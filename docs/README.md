# Документация ТДМ

Индекс проектной документации.

## План
- [ROADMAP.md](ROADMAP.md) — план проекта по этапам, ключевые решения, открытые вопросы.

## Этап 1 — Доменный фундамент ✅
- [domain/glossary.md](domain/glossary.md) — единый словарь терминов.
- [domain/order-model.md](domain/order-model.md) — доменная модель заказа.
- [domain/execution-models.md](domain/execution-models.md) — модели исполнения DIRECT / VOTE / OFFER + Carrier Determination.

## Этап 2 — Спецификация FSM заказа (внешний) ✅
- [order-fsm/backend-mapping.md](order-fsm/backend-mapping.md) — текущий бэкенд iBronevik (`b_state`+`c_*`) → доменная модель.
- [order-fsm/states.md](order-fsm/states.md) — состояния и переходы (наблюдаемый + целевой FSM).
- [order-fsm/events.md](order-fsm/events.md) — каталог событий `order_status_*` + payload.
- [order-fsm/commands.md](order-fsm/commands.md) — команды бот → заказ.
- [order-fsm/timers.md](order-fsm/timers.md) — таймеры.

## Этап 3 — Контракт интеграции ✅
- [integration/order-gateway-contract.md](integration/order-gateway-contract.md) — порт `OrderGateway`, маппинг, гарантии доставки.

## Этап 4 — FSM интерфейса бота (основная задача) ✅
- [bot-fsm/dsl-spec.md](bot-fsm/dsl-spec.md) — DSL: состояния, validation, Guard, cross-flow, actions.
- [bot-fsm/event-model.md](bot-fsm/event-model.md) — единая модель событий UI / System / Domain.
- [bot-fsm/form-fsm.md](bot-fsm/form-fsm.md) — слой 1: сбор данных заказа.
- [bot-fsm/tracking-fsm.md](bot-fsm/tracking-fsm.md) — слой 3: сопровождение заказа (реакция на FSM заказа).

## Дальше (планируется)
- `gap-analysis.md` — анализ кода ботов и выбор базы (Этап 5).
- `implementation-plan.md` — план реализации/миграции (Этап 6).
