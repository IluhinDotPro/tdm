# Справочник payload API iBronevik (авторитетный)

> Извлечено из дампа серверного FSM (`vote_fsm_original_schema...sql`, таблицы `taxi_order_payload_keys`
> и `taxi_order_payload_templates`), подготовленного бэкенд-стороной 2026-06-19. Источник полей помечен
> в самом дампе как `api_docs` (офиц. документация эндпоинта) и `gruzvill_site_constants` (разрешённые
> ключи конфига `gruzvill`). **Это авторитетнее реверса эмулятора** — здесь полный список разрешённых
> ключей, required-поля и параметры каждого `action`.
>
> Сам SQL — вне git, в `_workspace/sources/`. Этот документ — выжимка для адаптера iBronevik.
> См. также [backend-mapping.md](backend-mapping.md), [commands.md](commands.md).

---

## 1. `create_payload` — ключи создания заказа (`POST /drive`)

Required помечены ✱. Остальные опциональны.

| Ключ | Назначение |
|---|---|
| `b_payment_way` ✱ | Способ оплаты (id) |
| `b_start_datetime` ✱ | Время подачи; поддерживает `now`/`any` |
| `b_start_address` / `b_start_latitude` / `b_start_longitude` | Точка подачи (адрес ИЛИ координаты обязательны) |
| `b_destination_address` / `b_destination_latitude` / `b_destination_longitude` | Назначение |
| `b_contact` | Контакт (эмулятор шлёт строку телефона) |
| `b_passengers_count`, `b_luggage_count` | Пассажиры / багаж |
| `b_car_class`, `b_location_class` | Класс машины / локации |
| `b_max_waiting` | Окно ожидания, сек |
| `b_currency` | Валюта (напр. `RUB`) |
| `b_custom_comment` | Свободный коммент (исп. для маркера `[CASE]`) |
| `b_comments` | Массив id комментариев |
| **`b_only_offer`** | Если `1` — бэкенд создаёт `booking_states = 6` (OFFEREDTODRIVERS) |
| **`b_cars_count`** | Кол-во машин; **`0` = режим offer/intercity** |
| **`b_services`** | Массив id услуг; **`5` = Vote** |
| **`b_voting`** | Флаг голосования (в дампе помечен «документирован как response data», но сохраняется как рабочий флаг) |
| `b_options` | JSON-опции клиента (см. §2) |
| `kind` | Тип заказа: `{normal:1, default:1, driver_suborder:2, courier_suborder:3}` |
| `upper` | Родительский заказ (для суб-заказов) |
| `u_id` | Id клиента (только admin) |
| `b_pc` | Промокод (профиль stadium) |
| `b_flight_number`, `b_terminal`, `b_placard`, `b_payment_card` | Доп. поля |
| `city_start`/`city_destination`, `region_*`, `countries_list_*` | Гео; бэкенд может автозаполнить из координат |

## 2. `b_options` — разрешённые ключи (whitelist `gruzvill`)

Бэкенд отклоняет ключи вне этого списка («wrong b_options keys»). Ключевые для нас:

- **`customer_price`** — желаемая цена клиента (исп. эмулятором).
- `fromShortAddress`, `toShortAddress` — короткие адреса.
- `cost`, `submitPrice`, `pricingModel`, `createdBy`, `CalculationDetails` — ценообразование/метаданные (исп. WATaxiBot).
- `carsCount`, `courier_auto`, `feedback`, `sms`, `time_is_not_important`.
- Грузовые/переездные (gruzvill): `bigTruck*`, `weight`, `size`, `furniture`, `elevator`, `steps`, `is_big_size`, `is_loading_needs`, `moveType`, `object`, `collage`.
- Адресные детали from/to: `from_floor/porch/room/tel/way/mission/time_from/time_to/day`, аналогично `to_*`.
- Интервалы: `fromDateTimeInterval`, `tillDateTimeInterval`, `from_day`, `to_day`.
- `tickets` (вложенный: `{t_id, seats, payment}`), `driveStartedTimestamp`.

Полный список — в дампе (`taxi_order_payload_keys`, scope=`b_options`).

### `reserved_b_options` (служебные, не от клиента)
- `:private` — скрыто из ответов водителю.
- `:public` — публичная часть.
- `:u_id_alias` — маппинг user id водителя на индекс в public-данных.

## 3. `c_options` — отклик/предложение водителя

| Ключ | Назначение |
|---|---|
| `performers_price` | Цена водителя (offer/candidate) |
| `driver_offer_eta` | Подача (ETA) |
| `driver_offer_comment` | Комментарий водителя |

