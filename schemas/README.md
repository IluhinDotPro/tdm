# Черновики JSON-схем FSM бота

> **Статус: ЧЕРНОВИК / спец-референс.** Реализация спецификации [../docs/bot-fsm/](../docs/bot-fsm/)
> в формате DSL движка MultiBot. Цель — показать спеку «в коде» и дать стартовую точку реализации
> (Этап 6, блок C). Это **не** финальные продакшн-схемы.

## Файлы
- [_init.json](_init.json) — конфигурация тенанта: `initialState`, выбор flow (registered → form, иначе registration).
- [form.json](form.json) — **слой 1**, FSM формы: сбор параметров заказа такси ([../docs/bot-fsm/form-fsm.md](../docs/bot-fsm/form-fsm.md)).
- [order.json](order.json) — **слой 3**, FSM сопровождения: реакция на события заказа ([../docs/bot-fsm/tracking-fsm.md](../docs/bot-fsm/tracking-fsm.md)).

## Что в этих черновиках нового относительно текущего кода
1. **Guard на переходах** (`"guard": "..."`) — расширение DSL, [dsl-spec §3](../docs/bot-fsm/dsl-spec.md). В текущем движке ещё нет — требует блока A1.
2. **Форма такси** вместо «няни»: from→to→people→carClass→options→when→mode→(offerPrice)→confirm.
3. **Очистка протечек домена**: `requirements[]` с кодами вместо `additionalOptionsAllowed/TokenMap` в validation ([dsl-spec §2](../docs/bot-fsm/dsl-spec.md)).
4. **Ветвление по режиму** (DIRECT/VOTE/OFFER) через guard.
5. **order.json**: добавлен fallback для гонок Domain-событий и состояния-расширения VOTE/OFFER.

## Помечено как PENDING (ждёт решений)
- Состояния `order.candidateList` / `order.offerList` / `order.boarding` — ветки VOTE/OFFER.
  Зависят от ответа бэкенд-команды (как читать состав кандидатов/предложений). Поле `"_pending"` в схеме.
- Точная развилка «поиск ботом (DIRECT) vs прямое создание (VOTE/OFFER)» — после ответа бэкенда.
- Маппинг доменных параметров заказа на `b_*` поля iBronevik — в адаптере OrderGateway (блок B2), не в схеме.

> JSON не поддерживает комментарии — пояснения вынесены в поля `"_note"` / `"_pending"` (движок их игнорирует)
> и в этот README.
