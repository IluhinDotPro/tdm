# Каркас серверного FSM-ядра заказа (strawman для проектирования)

> **Статус: STRAWMAN (предложение), НЕ истина.** Этот документ описывает *предлагаемое* устройство
> **самого ядра** — то, что в контракте [../integration/bot-domain-api-contract.md](../integration/bot-domain-api-contract.md)
> (B0) остаётся «чёрным ящиком». Цель — дать @spitegod / Ивану конкретный предмет для реакции, а не
> зафиксировать готовый дизайн. **Источник истины по графу состояний — движок** (@spitegod); расхождения
> сводятся в [states.md](states.md) §1a.
>
> 🏛 Контекст — ADR-001 (Вариант 3): Domain Order FSM на универсальном FSM-движке владеет состоянием;
> iBronevik — за Core-слоем ([../architecture-decision-variant3.md](../architecture-decision-variant3.md)).
>
> **Зачем.** Контракт B0 отвечает «как бот работает с ядром». Этот документ отвечает «как устроено ядро»:
> агрегаты, сущности, хранение, состояния, **переходы** (что их вызывает: команда / авто / таймер),
> таймеры и автоматические действия. Именно это сейчас определяет структуру БД.
>
> **Следующий шаг (ревью 2026-06-24):** не новые документы, а **сверка** этого strawman'а с реальным
> универсальным движком Ивана (платформа постаматов) — насколько таблица переходов §5 (T1–T16),
> модель агрегатов §2 и развилка §2.4 ложатся на существующую платформу. Открытые вопросы §11 —
> программа этой сверки. Рабочий лист для встречи — [fsm-core-sync-checklist.md](fsm-core-sync-checklist.md).
>
> **Scope:** Order FSM. Driver FSM и Driver Web UI — зона @spitegod, **вне** этого документа (ADR §2).
> Опирается на: [../domain/order-model.md](../domain/order-model.md), [../domain/execution-models.md](../domain/execution-models.md),
> [../domain/business-rules.md](../domain/business-rules.md), [states.md](states.md), [commands.md](commands.md),
> [timers.md](timers.md), [backend-mapping.md](backend-mapping.md).

---

## Происхождение разделов (что уже реально, что — предложение Павла)

> Постановка для сверки: не «правильно ли спроектирован FSM», а **какие элементы уже соответствуют
> универсальному движку, а какие — проектные пожелания Павла, подлежащие сверке**. Роли: **Павел** —
> аналитик/интегратор (бизнес-правила, контракт бота, проекции, ожидаемое поведение); **Иван** —
> архитектор/разработчик движка (реальная модель FSM, переходы, хранение); **Максим** — носитель
> референсной реализации (постаматный FSM, прошедший ручное тестирование со всеми ролями) — проверяет
> «согласуется с универсальным движком / ломает универсальность».

| Раздел | Происхождение | Статус |
|---|---|---|
| §2 Агрегаты/сущности | предложение Павла (по [order-model.md](../domain/order-model.md) §6,§8) | сверить с моделью движка |
| §3 Хранение (таблицы) | **предложение** Павла (помечено как не-схема) | сверить со схемой движка / `vote_fsm` |
| §4 Состояния (12) | **авторитетно — @spitegod** ([states.md](states.md) §1a) | подтвердить имена/полноту |
| §5 Переходы T1–T16 | **предложение** Павла | пометить есть/нет/иначе/покрыто |
| §6 Command→переход | производно от B0 §2 + §5 | сверить |
| §7 Таймеры | частично реально (`votingTimer`, `b_max_waiting`), частично предложение | сверить механизм |
| §8 Авто-действия + Core Adapter | маппинг `b_state`/`c_state` — **реально** (эмулятор/дамп, [backend-mapping.md](backend-mapping.md)); эффекты переходов — предложение | сверить |

> Итого: единственное **авторитетное** ядро — 12 состояний (§4) и реальный маппинг бэкенда (§8/backend-
> mapping). Всё остальное — материал Павла для построчной сверки, см. [fsm-core-sync-checklist.md](fsm-core-sync-checklist.md).

---

## 1. Уровни описания (во избежание смешения)

| Уровень | Что | Где истина |
|---|---|---|
| **Aggregate / Entity** | бизнес-сущности и границы согласованности (§2) | домен (order-model) |
| **Persistence** | таблицы БД (§3) — *предложение* | движок / схема @spitegod |
| **FSM state** | доменные состояния (§4) | [states.md](states.md) §1a (@spitegod) |
| **Transition** | переходы + триггеры (§5–6) | движок (этот документ — strawman) |
| **Timer / Auto-action** | cross-cutting триггеры и эффекты (§7–8) | движок |
| **ObservedState / UI** | проекция для отрисовки | **бот** (UI Resolver) — НЕ ядро |

