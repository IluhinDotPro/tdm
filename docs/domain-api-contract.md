# Доменный API-контракт: серверное FSM-ядро ↔ бот

> **Назначение.** Зафиксировать **доменный контракт** между ботом (FSM интерфейса) и **серверным
> FSM-ядром заказа** — тем самым, которое проектируется бэкенд-стороной (Иван) поверх iBronevik.
> Это **не новая FSM-схема**, а описание интерфейса: какие **команды** ядро принимает, какие
> **запросы** обслуживает, какой **снимок** заказа отдаёт, какие **действия доступны** в каждый момент,
> как наблюдаемое состояние **ложится на состояния бота**, и как контракт **версионируется**.
>
> **Зачем отдельный документ.** Текущая документация сильна как описание *существующего* бота и его
> интеграции с iBronevik через поллинг (бот сам выводит состояние из `b_state`/`c_state` —
> [order-fsm/backend-mapping.md](order-fsm/backend-mapping.md)). Но она отстаёт от серверного
> FSM-ядра: в целевой архитектуре **ядро — источник истины**, а бот лишь рендерит снимок и доступные
> действия. Этот файл задаёт границу между двумя слоями.
>
> Опирается на: [integration/order-gateway-contract.md](integration/order-gateway-contract.md) (бот-сторона
> порта), [order-fsm/commands.md](order-fsm/commands.md), [order-fsm/events.md](order-fsm/events.md),
> [order-fsm/api-payload-reference.md](order-fsm/api-payload-reference.md) (iBronevik-реализация),
> [domain/order-model.md](domain/order-model.md), [domain/business-rules.md](domain/business-rules.md).

---

## 0. Позиция контракта в архитектуре

Три слоя, разделённые этим контрактом:

```
┌──────────────────────────────┐
│  FSM бота (интерфейс)         │  form-FSM + tracking-FSM. Рендерит снимок, шлёт команды.
│                              │  Про b_state/c_state НЕ знает.
└──────────────┬───────────────┘
               │  ◄── ЭТОТ КОНТРАКТ (доменный, нормализованный) ──►
               │      Commands · Queries · Snapshot · Available Actions · Events
┌──────────────┴───────────────┐
│  Серверное FSM-ядро заказа    │  Источник истины состояния. Владеет жизненным циклом,
│  (Иван / бэкенд)             │  таймерами, стратегиями Carrier Determination.
└──────────────┬───────────────┘
               │  адаптер iBronevik (b_*/c_*/set_*) — деталь реализации ядра
┌──────────────┴───────────────┐
│  iBronevik core (drive/*)     │
└──────────────────────────────┘
```

На бот-стороне контракт реализует порт **`OrderGateway`**
([integration/order-gateway-contract.md](integration/order-gateway-contract.md)). На стороне ядра —
любая реализация, удовлетворяющая контракту (сейчас: адаптер iBronevik по
[order-fsm/api-payload-reference.md](order-fsm/api-payload-reference.md)).

> **Стратегическая развилка (к заказчику, всё ещё открыта).** Контракт сознательно
> **транспорт- и бэкенд-агностичен**, поэтому он валиден при любом из двух исходов
> ([api-payload-reference.md](order-fsm/api-payload-reference.md) §6):
> 1. **Бот ходит в серверное FSM-ядро** — ядро отдаёт `OrderSnapshot`/`AvailableActions` напрямую
>    (этот контракт — его публичный API).
> 2. **Бот ходит напрямую в iBronevik** — контракт реализует адаптер на бот-стороне (как сейчас в
>    `OrderManager`), выводя снимок из поллинга.
>
> В обоих случаях **FSM бота не меняется**. Разница только в том, *кто* наполняет снимок и считает
> доступные действия — ядро или адаптер. Рекомендация: закрепить ответственность за ядром (вариант 1),
> чтобы бот перестал зависеть от `deriveEvent`.

