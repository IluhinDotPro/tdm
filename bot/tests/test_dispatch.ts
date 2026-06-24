/**
 * Тесты чистого ядра движка computeTransition (Блок A3, dsl-spec §5, event-model §3).
 * Без Redis: схема собирается в памяти.
 *
 * Запуск:
 *   npx ts-node tests/test_dispatch.ts
 */
import assert from 'assert';
import { computeTransition, findState } from '../src/engine/dispatch';
import { TenantSchema } from '../src/engine/types';

let passed = 0;
function ok(name: string) { passed++; console.log(`✅ ${name}`); }

// Минимальная схема form-FSM такси: ветвление режима через guard (form-fsm §2).
const schema: TenantSchema = {
  initialState: 'form.start',
  actions: {},
  flowSelection: { strategy: 'first_match', flows: [] },
  flows: {
    form: {
      name: 'form',
      actions: {},
      states: {
        'form.mode': {
          id: 'form.mode',
          transitions: [
            { event: 'ok', guard: 'order.mode == "OFFER"', to: 'form.offerPrice', actions: ['saveMode'] },
            { event: 'ok', to: 'form.confirm', actions: ['saveMode'] }, // DIRECT/VOTE
            { event: 'exit', to: 'form.start', actions: [] },
          ],
        },
        'form.offerPrice': {
          id: 'form.offerPrice',
          entryActions: ['sendAskPrice'],
          transitions: [{ event: 'ok', to: 'form.confirm', actions: ['savePrice'] }],
        },
        'form.confirm': {
          id: 'form.confirm',
          entryActions: ['sendConfirm'],
          transitions: [{ event: 'confirm', to: 'order.start', actions: ['createOrder'] }],
        },
        'form.start': { id: 'form.start', transitions: [] },
      },
    },
  },
};

// --- findState ---
{
  assert.strictEqual(findState(schema, 'form.mode')?.id, 'form.mode');
  assert.strictEqual(findState(schema, 'order.start'), undefined, 'нет такого состояния');
  ok('findState');
}

// --- ветвление по guard + entryActions целевого состояния ---
{
  const offer = computeTransition(schema, 'form.mode', { order: { mode: 'OFFER' } }, 'ok');
  assert.deepStrictEqual(offer, {
    from: 'form.mode', to: 'form.offerPrice', actions: ['saveMode'], entryActions: ['sendAskPrice'],
  });

  const direct = computeTransition(schema, 'form.mode', { order: { mode: 'DIRECT' } }, 'ok');
  assert.deepStrictEqual(direct, {
    from: 'form.mode', to: 'form.confirm', actions: ['saveMode'], entryActions: ['sendConfirm'],
  });
  ok('first_match по guard + entryActions из целевого состояния');
}

// --- событие без перехода → to=null ---
{
  const r = computeTransition(schema, 'form.mode', {}, 'nope');
  assert.deepStrictEqual(r, { from: 'form.mode', to: null, actions: [], entryActions: [] });
  ok('нет события → to=null');
}

// --- неизвестное состояние → to=null ---
{
  const r = computeTransition(schema, 'form.unknown', {}, 'ok');
  assert.deepStrictEqual(r, { from: 'form.unknown', to: null, actions: [], entryActions: [] });
  ok('неизвестное состояние → to=null');
}

// --- целевое состояние без entryActions ---
{
  const r = computeTransition(schema, 'form.mode', {}, 'exit');
  assert.strictEqual(r.to, 'form.start');
  assert.deepStrictEqual(r.entryActions, [], 'нет entryActions → []');
  ok('целевое состояние без entryActions');
}

// --- битый guard → переход пропущен, onGuardError вызван ---
{
  const broken: TenantSchema = {
    ...schema,
    flows: {
      form: {
        name: 'form',
        actions: {},
        states: {
          'form.x': {
            id: 'form.x',
            transitions: [
              { event: 'go', guard: 'order.y &&', to: 'form.broken', actions: [] },
              { event: 'go', to: 'form.ok', actions: [] },
              { event: 'go', to: 'form.never', actions: [] },
            ],
          },
          'form.ok': { id: 'form.ok', transitions: [] },
        },
      },
    },
  };
  let errs = 0;
  const r = computeTransition(broken, 'form.x', {}, 'go', () => { errs++; });
  assert.strictEqual(r.to, 'form.ok', 'битый guard пропущен, взят следующий');
  assert.strictEqual(errs, 1, 'onGuardError вызван один раз');
  ok('битый guard пропускается (fail-closed) + reporter');
}

console.log(`\n🎉 Все тесты dispatch пройдены (${passed} групп).`);
