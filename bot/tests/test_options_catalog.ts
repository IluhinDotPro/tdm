/**
 * Тесты доменного справочника опций заказа (Блок A4).
 * Чистая функция resolveOptionIds: без Redis/API/UI. Фиксирует поведение, вынесенное из MainHandler
 * (бывш. инлайн whitelist/tokenMap + booking_comments в state main.options) — 1:1.
 *
 * Запуск (без node_modules):
 *   npx -y -p typescript@5.6.3 tsc tests/test_options_catalog.ts --outDir <tmp> \
 *     --module commonjs --target es2022 --esModuleInterop --strict --skipLibCheck
 *   node <tmp>/tests/test_options_catalog.js
 * (или: npx ts-node tests/test_options_catalog.ts)
 */
import assert from 'assert';
import { resolveOptionIds, ALLOWED_OPTION_IDS, BookingComments } from '../src/engine/children/order/optionsCatalog';

let passed = 0;
function ok(name: string) { passed++; console.log(`✅ ${name}`); }

// Каталог из API: все курируемые опции присутствуют; 5 присутствует, но hidden; 9 присутствует вне курации.
const catalog: BookingComments = {
  '1': { title: 'a' }, '2': { title: 'b' }, '4': { title: 'd' },
  '6': { title: 'f' }, '7': { title: 'g' }, '8': { title: 'h' },
  '5': { title: 'e', options: { hidden: true } },
  '9': { title: 'i' },
};

// ==================== happy path ====================
{
  const r = resolveOptionIds('1 4 7', catalog);
  assert.deepStrictEqual(r, { ok: true, ids: [1, 4, 7] });

  const one = resolveOptionIds('8', catalog);
  assert.deepStrictEqual(one, { ok: true, ids: [8] });
  ok('валидный ввод → числовые id в порядке ввода');
}

// ==================== нормализация пробелов ====================
{
  const r = resolveOptionIds('1   4    7', catalog);
  assert.deepStrictEqual(r, { ok: true, ids: [1, 4, 7] }, 'кратные пробелы схлопываются');
  ok('кратные/крайние пробелы нормализуются');
}

// ==================== пустой ввод → пустой список ====================
{
  const r = resolveOptionIds('', catalog);
  assert.deepStrictEqual(r, { ok: true, ids: [] }, 'пустой ввод = опции не выбраны');
  ok('пустой ввод → ok с пустым списком');
}

// ==================== нет каталога booking_comments → fail ====================
{
  assert.deepStrictEqual(resolveOptionIds('1', null), { ok: false });
  assert.deepStrictEqual(resolveOptionIds('1', undefined), { ok: false });
  ok('нет booking_comments → ok=false (fail-closed)');
}

// ==================== вне курации (allowed) → fail ====================
{
  // "3" и "5" не в ALLOWED_OPTION_IDS — даже если 5 есть в каталоге.
  assert.deepStrictEqual(resolveOptionIds('3', catalog), { ok: false }, '3 вне курации');
  assert.deepStrictEqual(resolveOptionIds('5', catalog), { ok: false }, '5 вне курации');
  // "9" есть в каталоге, не hidden, но не в курации → fail.
  assert.deepStrictEqual(resolveOptionIds('9', catalog), { ok: false }, '9 в каталоге, но вне курации');
  // один невалидный токен в составе валит весь ввод.
  assert.deepStrictEqual(resolveOptionIds('1 3 7', catalog), { ok: false }, 'смесь: один вне курации → весь fail');
  ok('опции вне курации (3/5/9) → ok=false');
}

// ==================== нет в booking_comments / hidden → fail ====================
{
  // курируемая опиция, но отсутствует в каталоге API.
  const sparse: BookingComments = { '1': { title: 'a' } };
  assert.deepStrictEqual(resolveOptionIds('2', sparse), { ok: false }, '2 в курации, но нет в каталоге');
  // hidden в каталоге → fail (через явную курацию, где 5 разрешён).
  assert.deepStrictEqual(resolveOptionIds('5', catalog, ['5']), { ok: false }, 'hidden → fail даже если в курации');
  ok('нет в booking_comments / hidden → ok=false');
}

// ==================== нечисловой / отрицательный токен → fail ====================
{
  assert.deepStrictEqual(resolveOptionIds('abc', catalog), { ok: false }, 'нечисловой вне курации');
  // подменим курацию, чтобы проверить именно числовой гейт, а не курацию.
  assert.deepStrictEqual(resolveOptionIds('abc', catalog, ['abc']), { ok: false }, 'нечисловой → не число');
  assert.deepStrictEqual(resolveOptionIds('-1', catalog, ['-1']), { ok: false }, 'отрицательный → fail');
  ok('нечисловой/отрицательный токен → ok=false');
}

// ==================== курация по умолчанию = ALLOWED_OPTION_IDS ====================
{
  assert.deepStrictEqual([...ALLOWED_OPTION_IDS], ['1', '2', '4', '6', '7', '8'], 'курация = бывш. whitelist схемы');
  ok('ALLOWED_OPTION_IDS = бывш. additionalOptionsAllowed из main.json');
}

console.log(`\n${passed} групп пройдено.`);