> ⚠️ Ядро **не строится** на UI-канониках (`SEARCHING`…). Это уровень API/представления
> ([domain-api-contract.md](../domain-api-contract.md) §1). Ниже — только доменный уровень.

---

## 2. Агрегаты и сущности

> Закрывает замечание рецензии: «что такое Order / Candidate / Offer / DriverAssignment / Trip — таблицы,
> FSM, проекции?» Ответ: это **доменные сущности**; массивы `candidates[]`/`offers[]` в снапшоте B0 —
> их **read-проекции**; таблицы — в §3.

### 2.1 Order (Aggregate Root)
Корень агрегата. Владеет жизненным циклом и **является носителем FSM-состояния**.

- **Идентичность:** `orderId`.
- **Владеет (внутри границы согласованности):** маршрут (`from/to/via`), параметры (тип поездки, класс,
  места), `OrderPreferences` (requirements + note), цены (4 формы), способ подачи (`NOW/LATER`), режим
  (`DIRECT/VOTE/OFFER`), таймстемпы, `OrderLocation` (`requested/actualPickup`, `destination`),
  `BoardingSession`, **текущее FSM-состояние**, `fsmVersion`.
- **Не владеет напрямую** (отдельная подсистема, ссылается по `orderId`): Driver Matching — `Candidate`,
  `Offer`, `DriverAssignment` (см. [order-model.md](../domain/order-model.md) §6, §8).

### 2.2 Driver Matching (подсистема поверх заказа)
Единый процесс подбора с режимами; по границе **согласованности/хранения** — отдельно от агрегата
Order, ссылается на него по `orderId`. ⚠️ Но **владелец FSM** для фаз подбора — открытый вопрос: см.
развилку §2.4 (граница агрегата ≠ владелец FSM).

| Сущность | Что | Поля (черновик) | Режим | Проекция в снапшоте B0 |
|---|---|---|---|---|
| **Candidate** | водитель, заявивший готовность (VOTE: «intent to serve») | `orderId`, `driverUserId`, `vehicle`, `votedAt`, `status` | VOTE | `candidates[]` |
| **Offer** | ценовое предложение водителя | `orderId`, `driverUserId`, `vehicle`, `price`, `eta?`, `comment?`, `createdAt`, `status` | OFFER | `offers[]` |
| **DriverAssignment** | факт назначения исполнителя | `orderId`, `driverUserId`, `assignedAt`, `releasedAt?`, `source` (manual/firstArrived/…) | все | `driver` |
| **BoardingSession** | подтверждение посадки | `orderId`, `type` (code/QR/plate), `value`, `verifiedAt?` | VOTE/внешн. | `boarding` (если вводим) |
| **Trip** | фактическая перевозка после успешного boarding | `orderId`, `driverUserId`, `startedAt`, `finishedAt?`, `actualPrice?`, `outcome` | все | поля цены/времени |

> **CandidatePool / PoolVisibility** ([execution-models.md](../domain/execution-models.md) §1) — рантайм-
> понятия подбора (кому виден заказ / кто допущен после HARD_FILTER). Могут быть проекциями, а не
> таблицами — **открытый вопрос §11**.

### 2.3 Инварианты агрегата (черновик, [order-model.md](../domain/order-model.md) §8)
- У заказа не может быть активного `DriverAssignment`, пока не снят предыдущий.
- `Trip.startedAt` невозможен без успешного `BoardingSession.verifiedAt` (кроме DIRECT-сценариев прямого
  старта).
- `actualPrice ≥ minimumRidePrice` всегда; `actual` фиксируется к завершению ([business-rules.md](../domain/business-rules.md) §1).
- Цену **считает Core**, FSM только фиксирует (ADR §5 / B0 §5).

### 2.4 ✅ Развилка: владелец Driver Matching — РЕШЕНА (Вариант A, сверка 2026-06-26)

> **Закрыто ответом Ивана** ([fsm-core-sync-checklist.md](fsm-core-sync-checklist.md) §3.B, `fsm-core-sync-checklist-answer.md`):
> принят **Вариант A** — единый Order FSM, фазы подбора = состояния Order. **Candidate/Offer — контекст
> заказа в `orders.metadata_json`**, не отдельные сущности/таблицы/FSM (на MVP). Nested/Parallel FSM в
> движке **нет и не нужны**. Линза движка: Order = экземпляр FSM; Candidate/Offer = контекст FSM;
> DriverAssignment = эффект перехода; Boarding = guard/effect; Trip = domain model (`Ride`). Текст ниже —
> исходная постановка развилки, оставлен для истории.



