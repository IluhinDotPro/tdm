# Маппинг: текущий бэкенд (iBronevik) → доменная модель ТДМ

> Решение заказчика: интегрируемся **под текущий бэкенд**. Поэтому «чужой FSM заказа» на практике =
> состояние заказа в API **iBronevik**, вычисляемое поллингом. Этот документ — мост между реальным
> API и идеализированной доменной моделью ([../domain/](../domain/)).
>
> Источник истины (код): `_workspace/sources/WATaxiBot-main/src/api/{general,order}.ts`,
> `_workspace/sources/MultiBot-main/src/newManagers/OrderManager/OrderManager.ts`, а также
> **рабочий эмулятор водителей** `itaxi/driver-emulator/` (живой код против реального бэкенда —
> `src/order-generator.js`, `src/simulator.js`, `src/client-simulator.js`). Маппинги `b_state`/`c_state`,
> словарь команд и механика OFFER ниже **подтверждены этим эмулятором** (2026-06-19).

---

## 1. Бэкенд

- Базовый URL (пример конфигурации `gruzvill`): `https://ibronevik.ru/taxi/c/gruzvill/api/v1/`.
- Заказ = «booking / drive» — поля с префиксом `b_*`.
- Назначения водителей = массив `drivers[]`, поля с префиксом `c_*` (по одному элементу на отклик/водителя).
- Авторизация: `token` + `u_hash` (форма `x-www-form-urlencoded`).

### Эндпоинты (фактические, из эмулятора)
| Эндпоинт | Метод | Назначение |
|---|---|---|
| `/drive` | POST | Создать заказ (`data=JSON.stringify(payload)`) |
| `/drive/get/{orderId}` | POST | Прочитать заказ И выполнить команду (`action=…`) |
| `/drive/get/{orderId}?fields=…` | GET | Прочитать заказ с выбором полей |
| `/drive/now` | GET | (сторона водителя) список доступных заказов |
| `/car/{c_id}/drive`, `/user` (`u_active`), `/location` | POST | (сторона водителя) выйти на линию, слать координаты |

> Пуш-событий нет: и бот, и водительский интерфейс работают **поллингом** `/drive/get/{id}` —
> событие выводится из diff'а состояния. Это подтверждает поллинговую архитектуру `OrderGateway`.

---

## 2. Состояние заказа: `b_state` ✅ (подтверждено эмулятором)

| `b_state` | Имя | Смысл | Доменная стадия |
|---|---|---|---|
| 1 | `PROCESSING` | Создан, идёт обработка/поиск исполнителя | Discovery / Candidate Formation |
| 2 | `APPROVED` | Исполнитель назначен, заказ активен (подстатус по `c_state`) | Carrier Determination → Transportation |
| 3 | `CANCELED` | Отменён | Completion (`cancelled`) |
| 4 | `COMPLETED` | Завершён | Completion (`completed`) |
| 5 | `PENDINGACTIVATION` | Ожидает активации (промежуточный) | Discovery (подстатус) |
| 6 | `OFFEREDTODRIVERS` | Разослан водителям — **рабочее состояние режима OFFER** | Candidate Formation (OFFER) |

> ⚠️ **Исправление** прежней версии: ранее `6` ошибочно трактовался как «поиск». На самом деле
> `6 = OFFEREDTODRIVERS` (OFFER), а `5 = PENDINGACTIVATION`. Прежний `deriveEvent` WATaxiBot/MultiBot
> объединял `{1,6}` в «processing», т.к. визуально оба = «идёт поиск»; для отрисовки режима OFFER
> бот должен различать `b_state=6` отдельно.
> Источник: `WATaxiBot src/api/general.ts:8`, `order.ts:160`.

## 3. Подстатус водителя: `c_state` ✅ (подтверждено эмулятором)

Реальный бэкенд отдаёт в каждом элементе `drivers[]` единое числовое поле **`c_state`** (1–6):

| `c_state` | Смысл | Роль в выборе |
|---|---|---|
| 1 | `candidate` / considering — откликнулся, ждёт выбора клиента | **состав кандидатов/предложений** |
| 2 | `canceled` — водитель отменил отклик | исключается |
| 3 | `performer` — выбран исполнителем | выбранный водитель |
| 4 | `arrived` — прибыл к точке подачи | — |
| 5 | `started` — поездка началась | — |
| 6 | `finished` — поездка завершена | — |

Источник: `driver-emulator/src/client-simulator.js:47`, `simulator.js` (`getRawDriverState`).

- **Список кандидатов/предложений** для отрисовки клиенту = `drivers[]` где `c_state == 1`
  (см. `client-simulator.getCandidates`). У каждого — `u_id`, `c_id` и `c_options` (цена/ETA/коммент для OFFER, см. §6).
- **Выбранный исполнитель** = `c_state == 3`.

> 🔧 **Реконсиляция с WATaxiBot.** В `WATaxiBot deriveEvent` подстатус выводится из булевых полей
> `c_appointed/c_arrived/c_started/c_canceled/c_completed` (`driverState` 0–4). Это **производное
> представление** старого бота; реальный бэкенд отдаёт единый `c_state` (1–6). При написании адаптера
> iBronevik опираемся на **`c_state`** как на источник истины, булевы `c_*` — как fallback, если поле придёт.

## 4. Правило вывода события (`deriveEvent`)

