# Контракт B0 — Бот ↔ Domain API (серверный FSM-движок)

> 🏛 **Архитектура (ADR-001, Вариант 3).** Это критический артефакт, которого требовал ADR §4: контракт
> между **каналом** (наш WhatsApp-бот) и **серверным Domain FSM**. Источник истины по состоянию заказа —
> сервер; бот шлёт намерения ВВЕРХ (Command API) и читает доменное состояние ВНИЗ (Query API).
> См. [../architecture-decision-variant3.md](../architecture-decision-variant3.md),
> [../order-fsm/states.md](../order-fsm/states.md).
>
> **Статус: СОГЛАСОВАН (черновик v1)** по ответам @spitegod + уточнениям Валентина, 2026-06-24.
> Транспорт стартовый — REST + поллинг; push (webhook/SSE/WS) — следующий этап.

---

## 1. Принципы

- **CQRS-раздел** (Валентин): **Command API** меняет состояние, **Query API** читает снапшот. Это
  позволит развести команды и чтение (вплоть до разных сервисов) без ломки бота.
- **Сервер владеет состоянием.** Бот не вычисляет и не хранит доменное состояние — только проекцию для UI.
- **`uiState` — НЕ на сервере.** API отдаёт только доменный `state`; UI-каноники (`SEARCHING`…) считает
  **бот** (Passenger UI Resolver). Иначе логика дублируется на сервере и в каналах.
- **`availableActions` ведёт UI.** Бот рендерит доступные действия (кнопки) из этого поля и **не знает
  бизнес-правил** — что разрешено в текущем состоянии, решает FSM на сервере. Поле **обязательно**.
- **Цена живёт в Core.** Расчёт — доменный сервис ценообразования (Core), не FSM-процедура и не канал.
  FSM только **фиксирует** посчитанные значения; бот только **рендерит** их (см. §5).
- **`fsmVersion`** в каждом снапшоте — чтобы пережить изменения графа состояний.

---

## 2. Command API (намерения пассажира → сервер)

| Метод | Назначение | Режим |
|---|---|---|
| `POST /orders` | Создать заказ | все |
| `POST /orders/{orderId}/cancel` | Отменить заказ (до старта поездки) | все |
| `POST /orders/{orderId}/candidates/{driverUserId}/select` | Выбрать кандидата | VOTE |
| `POST /orders/{orderId}/candidates/release` | Снять выбор кандидата | VOTE |
| `POST /orders/{orderId}/offers/{driverUserId}/select` | Принять предложение водителя | OFFER |
| `POST /orders/{orderId}/pickup-fee` | Задать pickup fee (цену подачи) | все |
| `POST /orders/{orderId}/boarding/confirm` | Подтвердить посадку | все (VOTE — код) |
| `POST /orders/{orderId}/rating` | Рейтинг / отзыв после завершения | все |

> Ключ выбора и для VOTE, и для OFFER — `driverUserId` (`u_id` в терминах iBronevik), отдельного
> `offerId` нет (подтверждено эмулятором / дампом `vote_fsm`).

### Payload создания заказа — `POST /orders`

```json
{
  "mode": "VOTE",
  "pickup":      { "address": "...", "lat": 0, "lon": 0 },
  "destination": { "address": "...", "lat": 0, "lon": 0 },
  "passenger":   { "phone": "..." },
  "paymentWay": 1,
  "comment": "...",
  "price": {
    "estimated": 350,
    "pickupFee": 0
  }
}
```

- `mode` ∈ `DIRECT | VOTE | OFFER`.
- `price.estimated` — информационная (к оплате не предъявляется); `price.pickupFee` задаёт пассажир.
  `minimumRidePrice` и `actual` сервер считает сам (Core), в запрос на создание не входят.
- Ответ: `{ "orderId": <id> }` (далее бот поллит `GET /orders/{orderId}`).

---

## 3. Query API (доменное состояние → бот для UI Resolver)

`GET /orders/{orderId}` → **снапшот** (на старте бот поллит; позже push заменит поллинг, форма ответа
не меняется):

```json
{
  "fsmVersion": 1,
  "orderId": 123,
  "mode": "VOTE",
  "state": "order_vote_waiting_candidates",
  "availableActions": ["cancel", "selectCandidate"],
  "driver": null,
  "candidates": [
    { "driverUserId": 123, "driverName": "Ahmed", "vehicle": "Dacia Logan" }
  ],
  "offers": [],
  "price": {
    "estimated": 350,
    "pickupFee": 0,
    "minimumRidePrice": 350,
    "actual": null,
    "currency": ""
  },
  "paymentStatus": "pending",
  "updatedAt": "..."
}
```

