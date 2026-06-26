# Лист сверки FSM-ядра с движком (рабочий, Павел × Иван × Максим)

> **Это рабочий инструмент встречи, не спецификация.** Цель — построчно сверить strawman
> [fsm-core-design.md](fsm-core-design.md) с реальным универсальным FSM-движком, а не описать новую
> архитектуру. Заполняется на встрече; решения по итогам переносятся в `fsm-core-design.md` и
> [states.md](states.md).
>
> **Постановка:** не «правильно ли Павел придумал FSM», а **что уже есть в движке, а что нужно
> добавить**. Роли: **Павел** — аналитик/интегратор · **Иван** — архитектор/разработчик движка ·
> **Максим** — носитель референсной реализации (постаматный FSM), проверяет универсальность.
>
> **Как заполнять статус:** `✅ есть` · `❌ нет` · `≈ иначе` (движок делает по-другому) ·
> `🧩 покрыто` (уже даёт универсальный механизм движка, не заказо-специфично) · `?` (выяснить).
> Колонка «Заметка» — как именно реализовано / что меняем.

> **Порядок работы на встрече** (не сверху вниз по документу). Сначала выяснить рамку, потом
> наполнять её переходами:
> 1. **§0 — что уже умеет движок** (capabilities). Это вход в развилки: их нельзя решать, не зная
>    арсенал механизмов.
> 2. **§3 развилки A → B → C** (хранение состояния · владелец Matching · re-matching). Здесь
>    принимается ~80% архитектурных решений; пока они открыты, любой разбор переходов будет
>    возвращаться назад.
> 3. **§1 переходы T1–T16** — уже в принятой рамке.
> 4. **§5 таймеры** и **§2 состояния** — добивка.
> 5. **§4 открытые вопросы §11** — закрываем по ходу.

---

## 0. Что уже умеет движок (capabilities) — спросить ПЕРВЫМ

> Документ в основном спрашивает «что нужно такси?». Не менее важен обратный вопрос — **«что уже
> умеет универсальный движок?»**: половина развилок снимается, если механизм уже есть. Заполняют
> Иван (текущий движок) и Максим (референсный постаматный). Отметка `✅` ниже = **видно в дампе
> `vote_fsm`** (наш единственный пока артефакт о движке) — подтвердить; всё остальное `?`.

| Возможность | Статус | Заметка / где видно |
|---|:---:|---|
| FSM instance (экземпляр на сущность) | ≈ | **Иван:** состояние живёт в таблице сущности (`orders.status`); для taxi добавлен `server_fsm_instances`, но ещё не связан с worker/timers — это служебный слой исполнения, не носитель истины |
| Таблица переходов (`from→to+action`) | ✅ | `fsm_states`/`fsm_actions`/`fsm_transitions`; ХП `fsm_perform_action` |
| Auto-действия на переходе | ≈ | **Иван:** action как триггер перехода есть; side-effects держать в action layer/worker, НЕ внутри ХП |
| Guard / условия на переходе | ❌ | **Иван:** отдельного guard-слоя в ХП НЕТ; проверки — в API/action layer до вызова `fsm_perform_action` |
| Timer subsystem (таймеры состояния) | ❌ | **Иван:** универсального timer subsystem НЕТ; предложение — worker + `server_fsm_instances.next_timer_at` (→ §5) |
| Event journal / журнал переходов | ≈ | **Иван:** есть `fsm_action_logs`, но это журнал переходов, НЕ event store/outbox/idempotency (= §4 вопрос 7) |
| Button states (UI-проекция действий) | ✅ | `button_states` есть; **Иван:** для taxi правильнее отдавать `availableActions` через Domain API (= наш B0 Вариант 1) |
| Nested FSM (вложенные машины) | ❌ | **Иван:** не подтверждено и не реализовано → развилка B решается БЕЗ под-FSM |
| Parallel FSM (несколько активных машин на заказ) | ❌ | **Иван:** не подтверждено и не реализовано |
| Saga / orchestration (координация машин) | ≈ | **Иван:** отдельного saga-механизма нет; оркестрация — в worker/action layer |

**Вывод раздела:** механизмы, которых в движке НЕТ и которые надо добавить под такси (зона **сервера**, не бота):
**guard-слой** (в API/action layer), **timer worker** (на `next_timer_at`), **event store/outbox + идемпотентность** (поверх `fsm_action_logs`), **`availableActions` через Domain API** (вместо `button_states`). Nested/Parallel FSM НЕ нужны — развилка B решена единым Order FSM (Вариант A). *(Сверка 2026-06-26, ответ Ивана `fsm-core-sync-checklist-answer.md`.)*

---

