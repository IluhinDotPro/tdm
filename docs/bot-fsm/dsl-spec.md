# FSM бота — спецификация DSL

> Декларативный JSON-DSL для FSM интерфейса бота. Базируется на **фактическом** формате MultiBot
> (`src/engine/schemas/children/*.json`, `src/engine/types.ts`), с целевыми расширениями: **Guard**,
> явные **cross-flow** переходы, единая **модель событий** (см. [event-model.md](event-model.md)).
>
> Цель — DSL, на котором описываются обе ботовые FSM: [form-fsm.md](form-fsm.md) (сбор данных) и
> [tracking-fsm.md](tracking-fsm.md) (сопровождение заказа). Бизнес-логики заказа в DSL нет —
> только представление и переходы (см. [../domain/order-model.md](../domain/order-model.md) §7).

---

## 1. Структура (как есть сейчас)

```jsonc
// Tenant: набор flows. Каждый flow — файл (main, order, registration, settings).
{
  "name": "main",
  "actions": { /* глобальные для flow именованные действия */ },
  "states": {
    "from": {
      "id": "main.from",                 // полный id = "<flow>.<state>"
      "entryActions": ["sendFrom"],      // действия при входе в состояние
      "validation": { /* как разобрать ввод → событие */ },
      "location": { /* обработка геолокации */ },
      "actions": { /* локальные для состояния действия (редко) */ },
      "transitions": [
        { "event": "ok", "to": "main.to", "actions": ["saveFrom","sendTo"] }
      ]
    }
  }
}
```

**State** = `id` + `validation?` + `location?` + `transitions[]` + `entryActions?` + `actions?`.
**Transition** = `event` + `to` + `actions[]` (+ **`guard?`** — расширение, см. §3).

### Cross-flow переход
Переход между flows — просто **полный id** в `to`: `"order.start"`, `"settings.start"`.
(Подтверждено в main.json: `confirm → order.start`, `start → settings.start`.)
> Расширение: формализовать как `"to": { "flow": "order", "state": "start" }` или оставить строку —
> решается на Этапе 6. Семантика одна: сменить активный flow и состояние.

---

## 2. Валидация (validation)

Разбирает пользовательский ввод и порождает **событие** (UI Event). Типы (как сейчас):

| type | Поля | Семантика |
|---|---|---|
| `choice` | `allowed[]`, `mapping`, `errorEvent`, `successEvent?` | Ввод ∈ allowed → successEvent; точное совпадение в mapping → его event; иначе errorEvent |
| `regex` | `pattern`, `successEvent`, `errorEvent`, `saveFields?` | Совпало → successEvent (+ группы в поля); нет → errorEvent |
| `range` | `min`, `max`, `errorEvent`, `successEvent` | Число в диапазоне |
| `mapping` | `mapping`, `errorEvent` | Только точные совпадения ввода → event |

Доп. поля: `saveAs` (сохранить ввод в память по пути), `errorAction` (действие при ошибке),
`mapping[x].data` (мердж данных при срабатывании, напр. `{ "order.input.additionalOptions": [] }`).

**Location handling** (`location`): `accept`, `save` (куда положить lat/lng в память), `onSuccess.event`.

> ⚠️ **Анти-паттерн (зафиксировано gpt2):** доменные поля в validation — `additionalOptionsAllowed`,
> `additionalOptionsTokenMap` (main.json `options`). Это «протечка» домена в движок. **Цель:**
> вынести такие справочники в память/конфиг заказа, а в validation оставить только общий механизм.

---

## 3. Guard (реализовано — Блок A1)

> gpt1/gpt2: в исходном DSL guard не было, условность зашита в JS (MainHandler). Введён явно.
> ✅ Реализация: `bot/src/engine/guard/evaluateGuard.ts` (безопасный парсер выражений, без eval) +
> `chooseTransition.ts` (first_match), врезка в `FSMManager.transition`. Тесты — `bot/tests/test_guard.ts`.

Guard — булево условие на переходе. Переход выбирается, если событие совпало **и** guard истинен.

```jsonc
{
  "event": "confirm",
  "guard": "order.from != null && order.to != null && order.peopleCount > 0",
  "to": "main.driverSearch",
  "actions": ["createOrder"]
}
```

Правила:
- Несколько transitions с одним `event` — берётся **первый**, чей guard истинен (как `first_match`).
- Guard без `event` запрещён (guard уточняет событие, не заменяет).
- Выражения — над **памятью** (`order.*`, `user.*`, `registration.*`) и payload события.
- Без сторонних эффектов; только чтение памяти/payload.

Минимальный набор операторов: `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `||`, `!`, `null`, скобки,
доступ по пути `a.b.c`. (Полноценный движок выражений — на Этапе 6; синтаксис фиксируем здесь.)

Примеры guard для ТДМ:
- `order.mode == "OFFER" && order.clientPrice != null`
- `order.dispatchType == "LATER" && order.when != null`
- `snapshot.candidates.length > 0` (ветка VOTE — выбор кандидата)

---

## 4. Действия (actions)

Декларативные имена, исполняются `ActionExecutor`. Типы (как сейчас): `sendL10n`, `save`,
`data`(merge), `createOrder`, `startDriverSearch`, `setRate`, `setReview`, `cancelOrderWithReason`,
`apiCall`, и спец-`send*` (sendOrderConfirmation и т.п.).

**Принцип:** действие — это побочный эффект **представления** или **команда** заказу
([../order-fsm/commands.md](../order-fsm/commands.md)). Действие НЕ вычисляет статус заказа.

> Расширение: типизация params по типу действия + `onActionError` (событие при сбое действия) —
> сейчас сбой только логируется (gpt2). Детали — Этап 6.

---

## 5. Единый интерфейс перехода (реализовано — Блок A3)

Движок сводится к чистой функции:

```
dispatch(state, memory, event) → { from, to, actions, entryActions }
```

Это позволяет одному движку обслуживать form-FSM, tracking-FSM (и в будущем web/mobile).
✅ Реализация: `bot/src/engine/dispatch.ts` — `computeTransition(schema, state, memory, event)` без I/O
и побочных эффектов. `FSMManager.transition()` — тонкая обёртка (вычисление + persist состояния),
`FSMManager.dispatch()` — read-only расчёт. Тесты — `bot/tests/test_dispatch.ts`.

> memoryPatch ядром не возвращается: патч памяти формируется выше (validation, до перехода) и ниже
> (actions через ActionExecutor). Ядро отвечает только за выбор перехода. Полный перенос вычисления
> из `MainHandler` (determineEvent) в dispatch — следующий шаг (часть A2/A4).

---

## 6. Что в DSL НЕ хранится (представление)
Размеры/порядок/рекомендуемость кнопок, видимость блоков, карточки, экраны, цвета, иконки —
вне DSL (см. [../domain/order-model.md](../domain/order-model.md) §7). DSL описывает состояния, события,
guard, действия — но не вёрстку.