### Принципы контракта
1. **Ядро — источник истины.** Бот не вычисляет состояние заказа; он его **получает** (снимок + события).
2. **Домен, не транспорт.** Никаких `b_state`, `c_state`, `set_performer` в контракте — только
   нормализованные понятия. Маппинг на iBronevik живёт в адаптере.
3. **Команды = намерения.** Бот шлёт намерения; легитимность и эффект определяет ядро
   ([order-fsm/commands.md](order-fsm/commands.md) §3).
4. **Server-driven UI affordances.** Что *можно* сделать сейчас — решает ядро (`AvailableActions`),
   а не зашитые в боте условия. Бот лишь рендерит.
5. **Идемпотентность и дедупликация** — обязательны (см. §1.4, §6).

---

## 1. Commands (бот → ядро)

Команды — **запись**: намерения клиента, отправляемые в ядро. Нормализованный словарь (расширяет
[order-fsm/commands.md](order-fsm/commands.md); маппинг на `action` iBronevik — в скобках, источник
[api-payload-reference.md](order-fsm/api-payload-reference.md) §4).

### 1.1 Каталог команд

| Команда | Назначение | Применима в состояниях | iBronevik (адаптер) |
|---|---|---|---|
| `createOrder(params)` → `{orderId}` | Создать заказ | — (старт) | `POST /drive` (`b_*`, `b_options`) |
| `cancelOrder(orderId, reason)` | Отменить заказ | `SEARCHING`, `ASSIGNED`, `DRIVER_ARRIVED` (всё **до** `IN_RIDE`) | `set_cancel_state {reason}` |
| `selectCandidate(orderId, driverId)` | Выбрать кандидата (VOTE) | `SEARCHING` (есть кандидаты) | `set_performer {u_id, performer:1}` |
| `clearSelection(orderId, driverId)` | Снять выбор → вернуть в голосование | `SEARCHING`/`ASSIGNED` (выбор был) | `set_performer {u_id, performer:0}` |
| `selectOffer(orderId, driverId)` | Выбрать предложение (OFFER) | `SEARCHING` (есть офферы) | `set_performer {u_id, t_id?}` |
| `confirmVote(orderId)` | Подтвердить голосование (VOTE) | `SEARCHING` (VOTE) | `set_confirm_state {b_estimate_waiting?}` |
| `confirmBoarding(orderId, code)` | Подтвердить посадку (VOTE/внешний водитель) | `ASSIGNED`, `DRIVER_ARRIVED` | `b_driver_code` |
| `extendVoting(orderId)` | Продлить таймер голосования (+3 мин) | `SEARCHING` (VOTE) | `votingTimer += 180s` |
| `setRate(orderId, rate)` | Оценка после поездки | `COMPLETED` | API set rate |
| `setReview(orderId, text)` | Отзыв после поездки | `COMPLETED` | API set review |

> **Намеренно НЕ в контракте** (закрыто отрицательно, [commands.md](order-fsm/commands.md) §«Открытые вопросы»):
> смена точки подачи/назначения после создания — отдельной команды на бэкенде нет (`edit_payload`
> правит только опции, не маршрут). Из MVP убрано.
>
> **Сторона водителя** (`set_arrive_state`/`set_start_state`/`set_complete_state`) — **не команды бота**;
> бот узнаёт об их эффекте через события/снимок ([backend-mapping.md](order-fsm/backend-mapping.md) §3).

### 1.2 `OrderParams` (вход `createOrder`)

Доменные параметры (а не `b_*`). Адаптер переводит их в payload iBronevik
([api-payload-reference.md](order-fsm/api-payload-reference.md) §1–2).