## 1. Переходы T1–T16 ([fsm-core-design.md](fsm-core-design.md) §5)

Триггер: 👤 USER (команда пассажира) · 🔄 AUTO (событие водителя/Core) · ⏲ TIMER.

> **Статусы заполнены по ответу Ивана (2026-06-26, `fsm-core-sync-checklist-answer.md`).** Машинный
> перечень обещан в `domains/taxi/fsm_spec.py` + `domains/taxi/sql/taxi_order_fsm_seed.sql` — **запрошен у Ивана** для построчной сверки.

| ID | From → To | Триг. | Статус | Как в движке / что меняем |
|---|---|:---:|:---:|---|
| T1 | — → `order_created` | 👤 | ≈ | Создание `orders` + `server_fsm_instances`, НЕ отдельный ХП-переход |
| T2 | `order_created` → `order_vote_waiting_candidates` | 🔄 | ✅ | Vote publish есть |
| T3 | `order_created` → `order_offer_waiting` | 🔄 | ✅ | В taxi seed/action layer |
| T4 | `order_created` → `order_driver_assigned` (DIRECT) | 🔄 | ✅ | Direct assign в taxi seed/action layer |
| T5 | `order_vote_waiting_candidates` → self (отклик кандидата) | 🔄 | ≈ | **Состояние НЕ меняется**; кандидаты в `orders.metadata_json` → бот видит их только через снапшот Query API (`candidates[]`), не через смену state |
| T6 | `order_vote_waiting_candidates` → `order_vote_driver_assigned` | 👤 | ✅ | Select candidate есть |
| T7 | `order_vote_driver_assigned` → `order_vote_waiting_candidates` (release) | 👤 | ✅ | Release candidate есть (= частичный re-matching) |
| T8 | `order_offer_waiting` → self (предложение водителя) | 🔄 | ≈ | **Состояние НЕ меняется**; offers в `orders.metadata_json` → как T5 |
| T9 | `order_offer_waiting` → `order_driver_assigned` (selectOffer) | 👤 | ✅ | Select offer есть |
| T10 | `order_*_driver_assigned` → `order_driver_arrived` | 🔄 | ✅ | Driver arrived есть |
| T11 | `order_driver_arrived` → `order_in_ride` (+confirmBoarding VOTE) | 🔄/👤 | ✅ | Start ride есть; boarding — guard/effect, не отдельное состояние |
| T12 | `order_in_ride` → `order_completed` | 🔄 | ✅ | Finish ride есть |
| T13 | `order_in_ride` → `ride_interrupted` | 🔄/👤 | ✅ | Ride interrupted есть |
| T14 | {created, waiting_*, *_assigned, arrived} → `order_cancelled` | 👤 | ⚠️ | Есть cancel до назначения/в ожидании/после назначения. **НЕТ `order_driver_arrived → order_cancelled`** — Иван спрашивает «если подтверждаем отмену до старта». **Наш ответ: ДА, добавить** (business-rules §3/§4.1: CANCELLED разрешён до BOARDING_VERIFICATION = `order_driver_arrived`) |
| T15 | {created, waiting_*, *_assigned} → `order_expired` | ⏲ | ⚠️ | Переходы для `created`/`waiting` есть, но **timer worker НЕ построен** — без него expire не срабатывает |
| T16 | `order_vote_*` → `order_vote_no_show` | ⏲/🔄 | ≈ | Есть `order_vote_driver_assigned → order_vote_no_show`; зависит от timer worker (T15) для срабатывания по `pickupWindowTimeout` |

---

## 2. Состояния (12) ([states.md](states.md) §1a)

> **Иван (2026-06-26):** после применения taxi seed все 12 состояний есть, имена совпадают 1:1 с каноникой `states.md §1a`. Промежуточных taxi-состояний сверх 12 не закладывалось. Старые locker/courier states — наследие delivery-домена, к taxi MVP не относятся.

| Доменное состояние | Режим | Есть в движке | Имя совпадает | Заметка |
|---|---|:---:|:---:|---|
| `order_created` | все | ✅ | ✅ | |
| `order_vote_waiting_candidates` | VOTE | ✅ | ✅ | |
| `order_offer_waiting` | OFFER | ✅ | ✅ | |
| `order_vote_driver_assigned` | VOTE | ✅ | ✅ | |
| `order_driver_assigned` | DIRECT/OFFER | ✅ | ✅ | |
| `order_driver_arrived` | все | ✅ | ✅ | |
| `order_in_ride` | все | ✅ | ✅ | |
| `order_completed` ⛔ | все | ✅ | ✅ | |
| `order_cancelled` ⛔ | все | ✅ | ✅ | |
| `order_expired` ⛔ | все | ✅ | ✅ | |
| `ride_interrupted` ⛔ | все | ✅ | ✅ | |
| `order_vote_no_show` ⛔ | VOTE | ✅ | ✅ | |

