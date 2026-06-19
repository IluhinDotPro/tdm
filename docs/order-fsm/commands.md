# FSM заказа — команды (бот → заказ)

> Команды, которые бот отправляет во «внешний» FSM заказа. Реализуются через `OrderGateway`
> (Этап 3) поверх API iBronevik. Источник истины: `WATaxiBot api/order.ts`, `MultiBot OrderActions`,
> `order.json` (action `cancelOrder` → `/drive/cancel`, `set_offer`).

---

## 1. Команды (нормализованные)

| Команда | Назначение | Когда | Реализация на iBronevik |
|---|---|---|---|
| `createOrder(params)` | Создать заказ | После подтверждения формы | POST `/drive` с `b_*`/`b_options` |
| `cancelOrder(orderId, reason)` | Отменить заказ | Клиент отменяет / таймаут | POST `/drive/cancel` (`orderVar=order.id`, `reasonVar=order.cancelReason`) |
| `selectCandidate(orderId, driverId)` | Выбрать кандидата (VOTE) | Клиент выбрал из списка | `set_offer` на выбранного / `b_driver_code` |
| `selectOffer(orderId, offerId)` | Выбрать предложение (OFFER) | Клиент выбрал предложение | `set_offer` |
| `addOffer(orderId, driverList)` | Адресное предложение водителям | `b_only_offer=1` сценарий | action `set_offer` по списку |
| `confirmBoarding(orderId, code)` | Подтвердить посадку | VOTE/внешний водитель | `b_driver_code` (код посадки) |
| `setRate(orderId, rate)` | Оценка после поездки | Состояние COMPLETED | API set rate |
| `setReview(orderId, text)` | Отзыв после поездки | После оценки | API set review |
| `extendVoting(orderId)` | Продлить таймер голосования | VOTE, по запросу/авто | `votingTimer += 3 мин` |

---

## 2. Параметры createOrder (текущий API)

Из `api/order.ts` (фрагменты):
```
b_max_waiting      = maxWaitingSecs           # окно ожидания
b_payment_way      = 1                         # способ оплаты
b_options          = { ... , mode?, childrenProfiles? }
b_only_offer       = 1                         # если адресное предложение (preferredDriversList)
b_driver_code      = <код посадки>            # режим voting
# маршрут/класс/время/требования — прочие b_* поля
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

## Открытые вопросы
- Точные эндпоинты/поля для `selectCandidate` / `selectOffer` / `addOffer` (как именно VOTE/OFFER
  выбираются на бэкенде — backend-mapping §6).
- Передача желаемой цены клиента (OFFER) в `createOrder`.
- Изменение `actualPickupLocation` до старта — команда `updatePickupLocation`? (нет в текущем коде).
