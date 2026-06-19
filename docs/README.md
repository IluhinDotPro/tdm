# Документация ТДМ

Индекс проектной документации.

## План
- [ROADMAP.md](ROADMAP.md) — план проекта по этапам, ключевые решения, открытые вопросы.

## Этап 1 — Доменный фундамент ✅
- [domain/glossary.md](domain/glossary.md) — единый словарь терминов.
- [domain/order-model.md](domain/order-model.md) — доменная модель заказа.
- [domain/execution-models.md](domain/execution-models.md) — модели исполнения DIRECT / VOTE / OFFER + Carrier Determination.

## Дальше (планируется)
- `order-fsm/` — спецификация внешнего FSM заказа (Этап 2).
- `integration/` — контракт интеграции бот ↔ FSM заказа (Этап 3).
- `bot-fsm/` — спецификация FSM интерфейса бота (Этап 4).
- `gap-analysis.md` — анализ кода ботов и выбор базы (Этап 5).
- `implementation-plan.md` — план реализации/миграции (Этап 6).
