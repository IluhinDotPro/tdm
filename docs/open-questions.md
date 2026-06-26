# Открытые вопросы и владельцы

> Сводный **навигатор** по открытым вопросам проекта. Без дублирования: каждый пункт ссылается на
> первоисточник (там детали и контекст), здесь — **владелец, приоритет, статус, ссылка**.
>
> Закрытые решения живут в источниках: [ADR-001](architecture-decision-variant3.md) §5,
> [domain/business-rules.md](domain/business-rules.md), [order-fsm/fsm-core-sync-checklist.md](order-fsm/fsm-core-sync-checklist.md) §4.
>
> **Легенда приоритета:** 🔴 блокер / до MVP · 🟡 к утверждению или после MVP · ⚪ детализация целевого FSM (later).
> **Обновлено:** 2026-06-26.

---

## Сводка блокеров (🔴 — мешают MVP)

1. **Timer Worker не построен** — таймерные переходы `order_expire` (T15) / `order_no_show` (T16) **есть в
   seed**, но в рантайме не срабатывают → штатный сценарий заказа зависает. Владелец: **@spitegod**.
   → [fsm-core-design.md](order-fsm/fsm-core-design.md) §11, [timers.md](order-fsm/timers.md) §1, [fsm-core-sync-checklist.md](order-fsm/fsm-core-sync-checklist.md) §5.
2. **`availableActions` через Domain API** + **атомарность записи состояния** (`orders.status` ↔ `server_fsm_instances`). Владелец: **@spitegod**.
   → [fsm-core-design.md](order-fsm/fsm-core-design.md) §11.
3. **Выбор кодовой базы** (MultiBot vs WATaxiBot) — ждёт утверждения заказчиком; рекомендация — **MultiBot**.
   → [gap-analysis.md](gap-analysis.md) §4, [implementation-plan.md](implementation-plan.md).

---

## @spitegod — ядро серверного FSM / сервер

| Вопрос | Приоритет | Статус | Источник |
|---|---|---|---|
| Timer Worker (`order_expire`/`order_no_show` по `next_timer_at`) | 🔴 до MVP | зона сервера | [fsm-core-design §11](order-fsm/fsm-core-design.md) · [timers §1](order-fsm/timers.md) |
| `availableActions` в снапшоте Domain API | 🔴 до MVP | ждёт API | [fsm-core-design §11](order-fsm/fsm-core-design.md) |
| Атомарность `orders.status` ↔ `server_fsm_instances` | 🔴 до MVP | открыт | [fsm-core-design §11](order-fsm/fsm-core-design.md) |
| Event store / outbox / идемпотентность (есть только `fsm_action_logs`) | 🟡 после MVP | открыт | [fsm-core-design §11 #6](order-fsm/fsm-core-design.md) |
| Развитие ядра: guard / effect / timer subsystem / context / registry (9 вопросов) | 🟡 эволюция движка | **RFC отправлен** | [fsm-engine-rfc.md](order-fsm/fsm-engine-rfc.md) |
| `idempotencyKey` в Command API B0 | 🟡 | рекомендация | [domain-api-contract §Открытые](domain-api-contract.md) |
| Push-транспорт (webhook/SSE/WS) + формат доставки снапшота | 🟡 след. этап | отложено | [domain-api-contract §Открытые](domain-api-contract.md) |
| Сроки готовности серверного API (create + read state) | ⏳ | без даты | [bot-domain-api-contract §7](integration/bot-domain-api-contract.md) |

---

## Бэкенд-команда — iBronevik / Core Adapter

| Вопрос | Приоритет | Статус | Источник |
|---|---|---|---|
| Семантика принятия OFFER / контр-цены (помимо `set_performer`) | 🟡 для веток VOTE/OFFER | ⏳ уточнить | [order-gateway-contract §Открытые](integration/order-gateway-contract.md) |
| Схема `offers[]` (цена / eta / comment), симметрично `candidates[]` | 🟡 | согласовать | [bot-domain-api-contract §7](integration/bot-domain-api-contract.md) |
| Payload `pickup-fee`, `boarding/confirm` (код посадки VOTE), `rating` | 🟡 | согласовать | [bot-domain-api-contract §7](integration/bot-domain-api-contract.md) |
| Состав кандидатов/предложений для отрисовки (в поллинге VOTE/OFFER/DIRECT неразличимы) | 🟡 | частично (`drivers[]` + `c_options`) | [ROADMAP §4](ROADMAP.md) · [events §1](order-fsm/events.md) |

---

## Заказчик (Валентин) — бизнес-правила

| Вопрос | Приоритет | Статус | Источник |
|---|---|---|---|
| Состав справочника причин отмены пассажиром (для Марокко) | 🟡 для UI отмены | не задан | [business-rules §4.1.1](domain/business-rules.md) · [tracking-fsm §1](bot-fsm/tracking-fsm.md) |
| Источник `Minimum Ride Price` по регионам Марокко | 🟡 | открыт | [business-rules §Открытые](domain/business-rules.md) |
| Правила корректировки `Actual` за попутчиков (Petit Taxi) | ⚪ | формализовать | [business-rules §Открытые](domain/business-rules.md) |

---

## Детализация домена / целевого FSM (после MVP, ⚪)

| Вопрос | Источник |
|---|---|
| Событие и атрибуты `RIDE_INTERRUPTED` (причина, точка фактической высадки, расчёт суммы) | [business-rules §Открытые](domain/business-rules.md) |
| Финальные правила Carrier Determination для VOTE | [execution-models §Открытые](domain/execution-models.md) |
| Состояния `EN_ROUTE` / `HEADING_TO_PICKUP` после `ASSIGNED` | [execution-models §Открытые](domain/execution-models.md) |
| Re-matching / Re-assignment (отказ водителя) — частично есть, saga после MVP | [execution-models §Открытые](domain/execution-models.md) · [fsm-core-sync-checklist §4](order-fsm/fsm-core-sync-checklist.md) |
| Параллельные таймеры, приоритеты; маппинг на `b_max_waiting` + votingTimer | [timers §3](order-fsm/timers.md) · [fsm-engine-rfc.md](order-fsm/fsm-engine-rfc.md) |

---

> **Недавно закрыто** (для контекста, чтобы не открывать повторно): режимы MVP — **все 3** (DIRECT/VOTE/OFFER,
> [ROADMAP §0](ROADMAP.md)); владелец состояния — **серверный Domain FSM** ([ADR-001](architecture-decision-variant3.md));
> no-show — **специфичен для VOTE**, для DIRECT/OFFER ручная отмена ([business-rules.md](domain/business-rules.md) §4.3);
> ценообразование — в **Core** ([ADR-001](architecture-decision-variant3.md) §5); 12 состояний движка сверены 1:1
> ([states.md](order-fsm/states.md) §1a).