**Промежуточные состояния движка, которых нет в списке 12** (рецензия: возможны
`order_vote_waiting_confirmation`, `order_offer_waiting_price` и т.п.):

```
Нет. Иван промежуточных taxi-состояний не закладывал (12 достаточно для MVP).
Подтвердить по машинному seed (taxi_order_fsm_seed.sql), когда получим файл.
```

---

## 3. Три развилки на решение

### A. Где хранится состояние ([fsm-core-design.md](fsm-core-design.md) §3)
- [x] `orders.status` — поле заказа (**истина**)
- [ ] общая инфраструктура движка: `fsm_instances` / `fsm_states` / `fsm_transitions`, `orders` ссылается на инстанс
- **Решение (Иван, 2026-06-26):** **гибрид.** Истина состояния = `orders.status`; `server_fsm_instances` =
  служебный слой исполнения (worker, timers, observability), не носитель состояния. Для **бота** безразлично —
  читаем `snapshot.state` из Query API. ⚠️ Риск двойного хранения (рассинхрон `orders.status` ↔ инстанс) —
  серверу гарантировать атомарную запись обоих. → §3 таблицы: `orders.status` + служебный `server_fsm_instances.next_timer_at`.

### B. Владелец Driver Matching ([fsm-core-design.md](fsm-core-design.md) §2.4)
- [x] **Вариант A** — единый Order FSM, фазы подбора = состояния Order (12 состояний читаются так)
- [ ] **Вариант B** — отдельный Matching FSM (+ Trip FSM), `order_vote_waiting_*` = проекция
  — реализуемость зависит от §0: nested/parallel FSM в движке (их **НЕТ** → Вариант B недоступен без ручной оркестрации)
- Candidate/Offer — отдельные сущности движка или payload заказа? → **контекст заказа в `orders.metadata_json`** (на MVP, не отдельные таблицы/FSM)
- **Линза движка (важнее имён таблиц):** для каждой сущности определить — это **экземпляр FSM** /
  **контекст FSM** / **бизнес-сущность вокруг FSM**?
  - Order: **экземпляр FSM**  · Candidate: **контекст FSM** (`metadata_json`)  · Offer: **контекст FSM** (`metadata_json`)
  - DriverAssignment: **эффект перехода** (фиксация назначения)  · Trip: domain model (`Ride`)  · BoardingSession: **guard/effect** (не сущность)
- **Решение (Иван, 2026-06-26):** **Вариант A** — Matching внутри Order FSM; Candidate/Offer — контекст заказа.
  Совпадает с MVP-позицией Павла. Nested/Parallel FSM не нужны.

### C. Re-matching (бизнес-критично для Марокко)
Назначение сорвалось →
- [x] вернуть заказ в поиск (re-matching / re-assignment) — **частично, через release candidate**
- [ ] завершить заказ (CANCELLED / NO_SHOW)
- [ ] зависит от причины (ниже)

| Причина срыва | Поведение | Состояние-результат |
|---|---|---|
| водитель передумал (отменил отклик) | возврат в поиск | `order_vote_waiting_candidates` / `order_offer_waiting` |
| не приехал в окно подачи | no-show / re-match по правилам | `order_vote_no_show` (нужен timer worker) |
| сломался / форс-мажор | возврат в поиск | waiting-состояние |
| не взял трубку / не отвечает | no-show / re-match по правилам | (нужен timer worker) |
| водитель отменил после назначения | release → возврат в поиск | `order_vote_waiting_candidates` |

- **Решение (Иван, 2026-06-26):** для MVP **отдельное состояние `RE_MATCHING` НЕ нужно** — достаточно
  возврата в соответствующее waiting-состояние (release candidate). Полноценный re-matching по причинам /
  saga — **после MVP**, отдельным orchestration-слоем. Совпадает с MVP-позицией Павла.
  → состояния `RE_MATCHING`/`RE_ASSIGNMENT` сверх 12 **не вводим**.

---

## 4. Открытые вопросы §11 ([fsm-core-design.md](fsm-core-design.md) §11)

