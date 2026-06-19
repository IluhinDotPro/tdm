# Маппинг: текущий бэкенд (iBronevik) → доменная модель ТДМ

> Решение заказчика: интегрируемся **под текущий бэкенд**. Поэтому «чужой FSM заказа» на практике =
> состояние заказа в API **iBronevik**, вычисляемое поллингом. Этот документ — мост между реальным
> API и идеализированной доменной моделью ([../domain/](../domain/)).
>
> Источник истины (код): `_workspace/sources/WATaxiBot-main/src/api/{general,order}.ts`,
> `_workspace/sources/MultiBot-main/src/newManagers/OrderManager/OrderManager.ts`.

---

## 1. Бэкенд

- Базовый URL (пример конфигурации `gruzvill`): `https://ibronevik.ru/taxi/c/gruzvill/api/v1/`.
- Заказ = «booking / drive» — поля с префиксом `b_*`.
- Назначения водителей = массив `drivers[]`, поля с префиксом `c_*`.
- Авторизация: `token` + `u_hash` (форма `x-www-form-urlencoded`).

---

## 2. Состояние заказа: `b_state`

| `b_state` | Смысл | Доменная стадия |
|---|---|---|
| 1, 6 | Поиск исполнителя (Processing) | Discovery / Candidate Formation |
| 2 | Активен (есть назначенный водитель) — подстатус по `c_*` | Carrier Determination → Transportation |
| 3 | Отменён (Canceled) | Completion (`cancelled`) |
| 4 | Завершён (Completed) | Completion (`completed`) |

В enum также есть `PENDINGACTIVATION`, `OFFEREDTODRIVERS` — присутствуют в API, но в текущем
`deriveEvent` не обрабатываются (см. §6, открытый вопрос).

## 3. Подстатус водителя: поля `c_*`

Берётся «подходящий» водитель: `drivers.find(d => d.c_canceled == null)`. По его полям:

| Поле выставлено | `driverState` | Смысл |
|---|---|---|
| `c_appointed` | 0 | Водитель назначен (APPROVED) |
| `c_arrived` | 1 | Водитель прибыл |
| `c_started` | 2 | Поездка началась |
| `c_canceled` | 3 | Водитель отменил |
| `c_completed` | 4 | Поездка завершена |

Если подходящего нет, но `drivers` непустой → `driverState = 3` (трактуется как отмена водителем).

## 4. Правило вывода события (`deriveEvent`)

```
state ∈ {1,6}:  driverState==3 → DRIVER_CANCELED ; иначе → PROCESSING
state == 2:     0→APPROVED 1→DRIVER_ARRIVED 2→DRIVER_STARTED 3→DRIVER_CANCELED 4→COMPLETED
state == 3:     → CANCELED
state == 4:     → COMPLETED
fallback:       → APPROVED
```

Плюс вычисляемый вне `b_state` таймаут → `OUT_OF_TIME` (см. [timers.md](timers.md)).

## 5. Нормализованные события заказа (для бота)

8 событий `OrderStatusEvent` (имена в FSM-движке — `order_status_*`):

`PROCESSING`, `APPROVED`, `DRIVER_ARRIVED`, `DRIVER_STARTED`, `DRIVER_CANCELED`,
`CANCELED`, `COMPLETED`, `OUT_OF_TIME`.

**Терминальные:** `COMPLETED`, `CANCELED`, `DRIVER_CANCELED`, `OUT_OF_TIME` — после них заказ
снимается с наблюдения.

Полный каталог с payload — в [events.md](events.md).

---

## 6. Как модели DIRECT / VOTE / OFFER ложатся на текущий API

Механика в API существует:
- **DIRECT** — обычный заказ; первый назначенный водитель (`c_appointed`).
- **VOTE** — `isVoting=true`: `b_max_waiting` + votingTimer (по умолчанию `maxVotingWaitingTimeSecs`,
  продлевается +3 мин); водители откликаются, клиент выбирает; код посадки (`b_driver_code`).
- **OFFER / адресный** — `b_only_offer=1` + action `set_offer` (предложение конкретным водителям /
  от водителя); `BookingState.OfferedToDrivers`.

Параметры создания (фрагменты): `b_max_waiting`, `b_payment_way=1`, `b_options` (в т.ч. `mode="trip"`,
`childrenProfiles`), `b_only_offer`, `b_driver_code`.

> ⚠️ **Ключевой разрыв (открытый вопрос).** Поллинговый `deriveEvent` **режим-агностичен**: VOTE/OFFER/DIRECT
> дают одинаковый трек `PROCESSING → APPROVED → DRIVER_ARRIVED → DRIVER_STARTED → COMPLETED`.
> Различия моделей (список кандидатов для выбора, список предложений с ценами) **не приходят** через
> этот единственный статус. Для отрисовки выбора клиенту нужно отдельно читать `drivers[]` / offers из
> ответа API. Нужно подтвердить у бэкенд-команды:
> 1. как читать актуальный список кандидатов/предложений (поля, эндпоинт);
> 2. передаётся ли желаемая цена клиента (OFFER) и как водители её видят/перебивают;
> 3. семантику `OFFEREDTODRIVERS` / `PENDINGACTIVATION`.
>
> До ответов FSM сопровождения (Этап 4) проектируем по фактически наблюдаемым 8 событиям, а
> ветки выбора кандидата/предложения держим как расширение поверх чтения `drivers[]`.

---

## 7. Следствие для архитектуры

Текущий «внешний FSM заказа» = **режим-агностичный линейный трек** из 8 событий, получаемый поллингом.
Идеализированный FSM ТДМ (gpt3, со стратегиями Carrier Determination) — целевой ориентир. Контракт
`OrderGateway` (Этап 3) скрывает это различие: бот работает с нормализованными событиями и командами,
а адаптер iBronevik переводит их в `b_*`/`c_*`/`set_offer`.