## 4. `action_payload` — параметры команд (`POST /drive/get/{orderId}`)

| `action` | Принимаемые параметры | Смысл |
|---|---|---|
| `set_performer` | `{performer, u_id, t_id?, data?, b_driver_code?}` | Выбор кандидата/исполнителя (VOTE и OFFER) |
| `set_offer` | `{u_id, t_id?}` | Предложить заказ **конкретному** водителю (OFFER) |
| `set_cancel_state` | `{reason?, forced?, cancel_states?}` | Отмена заказа |
| `set_confirm_state` | `{b_estimate_waiting?}` | Подтвердить созданный заказ (VOTE) |
| `set_arrive_state` | — | Водитель прибыл |
| `set_start_state` | — | Водитель начал поездку |
| `set_complete_state` | — | Завершить заказ |

### `edit_payload` — правка после создания
`b_options` / `c_options` правятся **массивом операций**, форма `[["=", ["key"], value], ...]`,
операторы `=`, `+`, `-` (есть и для вложенных ключей: `["=", [":private","scenarioKey"], "..."]`).
> ⚠️ Это правка **опций**, не маршрута. Команды смены точки подачи/назначения по-прежнему нет.

## 5. Готовые шаблоны режимов (`taxi_order_payload_templates`)

В дампе 2 шаблона (DIRECT отдельным шаблоном не задан — это базовый payload без `b_voting`/`b_cars_count`):

### VOTE (`vote_client_emulator_v1`)
Создание: базовый payload + `b_voting:1`, `b_services:[5]`, `b_cars_count:1`, `b_only_offer:0`,
`b_options.customer_price`, `b_currency:"RUB"`, `b_start_datetime:"now"`.
Последовательность действий (`backend_actions_json` ↔ наш FSM):

| Шаг | Эндпоинт / payload | FSM-action | client-simulator |
|---|---|---|---|
| publish | `POST /drive` (data) | `order_publish_vote` | `createVoteOrder` |
| confirm | `set_confirm_state` | — | `confirmVoteOrder` |
| select | `set_performer {u_id, performer:"1"}` | `order_select_candidate` | `selectDriver` |
| release | `set_performer {u_id, performer:"0"}` | `order_release_candidate` | `clearSelection` |
| cancel | `set_cancel_state {reason}` | `order_cancel_by_client` | `cancelOrder` |
| no-show | (нет эндпоинта) | `order_no_show` | `noShow` |

### OFFER (`offer_client_emulator_v1`)
Создание: базовый payload + `b_cars_count:0`, `b_services:[]`, `b_options.{customer_price, carsCount:0, pricingModel:"manual-offer", :private.offerMode:true}`.
Последовательность:

| Шаг | Эндпоинт / payload | client-simulator |
|---|---|---|
| create | `POST /drive` (data) | `createOfferOrder` |
| **offer** | `set_offer {u_id, t_id?}` — адресно водителю | `setOffer` |
| **select** | `set_performer {u_id, t_id?}` — финализировать | `selectOffer` |

> Примечание из дампа: «Reference only. Current task focuses on Vote; Offer included because API exposes
> `b_cars_count=0` and `set_offer`». → OFFER подтверждён на уровне контракта, но финально стоит проверить вживую.

---

## 6. Что это закрывает

- ✅ **Последний открытый вопрос OFFER**: семантика принятия есть — `set_offer {u_id,t_id}` (адресное
  предложение водителю) + `set_performer` (финализация). Отдельная от VOTE команда подтверждена контрактом.
- ✅ Полный whitelist `b_options`/`c_options` — устраняет ошибки «wrong keys» при создании.
- ✅ Параметры всех `action` (`reason`/`forced` у отмены, `b_estimate_waiting` у подтверждения и т.д.).
- ✅ Механизм правки (`edit_payload` операциями) — но не для маршрута.

> ⚠️ **Открытая развилка (к заказчику):** этот payload-контракт описывает прямой API iBronevik.
> Но дамп — это ещё и **серверный FSM**, сидящий между нашим ботом и ядром iBronevik
> (`core_order_mapping`: `local_order_id ↔ core_order_id ↔ b_state`). Нужно решить: бот ходит
> **в этот серверный FSM** (тогда «внешний FSM заказа» = чистая БД-машина с явными `order_vote_*`
> состояниями) или **напрямую в iBronevik** (тогда этот файл — только справочник payload). От ответа
> зависит цель адаптера `OrderGateway`. См. [../integration/order-gateway-contract.md](../integration/order-gateway-contract.md).
