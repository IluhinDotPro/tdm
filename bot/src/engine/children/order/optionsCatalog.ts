/**
 * Доменный справочник опций заказа (booking_comments / additionalOptions). Блок A4.
 *
 * Вынесен из generic-валидации движка: тип `ValidationRule` больше НЕ знает про опции
 * (раньше тащил `additionalOptionsAllowed` + `additionalOptionsTokenMap`). Курация «какие опции
 * предлагаются в этом флоу» — доменное знание и живёт здесь, а не в структуре FSM-схемы.
 *
 * Под Вариантом 3 (docs/architecture-decision-variant3.md) каталог опций — доменный и в перспективе
 * уходит на сервер: авторитетный источник — `booking_comments` из API. Здесь — клиентская курация
 * поверх него (какие из отдаваемых API опций предлагаем пользователю).
 */

/** Опции, предлагаемые в main.options поверх booking_comments. Бывш. validation.additionalOptionsAllowed. */
export const ALLOWED_OPTION_IDS: readonly string[] = ['1', '2', '4', '6', '7', '8'];

/** Запись авторитетного каталога опций из API (data.data.booking_comments[id]). */
export type BookingComment = { options?: { hidden?: boolean } } & Record<string, unknown>;
export type BookingComments = Record<string, BookingComment>;

export type ResolveOptionsResult =
  | { ok: true; ids: number[] }
  | { ok: false };

/**
 * Разбирает ввод опций («1 4 7») в числовые id, проверяя по курации (`allowed`) и авторитетному
 * каталогу `booking_comments` (существование + не hidden). Инкапсулирует бывш. инлайн-логику
 * MainHandler (state `main.options`). Поведение сохранено 1:1; тождественный tokenMap (1→1, 2→2…)
 * был no-op и удалён.
 *
 * @returns ok=true с id при успехе; ok=false при любой невалидности (нет каталога / не в курации /
 *          не число / нет в booking_comments / hidden). Пустой ввод → ok с пустым списком.
 */
export function resolveOptionIds(
  input: string,
  bookingComments: BookingComments | null | undefined,
  allowed: readonly string[] = ALLOWED_OPTION_IDS,
): ResolveOptionsResult {
  if (!bookingComments) return { ok: false };
  const parts = input.replace(/\s{2,}/g, ' ').trim().split(' ').filter(Boolean);
  const ids: number[] = [];
  for (const idStr of parts) {
    if (allowed.length && !allowed.includes(idStr)) return { ok: false };
    const numericId = Number(idStr);
    if (!Number.isFinite(numericId) || numericId < 0) return { ok: false };
    const comment = bookingComments[String(numericId)];
    if (!comment || comment.options?.hidden) return { ok: false };
    ids.push(numericId);
  }
  return { ok: true, ids };
}
