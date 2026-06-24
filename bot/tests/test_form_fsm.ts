/**
 * Тесты form-FSM такси (Блоки C2 + C3, см. docs/bot-fsm/form-fsm.md).
 *
 * Что проверяем — поверх НАСТОЯЩЕГО ядра движка `computeTransition` (A3) и guard (A1):
 *   C2: форма такси собрана корректно — путь start→from→to→people→carClass→options→when→mode
 *       и навигация (exit на каждом шаге сбора возвращает в form.start);
 *   C3: ветвление по режиму:
 *       - на form.mode выбор раскладывается на 3 ветки (DIRECT/VOTE → confirm, OFFER → offerPrice);
 *       - на form.confirm GUARD по order.mode разводит сценарий создания:
 *           DIRECT  → поиск водителя ботом (form.driverSearch),
 *           VOTE/OFFER → прямое создание (cross-flow в order.start).
 *
 * Тест грузит РЕАЛЬНЫЙ черновик схемы `schemas/` (form.json + order.json + _init.json) тем же
 * способом, что и FSMManager.loadSchemaFromFolder, поэтому проверяется сам артефакт дизайна, а не
 * его копия. Cross-flow form.* → order.start резолвится против настоящего order.json.
 *
 * Без Redis/WhatsApp: ядро чистое, схема читается из файла.
 *
 * Запуск (без node_modules) — см. _workspace/notes/next-session-prompt.md:
 *   npx -y -p typescript@5.6.3 tsc tests/test_form_fsm.ts \
 *     --outDir <tmp> --module commonjs --target es2022 --esModuleInterop --strict --skipLibCheck
 *   node <tmp>/tests/test_form_fsm.js
 * (или: npx ts-node tests/test_form_fsm.ts)
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { computeTransition, findState } from '../src/engine/dispatch';
import { TenantSchema, Flow, State } from '../src/engine/types';

let passed = 0;
function ok(name: string) { passed++; console.log(`✅ ${name}`); }

// ==================== Загрузка черновика тенанта `schemas/` ====================
// Зеркало FSMManager.loadSchemaFromFolder (managers/FSMManager.ts §49-111): короткие ключи
// состояний → `<flow>.<short>`, сбор flows, проброс guard/validation/location.

function resolveSchemasDir(): string {
  const candidates = [
    path.resolve(process.cwd(), '../schemas'),       // запуск из bot/ (документированный способ)
    path.resolve(process.cwd(), 'schemas'),          // запуск из tdm/
    path.resolve(__dirname, '../../schemas'),         // src-расположение
    path.resolve(__dirname, '../../../schemas'),      // скомпилированное <tmp>/tests/ при rootDir=bot/
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'form.json'))) return dir;
  }
  throw new Error(`Не найден schemas/form.json. Пробовал: ${candidates.join(', ')}`);
}

function loadDraftTenant(dir: string): TenantSchema {
  const initSchema = JSON.parse(fs.readFileSync(path.join(dir, '_init.json'), 'utf8'));
  const flowFiles = fs.readdirSync(dir).filter((f: string) => f.endsWith('.json') && f !== '_init.json');

  const flows: Record<string, Flow> = {};
  for (const file of flowFiles) {
    const flowData = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const prefixedStates: Record<string, State> = {};
    for (const [stateName, stateData] of Object.entries(flowData.states || {})) {
      const s = stateData as any;
      prefixedStates[`${flowData.name}.${stateName}`] = {
        id: `${flowData.name}.${stateName}`,
        entryActions: s.entryActions || [],
        transitions: (s.transitions || []).map((t: any) => ({
          event: t.event,
          to: t.to,
          actions: t.actions || [],
          ...(t.guard != null && { guard: t.guard }),
        })),
        ...(s.validation && { validation: s.validation }),
        ...(s.actions && { actions: s.actions }),
        ...(s.location && { location: s.location }),
      };
    }
    flows[flowData.name] = {
      name: flowData.name,
      description: flowData.description,
      states: prefixedStates,
      actions: flowData.actions || {},
    };
  }

  return {
    initialState: initSchema.initialState,
    actions: initSchema.actions || {},
    flowSelection: initSchema.flowSelection || { strategy: 'first_match', flows: [] },
    flows,
  };
}

const schema = loadDraftTenant(resolveSchemasDir());

// Хелпер: прогнать событие и вернуть результат перехода.
function step(state: string, event: string, memory: Record<string, any> = {}) {
  return computeTransition(schema, state, memory, event);
}

// ==================== 0. Схема загрузилась и нормализовалась ====================
{
  assert.ok(schema.flows.form, 'flow form присутствует');
  assert.ok(schema.flows.order, 'flow order присутствует (для cross-flow)');
  assert.strictEqual(findState(schema, 'form.mode')?.id, 'form.mode');
  assert.strictEqual(findState(schema, 'order.start')?.id, 'order.start', 'cross-flow цель резолвится');
  ok('черновик schemas/ грузится как тенант (form + order), id состояний нормализованы');
}

// ==================== C2. Сбор данных: happy path start→…→mode ====================
{
  // start --order_creation--> form.from (+ очистка и приглашение ввести точку отправления)
  const s0 = step('form.start', 'order_creation');
  assert.strictEqual(s0.to, 'form.from');
  assert.deepStrictEqual(s0.actions, ['clearOrderData', 'sendFrom']);

  // Линейная цепочка сбора. Пары [состояние, событие, ожидаемое следующее состояние].
  const chain: Array<[string, string, string]> = [
    ['form.from', 'ok', 'form.to'],
    ['form.to', 'ok', 'form.people'],
    ['form.people', 'ok', 'form.carClass'],
    ['form.carClass', 'ok', 'form.options'],
    ['form.options', 'ok', 'form.when'],
    ['form.when', 'ok', 'form.mode'],
  ];
  for (const [from, event, to] of chain) {
    const r = step(from, event);
    assert.strictEqual(r.to, to, `${from} --${event}--> ${to} (получено ${r.to})`);
  }

  // options допускает «пропустить» (0 → skip), ведёт туда же, что и ok.
  assert.strictEqual(step('form.options', 'skip').to, 'form.when', 'options: skip → when');
  ok('C2: сбор данных start→from→to→people→carClass→options→when→mode (happy path)');
}

// ==================== C2. Навигация: exit на каждом шаге → form.start ====================
{
  const cancellable = ['form.from', 'form.to', 'form.people', 'form.carClass', 'form.mode', 'form.offerPrice'];
  for (const st of cancellable) {
    const r = step(st, 'exit');
    assert.strictEqual(r.to, 'form.start', `${st} --exit--> form.start (получено ${r.to})`);
  }
  ok('C2: отмена (exit) из любого шага сбора возвращает в form.start');
}

// ==================== C3. form.mode раскладывает выбор на 3 ветки ====================
{
  const direct = step('form.mode', 'mode_direct');
  assert.strictEqual(direct.to, 'form.confirm');
  assert.deepStrictEqual(direct.actions, ['saveModeDirect', 'sendOrderConfirmation']);

  const vote = step('form.mode', 'mode_vote');
  assert.strictEqual(vote.to, 'form.confirm');
  assert.deepStrictEqual(vote.actions, ['saveModeVote', 'sendOrderConfirmation']);

  // OFFER — отдельный шаг ввода цены ПЕРЕД подтверждением.
  const offer = step('form.mode', 'mode_offer');
  assert.strictEqual(offer.to, 'form.offerPrice');
  assert.deepStrictEqual(offer.actions, ['saveModeOffer', 'sendEnterOfferPrice']);

  // offerPrice --ok--> confirm
  assert.strictEqual(step('form.offerPrice', 'ok').to, 'form.confirm', 'offerPrice → confirm');
  ok('C3: form.mode → {DIRECT,VOTE}→confirm, OFFER→offerPrice→confirm');
}

// ==================== C3. GUARD на form.confirm разводит сценарий создания ====================
{
  // DIRECT: бот сам ищет водителя → form.driverSearch.
  const direct = step('form.confirm', 'confirm', { order: { mode: 'DIRECT' } });
  assert.strictEqual(direct.to, 'form.driverSearch', 'DIRECT → driverSearch (guard order.mode == DIRECT)');
  assert.deepStrictEqual(direct.actions, ['mergeWaitingForDrivers', 'startDriverSearch']);

  // VOTE: прямое создание → cross-flow в order.start.
  const vote = step('form.confirm', 'confirm', { order: { mode: 'VOTE' } });
  assert.strictEqual(vote.to, 'order.start', 'VOTE → order.start (guard order.mode != DIRECT)');
  assert.deepStrictEqual(vote.actions, ['createOrder']);

  // OFFER: тоже прямое создание.
  const offer = step('form.confirm', 'confirm', { order: { mode: 'OFFER' } });
  assert.strictEqual(offer.to, 'order.start', 'OFFER → order.start');
  assert.deepStrictEqual(offer.actions, ['createOrder']);

  // Cross-flow handoff реален: целевое order.start существует в order.json.
  assert.ok(findState(schema, 'order.start'), 'order.start — реальное состояние tracking-FSM');
  ok('C3: guard на confirm разводит DIRECT→driverSearch vs VOTE/OFFER→order.start');
}

// ==================== C3. Семантика guard при незаданном order.mode (edge) ====================
{
  // Если mode не задан: guard "order.mode == 'DIRECT'" ложен (undefined→null != 'DIRECT'),
  // второй "order.mode != 'DIRECT'" истинен → дефолт = прямое создание (order.start), НЕ driverSearch.
  const r = step('form.confirm', 'confirm', {});
  assert.strictEqual(r.to, 'order.start', 'mode не задан → дефолт прямое создание (fail к VOTE/OFFER-ветке)');
  ok('C3 (edge): при незаданном order.mode confirm уходит в order.start (документированная семантика)');
}

// ==================== C2/C3. DIRECT: driverSearch → driverList → order.start ====================
{
  // System-события поиска (event-model §1).
  const found = step('form.driverSearch', 'drivers_found');
  assert.strictEqual(found.to, 'form.driverList', 'drivers_found → driverList');

  const none = step('form.driverSearch', 'no_drivers');
  assert.strictEqual(none.to, 'form.start', 'no_drivers → form.start (заказ отменён)');
  assert.ok(none.actions.includes('clearOrderData'), 'no_drivers чистит данные заказа');

  // Выбор водителя из списка → создание заказа, cross-flow в tracking.
  const picked = step('form.driverList', 'ok');
  assert.strictEqual(picked.to, 'order.start', 'driverList: ok → order.start');
  assert.deepStrictEqual(picked.actions, ['createOrder']);
  ok('C2/C3: DIRECT-ветка driverSearch→driverList→order.start (+ no_drivers→start)');
}

// ==================== Полный сквозной прогон трёх режимов ====================
{
  // Прогоняем форму как последовательность переходов, имитируя накопление order.mode в памяти
  // (в бою mode пишется validation/action ДО confirm — здесь подаём напрямую в память на шаге confirm).
  type Scenario = { mode: string; modeEvent: string; viaOfferPrice: boolean; confirmTo: string };
  const scenarios: Scenario[] = [
    { mode: 'DIRECT', modeEvent: 'mode_direct', viaOfferPrice: false, confirmTo: 'form.driverSearch' },
    { mode: 'VOTE',   modeEvent: 'mode_vote',   viaOfferPrice: false, confirmTo: 'order.start' },
    { mode: 'OFFER',  modeEvent: 'mode_offer',  viaOfferPrice: true,  confirmTo: 'order.start' },
  ];

  for (const sc of scenarios) {
    let state = 'form.start';
    state = step(state, 'order_creation').to!;            // → form.from
    for (const ev of ['ok', 'ok', 'ok', 'ok', 'ok', 'ok']) state = step(state, ev).to!; // → form.mode
    assert.strictEqual(state, 'form.mode', `[${sc.mode}] добрались до form.mode`);

    state = step(state, sc.modeEvent).to!;               // → confirm | offerPrice
    if (sc.viaOfferPrice) {
      assert.strictEqual(state, 'form.offerPrice', `[${sc.mode}] OFFER → offerPrice`);
      state = step(state, 'ok').to!;                     // → form.confirm
    }
    assert.strictEqual(state, 'form.confirm', `[${sc.mode}] перед подтверждением — form.confirm`);

    const fin = step(state, 'confirm', { order: { mode: sc.mode } });
    assert.strictEqual(fin.to, sc.confirmTo, `[${sc.mode}] confirm → ${sc.confirmTo} (получено ${fin.to})`);
  }
  ok('Сквозной прогон формы для DIRECT / VOTE / OFFER завершается ожидаемой целью');
}

console.log(`\n🎉 Все тесты form-FSM пройдены (${passed} групп).`);
