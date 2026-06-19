# FSM заказа — команды (бот → заказ)

> Команды, которые бот отправляет во «внешний» FSM заказа. Реализуются через `OrderGateway`
> (Этап 3) поверх API iBronevik. Источник истины: `WATaxiBot api/order.ts`, `MultiBot OrderActions`,
> `order.json` (action `cancelOrder` → `/drive/cancel`, `set_offer`).

---

## 1. Команды (нормализованные)

✅ Словарь `action` подтверждён эмулятором (`driver-emulator/src/client-simulator.js:41`,
`simulator.js:18`, `WATaxiBot order.ts:660`). Все командные `action` шлются на `POST /drive/get/{orderId}`
(url-encoded, `token`+`u_hash`); создание — на `POST /drive`.

| Команда | Назначение | Когда | Реализация на iBronevik (подтверждено) |
|---|---|---|---|
| `createOrder(params)` | Создать заказ | После подтверждения формы | POST `/drive`, `data=JSON.stringify(payload)` (`b_*`/`b_options`) |
| `cancelOrder(orderId)` | Отменить заказ | Клиент отменяет / таймаут | `action=set_cancel_state` |
| `selectCandidate(orderId, driverId)` | Выбрать кандидата (VOTE) | Клиент выбрал из списка | `action=set_performer, performer=1, u_id=<driverId>` |
| `offerToDriver(orderId, driverId)` | Адресно предложить заказ водителю (OFFER) | Клиент/система выбрала из офферов | `action=set_offer, u_id=<driverId>, t_id?` |
| `selectOffer(orderId, driverId)` | Финализировать выбор оффера | После `set_offer` | `action=set_performer, u_id, t_id?` |
| `clearSelection(orderId, driverId)` | Снять выбор → вернуть в голосование | Клиент передумал | `action=set_performer, performer=0, u_id` |
| `confirmVote(orderId)` | Подтвердить голосование | VOTE | `action=set_confirm_state` (`b_estimate_waiting?`) |
| `confirmBoarding(orderId, code)` | Подтвердить посадку | VOTE/внешний водитель | `b_driver_code` (код посадки; OFFER/DIRECT без кода) |
| `setRate(orderId, rate)` | Оценка после поездки | Состояние COMPLETED | API set rate |
| `setReview(orderId, text)` | Отзыв после поездки | После оценки | API set review |
| `extendVoting(orderId)` | Продлить таймер голосования | VOTE, по запросу/авто | `votingTimer += 3 мин` |

> Сторона водителя (не команды бота-клиента, но видны в `drivers[]`/событиях): `set_arrive_state`,
> `set_start_state`, `set_complete_state` — прибытие/старт/завершение водителем.
> Примечание: прежняя версия указывала отмену через `/drive/cancel` и выбор через `set_offer` —
> эмулятор показывает иное (`set_cancel_state` / `set_performer`); считаем эмулятор источником истины.

---

## 2. Параметры createOrder (текущий API)

Фактический payload (`driver-emulator/src/order-generator.js:203`):
```
b_start_address / b_start_latitude / b_start_longitude        # точка подачи
b_destination_address / b_destination_latitude / b_destination_longitude
b_contact            = "+7..."                # телефон клиента
b_start_datetime     = <время подачи>
b_passengers_count   = 1
b_payment_way        = 1                       # способ оплаты
b_max_waiting        = 7200                    # окно ожидания, сек
b_options            = { fromShortAddress, toShortAddress, customer_price }  # желаемая цена клиента
b_custom_comment     = <коммент>
# режим:
b_voting   = 1, b_services = [5]               # VOTE
b_cars_count = 0                               # OFFER (он же b_only_offer=1)
# (нет обоих → DIRECT)
b_driver_code = <код посадки>                  # VOTE: подтверждение посадки
```

Доменные параметры (целевые, см. [../domain/order-model.md](../domain/order-model.md)) — маршрут (from/to/via),
тип поездки, класс, requirements (HARD_FILTER/SOFT_SCORE), способ подачи (NOW/LATER), режим
(DIRECT/VOTE/OFFER), цены. Маппинг доменных параметров на `b_*` — задача адаптера iBronevik (Этап 3/6).

---

## 3. Принцип

Бот **не управляет** жизненным циклом заказа — он лишь шлёт намерения (команды) и реагирует на
события ([events.md](events.md)). Команды идемпотентны по смыслу (повтор `cancelOrder` на отменённом —
без эффекта). Гарантии доставки/повторов — в контракте [../integration/order-gateway-contract.md](../integration/order-gateway-contract.md).

---

## Открытые вопросы (закрыты — см. [api-payload-reference.md](api-payload-reference.md))
- ✅ Эндпоинты/поля выбора VOTE/OFFER — `set_performer` на `/drive/get/{id}`; полный список параметров
  каждого `action` — в [api-payload-reference.md](api-payload-reference.md) §4.
- ✅ Желаемая цена клиента (OFFER) — `b_options.customer_price`; цена водителя — `c_options.performers_price`.
- ✅ Изменение маршрута до старта — **отдельной команды нет**. Есть `edit_payload` (правка `b_options`/
  `c_options` операциями `=/+/-`), но не для точек подачи/назначения. Фичу «сменить адрес» — из MVP убираем.
- ✅ **OFFER-семантика закрыта контрактом:** `set_offer {u_id, t_id?}` (адресное предложение водителю) +
  `set_performer` (финализация). Финально подтвердить вживую.
