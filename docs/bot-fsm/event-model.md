# FSM бота — единая модель событий

> Ключевая рекомендация gpt2: движок должен явно различать **природу** событий. Сейчас они «живут
> вперемешку» (`message`, `confirm`, `drivers_found`, `order_status_completed`). Здесь — единая модель.
>
> См. [../domain/glossary.md](../domain/glossary.md) §11, [../order-fsm/events.md](../order-fsm/events.md), [dsl-spec.md](dsl-spec.md).

---

## 1. Три природы событий

| Природа | Источник | Кто порождает | Примеры |
|---|---|---|---|
| **UI Event** | Ввод пользователя | `validation` / `location` | `confirm`, `yes`, `no`, `help`, `exit`, `ok`, `error`, выбор пункта |
| **System Event** | Внутренние менеджеры бота | DriverSearchManager, таймеры формы | `drivers_found`, `no_drivers` |
| **Domain Event** | Внешний FSM заказа | `OrderGateway` (поллинг) | `order_status_approved`, `order_status_completed`, … |

> Все три приходят в FSM **единообразно** (как `event` в `transition`), но различаются по источнику
> и обработке. Domain Events — это нормализованные `order_status_*` из [../order-fsm/events.md](../order-fsm/events.md).

---

## 2. Конвенция именования (предложение)

Чтобы природа читалась в схеме без угадывания:

| Природа | Префикс | Пример |
|---|---|---|
| UI | без префикса (короткие) | `confirm`, `exit`, `select_candidate` |
| System | `sys_` | `sys_drivers_found`, `sys_no_drivers` |
| Domain | `order_status_` (как сейчас) | `order_status_approved` |

> Сейчас System-события без префикса (`drivers_found`). Переименование — необязательное улучшение
> читаемости; решается на Этапе 6 (миграция схем). Для совместимости можно оставить как есть.
>
> ✅ **A2 реализован:** конвенция формализована в коде — `bot/src/engine/eventNature.ts`
> (`eventNature`/`isDomainEvent`/…). Domain (`order_status_*`) классифицируется точно уже сегодня;
> System без префикса временно классится как UI до переименования (Этап 6). Единый источник истины
> для будущего Passenger UI Resolver (Вариант 3) и гарантии §4.

---

## 3. Как событие попадает в FSM

```
┌─ UI ──────────┐
│ message       │→ validation/location → event ─┐
└───────────────┘                               │
┌─ System ──────┐                               ▼
│ DriverSearch  │→ event (drivers_found) ──► dispatch(state, memory, event)
│ form timers   │                               ▲   → { nextState, actions, memoryPatch }
└───────────────┘                               │
┌─ Domain ──────┐                               │
│ OrderGateway  │→ onOrderEvent (order_status_*)┘
└───────────────┘
```

- **UI:** входящее сообщение → `validation` порождает событие (или `location.onSuccess`).
- **System:** менеджер бота вызывает переход напрямую с событием.
- **Domain:** `OrderGateway.onOrderEvent` (см. [../integration/order-gateway-contract.md](../integration/order-gateway-contract.md))
  вызывает переход с `order_status_*`; payload/snapshot мерджится в память перед действиями.

---

## 4. Приоритет и совмещение

В одном состоянии могут быть валидны переходы по событиям разной природы (напр. в `order.approved`:
UI `cancel_reason_request` И Domain `order_status_driver_arrived`). Это нормально — события приходят
асинхронно, обрабатываются по мере поступления. Конфликтов нет, т.к. каждое событие = отдельный
вызов `dispatch`.

**Гонки:** Domain-событие может прийти, пока пользователь в под-диалоге (напр. вводит причину отмены,
а заказ уже завершился). Правило: Domain-события **не теряются** — если в текущем состоянии нет
перехода по `order_status_*`, бот применяет fallback (см. [tracking-fsm.md](tracking-fsm.md) §5).

---

## 5. Каталоги событий (ссылки)
- UI-события формы — [form-fsm.md](form-fsm.md).
- UI/System/Domain события сопровождения — [tracking-fsm.md](tracking-fsm.md).
- Domain-события заказа (payload) — [../order-fsm/events.md](../order-fsm/events.md).