```ts
interface OrderParams {
  route: { from: Location; to: Location; via?: Location[] };
  tripType?: 'CITY' | 'INTERCITY' | 'COUNTRY';        // источник: AUTO | MANUAL
  carClass?: 'PETIT' | 'GRAND' | 'ANY';
  seats?: number;
  preferences?: {
    requirements?: Array<{ code: string }>;            // режим HARD_FILTER|SOFT_SCORE — у ядра
    note?: string;                                     // в подбор НЕ участвует
  };
  dispatch: { type: 'NOW' | 'LATER'; when?: string };  // ISO для LATER
  mode: 'DIRECT' | 'VOTE' | 'OFFER';                   // стратегия Driver Matching
  pricing?: {
    clientPrice?: number;                              // предложение клиента (OFFER) → b_options.customer_price
    pickupFee?: number;                                // задаёт пассажир (business-rules §1)
  };
  contact: { phone: string };
  payment: { method: string };
  maxWaitingSecs?: number;
}

interface Location { latitude: number; longitude: number; address?: string }
```

### 1.3 Результаты и ошибки

```ts
type CommandResult =
  | { ok: true; orderId: string; snapshot?: OrderSnapshot }   // снимок-эхо после команды (рекоменд.)
  | { ok: false; error: CommandError };

interface CommandError {
  code: 'NOT_FOUND' | 'INVALID_STATE' | 'NOT_ALLOWED' | 'VALIDATION' | 'BACKEND' | 'CONFLICT';
  message: string;
  retriable?: boolean;
}
```

- `INVALID_STATE` — команда неприменима в текущем состоянии (см. колонку «Применима»). Бот **не должен**
  слать такие команды, если опирается на `AvailableActions` (§4), но ядро обязано защищаться.
- Желательно: успешная команда возвращает свежий `snapshot` (эхо), чтобы бот не делал лишний `getOrderSnapshot`.

### 1.4 Гарантии команд

| Свойство | Правило |
|---|---|
| Идемпотентность | Повтор `cancelOrder` на терминальном заказе — `ok:true` без эффекта (не ошибка). |
| Авторитетность | Легитимность перехода определяет **ядро**, не бот ([commands.md](order-fsm/commands.md) §3). |
| Атомарность | Команда либо применена, либо нет; частичных эффектов быть не должно. |
| Эхо-снимок | По возможности возвращать `snapshot` синхронно (снижает гонки с поллингом). |

---

## 2. Queries (бот → ядро, чтение)

> **Здесь главный разрыв с текущим состоянием.** Сейчас read-модели как таковой нет: бот поллит
> `/drive/get/{id}`, выводит событие через `deriveEvent` и **дочитывает детали** из API при отрисовке
> ([events.md](order-fsm/events.md) §1). Контракт вводит явные запросы — read-сторона ядра.

```ts
interface OrderQueries {
  // полный снимок заказа (read-модель, §3)
  getOrderSnapshot(orderId: string): Promise<OrderSnapshot | null>;

  // что клиент может сделать прямо сейчас (§4) — server-driven affordances
  getAvailableActions(orderId: string): Promise<AvailableAction[]>;

  // подписка на события (поток изменений снимка); транспорт-агностично (§6)
  watch(orderId: string, ctx: WatchContext): void;   // как в OrderGateway
  unwatch(orderId: string): void;

  // опционально (операционные)
  listActiveOrders?(filter: { botId?: string; chatId?: string }): Promise<string[]>;
}
```

- `getOrderSnapshot` — единая точка чтения; заменяет «дочитывание деталей из API по `orderId`».
- `getAvailableActions` может приходить **внутри** снимка (поле `availableActions`) — тогда отдельный
  запрос не нужен (рекомендуемый вариант, см. §3).
- `watch`/`unwatch` и доставка событий — на бот-стороне это `OrderGateway`
  ([order-gateway-contract.md](integration/order-gateway-contract.md) §2). Поток событий — §6.

> **Реализация сейчас (поллинг):** `watch` = `OrderManager.registerOrder`; «событие» выводится из diff
> снимка между тиками. При переходе на серверное ядро `watch` может стать webhook/WS без изменений в
> FSM бота — сигнатуры те же.

---