| # | Вопрос | Ответ Ивана (2026-06-26) |
|---|---|---|
| 1 ⭐ | Владелец Driver Matching (= развилка B) | Для MVP — **Order FSM** (Вариант A). Candidate/Offer — контекст заказа в `metadata_json`, не отдельные FSM |
| 2 | Перечень состояний финален / есть промежуточные | Для MVP **12 достаточно**; промежуточные — позже, если появятся реальные правила |
| 3 | Переходы таблично-управляемы или зашиты; можно ли машинный перечень `from→to+trigger+guard` | **Табличные.** Машинный перечень есть в `domains/taxi/fsm_spec.py` + `domains/taxi/sql/taxi_order_fsm_seed.sql` → **запросить файлы** |
| 4 | Таймеры: механизм, параллельность, маппинг на `b_max_waiting`+votingTimer | Универсального timer subsystem **НЕТ**. Предложение — worker + `server_fsm_instances.next_timer_at` |
| 5 | Re-matching есть? (= развилка C) | **Частично** (release candidate). Полноценной saga/re-matching нет — после MVP |
| 6 | Агрегаты vs таблицы движка; CandidatePool/PoolVisibility — проекции или хранимое | `Order` — основная сущность/FSM. `Candidate`/`Offer` — контекст в `metadata_json`, не таблицы/FSM на MVP |
| 7 | `order_events` / журнал переходов в движке (дедуп, аналитика) | Есть `fsm_action_logs`, но это журнал переходов, **НЕ** event store/outbox/idempotency |
| 8 | DIRECT: только «первый принявший» или подбор лучшего системой | **FSM только фиксирует назначение.** Стратегия выбора водителя — вне FSM, в matching/core/domain logic |
| 9 | Boarding — отдельная сущность/состояние или флаг `b_driver_code` | **guard/effect** между `order_driver_arrived → order_in_ride`, не отдельная сущность/состояние |

---

## 5. Таймеры ([fsm-core-design.md](fsm-core-design.md) §7)

> **Иван (2026-06-26):** универсального timer subsystem НЕТ. Все таймеры — через будущий worker + `server_fsm_instances.next_timer_at`. Сейчас НИ ОДИН не работает в рантайме.

| Таймер | Фаза | Истечение → переход | Механизм в движке |
|---|---|---|---|
| `matchingTimeout` | created (DIRECT) | T15 → expired | ❌ нужен worker + `next_timer_at` |
| `candidateTimeout` | vote_waiting_candidates | T15 → expired / re-match | ❌ нужен worker + `next_timer_at` |
| `offerTimeout` | offer_waiting | T15 → expired | ❌ нужен worker + `next_timer_at` |
| `boardingTimeout` | driver_arrived (VOTE) | отмена / re-match | ❌ не реализовано как универсальный механизм |
| `pickupWindowTimeout` | *_assigned → arrival | T16 → no_show / re-match | ❌ не реализовано как универсальный механизм |

---

## 6. Итог встречи

- **Дата / участники:** 2026-06-26, асинхронно — ответ **Ивана** на чек-лист (`fsm-core-sync-checklist-answer.md`), сведение — Павел.
- **Принятые решения (A / B / C):**
  - **A** — гибрид: истина = `orders.status`, `server_fsm_instances` = служебный слой исполнения.
  - **B** — Вариант A (единый Order FSM); Candidate/Offer = контекст в `metadata_json`; nested/parallel FSM нет и не нужны.
  - **C** — без `RE_MATCHING`; возврат в waiting-состояние (release candidate); полноценный re-matching/saga после MVP.
- **Что меняем в `fsm-core-design.md` / `states.md`:** развилка §2.4 / вопрос №1 §11 — **закрыты** Вариантом A
  (отметка внесена в `fsm-core-design.md §11`). T14 — добавить `order_driver_arrived → order_cancelled`.
  T5/T8 — зафиксировать, что self-переход не меняет state (кандидаты/офферы через снапшот). Имена 12 состояний подтверждены.
- **Машинный перечень состояний/переходов движка получен:** ☐ да ☑ нет (обещан) → где: `domains/taxi/fsm_spec.py` + `domains/taxi/sql/taxi_order_fsm_seed.sql` — **запрошен у Ивана**.
- **Следующие действия:**
  1. Запросить у Ивана `fsm_spec.py` + `taxi_order_fsm_seed.sql` → построчная сверка T1–T16, проверка отсутствия промежуточных состояний.
  2. Подтвердить Ивану: T14 `order_driver_arrived → order_cancelled` — **обязателен** (business-rules §3/§4.1).
  3. Серверные дыры рантайма по критичности (ревью 2026-06-26): 🔴 **до MVP** — timer worker, `availableActions` через Domain API, атомарность записи состояния; 🟡 **после MVP** — guard registry, outbox/idempotency.
  4. **Архитектурный backlog:** «не потерять универсальность движка» — каждое решение проверять: расширение движка или временная taxi-only реализация? (фильтр — Максим, референс постаматов).
  5. Перенести результаты в `fsm-core-design.md`/`states.md` (частично сделано).