Противоречие, которое надо снять с Иваном. §2.2 говорит: подбор — отдельная подсистема, не часть
агрегата Order. Но в перечне состояний (§4) фазы подбора — `order_vote_waiting_candidates`,
`order_offer_waiting`, `order_vote_driver_assigned` — это состояния **самого Order FSM**. То есть подбор
фактически живёт внутри Order FSM. Нужно выбрать трактовку:

| | **Вариант A — единый Order FSM** | **Вариант B — декомпозиция FSM** |
|---|---|---|
| Машины | одна: фазы подбора = состояния Order | Order FSM + Matching FSM (+ Trip FSM); Order делегирует фазу подбора |
| Состояния §4 | `order_vote_waiting_*` / `order_offer_waiting` — **родные** состояния Order | те же имена — **проекция** состояния Matching FSM на Order |
| Агрегаты | Candidate/Offer — сущности/таблицы, но фазой владеет Order FSM | Matching — самостоятельный агрегат со своим жизненным циклом |
| БД | состояние подбора в `orders.state` | отдельное `matching.state` + связь с заказом |
| Сложность | проще (1 машина); риск разрастания состояний Order | чище разделение, но 2–3 машины и их синхронизация |
| Когда уместно | подбор линеен и строго внутри одного заказа | сложный подбор: re-matching, раунды, параллельные кандидаты |

**Ключ к разрешению:** различать **границу агрегата** (согласованность/хранение) и **владельца FSM**
(кто двигает состояние фазы). Это разные оси: можно держать Candidate/Offer как отдельные сущности
(свои таблицы) и при этом отражать *фазу* подбора как состояния Order — гибрид, ближе к A.

**Сигнал из каноники:** текущие 12 состояний @spitegod ([states.md](states.md) §1a) **читаются как
Вариант A** — фазы подбора уже перечислены как состояния Order FSM. Возможно, движок де-факто выбрал A.
Подтвердить у Ивана: (1) Candidate/Offer — отдельные сущности движка или часть payload заказа;
(2) не появится ли отдельный Matching/Trip FSM при усложнении (re-matching, `order_vote_no_show`).

→ Развилка **решается сверкой с движком**, не на стороне бота. Поднята вопросом №1 в §11.

---

## 3. Хранение (предлагаемые таблицы)

> ⚠️ **Предложение**, не схема. Свести с реальной схемой движка / дампом `vote_fsm`.
>
> **Развилка хранения состояния (вопрос A к Ивану):** `orders.state` как поле заказа — *или* состояние
> живёт в **общей инфраструктуре движка** (`fsm_instances` / `fsm_states` / `fsm_transitions`), а `orders`
> лишь ссылается на инстанс FSM. Для «универсальной платформы постаматов» второй вариант вероятен — тогда
> состояния (§4), переходы (§5) и таймеры (§7) ложатся на **движковые** таблицы, а не на заказо-
> специфичные. От этого зависит, что вообще писать в `orders`, а что — в инфраструктуре движка.

| Таблица | Назначение | Ключевые поля |
|---|---|---|
| `orders` | агрегат Order | `order_id` (PK), `mode`, `state`, `fsm_version`, маршрут, цены, таймстемпы, `payment_status` |
| `order_candidates` | Candidate (VOTE) | `order_id`, `driver_user_id`, `vehicle`, `voted_at`, `status` |
| `order_offers` | Offer (OFFER) | `order_id`, `driver_user_id`, `price`, `eta`, `comment`, `created_at`, `status` |
| `driver_assignments` | DriverAssignment | `order_id`, `driver_user_id`, `assigned_at`, `released_at`, `source` |
| `boarding_sessions` | BoardingSession | `order_id`, `type`, `value`, `verified_at` |
| `trips` | Trip | `order_id`, `driver_user_id`, `started_at`, `finished_at`, `actual_price`, `outcome` |
| `order_timers` | активные таймеры (§7) | `order_id`, `kind`, `deadline_at`, `active` |
| `order_events` | журнал переходов/событий (audit + дедуп) | `order_id`, `seq`, `from_state`, `to_state`, `trigger`, `payload`, `occurred_at` |