## 3. Order Snapshot (read-модель)

> Единый **снимок заказа** — то, что бот рендерит. Расширяет `OrderSnapshot` из
> [order-gateway-contract.md](integration/order-gateway-contract.md) §4 до полной read-модели и
> согласован с доменной моделью ([order-model.md](domain/order-model.md)).
>
> **Контрактное требование:** снимок **самодостаточен для отрисовки** — бот не делает доп. запросов,
> чтобы показать экран. Все поля для текущего состояния уже в снимке.

```ts
interface OrderSnapshot {
  orderId: string;
  version: number;            // schemaVersion контракта (§7)
  seq: number;                // монотонный номер ревизии снимка (упорядочивание, §6)
  occurredAt: string;         // ISO; момент формирования снимка

  state: ObservedState;       // нормализованное состояние (§5)
  mode: 'DIRECT' | 'VOTE' | 'OFFER';
  outcome?: ExecutionOutcome; // только для терминальных состояний

  route: { from: Location; to: Location; via?: Location[] };
  pickup?: { requested?: Location; actual?: Location };   // actual может ≠ requested (order-model §3)

  // выбранный исполнитель (когда есть)
  driver?: { driverId: string; name?: string; phone?: string; car?: string; plate?: string };

  // фаза выбора (по режиму)
  candidates?: Array<{ driverId: string; carId?: string; arrivedAt?: string }>;  // VOTE: отклики
  offers?: Array<{ driverId: string; price: number; eta?: string; comment?: string }>; // OFFER

  // деньги (business-rules §1): только Actual к оплате; остальное информативно
  pricing?: {
    estimated?: number;       // расчётная (информационная)
    clientPrice?: number;     // предложение клиента (OFFER)
    acceptedPrice?: number;   // принятая цена водителя
    pickupFee?: number;
    minimumRidePrice?: number;
    actual?: number;          // ЕДИНСТВЕННАЯ к оплате (по завершении)
    tips?: number;
  };

  timestamps?: {              // order-model §2.10
    createdAt?: string; expiresAt?: string; assignedAt?: string;
    arrivedAt?: string; startedAt?: string; finishedAt?: string;
  };

  // активные таймеры (cross-cutting, timers.md) — для отрисовки обратного отсчёта
  timers?: Array<{ kind: string; remainingSecs: number; deadlineAt?: string }>;

  boarding?: { required: boolean; verified: boolean; method?: string };  // VOTE-посадка

  // server-driven affordances (§4) — рекомендуется встраивать прямо в снимок
  availableActions?: AvailableAction[];
}

type ExecutionOutcome =
  | 'completed' | 'expired' | 'cancelled'
  | 'external_carrier' | 'early_terminated' | 'incident';   // execution-models §8
```

> **Источники наполнения (iBronevik-адаптер).** Кандидаты = `drivers[]` где `c_state==1`; выбранный =
> `c_state==3`; цена/ETA оффера = `c_options.{performers_price,driver_offer_eta,driver_offer_comment}`;
> деньги — `b_options.customer_price` / `c_options.performers_price` ([backend-mapping.md](order-fsm/backend-mapping.md)
> §3, §6). Поллер уже держит сырой ответ — наполнить снимок дёшево
> ([order-gateway-contract.md](integration/order-gateway-contract.md) §4).

---

## 4. Available Actions (server-driven affordances)

> **Принцип.** Какие действия доступны клиенту сейчас — решает **ядро**, не бот. Бот не зашивает
> «в состоянии X показать кнопку Отмена»; он рендерит то, что отдало ядро. Это убирает дублирование
> правил отмены/выбора между ботом и ядром ([business-rules.md](domain/business-rules.md) §4 — единственный
> источник политики отмены).

```ts
interface AvailableAction {
  command: string;            // имя команды из §1 (например 'cancelOrder', 'selectCandidate')
  enabled: boolean;           // false → показать неактивной с reason
  labelKey?: string;          // ключ локализации для подписи (тексты — на бот-стороне)
  params?: Record<string, unknown>;  // предзаполнение (например driverId кандидата)
  reason?: string;            // почему disabled (для подсказки)
}
```

