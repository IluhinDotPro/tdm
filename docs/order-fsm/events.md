# FSM заказа — каталог событий

> Нормализованные доменные события заказа, которые бот получает от `OrderGateway` (поллинг бэкенда).
> Имена в FSM-движке — `order_status_*`. Источник: `OrderManager.deriveEvent`, `ORDER_STATUS_EVENTS`.
> См. [backend-mapping.md](backend-mapping.md), [states.md](states.md).

---

## 1. Наблюдаемые события (реализованы сейчас)

| Доменное событие | FSM-событие | Источник (API) | Целевое состояние | Терминальное |
|---|---|---|---|:---:|
| OrderProcessing | `order_status_processing` | `b_state∈{1,6}` | SEARCHING | — |
| DriverAssigned | `order_status_approved` | `b_state=2`, `c_appointed` | ASSIGNED | — |
| DriverArrived | `order_status_driver_arrived` | `c_arrived` | DRIVER_ARRIVED | — |
| RideStarted | `order_status_driver_started` | `c_started` | IN_RIDE | — |
| DriverCancelled | `order_status_driver_canceled` | `c_canceled` / нет подходящего | CANCELLED | ✅ |
| OrderCancelled | `order_status_canceled` | `b_state=3` | CANCELLED | ✅ |
| RideCompleted | `order_status_completed` | `b_state=4` / `c_completed` | COMPLETED | ✅ |
| OrderExpired | `order_status_out_of_time` | таймаут (см. timers) | EXPIRED | ✅ |

**Семантика доставки:** OrderManager эмитит событие только при **изменении** относительно
`lastEmittedEvent` (дедупликация). Терминальное событие снимает заказ с наблюдения.

### Payload (наблюдаемые)
Минимальный payload, который реально шлёт текущий `OrderManager`:
```json
{ "tenantId": "...", "botId": "...", "chatId": "...", "userId": "...",
  "event": "order_status_approved", "payload": { "orderId": "..." } }
```
Детали заказа (водитель, авто, цена) бот **дочитывает** из API по `orderId` при отрисовке.

> Рекомендация (Этап 3): обогащать payload снимком заказа (`OrderSnapshot`), чтобы FSM-actions не
> делали повторных запросов. См. [../integration/order-gateway-contract.md](../integration/order-gateway-contract.md).

---

## 2. Целевые доменные события (ориентир, не все реализуемы сейчас)

Из execution-models по режимам. Появятся, когда бэкенд начнёт отдавать состав кандидатов/предложений.

| Режим | События |
|---|---|
| Общие | `OrderPublished`, `OrderCancelled`, `OrderExpired`, `BoardingVerified`, `TripStarted`, `TripCompleted`, `TripSOS` |
| DIRECT | `DriverAccepted`, `DriverAssigned`, `DriverArrived` |
| VOTE | `CandidateAdded`, `CandidateRemoved`, `CandidateSelected`, `CandidateArrived`, `CarrierDetermined` |
| OFFER | `OfferSubmitted`, `OfferUpdated`, `OfferWithdrawn`, `OfferSelected`, `DriverAssigned` |

**Gap (наблюдаемое vs целевое):** сейчас отсутствуют события состава выбора (`CandidateAdded`,
`OfferSubmitted` …) и `BoardingVerified`/`CarrierDetermined`. Для VOTE/OFFER состав читается из
`drivers[]`/offers ответа API, а не из событий (открытый вопрос — backend-mapping §6).

---

## 3. Природа событий (для FSM бота)

Каталог выше — **Domain Events**. В FSM бота они смешиваются с (см. [../domain/glossary.md](../domain/glossary.md) §11):
- **System Events** — `drivers_found`, `no_drivers` (DriverSearchManager), таймауты;
- **UI Events** — `message`, `confirm`, выбор кандидата/предложения, ввод причины отмены, рейтинг.

Разделение трёх природ — требование Этапа 4 (единая модель событий).

---

## 4. Таймаут — это событие, а не состояние (принцип различения, ревью 2026-06-26)

> Вклад ревью 2026-06-26 (Валентин, поддержка позиции Павла). Задаёт ось различения переходов «исполнитель
> не вышел на посадку» и предотвращает размножение per-mode терминалов «не приехал».

Различать стоит **причину перехода (событие)**, а не столько конечное состояние. Сигнал «назначенный
водитель не вышел на посадку в окно ожидания» — это **одно доменное событие** `pickup_timeout` (синоним
`timeout_wait_driver`); а терминал по нему выбирает **бизнес-правило**, исходя из режима:

| Режим | Событие | Терминал | Статус |
|---|---|---|---|
| VOTE | `pickup_timeout` | `order_vote_no_show` | ✅ MVP (T16) |
| DIRECT | `pickup_timeout` | `order_cancelled` | принцип; в MVP — ручная отмена |
| OFFER | `pickup_timeout` | `order_cancelled` | принцип; в MVP — ручная отмена |
| (будущее) | `pickup_timeout` | один универсальный терминал | при появлении бизнес-правила |

- `order_vote_no_show` несёт **специфичную для VOTE** семантику (клиент выбрал конкретного водителя, тот
  не дождался клиента) — переносить её на DIRECT/OFFER некорректно: там «не доехали» имеет разные причины
  (водитель не приехал / отменил; клиент отменил; истекло ожидание; не дозвонились).
- **Для MVP** новых терминалов под DIRECT/OFFER не вводим — «не приехал» закрывается **ручной отменой**
  пассажира (→ `order_cancelled`). Событийная развязка — направление развития, а не текущее состояние.
- Источник события — **timer worker** на `server_fsm_instances.next_timer_at` (см. [timers.md](timers.md);
  для VOTE это `pickupWindowTimeout` → T16). Timer Worker — **часть MVP**.

Та же логика — для `order_expire` (до назначения): это тоже **событие** (истёк
`matchingTimeout`/`candidateTimeout`/`offerTimeout`), ведущее в `order_expired`. Терминал — следствие
события и режима, а не самостоятельно различимый «жизненный случай».

См. [states.md](states.md) §1a, [fsm-core-design.md](fsm-core-design.md) §5a, [timers.md](timers.md).