> `order_events` даёт **источник для дедупликации/упорядочивания** доставки (B0/gateway §5) и аналитику
> по различимым доменным ветвям (Валентин #6).

---

## 4. FSM-состояния (авторитет — states.md §1a, @spitegod)

12 доменных состояний. Имена и терминальность — из [states.md](states.md) §1a; здесь повторены для
полноты переходной таблицы (§5).

| # | Доменное состояние | Режим | Терминальное | UI-каноника (бот) |
|---|---|---|:---:|---|
| 1 | `order_created` | все | — | SEARCHING |
| 2 | `order_vote_waiting_candidates` | VOTE | — | SEARCHING |
| 3 | `order_offer_waiting` | OFFER | — | SEARCHING |
| 4 | `order_vote_driver_assigned` | VOTE | — | ASSIGNED |
| 5 | `order_driver_assigned` | DIRECT/OFFER | — | ASSIGNED |
| 6 | `order_driver_arrived` | все | — | DRIVER_ARRIVED |
| 7 | `order_in_ride` | все | — | IN_RIDE |
| 8 | `order_completed` | все | ✅ | COMPLETED |
| 9 | `order_cancelled` | все | ✅ | CANCELLED |
| 10 | `order_expired` | все | ✅ | EXPIRED |
| 11 | `ride_interrupted` | все | ✅ | RIDE_INTERRUPTED |
| 12 | `order_vote_no_show` | VOTE | ✅ | NO_SHOW |

### Ветки по режимам ([states.md](states.md) §1a)
```
DIRECT: order_created → order_driver_assigned → order_driver_arrived → order_in_ride → order_completed
VOTE:   order_created → order_vote_waiting_candidates → order_vote_driver_assigned
                      → order_driver_arrived → order_in_ride → order_completed
OFFER:  order_created → order_offer_waiting → order_driver_assigned
                      → order_driver_arrived → order_in_ride → order_completed
```

---

## 5. Переходы и их природа

> Закрывает главное замечание рецензии: какие переходы **пользовательские** (команда пассажира),
> **автоматические** (приходят из Core от внешней системы/водителя), **таймерные** (истечение таймера).

**Легенда триггера:** 👤 USER — команда пассажира (B0 §2) · 🔄 AUTO — событие водителя/Core
([backend-mapping.md](backend-mapping.md) §2–4) · ⏲ TIMER — истечение таймера (§7).

> **✅ Сверено с движком (2026-06-26)** по `taxi_order_fsm_seed.sql` + `fsm_spec.py` (Иван). Совпало
> 14/16; T1/T5/T8 корректно отсутствуют как переходы (init / self без смены state). Расхождение —
> только T15 (исправлено ниже). Построчно — [fsm-core-sync-checklist.md](fsm-core-sync-checklist.md) §1.
>
> **Авторитетные имена действий движка** (колонка «Эффекты» ниже ссылается на них): `order_publish_vote`
> (T2) · `order_publish_offer` (T3) · `order_assign_direct` (T4) · `order_select_candidate` (T6) ·
> `order_release_candidate` (T7) · `order_select_offer` (T9) · `order_arrive` (T10) · `order_start` (T11) ·
> `order_finish` (T12) · `order_interrupt_ride` (T13) · `order_cancel_by_client` (T14) · `order_expire`
> (T15) · `order_no_show` (T16). Всего 13 действий, 21 строка переходов в seed.
>
> **🟢 Обновление seed v2 (2026-06-30, Иван):** граф НЕ изменён (те же 12/13/21). `fsm_transitions`
> расширена forward-compat полями `guard_name` / `guard_params` / `effect_name` / `effect_params` /
> `timer_name` / `timer_params` (ALTER идемпотентны, значения NULL), и теми же опциональными полями —
> `TransitionSpec` в `fsm_spec.py`. Это закладывает декларативные guard/effect/timer на переходах под
> будущий движок (см. [fsm-engine-rfc.md](fsm-engine-rfc.md) Q1/Q4/Q5/Q7), не меняя поведения. Колонка
> «Условие / guard» и «Эффекты» ниже — спецификация для этих полей, когда механизм заработает.

| # | From → To | Триггер | Условие / guard | Эффекты (сущности, события) |
|---|---|---|---|---|
| T1 | — → `order_created` | 👤 `createOrder` | валиден payload | создать Order; старт `matchingTimeout`; событие `OrderCreated` |
| T2 | `order_created` → `order_vote_waiting_candidates` | 🔄 авто (mode=VOTE, опубликован) | mode=VOTE | старт `candidateTimeout` |
| T3 | `order_created` → `order_offer_waiting` | 🔄 авто (mode=OFFER) | mode=OFFER | старт `offerTimeout` |
| T4 | `order_created` → `order_driver_assigned` | 🔄 AUTO водитель захватил (DIRECT) | mode=DIRECT | создать `DriverAssignment`; `assignedAt`; событие `DriverAssigned` |
| T5 | `order_vote_waiting_candidates` → (self) | 🔄 AUTO отклик/отзыв кандидата | — | ⚠️ **состояние НЕ меняется** (Иван): upsert `Candidate` в `orders.metadata_json`; бот видит кандидатов через снапшот Query API (`candidates[]`), не через смену state; событие `CandidateAdded/Removed` |
| T6 | `order_vote_waiting_candidates` → `order_vote_driver_assigned` | 👤 `selectCandidate` | есть кандидат | `DriverAssignment(source=manual)`; событие `CandidateSelected` |
| T7 | `order_vote_driver_assigned` → `order_vote_waiting_candidates` | 👤 `releaseCandidate` | назначение было | снять `DriverAssignment` (`released_at`) |
| T8 | `order_offer_waiting` → (self) | 🔄 AUTO предложение водителя | — | ⚠️ **состояние НЕ меняется** (Иван): upsert `Offer` в `orders.metadata_json`; бот видит офферы через снапшот (`offers[]`); событие `OfferSubmitted/Updated/Withdrawn` |
| T9 | `order_offer_waiting` → `order_driver_assigned` | 👤 `selectOffer` | есть оффер | `DriverAssignment`; зафиксировать `actual` = offer.price; событие `OfferSelected` |
| T10 | `order_*_driver_assigned` → `order_driver_arrived` | 🔄 AUTO водитель прибыл | — | `arrivedAt`; старт `boardingTimeout`/`pickupWindowTimeout`; событие `DriverArrived` |
| T11 | `order_driver_arrived` → `order_in_ride` | 🔄 AUTO старт поездки (+👤 `confirmBoarding` для VOTE/внешн.) | boarding verified (VOTE) | `BoardingSession.verifiedAt`; создать `Trip`; `startedAt`; событие `TripStarted` |
| T12 | `order_in_ride` → `order_completed` | 🔄 AUTO завершение | — | `Trip.finishedAt`; Core считает `actual`; событие `TripCompleted` |
| T13 | `order_in_ride` → `ride_interrupted` | 🔄 AUTO/👤 досрочное прекращение | высадка не в плановой точке | терминальное; `outcome=early_terminated` ([business-rules.md](../domain/business-rules.md) §4.2) |
| T14 | {created, vote_waiting_candidates, offer_waiting, vote_driver_assigned, driver_assigned, **driver_arrived**} → `order_cancelled` | 👤 `cancel` (`order_cancel_by_client`) | состояние **до** `order_in_ride` ([business-rules.md](../domain/business-rules.md) §4.1) | терминальное; `outcome=cancelled`. ✅ **Сверено: все 6 источников в seed, включая `order_driver_arrived → order_cancelled`** (Иван добавил по нашему запросу) |
| T15 | {created, vote_waiting_candidates, offer_waiting} → `order_expired` | ⏲ `matchingTimeout`/`candidateTimeout`/`offerTimeout` (`order_expire`) | исполнитель не найден/не выбран **до назначения** | терминальное; `outcome=expired`. ✅ **Сверено: только эти 3 до-назначенческих источника** — из `*_assigned` expire НЕТ (исправлено: ранее ошибочно значилось `*_assigned`; после назначения работает no_show, не expire) |
| T16 | `order_vote_driver_assigned` → `order_vote_no_show` | ⏲ `pickupWindowTimeout` / 🔄 AUTO (`order_no_show`) | назначенный (VOTE) не прибыл | терминальное (VOTE); `outcome=no_show`. ✅ Сверено: единственный источник — `order_vote_driver_assigned`. **Для DIRECT/OFFER аналога НЕТ — намеренно** (решение Валентина 2026-06-26: ручная отмена → `order_cancelled`; §11). `no_show` — специфика VOTE. Различать стоит **событие**, не терминал — см. §5a |

> ✅ Строки T2–T16 **сверены** с `taxi_order_fsm_seed.sql`/`fsm_spec.py` (2026-06-26): совпали, кроме
> сужения T15 (исправлено). Re-matching/re-assignment (водитель отказался после назначения → возврат в
> поиск вместо CANCELLED) — на MVP покрыт лишь частично (T7 release candidate); полноценный re-matching по
> причинам / saga — после MVP (развилка C). В seed re-matching сверх T7 нет — подтверждено.

---

## 5a. Таймаут — это событие, а не состояние (принцип различения, 2026-06-26)

> Вклад ревью 2026-06-26 (Валентин, поддержка позиции Павла). Снимает соблазн плодить per-mode
> терминалы «не приехал» и задаёт ось различения переходов.

Различать стоит не столько **конечное состояние**, сколько **причину перехода (событие)**. Один
системный сигнал — «назначенный исполнитель не вышел на посадку в окно» — целесообразно моделировать
**одним событием** (`pickup_timeout` / `timeout_wait_driver`); а уже бизнес-правило выбирает терминал по
режиму:

| Режим | Событие | Терминал | Статус |
|---|---|---|---|
| VOTE | `pickup_timeout` | `order_vote_no_show` | ✅ MVP (T16) |
| DIRECT | `pickup_timeout` | `order_cancelled` | принцип; в MVP — **ручная отмена** (T14) |
| OFFER | `pickup_timeout` | `order_cancelled` | принцип; в MVP — **ручная отмена** (T14) |
| (будущее) | `pickup_timeout` | отдельный универсальный терминал | только при появлении бизнес-правила |

**Почему `no_show` — только VOTE.** `order_vote_no_show` несёт конкретную семантику: клиент выбрал
**конкретного** водителя, водитель прибыл (или должен был), **клиент** не появился. В DIRECT/OFFER за
«не доехали» стоят разные причины (водитель не приехал / отменил; клиент отменил; истекло ожидание; не
удалось связаться) — называть их все `no_show` некорректно. Пока нет процесса, отдельно обрабатывающего
«no-show в DIRECT», новое состояние только усложняет модель (принцип Ивана «не плодить состояния без
подтверждённого бизнес-правила» — подтверждён верным).

**Следствие для MVP:** новых терминалов под DIRECT/OFFER **не вводим**; «не приехал» там закрывается
**ручной отменой** пассажира (→ `order_cancelled`, T14). Событийная развязка выше — **направление
развития**: когда (если) появится авто-таймаут подачи для DIRECT/OFFER, он войдёт как `pickup_timeout`,
разрешаемый в существующий `order_cancelled`, а не как новый per-mode `*_no_show`. См. также
[events.md](events.md) §4.

---

## 6. Command → переход (источник для AvailableActions, Вариант 1)

Поскольку **ядро владеет `availableActions`** (B0, Вариант 1), они выводятся из этой таблицы: команда
доступна в состоянии ⇔ из него есть USER-переход по этой команде (с учётом guard).

| Команда (B0 §2) | Глагол `availableActions` | Action движка | Допустимые состояния-источники | Переход |
|---|---|---|---|---|
| `POST /orders` | — (старт) | — (init + publish) | — | T1 |
| `POST /orders/{id}/cancel` | `cancel` | `order_cancel_by_client` | created, vote_waiting_candidates, offer_waiting, vote_driver_assigned, driver_assigned, driver_arrived | T14 |
| `…/candidates/{u}/select` | `selectCandidate` | `order_select_candidate` | vote_waiting_candidates | T6 |
| `…/candidates/release` | `releaseCandidate` | `order_release_candidate` | vote_driver_assigned | T7 |
| `…/offers/{u}/select` | `selectOffer` | `order_select_offer` | offer_waiting | T9 |
| `…/pickup-fee` | `setPickupFee` | — (мутация заказа) | created, vote_waiting_candidates, offer_waiting (до назначения) | (не смена состояния) |
| `…/boarding/confirm` | `confirmBoarding` | — (guard/effect в `order_start`) | driver_arrived (VOTE/внешн.) | вклад в T11 |
| `…/rating` | `rate` | — (пост-обработка) | order_completed | (не смена состояния) |

> **Не-пользовательские действия движка** (🔄 Core / ⏲ timer, не попадают в `availableActions`):
> `order_publish_vote`/`order_publish_offer`/`order_assign_direct` (публикация/прямое назначение),
> `order_arrive`/`order_start`/`order_finish`/`order_interrupt_ride` (события водителя/Core),
> `order_expire`/`order_no_show` (таймерные — дёргает timer worker). Бот их не вызывает.

> Так бот **никогда** не реплицирует эти правила: он показывает кнопки строго из `availableActions`
> снапшота ([domain-api-contract.md](../domain-api-contract.md) §3). Таблица выше — спецификация для
> **сервера**, как этот список считать.

---

## 7. Таймеры (cross-cutting, [timers.md](timers.md))

Таймеры — не состояния, а триггеры переходов. Каждый привязан к фазе и при истечении даёт переход (§5).

| Таймер | Ограничивает (состояние) | Истечение → переход | Реализация сейчас (iBronevik) |
|---|---|---|---|
| `matchingTimeout` | created (DIRECT) | T15 → expired | `b_max_waiting` / fallback 600с |
| `candidateTimeout` | vote_waiting_candidates | T15 → expired (или re-matching) | votingTimer (+3 мин, ≤30с нотификация) |
| `offerTimeout` | offer_waiting | T15 → expired | — (уточнить) |
| `boardingTimeout` | driver_arrived (VOTE) | отмена / re-matching | `b_driver_code` flow |
| `pickupWindowTimeout` | *_driver_assigned → arrival | T16 → no_show / re-matching | — (целевой) |

> Открыто ([timers.md](timers.md) §3): могут ли таймеры работать параллельно, приоритеты, и как лягут на
> механизм движка (один общий таймер ожидания + votingTimer сейчас).

> **Timer Worker — часть MVP, не «после MVP» (ревью 2026-06-26).** Переходы `order_expire` (T15) и
> `order_no_show` (T16) есть в графе, но **сами не сработают** — их обязан дёргать worker по
> `server_fsm_instances.next_timer_at`. Без него часть графа недостижима при штатном сценарии, поэтому
> таймеры — уже **обязательная часть исполнения FSM**, а не «архитектурное улучшение». Разделяем два
> уровня: **Timer Worker** (запускает timeout-действия; механизм простой — worker + `next_timer_at`) —
> **в MVP**; **универсальный Timer Subsystem** (параметризуемые таймеры, registry, приоритеты,
> параллельность) — **после MVP**. В MVP worker обслуживает только: `matchingTimeout`/`candidateTimeout`/
> `offerTimeout` → T15 (до-назначенческий expire) и `pickupWindowTimeout` (VOTE) → T16. Для DIRECT/OFFER
> таймера подачи в MVP нет (ручная отмена, §5a).

---

## 8. Автоматические действия (эффекты переходов)

Side-effects, выполняемые ядром при входе/выходе состояния (не пользовательские):

| Триггер | Авто-действие |
|---|---|
| вход `order_created` | публикация заказа в подбор; старт релевантного таймера; запись `order_events` |
| AUTO из Core (смена `b_state`/`c_state`) | нормализация в доменный переход ([backend-mapping.md](backend-mapping.md) §4); дедуп по `order_events.seq` |
| вход `order_driver_assigned` | фиксация `assignedAt`; снятие конкурирующих кандидатов (по стратегии); уведомление каналов |
| вход `order_in_ride` | создать `Trip`; остановить таймеры подбора |
| вход терминального | остановить все таймеры; снять с наблюдения; зафиксировать `outcome`; (Core) расчёт `actual` |
| истечение таймера | переход §7; запись события |

> **Core Adapter** ([architecture-decision-variant3.md](../architecture-decision-variant3.md) §3) —
> источник 🔄 AUTO-переходов: он поллит/слушает iBronevik и транслирует `b_state`/`c_state` в доменные
> события ядра. Маппинг — спецификация в [backend-mapping.md](backend-mapping.md), это **серверный** код,
> не бот.

---

## 9. Связь с контрактом B0

| Элемент ядра | Что видит бот (B0) |
|---|---|
| `Order.state` (12 доменных) | `snapshot.state` (доменное) + бот проецирует в UI-канунику |
| `Candidate[]` / `Offer[]` | `snapshot.candidates[]` / `offers[]` (проекции) |
| `DriverAssignment` | `snapshot.driver` |
| цены (Core) | `snapshot.price.{estimated,pickupFee,minimumRidePrice,actual}` |
| Command→переход (§6) | `snapshot.availableActions` (Вариант 1) |
| `order_events.seq` | дедуп/упорядочивание доставки |

---

## 10. Что НЕ входит в ядро
- Расчёт цены — **Core**, не FSM-процедура (ADR §5). FSM только фиксирует значения.
- UI-каноники, тексты, кнопки, экраны — **бот** (UI Resolver).
- Driver FSM / Driver Web UI — @spitegod, отдельный документ.
- Form FSM (сбор параметров) — бот, Redis ([../bot-fsm/form-fsm.md](../bot-fsm/form-fsm.md)).

---

## 11. Открытые вопросы к @spitegod / Ивану — СТАТУС после сверки 2026-06-26

> ⭐ **Вопрос №1 — главная развилка (§2.4): владелец Driver Matching — ✅ ЗАКРЫТ.** Принят **Вариант A**
> (единый Order FSM; Candidate/Offer = контекст в `orders.metadata_json`; nested/parallel FSM нет).
> См. §2.4 и [fsm-core-sync-checklist.md](fsm-core-sync-checklist.md) §3.B.

Ответы Ивана (полностью — в `fsm-core-sync-checklist.md` §4; первоисточник `fsm-core-sync-checklist-answer.md`):

1. ✅ **Состояния** — 12 финальны для MVP, имена совпадают 1:1. **Промежуточных нет — подтверждено машинно** (`taxi_order_fsm_seed.sql` + `fsm_spec.py`, 2026-06-26).
2. ✅ **Переходы табличные — СВЕРЕНЫ построчно** (2026-06-26): seed/spec получены, T1–T16 совпали 14/16 (T1/T5/T8 корректно без перехода), T14 закрыт, T15 сужен (исправлен). Детали — [fsm-core-sync-checklist.md](fsm-core-sync-checklist.md) §1.
3. ⚠️ **Таймеры** — универсального timer subsystem **НЕТ**; предложение — worker + `server_fsm_instances.next_timer_at`. Сейчас ни один не работает (зона сервера). **Реклассификация (ревью 2026-06-26):** Timer Worker — **в MVP** (без него T15/T16 мертвы), универсальный Timer Subsystem — после MVP (§7, §5a).
4. ✅ **Re-matching** — частично (release candidate → возврат в waiting); отдельного `RE_MATCHING` нет и не нужно; saga после MVP.
5. ✅ **Агрегаты** — `Order` = сущность/FSM; Candidate/Offer = контекст в `metadata_json`, не таблицы.
6. ⚠️ **Журнал** — есть `fsm_action_logs` (журнал переходов), но **НЕ** event store/outbox/идемпотентность — добавить серверу.
7. ✅ **DIRECT** — FSM только фиксирует назначение; стратегия выбора водителя — вне FSM (matching/core).
8. ✅ **Boarding** — guard/effect между `arrived → in_ride`, не отдельная сущность/состояние.

**Осталось серверу добить (зона сервера, не бота) — по критичности к MVP** (приоритизация из ревью 2026-06-26):
- ✅ **Сделано Иваном:** T14 `order_driver_arrived → order_cancelled` добавлен в seed (сверка 2026-06-26).
- 🔴 **до MVP** (иначе процесс заказа зависает / некорректен): **Timer Worker** (#3) — без него `order_expire`/`order_no_show` в seed есть, но не срабатывают (T15/T16); **`availableActions` через Domain API**; **атомарность записи состояния** (`orders.status` ↔ `server_fsm_instances`). *(Иван подтвердил 2026-06-26: переходы в графе есть, но авто-срабатывание ТОЛЬКО через timer worker на `server_fsm_instances.next_timer_at`; сейчас вызываются вручную / экшн-слоем. Ревью 2026-06-26 закрепило: именно Timer Worker — часть MVP, не «после MVP»; §7.)*
- 🟡 **после MVP** (компенсируется Action Layer): универсальный **guard registry**, универсальный **Timer Subsystem** (параметризуемые таймеры/registry — в отличие от простого worker'а выше), полноценный **outbox/idempotency framework** (#6). → инженерные вопросы по этим механизмам вынесены в [fsm-engine-rfc.md](fsm-engine-rfc.md) (Максиму).
- ✅ **РЕШЕНО (Валентин, 2026-06-26): no-show для DIRECT/OFFER НЕ вводим — ручная отмена.** Принята позиция Павла. `order_vote_no_show` остаётся специфичным для VOTE (клиент выбрал конкретного водителя, тот не дождался клиента); в DIRECT/OFFER «не приехал» имеет разные причины и закрывается **ручной отменой** пассажира (→ `order_cancelled`, T14). Новых терминальных состояний не вводим (принцип Ивана «не плодить состояния без подтверждённого бизнес-правила» подтверждён верным). Если авто-таймаут подачи для DIRECT/OFFER понадобится в будущем — он войдёт **событием** `pickup_timeout`, разрешаемым в `order_cancelled`, а не новым per-mode `*_no_show` (§5a). 12 состояний — без изменений.

> **Архитектурный backlog — «не потерять универсальность» (ревью 2026-06-26).** Движок прирастает
> (Guard/Effect Registry, Timer Subsystem, Context) и из «FSM для такси» превращается в универсальный
> workflow-движок (выросший из доставки через постаматы). Каждое новое решение проверять вопросом:
> **расширение движка (универсальный механизм) или временная taxi-only реализация?** — и не давать
> taxi-specific логике утекать в ядро. Носитель фильтра универсальности — Максим (референс постаматов).