### 4.1 Базовая матрица «состояние → доступные команды»

Выведена из политики отмены ([business-rules.md](domain/business-rules.md) §4.1: отмена только **до**
`IN_RIDE`) и предусловий команд (§1.1). Ядро может сузить набор по режиму/стратегии.

| ObservedState | DIRECT | VOTE | OFFER |
|---|---|---|---|
| `SEARCHING` | `cancelOrder` | `cancelOrder`, `selectCandidate`*, `clearSelection`*, `confirmVote`, `extendVoting` | `cancelOrder`, `selectOffer`* |
| `ASSIGNED` | `cancelOrder` | `cancelOrder`, `confirmBoarding`, `clearSelection` | `cancelOrder` |
| `DRIVER_ARRIVED` | `cancelOrder` | `cancelOrder`, `confirmBoarding` | `cancelOrder` |
| `IN_RIDE` | — | — | — |
| `COMPLETED` | `setRate`, `setReview` | `setRate`, `setReview` | `setRate`, `setReview` |
| `CANCELLED` / `EXPIRED` / `RIDE_INTERRUPTED` | — | — | — |

\* — только если есть состав выбора (`candidates`/`offers` непусты).

> **Почему это критично для стыковки с ядром.** Сегодня доступность кнопок зашита в схемах/хендлерах
> бота. Когда ядро начнёт владеть стратегиями Carrier Determination
> ([execution-models.md](domain/execution-models.md) §6) — условия «можно ли выбрать кандидата»,
> «можно ли ещё отменить» усложнятся (re-matching, отложенное назначение). Контракт переносит это
> решение в ядро **сейчас**, пока бот ещё на простой матрице — миграция будет аддитивной.

---

## 5. UI State Mapping

> Связывает три представления состояния: **(адаптер) сырой бэкенд → нормализованное событие →
> ObservedState ядра → состояние tracking-FSM бота**. Это та «недостающая прослойка» между
> документацией бота и серверным FSM.

### 5.1 Канон: `ObservedState`

Нормализованный набор состояний, которым оперирует контракт (надмножество над 8 событиями
`order_status_*`; терминальные помечены):

| ObservedState | Смысл | Терминальное |
|---|---|---|
| `SEARCHING` | Поиск/формирование кандидатов (вкл. VOTE-голосование, OFFER-сбор) | — |
| `ASSIGNED` | Исполнитель назначен, едет к клиенту | — |
| `DRIVER_ARRIVED` | Водитель прибыл к точке подачи | — |
| `IN_RIDE` | Поездка идёт | — |
| `COMPLETED` | Завершена штатно | ✅ |
| `CANCELLED` | Отменена до старта (клиент/водитель/таймаут отклика) | ✅ |
| `EXPIRED` | Истёк срок (исполнитель не найден) | ✅ |
| `RIDE_INTERRUPTED` | Досрочное прекращение **после** старта (≠ отмена) | ✅ |
| `NO_SHOW_DRIVER` | Назначенный не прибыл (целевое, re-matching/term.) | ✅ |

> `RIDE_INTERRUPTED` и `NO_SHOW_DRIVER` — целевые ([business-rules.md](domain/business-rules.md) §4.2,
> [execution-models.md](domain/execution-models.md) §«Открытые вопросы»); в текущем поллинге пока не
> различаются (схлопываются в `COMPLETED`/`CANCELLED`). Введены в контракт, чтобы ядро могло их отдать
> без изменения контракта (аддитивно).

### 5.2 Полная таблица маппинга

