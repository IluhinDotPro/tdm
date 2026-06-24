/**
 * Тесты расчёта Actual Price (Блок C4, бизнес-правила docs/domain/business-rules.md §1–§2).
 * Чистая доменная функция: без Redis/API/UI.
 *
 * Запуск (без node_modules):
 *   npx -y -p typescript@5.6.3 tsc tests/test_actual_price.ts --outDir <tmp> \
 *     --module commonjs --target es2022 --esModuleInterop --strict --skipLibCheck
 *   node <tmp>/tests/test_actual_price.js
 * (или: npx ts-node tests/test_actual_price.ts)
 */
import assert from 'assert';
import { computeActualPrice } from '../src/engine/children/order/actualPrice';

let passed = 0;
function ok(name: string) { passed++; console.log(`✅ ${name}`); }

// ==================== §2.1 PETIT (таксометр) ====================
{
  // Actual = таксометр + Pickup Fee, выше минимума → флор не срабатывает.
  const r = computeActualPrice({ mode: 'PETIT', taximeter: 100, pickupFee: 20, minimumRidePrice: 50 });
  assert.strictEqual(r.rideCost, 100);
  assert.strictEqual(r.pickupApplied, 20, 'PETIT учитывает Pickup Fee');
  assert.strictEqual(r.subtotal, 120);
  assert.strictEqual(r.actual, 120);
  assert.strictEqual(r.flooredToMinimum, false);

  // Без Pickup Fee и Minimum.
  const bare = computeActualPrice({ mode: 'PETIT', taximeter: 80 });
  assert.strictEqual(bare.actual, 80);
  assert.strictEqual(bare.pickupApplied, 0);
  ok('§2.1 PETIT: Actual = таксометр + Pickup Fee');
}

// ==================== §2.1 PETIT: флор Minimum ====================
{
  // таксометр+pickup < Minimum → к оплате Minimum.
  const r = computeActualPrice({ mode: 'PETIT', taximeter: 10, pickupFee: 5, minimumRidePrice: 50 });
  assert.strictEqual(r.subtotal, 15);
  assert.strictEqual(r.actual, 50, 'Actual поднят до Minimum');
  assert.strictEqual(r.flooredToMinimum, true);
  ok('§2.1 PETIT: Actual < Minimum → к оплате Minimum (флор)');
}

// ==================== §2.1 PETIT: корректировка маршрута (попутчики) ====================
{
  // Отрицательная корректировка (скидка) допускается; стоимость поездки не ниже 0.
  const r = computeActualPrice({ mode: 'PETIT', taximeter: 100, adjustment: -30, pickupFee: 10 });
  assert.strictEqual(r.rideCost, 70, 'таксометр + корректировка');
  assert.strictEqual(r.actual, 80);

  const clamped = computeActualPrice({ mode: 'PETIT', taximeter: 20, adjustment: -100 });
  assert.strictEqual(clamped.rideCost, 0, 'стоимость поездки не уходит ниже 0');
  ok('§2.1 PETIT: корректировка за попутчиков (вкл. отрицательную)');
}

// ==================== §2.2 OFFER ====================
{
  // Actual = принятая цена водителя; Pickup Fee НЕ применяется даже если передан.
  const r = computeActualPrice({ mode: 'OFFER', acceptedDriverPrice: 120, pickupFee: 30, minimumRidePrice: 50 });
  assert.strictEqual(r.rideCost, 120);
  assert.strictEqual(r.pickupApplied, 0, 'OFFER: Pickup Fee отсутствует (§2.2)');
  assert.strictEqual(r.actual, 120);

  // Флор Minimum применяется и в OFFER.
  const floored = computeActualPrice({ mode: 'OFFER', acceptedDriverPrice: 40, minimumRidePrice: 50 });
  assert.strictEqual(floored.actual, 50);
  assert.strictEqual(floored.flooredToMinimum, true);
  ok('§2.2 OFFER: Actual = принятая цена водителя, без Pickup Fee, флор Minimum');
}

// ==================== §2.3 DIRECT (не-Petit) ====================
{
  // Actual = договорённость; Pickup Fee программно не прибавляется (учтён в договорённости).
  const r = computeActualPrice({ mode: 'DIRECT', agreedAmount: 90, pickupFee: 25, minimumRidePrice: 50 });
  assert.strictEqual(r.rideCost, 90);
  assert.strictEqual(r.pickupApplied, 0, 'DIRECT: Pickup Fee не прибавляется поверх договорённости');
  assert.strictEqual(r.actual, 90);

  // Инвариант флора действует и для DIRECT.
  const floored = computeActualPrice({ mode: 'DIRECT', agreedAmount: 30, minimumRidePrice: 50 });
  assert.strictEqual(floored.actual, 50);
  ok('§2.3 DIRECT: Actual = договорённость, флор Minimum как инвариант');
}

// ==================== Инвариант §1: Actual ≥ Minimum всегда ====================
{
  const modes = [
    computeActualPrice({ mode: 'PETIT', taximeter: 0, minimumRidePrice: 50 }),
    computeActualPrice({ mode: 'OFFER', acceptedDriverPrice: 0, minimumRidePrice: 50 }),
    computeActualPrice({ mode: 'DIRECT', agreedAmount: 0, minimumRidePrice: 50 }),
  ];
  for (const r of modes) assert.ok(r.actual >= 50, `Actual (${r.actual}) ≥ Minimum`);
  ok('§1 инвариант: Actual ≥ Minimum во всех режимах');
}

// ==================== Валидация входа (ошибка вызова, не данных) ====================
{
  // Отсутствует обязательное поле режима.
  assert.throws(() => computeActualPrice({ mode: 'PETIT' }), /taximeter/, 'PETIT без таксометра');
  assert.throws(() => computeActualPrice({ mode: 'OFFER' }), /acceptedDriverPrice/, 'OFFER без цены водителя');
  assert.throws(() => computeActualPrice({ mode: 'DIRECT' }), /agreedAmount/, 'DIRECT без договорённости');

  // Некорректные значения.
  assert.throws(() => computeActualPrice({ mode: 'PETIT', taximeter: -5 }), /отрицательн/);
  assert.throws(() => computeActualPrice({ mode: 'PETIT', taximeter: NaN }), /конечным числом/);
  assert.throws(() => computeActualPrice({ mode: 'OFFER', acceptedDriverPrice: 10, minimumRidePrice: -1 }), /отрицательн/);
  // @ts-expect-error — неизвестный режим
  assert.throws(() => computeActualPrice({ mode: 'XXX', agreedAmount: 1 }), /неизвестный режим/);
  ok('Валидация: обязательные поля по режиму + конечность/неотрицательность');
}

console.log(`\n🎉 Все тесты Actual Price пройдены (${passed} групп).`);
