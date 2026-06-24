/**
 * Тесты классификатора природы события (Блок A2, docs/bot-fsm/event-model.md §1–2).
 * Чистые функции: без Redis/API/UI.
 *
 * Запуск (без node_modules):
 *   npx -y -p typescript@5.6.3 tsc tests/test_event_nature.ts --outDir <tmp> \
 *     --module commonjs --target es2022 --esModuleInterop --strict --skipLibCheck
 *   node <tmp>/tests/test_event_nature.js
 * (или: npx ts-node tests/test_event_nature.ts)
 */
import assert from 'assert';
import { eventNature, isDomainEvent, isSystemEvent, isUiEvent } from '../src/engine/eventNature';

let passed = 0;
function ok(name: string) { passed++; console.log(`✅ ${name}`); }

// ==================== Domain (order_status_*) ====================
{
  for (const e of ['order_status_approved', 'order_status_completed', 'order_status_driver_arrived', 'order_status_out_of_time']) {
    assert.strictEqual(eventNature(e), 'domain', e);
    assert.strictEqual(isDomainEvent(e), true, e);
    assert.strictEqual(isSystemEvent(e), false, e);
    assert.strictEqual(isUiEvent(e), false, e);
  }
  ok('order_status_* → domain');
}

// ==================== System (sys_*) — таргет-конвенция ====================
{
  for (const e of ['sys_drivers_found', 'sys_no_drivers']) {
    assert.strictEqual(eventNature(e), 'system', e);
    assert.strictEqual(isSystemEvent(e), true, e);
    assert.strictEqual(isDomainEvent(e), false, e);
  }
  ok('sys_* → system');
}

// ==================== UI (всё остальное) ====================
{
  for (const e of ['confirm', 'exit', 'ok', 'error', 'help', 'skip', 'mode_offer', 'select_candidate']) {
    assert.strictEqual(eventNature(e), 'ui', e);
    assert.strictEqual(isUiEvent(e), true, e);
    assert.strictEqual(isDomainEvent(e), false, e);
    assert.strictEqual(isSystemEvent(e), false, e);
  }
  ok('короткие события без префикса → ui');
}

// ==================== Граница: существующие System-события БЕЗ префикса = ui (до Этапа 6) ====================
{
  // Сегодня менеджеры шлют drivers_found без sys_ → классятся как ui, пока схемы не переименованы.
  assert.strictEqual(eventNature('drivers_found'), 'ui', 'без префикса → ui (документированное ограничение)');
  assert.strictEqual(eventNature('no_drivers'), 'ui');
  ok('System без префикса → ui (ограничение конвенции, Этап 6)');
}

// ==================== Граница: префикс как подстрока в середине не считается ====================
{
  assert.strictEqual(eventNature('x_order_status_approved'), 'ui', 'префикс только в начале');
  assert.strictEqual(eventNature('order_status_'), 'domain', 'голый префикс = domain');
  ok('префикс учитывается только в начале строки');
}

console.log(`\n${passed} групп пройдено.`);
