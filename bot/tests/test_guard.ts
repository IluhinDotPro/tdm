/**
 * Тесты Guard в DSL (Блок A1, dsl-spec §3):
 *   - evaluateGuard: операторы, пути по памяти, null-семантика, ошибки (fail-closed);
 *   - chooseTransition: выбор перехода first_match по guard.
 *
 * Запуск:
 *   npx ts-node tests/test_guard.ts
 */
import assert from 'assert';
import { evaluateGuard, parseGuard, GuardError } from '../src/engine/guard/evaluateGuard';
import { chooseTransition } from '../src/engine/guard/chooseTransition';

let passed = 0;
function ok(name: string) { passed++; console.log(`✅ ${name}`); }

// ==================== evaluateGuard ====================
{
  // Память-образец как в form-FSM такси
  const mem = {
    order: {
      from: 'Casablanca', to: 'Rabat', peopleCount: 3,
      mode: 'OFFER', clientPrice: 50, dispatchType: 'LATER', when: 1719230000000,
      input: { additionalOptions: [1, 2] },
    },
    user: { id: 42, registered: true, name: '' },
    snapshot: { candidates: ['dr1', 'dr2'], offers: [] },
  };

  // --- литералы и истинность ---
  assert.strictEqual(evaluateGuard('true', mem), true);
  assert.strictEqual(evaluateGuard('false', mem), false);
  assert.strictEqual(evaluateGuard('1', mem), true);
  assert.strictEqual(evaluateGuard('0', mem), false);
  assert.strictEqual(evaluateGuard(undefined, mem), true, 'нет guard → разрешён');
  assert.strictEqual(evaluateGuard('', mem), true, 'пустой guard → разрешён');
  ok('литералы и пустой guard');

  // --- пути и истинность пути ---
  assert.strictEqual(evaluateGuard('order.from', mem), true);
  assert.strictEqual(evaluateGuard('user.registered', mem), true);
  assert.strictEqual(evaluateGuard('user.name', mem), false, 'пустая строка → false');
  assert.strictEqual(evaluateGuard('order.missing', mem), false, 'отсутствующий путь → false');
  assert.strictEqual(evaluateGuard('order.input.additionalOptions', mem), true);
  ok('пути по памяти');

  // --- null-семантика ---
  assert.strictEqual(evaluateGuard('order.from != null', mem), true);
  assert.strictEqual(evaluateGuard('order.from == null', mem), false);
  assert.strictEqual(evaluateGuard('order.missing == null', mem), true, 'undefined == null');
  assert.strictEqual(evaluateGuard('order.missing != null', mem), false);
  ok('null-семантика (undefined == null)');

  // --- равенство строк/чисел ---
  assert.strictEqual(evaluateGuard('order.mode == "OFFER"', mem), true);
  assert.strictEqual(evaluateGuard("order.mode == 'VOTE'", mem), false);
  assert.strictEqual(evaluateGuard('order.peopleCount == 3', mem), true);
  assert.strictEqual(evaluateGuard('order.peopleCount != 3', mem), false);
  ok('равенство строк и чисел');

  // --- сравнения ---
  assert.strictEqual(evaluateGuard('order.peopleCount > 0', mem), true);
  assert.strictEqual(evaluateGuard('order.peopleCount >= 3', mem), true);
  assert.strictEqual(evaluateGuard('order.peopleCount < 3', mem), false);
  assert.strictEqual(evaluateGuard('order.clientPrice <= 50', mem), true);
  assert.strictEqual(evaluateGuard('order.missing > 0', mem), false, 'undefined > 0 → false');
  ok('сравнения чисел');

  // --- length массива ---
  assert.strictEqual(evaluateGuard('snapshot.candidates.length > 0', mem), true);
  assert.strictEqual(evaluateGuard('snapshot.offers.length > 0', mem), false);
  assert.strictEqual(evaluateGuard('order.input.additionalOptions.length == 2', mem), true);
  ok('доступ к .length');

  // --- логика и скобки ---
  assert.strictEqual(evaluateGuard('order.from != null && order.to != null && order.peopleCount > 0', mem), true);
  assert.strictEqual(evaluateGuard('order.mode == "OFFER" && order.clientPrice != null', mem), true);
  assert.strictEqual(evaluateGuard('order.dispatchType == "LATER" && order.when != null', mem), true);
  assert.strictEqual(evaluateGuard('order.mode == "VOTE" || order.mode == "OFFER"', mem), true);
  assert.strictEqual(evaluateGuard('!(order.peopleCount > 5)', mem), true);
  assert.strictEqual(evaluateGuard('!user.registered', mem), false);
  assert.strictEqual(evaluateGuard('(order.mode == "VOTE" || order.mode == "OFFER") && order.peopleCount > 0', mem), true);
  ok('логика, отрицание, скобки');

  // --- приоритет операторов: && связывает крепче || ---
  assert.strictEqual(evaluateGuard('false && false || true', mem), true);
  assert.strictEqual(evaluateGuard('true || false && false', mem), true);
  ok('приоритет && над ||');
}

