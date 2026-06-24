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
> **Scope:** Order FSM. Driver FSM и Driver Web UI — зона @spitegod, **вне** этого документа (ADR §2).
> Опирается на: [../domain/order-model.md](../domain/order-model.md), [../domain/execution-models.md](../domain/execution-models.md),
> [../domain/business-rules.md](../domain/business-rules.md), [states.md](states.md), [commands.md](commands.md),
> [timers.md](timers.md), [backend-mapping.md](backend-mapping.md).

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
Единый процесс подбора с режимами; не часть агрегата Order, ссылается на него по `orderId`.

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

---

## 3. Хранение (предлагаемые таблицы)

> ⚠️ **Предложение**, не схема. Свести с реальной схемой движка / дампом `vote_fsm`. Если движок —
> «универсальная платформа постаматов», часть таблиц (состояние, переходы, таймеры) может быть **общей
> движковой**, а не заказо-специфичной — §11.

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

| # | From → To | Триггер | Условие / guard | Эффекты (сущности, события) |
|---|---|---|---|---|
| T1 | — → `order_created` | 👤 `createOrder` | валиден payload | создать Order; старт `matchingTimeout`; событие `OrderCreated` |
| T2 | `order_created` → `order_vote_waiting_candidates` | 🔄 авто (mode=VOTE, опубликован) | mode=VOTE | старт `candidateTimeout` |
| T3 | `order_created` → `order_offer_waiting` | 🔄 авто (mode=OFFER) | mode=OFFER | старт `offerTimeout` |
| T4 | `order_created` → `order_driver_assigned` | 🔄 AUTO водитель захватил (DIRECT) | mode=DIRECT | создать `DriverAssignment`; `assignedAt`; событие `DriverAssigned` |
| T5 | `order_vote_waiting_candidates` → (self) | 🔄 AUTO отклик/отзыв кандидата | — | upsert `Candidate` (`c_state=1`); событие `CandidateAdded/Removed` |
| T6 | `order_vote_waiting_candidates` → `order_vote_driver_assigned` | 👤 `selectCandidate` | есть кандидат | `DriverAssignment(source=manual)`; событие `CandidateSelected` |
| T7 | `order_vote_driver_assigned` → `order_vote_waiting_candidates` | 👤 `releaseCandidate` | назначение было | снять `DriverAssignment` (`released_at`) |
| T8 | `order_offer_waiting` → (self) | 🔄 AUTO предложение водителя | — | upsert `Offer` (цена/eta); событие `OfferSubmitted/Updated/Withdrawn` |
| T9 | `order_offer_waiting` → `order_driver_assigned` | 👤 `selectOffer` | есть оффер | `DriverAssignment`; зафиксировать `actual` = offer.price; событие `OfferSelected` |
| T10 | `order_*_driver_assigned` → `order_driver_arrived` | 🔄 AUTO водитель прибыл | — | `arrivedAt`; старт `boardingTimeout`/`pickupWindowTimeout`; событие `DriverArrived` |
| T11 | `order_driver_arrived` → `order_in_ride` | 🔄 AUTO старт поездки (+👤 `confirmBoarding` для VOTE/внешн.) | boarding verified (VOTE) | `BoardingSession.verifiedAt`; создать `Trip`; `startedAt`; событие `TripStarted` |
| T12 | `order_in_ride` → `order_completed` | 🔄 AUTO завершение | — | `Trip.finishedAt`; Core считает `actual`; событие `TripCompleted` |
| T13 | `order_in_ride` → `ride_interrupted` | 🔄 AUTO/👤 досрочное прекращение | высадка не в плановой точке | терминальное; `outcome=early_terminated` ([business-rules.md](../domain/business-rules.md) §4.2) |
| T14 | {created, waiting_*, *_assigned, arrived} → `order_cancelled` | 👤 `cancel` | состояние **до** `order_in_ride` ([business-rules.md](../domain/business-rules.md) §4.1) | терминальное; `outcome=cancelled` |
| T15 | {created, waiting_*, *_assigned} → `order_expired` | ⏲ `matchingTimeout`/`candidateTimeout`/`offerTimeout` | исполнитель не найден/не выбран | терминальное; `outcome=expired` |
| T16 | `order_vote_*` (после назначения, прибытия) → `order_vote_no_show` | ⏲ `pickupWindowTimeout` / 🔄 AUTO | назначенный не прибыл | терминальное (VOTE); `outcome` (уточнить) |

> ⚠️ Все строки T2–T16 — **strawman**, выверяются по реальным переходам движка. Re-matching/re-assignment
> (водитель отказался после назначения → возврат в поиск вместо CANCELLED) — целевой ориентир
> ([states.md](states.md) §4), в перечне 12 состояний явного re-matching нет — §11.

---

## 6. Command → переход (источник для AvailableActions, Вариант 1)

Поскольку **ядро владеет `availableActions`** (B0, Вариант 1), они выводятся из этой таблицы: команда
доступна в состоянии ⇔ из него есть USER-переход по этой команде (с учётом guard).

| Команда (B0 §2) | Глагол `availableActions` | Допустимые состояния-источники | Переход |
|---|---|---|---|
| `POST /orders` | — (старт) | — | T1 |
| `POST /orders/{id}/cancel` | `cancel` | created, vote_waiting_candidates, offer_waiting, vote_driver_assigned, driver_assigned, driver_arrived | T14 |
| `…/candidates/{u}/select` | `selectCandidate` | vote_waiting_candidates | T6 |
| `…/candidates/release` | `releaseCandidate` | vote_driver_assigned | T7 |
| `…/offers/{u}/select` | `selectOffer` | offer_waiting | T9 |
| `…/pickup-fee` | `setPickupFee` | created, vote_waiting_candidates, offer_waiting (до назначения) | (мутация заказа, не смена состояния) |
| `…/boarding/confirm` | `confirmBoarding` | driver_arrived (VOTE/внешн.) | вклад в T11 |
| `…/rating` | `rate` | order_completed | (пост-обработка, не смена состояния) |

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

## 11. Открытые вопросы к @spitegod / Ивану

1. **Перечень состояний движка** — 12 из [states.md](states.md) §1a финальны, или есть промежуточные
   (например `order_vote_waiting_confirmation`, `order_offer_waiting_price`), сворачиваемые в UI, но
   различимые в движке? (рецензия указала на такой риск).
2. **Переходы (§5)** — таблично-управляемые в движке или зашиты? Можно ли получить машинный перечень
   `from→to+trigger+guard` (для сверки с T1–T16)?
3. **Таймеры (§7)** — механизм в движке; параллельность/приоритеты; маппинг на текущий
   `b_max_waiting`+votingTimer.
4. **Re-matching / re-assignment** — есть ли (водитель отказался после назначения → возврат в поиск), или
   всегда терминальный CANCELLED/NO_SHOW? В 12 состояниях явного re-matching нет.
5. **Агрегаты vs таблицы движка (§2–3)** — Candidate/Offer/Assignment — отдельные таблицы или часть
   payload заказа в движке? `CandidatePool`/`PoolVisibility` — проекции или хранимое?
6. **`order_events` / журнал** — есть ли в движке источник для дедупа/упорядочивания и аналитики ветвей?
7. **DIRECT** — поддерживается ли подбор лучшего системой (расширение DIRECT,
   [execution-models.md](../domain/execution-models.md) §3), или только «первый принявший»?
8. **Boarding** — отдельная сущность/состояние в движке, или только флаг `b_driver_code`?