| Поле | Смысл / правило |
|---|---|
| `fsmVersion` | Версия графа состояний движка. Бот сверяет/логирует при расхождении. |
| `state` | Доменное состояние (один из 12, [../order-fsm/states.md](../order-fsm/states.md)). **Только домен** — без `uiState`. |
| `availableActions` | **Обязательно.** Список разрешённых действий в текущем состоянии. Бот рендерит кнопки от него. Имена ⊆ глаголов Command API (`cancel`, `selectCandidate`, `selectOffer`, `releaseCandidate`, `setPickupFee`, `confirmBoarding`, `rate`). |
| `driver` | `null` пока не назначен; иначе `{ driverUserId, driverName, vehicle, ... }`. |
| `candidates` | VOTE: структурированный список `{ driverUserId, driverName, vehicle }`. |
| `offers` | OFFER: предложения водителей (та же структура + цена/eta/comment предложения). |
| `price` | Все 4 формы: `estimated / pickupFee / minimumRidePrice / actual` (+`currency`). Считает Core; бот рендерит. `actual` = `null` до завершения. |
| `paymentStatus` | Оплата — только наличные; неоплата = инцидент вне FSM (состояние не меняет). |
| `updatedAt` | ISO-метка последнего изменения. |

> **UI Resolver** (бот) проецирует `state` → UI-каноники (`SEARCHING/ASSIGNED/DRIVER_ARRIVED/IN_RIDE/
> COMPLETED/CANCELLED/EXPIRED/RIDE_INTERRUPTED/NO_SHOW`) — таблица в [../order-fsm/states.md](../order-fsm/states.md) §2.
> Сервер `uiState` НЕ отдаёт.

---

## 4. Различимость режимов (DIRECT / VOTE / OFFER)

В отличие от сырого поллинга iBronevik (режим-агностичен), в Domain FSM режимы — **разные ветки**:

```
DIRECT: order_created → order_driver_assigned → order_driver_arrived → order_in_ride → order_completed
VOTE:   order_created → order_vote_waiting_candidates → order_vote_driver_assigned
                      → order_driver_arrived → order_in_ride → order_completed
OFFER:  order_created → order_offer_waiting → order_driver_assigned
                      → order_driver_arrived → order_in_ride → order_completed
```

UI Resolver сводит `order_vote_driver_assigned` и `order_driver_assigned` к одному UI-статусу `ASSIGNED`,
но **на доменном уровне различие сохраняется** (важно для аналитики; Валентин #6).

---

## 5. Ценообразование — граница ответственности

| Слой | Отвечает за |
|---|---|
| **Core (доменный сервис ценообразования)** | РАСЧЁТ всех форм цены по [../domain/business-rules.md](../domain/business-rules.md): Estimated / Pickup Fee / Minimum Ride Price / Actual. |
| **Domain FSM** | Только **фиксирует** посчитанные значения в состоянии заказа. Не содержит алгоритма расчёта. |
| **Бот (канал)** | Только **рендерит** `price.*` из снапшота. Никакой арифметики цены. |

⚠️ Следствие: наш `bot/src/engine/children/order/actualPrice.ts` — **не доменный код бота**, а
**спецификация** алгоритма `Actual` для Core (см. шапку файла). В боте он не вызывается на проде; может
остаться разве что как клиентская предпросмотр-валидация, но владелец расчёта — Core.

---

## 6. Этапность

1. **Сейчас (интерим, до готовности серверного API):** бот ходит за абстракцией `OrderGateway`,
   **интерфейс которой уже = этот контракт** (а не iBronevik). Под портом временно может стоять адаптер
   iBronevik. Когда @spitegod закончит ORM + action-слой — перенаправляем порт на серверный API без
   изменения FSM бота. См. [order-gateway-contract.md](order-gateway-contract.md).
2. **Следующий этап:** push-доставка состояния (webhook/SSE/WS) вместо поллинга `GET /orders/{id}` —
   форма снапшота не меняется.

---

## 7. Открытые / к уточнению с @spitegod

- Точная схема `offers[]` (поля цены/eta/comment предложения водителя) — структуру `candidates[]`
  согласовали (`driverUserId/driverName/vehicle`), `offers[]` симметрично + цена предложения.
- Семантика и payload `pickup-fee`, `boarding/confirm` (для VOTE — код посадки `b_driver_code`), `rating`.
- Коды ошибок / идемпотентность команд (повтор `cancel` на терминальном — без эффекта).
- Сроки готовности серверного API (хотя бы create + read state) — @spitegod пока без точной даты.