| iBronevik (адаптер) | Нормализованное событие | ObservedState | Состояние tracking-FSM бота |
|---|---|---|---|
| `b_state∈{1,5,6}` | `order_status_processing` | `SEARCHING` | `order.driverSearch` |
| `b_state=2`, `c_state=3` | `order_status_approved` | `ASSIGNED` | `order.driverAssigned` |
| `b_state=2`, `c_state=4` | `order_status_driver_arrived` | `DRIVER_ARRIVED` | `order.driverArrived` |
| `b_state=2`, `c_state=5` | `order_status_driver_started` | `IN_RIDE` | `order.rideStarted` |
| `b_state=2`, `c_state=2` | `order_status_driver_canceled` | `CANCELLED` | `order.cancelled` |
| `b_state=3` | `order_status_canceled` | `CANCELLED` | `order.cancelled` |
| `b_state=4` / `c_state=6` | `order_status_completed` | `COMPLETED` | `order.completed` |
| таймаут (timers) | `order_status_out_of_time` | `EXPIRED` | `order.expired` |

> Колонка iBronevik — реализация адаптера ([backend-mapping.md](order-fsm/backend-mapping.md) §2–4);
> в контракте её **нет** (бот её не видит). Имена состояний бота — ориентир по
> [bot-fsm/tracking-fsm.md](bot-fsm/tracking-fsm.md) и `schemas/order.json`; точные id фиксируются в схеме.
> Режим OFFER различается по флагу (`b_state=6`), но событийный трек тот же — режим бот берёт из
> `snapshot.mode`, а не из состояния.

### 5.3 Правила перехода для бота

- Бот меняет состояние tracking-FSM **только** по событию/снимку от ядра (никогда — самовольно).
- **Пропуски допустимы:** поллинг может «перепрыгнуть» промежуточный статус — FSM сопровождения обязан
  принимать переход через несколько шагов (напр. `SEARCHING → IN_RIDE`)
  ([order-gateway-contract.md](integration/order-gateway-contract.md) §5).
- **События «назад» по треку игнорируются** (по `seq`).
- Терминальное состояние → `unwatch`.

---

## 6. Поток событий и доставка

Подписка (`watch`) даёт поток изменений снимка. Событие = «снимок изменился».

```ts
interface OrderEvent {
  orderId: string;
  event: OrderStatusEvent;     // order_status_* (events.md) — нормализованный тип
  state: ObservedState;        // §5
  snapshot: OrderSnapshot;     // полный снимок на момент события (§3) — обязателен в целевом контракте
  seq: number;                 // монотонный; упорядочивание и анти-«назад»
  occurredAt: string;          // ISO; ставит доставщик
}
```

| Гарантия | Правило (для ядра/адаптера) |
|---|---|
| Дедупликация | Эмитить только при изменении относительно `lastEmittedEvent`/`seq`. |
| Терминальность | После `COMPLETED/CANCELLED/EXPIRED/RIDE_INTERRUPTED/NO_SHOW_DRIVER` → `unwatch`. |
| Упорядочивание | По `seq`; бот отбрасывает событие со `seq` ≤ последнего применённого. |
| Пропуски | Бот принимает мультишаговый переход (см. §5.3). |
| Восстановление | Реестр наблюдения должен переживать рестарт (Redis) — иначе поллинг теряется при рестарте процесса ([order-gateway-contract.md](integration/order-gateway-contract.md) §5). |

> Транспорт (поллинг ~5с / webhook / WS) — деталь реализации `watch`; контракт от него не зависит.

---

## 7. Versioning

> Контракт будет жить дольше любой текущей реализации (iBronevik сегодня, серверное ядро завтра).
> Версионирование обязано допускать **аддитивную эволюцию** без поломки бота.

### 7.1 Версия контракта
- Поле **`version`** в `OrderSnapshot`/`OrderEvent` — номер версии **схемы контракта** (целое,
  монотонно растущее). Бот логирует и умеет работать с `version ≤ supported`.