// ==================== Ошибки (fail-closed) ====================
{
  // парсинг бросает
  assert.throws(() => parseGuard('order.from &&'), GuardError, 'неполное выражение');
  assert.throws(() => parseGuard('order.from = null'), GuardError, 'одиночный = недопустим');
  assert.throws(() => parseGuard('order..from'), GuardError, 'двойная точка');
  assert.throws(() => parseGuard('(order.from'), GuardError, 'незакрытая скобка');
  assert.throws(() => parseGuard('"abc'), GuardError, 'незакрытая строка');

  // evaluateGuard НЕ бросает — fail-closed (false) + onError
  let captured: unknown = null;
  const r = evaluateGuard('order.from &&', {}, { onError: (e) => { captured = e; } });
  assert.strictEqual(r, false, 'битый guard → false');
  assert(captured instanceof GuardError, 'onError получил GuardError');
  ok('ошибки: parseGuard бросает, evaluateGuard fail-closed');
}

// ==================== chooseTransition (first_match) ====================
{
  // Несколько переходов с одним событием, разные guard → берётся первый прошедший
  const transitions = [
    { event: 'confirm', guard: 'order.mode == "OFFER"', to: 'main.offerPrice', actions: ['a1'] },
    { event: 'confirm', guard: 'order.mode == "VOTE"', to: 'main.vote', actions: ['a2'] },
    { event: 'confirm', to: 'main.driverSearch', actions: ['a3'] }, // fallback без guard
    { event: 'cancel', to: 'main.start', actions: [] },
  ];

  // OFFER → первый
  assert.strictEqual(chooseTransition(transitions, 'confirm', { order: { mode: 'OFFER' } })?.to, 'main.offerPrice');
  // VOTE → второй
  assert.strictEqual(chooseTransition(transitions, 'confirm', { order: { mode: 'VOTE' } })?.to, 'main.vote');
  // DIRECT (ни один guard не прошёл) → fallback без guard
  assert.strictEqual(chooseTransition(transitions, 'confirm', { order: { mode: 'DIRECT' } })?.to, 'main.driverSearch');
  // другое событие
  assert.strictEqual(chooseTransition(transitions, 'cancel', {})?.to, 'main.start');
  // несуществующее событие
  assert.strictEqual(chooseTransition(transitions, 'nope', {}), undefined);
  ok('chooseTransition: first_match по guard + fallback');

  // Обратная совместимость: без guard ведёт себя как find(event)
  const plain = [
    { event: 'ok', to: 'main.to', actions: [] },
    { event: 'ok', to: 'main.other', actions: [] },
  ];
  assert.strictEqual(chooseTransition(plain, 'ok', {})?.to, 'main.to', 'первый по событию');
  ok('chooseTransition: обратная совместимость без guard');

  // Битый guard → переход пропускается, берётся следующий
  let errs = 0;
  const withBroken = [
    { event: 'go', guard: 'order.x &&', to: 'broken', actions: [] },
    { event: 'go', to: 'fallback', actions: [] },
  ];
  const chosen = chooseTransition(withBroken, 'go', {}, () => { errs++; });
  assert.strictEqual(chosen?.to, 'fallback', 'битый guard пропущен');
  assert.strictEqual(errs, 1, 'onGuardError вызван один раз');
  ok('chooseTransition: битый guard пропускается (fail-closed)');

  // Все guard ложны → undefined
  const allFalse = [
    { event: 'go', guard: 'false', to: 'a', actions: [] },
    { event: 'go', guard: 'order.x == 1', to: 'b', actions: [] },
  ];
  assert.strictEqual(chooseTransition(allFalse, 'go', { order: { x: 2 } }), undefined);
  ok('chooseTransition: все guard ложны → нет перехода');
}

console.log(`\n🎉 Все тесты Guard пройдены (${passed} групп).`);