Текущее правило WATaxiBot/MultiBot (через производный `driverState`):
```
state ∈ {1,6}:  driverState==3 → DRIVER_CANCELED ; иначе → PROCESSING
state == 2:     0→APPROVED 1→DRIVER_ARRIVED 2→DRIVER_STARTED 3→DRIVER_CANCELED 4→COMPLETED
state == 3:     → CANCELED
state == 4:     → COMPLETED
fallback:       → APPROVED
```

Эквивалент через **`c_state`** выбранного/подходящего водителя (целевой для адаптера iBronevik):
```
b_state 1 → PROCESSING ; b_state 6 → PROCESSING (+флаг режима OFFER) ; b_state 5 → PROCESSING
b_state 2 + c_state: 3→APPROVED 4→DRIVER_ARRIVED 5→DRIVER_STARTED 2→DRIVER_CANCELED 6→COMPLETED
b_state 3 → CANCELED ; b_state 4 → COMPLETED
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

## 6. Как модели DIRECT / VOTE / OFFER ложатся на текущий API ✅ (в основном подтверждено)

### Различение режима при СОЗДАНИИ (`POST /drive`)
Режим задаётся флагами в payload (`driver-emulator/src/order-generator.js:203,243`):

| Режим | Признак в payload | Рантайм-маркер |
|---|---|---|
| **DIRECT** | ни `b_voting`, ни `b_cars_count=0` (обычный payload) | первый назначенный водитель |
| **VOTE** | `b_voting: 1`, `b_services: [5]` | кандидаты в `drivers[]` c `c_state=1` |
| **OFFER** | `b_cars_count: 0` (он же `b_only_offer=1`) | `b_state=6` (`OFFEREDTODRIVERS`) |

Желаемая цена клиента передаётся в `b_options.customer_price` (число). Базовый payload общий:
`b_start/destination_*` (адрес+lat+lon), `b_contact`, `b_start_datetime`, `b_passengers_count`,
`b_payment_way`, `b_max_waiting`, `b_options{fromShortAddress,toShortAddress,customer_price}`, `b_custom_comment`.

> Это снимает прежнюю оговорку «режим-агностичность»: режим **различим** — при создании по payload,
> на рантайме OFFER — по `b_state=6`. Линейный трек событий (PROCESSING→APPROVED→…→COMPLETED)
> по-прежнему общий; различается только фаза выбора (кандидаты/офферы), читаемая из `drivers[]`.

### VOTE — механика подтверждена
- Водитель откликается → появляется в `drivers[]` с `c_state=1`.
- Клиент выбирает: `set_performer` (`performer=1, u_id=<driverId>`) на `/drive/get/{id}` → водитель `c_state=3`.
- Снять выбор / вернуть в голосование: `set_performer` (`performer=0, u_id`).
- Подтверждение голосования: `set_confirm_state`. Код посадки: `b_driver_code` (в тесте перебор 1–9).

### OFFER — механика подтверждена (вопрос закрыт)
OFFER — это тот же выбор из `drivers[]`, но **каждый водитель прикладывает свою цену/условия** в
`c_options` при отклике (`driver-emulator/src/simulator.js:1190`):
```
c_options = { performers_price: <цена водителя>, driver_offer_eta: <подача>, driver_offer_comment: <коммент> }
```
- Клиент видит кандидатов с их ценами (читая `drivers[]` где `c_state=1` + их `c_options.performers_price`).
- Выбор оффера = **тот же `set_performer`** (`performer=1, u_id`) — отдельной команды `selectOffer` нет.
- `set_offer` — отдельное action (перевод заказа в режим оффера / адресное предложение).
- OFFER/DIRECT не требуют кода посадки; старт без кода (только VOTE требует `b_driver_code`).

> ⚠️ Один нюанс по OFFER, который заказчик просит уточнить у бэкенд-команды: полный клиентский
> сценарий «принять оффер» в эмуляторе виден только как `set_performer` (нет отдельной доменной
> команды). Если бэкенд имеет отдельную семантику принятия оффера/контр-цены — уточнить. Остальное закрыто.

### Что осталось открытым к бэкенд-команде (сузилось до 1 пункта)
1. ~~состав кандидатов/предложений~~ → **закрыто**: `drivers[]` где `c_state=1` (+`c_options` для OFFER).
2. ~~передача желаемой цены OFFER~~ → **закрыто**: клиент — `b_options.customer_price`; водитель — `c_options.performers_price`.
3. ~~семантика OFFEREDTODRIVERS / PENDINGACTIVATION~~ → **закрыто**: `b_state` 6 и 5 (см. §2).
4. ~~команда смены точки подачи~~ → **закрыто отрицательно**: отдельной команды нет; `action=edit`
   существует, но не для маршрута (см. [commands.md](commands.md)).
5. **Остаётся:** точная семантика принятия оффера (отдельная команда / контр-цена водителя?) — уточнить.

---

## 7. Следствие для архитектуры

Текущий «внешний FSM заказа» = **линейный трек** из 8 событий, получаемый поллингом, **плюс читаемая
из `drivers[]` фаза выбора** (кандидаты VOTE / офферы с ценами OFFER). Режим различим (см. §6).
Идеализированный FSM ТДМ (gpt3, со стратегиями Carrier Determination) — целевой ориентир. Контракт
`OrderGateway` (Этап 3) скрывает это различие: бот работает с нормализованными событиями и командами,
а адаптер iBronevik переводит их в `b_*`/`c_*`/`set_offer`.