- **SemVer на уровне документа:** `MAJOR.MINOR`.
  - **MINOR** — аддитивно: новые **опциональные** поля снимка, новые `ObservedState`, новые команды,
    новые значения `ExecutionOutcome`. Старый бот игнорирует незнакомое.
  - **MAJOR** — несовместимо: удаление/переименование поля, смена семантики, обязательность нового
    поля, удаление команды. Требует согласованного релиза бота и ядра.

### 7.2 Правила совместимости
| Изменение | Тип | Действие бота |
|---|---|---|
| Новое опциональное поле снимка | MINOR | Игнорировать, если не знает. |
| Новый `ObservedState` | MINOR | Маппить на ближайший известный или «нейтральный» экран; не падать. |
| Новая команда / `AvailableAction` | MINOR | Показывать, только если знает `command`; иначе скрыть. |
| Новое значение `ExecutionOutcome` | MINOR | Трактовать как терминальное; общий текст. |
| Удаление/переименование поля или команды | MAJOR | Согласованный релиз. |
| Смена семантики существующего поля | MAJOR | Согласованный релиз. |

### 7.3 Устойчивость бота (forward-compatibility)
- **Неизвестные поля** — игнорировать, не валить парсинг.
- **Неизвестный `ObservedState`/`event`** — не падать; деградировать до безопасного отображения и
  логировать (для алерта о рассинхроне версий).
- **`AvailableActions` — единственный источник доступности команд:** если ядро не прислало команду в
  списке, бот её не показывает, даже если «знает» по матрице §4.1. Это делает п.4.1 fallback-ом, а
  не дублирующим источником истины.

### 7.4 Согласование возможностей (capabilities) — опционально
Чтобы бот понимал, что умеет конкретное ядро (поллинг vs push, поддержка `RIDE_INTERRUPTED`,
встроенные `availableActions` в снимок):

```ts
interface GatewayCapabilities {
  version: number;
  transport: 'poll' | 'webhook' | 'ws';
  snapshotInEvents: boolean;        // событие несёт полный снимок
  availableActionsInSnapshot: boolean;
  supportedStates: ObservedState[];
  supportedCommands: string[];
}
```

Бот запрашивает `capabilities` при инициализации gateway и подстраивает рендер/набор кнопок.

---

## 8. Что меняется относительно «как сейчас»

| Сегодня (бот + iBronevik) | Целевой контракт (бот ↔ ядро) |
|---|---|
| Бот выводит состояние сам (`deriveEvent` из `b_state`/`c_state`) | Ядро отдаёт `ObservedState` в снимке |
| Детали дочитываются из API при отрисовке | Снимок самодостаточен (§3) |
| Доступность кнопок зашита в боте | `AvailableActions` от ядра (§4) |
| Минимальный payload события (`{orderId}`) | Событие несёт полный снимок + `seq` (§6) |
| Реестр наблюдения в памяти процесса | Персистентный (Redis), переживает рестарт |
| Нет явной версии | `version` + правила совместимости (§7) |

> **Итог.** Документ задаёт границу, на которой бэкенд-ядро и бот могут развиваться независимо: ядро
> усложняет стратегии и состояния — бот не трогаем, пока изменения аддитивны (§7). Это и есть то,
> чего не хватало между текущей документацией бота и серверным FSM-ядром.

---

## Открытые вопросы (к заказчику / бэкенд-команде)
- **Развилка §0:** бот ходит в серверное FSM-ядро или напрямую в iBronevik? От ответа зависит, *где*
  живёт реализация контракта (ядро vs адаптер на бот-стороне).
- Отдаёт ли ядро `availableActions` и полный снимок в событии, или бот считает их сам (capabilities §7.4).
- Поддержка целевых состояний `RIDE_INTERRUPTED` / `NO_SHOW_DRIVER` и таймеров re-matching на стороне ядра.
- Семантика принятия оффера/контр-цены помимо `set_performer` (остаётся открытой,
  [order-gateway-contract.md](integration/order-gateway-contract.md) §«Открытые вопросы»).
