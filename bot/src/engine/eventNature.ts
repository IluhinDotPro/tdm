/**
 * Природа события FSM (Блок A2, docs/bot-fsm/event-model.md §1–2).
 *
 * Движок обрабатывает все события единообразно (как `event` в transition), но их ПРИРОДА различна:
 *   - UI     — ввод пользователя (validation/location): confirm, exit, ok, error, выбор пункта;
 *   - System — внутренние менеджеры бота: drivers_found, no_drivers (таргет-префикс `sys_`);
 *   - Domain — внешний FSM заказа: `order_status_*` (под Вариантом 3 приходят от серверного API
 *              как доменные состояния; см. docs/architecture-decision-variant3.md).
 *
 * Этот модуль — единый источник истины по классификации. Конвенция именования (event-model §2):
 *   Domain = префикс `order_status_` (как сейчас, точно и надёжно уже сегодня);
 *   System = префикс `sys_` (ТАРГЕТ; существующие System-события пока без префикса → классятся как UI
 *            до необязательного переименования схем на Этапе 6);
 *   UI     = всё остальное.
 *
 * Domain-классификация важна для гарантии «Domain-события не теряются» (event-model §4): если в
 * текущем состоянии нет перехода по доменному событию, его потеря должна быть как минимум видимой.
 */

export type EventNature = 'ui' | 'system' | 'domain';

export const DOMAIN_EVENT_PREFIX = 'order_status_';
export const SYSTEM_EVENT_PREFIX = 'sys_';

/** Классифицирует событие по его имени (см. конвенцию выше). */
export function eventNature(event: string): EventNature {
  if (event.startsWith(DOMAIN_EVENT_PREFIX)) return 'domain';
  if (event.startsWith(SYSTEM_EVENT_PREFIX)) return 'system';
  return 'ui';
}

/** Domain-событие (`order_status_*`) — из внешнего FSM заказа / серверного API. */
export function isDomainEvent(event: string): boolean {
  return event.startsWith(DOMAIN_EVENT_PREFIX);
}

/** System-событие (`sys_*`) — из внутренних менеджеров бота (таргет-конвенция). */
export function isSystemEvent(event: string): boolean {
  return event.startsWith(SYSTEM_EVENT_PREFIX);
}

/** UI-событие — ввод пользователя (всё, что не Domain и не System по префиксу). */
export function isUiEvent(event: string): boolean {
  return eventNature(event) === 'ui';
}
