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

---

## 1. Переходы T1–T16 ([fsm-core-design.md](fsm-core-design.md) §5)

Триггер: 👤 USER (команда пассажира) · 🔄 AUTO (событие водителя/Core) · ⏲ TIMER.

| ID | From → To | Триг. | Статус | Как в движке / что меняем |
|---|---|:---:|:---:|---|
| T1 | — → `order_created` | 👤 | ☐ | |
| T2 | `order_created` → `order_vote_waiting_candidates` | 🔄 | ☐ | |
| T3 | `order_created` → `order_offer_waiting` | 🔄 | ☐ | |
| T4 | `order_created` → `order_driver_assigned` (DIRECT) | 🔄 | ☐ | |
| T5 | `order_vote_waiting_candidates` → self (отклик кандидата) | 🔄 | ☐ | |
| T6 | `order_vote_waiting_candidates` → `order_vote_driver_assigned` | 👤 | ☐ | |
| T7 | `order_vote_driver_assigned` → `order_vote_waiting_candidates` (release) | 👤 | ☐ | |
| T8 | `order_offer_waiting` → self (предложение водителя) | 🔄 | ☐ | |
| T9 | `order_offer_waiting` → `order_driver_assigned` (selectOffer) | 👤 | ☐ | |
| T10 | `order_*_driver_assigned` → `order_driver_arrived` | 🔄 | ☐ | |
| T11 | `order_driver_arrived` → `order_in_ride` (+confirmBoarding VOTE) | 🔄/👤 | ☐ | |
| T12 | `order_in_ride` → `order_completed` | 🔄 | ☐ | |
| T13 | `order_in_ride` → `ride_interrupted` | 🔄/👤 | ☐ | |
| T14 | {created, waiting_*, *_assigned, arrived} → `order_cancelled` | 👤 | ☐ | |
| T15 | {created, waiting_*, *_assigned} → `order_expired` | ⏲ | ☐ | |
| T16 | `order_vote_*` → `order_vote_no_show` | ⏲/🔄 | ☐ | |

---

## 2. Состояния (12) ([states.md](states.md) §1a)

| Доменное состояние | Режим | Есть в движке | Имя совпадает | Заметка |
|---|---|:---:|:---:|---|
| `order_created` | все | ☐ | ☐ | |
| `order_vote_waiting_candidates` | VOTE | ☐ | ☐ | |
| `order_offer_waiting` | OFFER | ☐ | ☐ | |
| `order_vote_driver_assigned` | VOTE | ☐ | ☐ | |
| `order_driver_assigned` | DIRECT/OFFER | ☐ | ☐ | |
| `order_driver_arrived` | все | ☐ | ☐ | |
| `order_in_ride` | все | ☐ | ☐ | |
| `order_completed` ⛔ | все | ☐ | ☐ | |
| `order_cancelled` ⛔ | все | ☐ | ☐ | |
| `order_expired` ⛔ | все | ☐ | ☐ | |
| `ride_interrupted` ⛔ | все | ☐ | ☐ | |
| `order_vote_no_show` ⛔ | VOTE | ☐ | ☐ | |

**Промежуточные состояния движка, которых нет в списке 12** (рецензия: возможны
`order_vote_waiting_confirmation`, `order_offer_waiting_price` и т.п.):

```
(выписать сюда то, что есть в движке, но свёрнуто у нас)
```

---

## 3. Три развилки на решение

### A. Где хранится состояние ([fsm-core-design.md](fsm-core-design.md) §3)
- [ ] `orders.state` — поле заказа
- [ ] общая инфраструктура движка: `fsm_instances` / `fsm_states` / `fsm_transitions`, `orders` ссылается на инстанс
- **Решение:** ____________  → следствие для §3 (таблицы), §5 (переходы), §7 (таймеры): ____________

### B. Владелец Driver Matching ([fsm-core-design.md](fsm-core-design.md) §2.4)
- [ ] **Вариант A** — единый Order FSM, фазы подбора = состояния Order (12 состояний читаются так)
- [ ] **Вариант B** — отдельный Matching FSM (+ Trip FSM), `order_vote_waiting_*` = проекция
- Candidate/Offer — отдельные сущности движка или payload заказа? ____________
- **Линза движка (важнее имён таблиц):** для каждой сущности определить — это **экземпляр FSM** /
  **контекст FSM** / **бизнес-сущность вокруг FSM**?
  - Order: ____________  · Candidate: ____________  · Offer: ____________
  - DriverAssignment: ____________  · Trip: ____________  · BoardingSession: ____________
- **Решение:** ____________

### C. Re-matching (бизнес-критично для Марокко)
Назначение сорвалось →
- [ ] вернуть заказ в поиск (re-matching / re-assignment)
- [ ] завершить заказ (CANCELLED / NO_SHOW)
- [ ] зависит от причины (ниже)

| Причина срыва | Поведение | Состояние-результат |
|---|---|---|
| водитель передумал (отменил отклик) | | |
| не приехал в окно подачи | | |
| сломался / форс-мажор | | |
| не взял трубку / не отвечает | | |
| водитель отменил после назначения | | |

- **Решение:** ____________ → нужны ли состояния `RE_MATCHING`/`RE_ASSIGNMENT` сверх 12: ____________

---

## 4. Открытые вопросы §11 ([fsm-core-design.md](fsm-core-design.md) §11)

| # | Вопрос | Ответ Ивана |
|---|---|---|
| 1 ⭐ | Владелец Driver Matching (= развилка B) | |
| 2 | Перечень состояний финален / есть промежуточные | |
| 3 | Переходы таблично-управляемы или зашиты; можно ли машинный перечень `from→to+trigger+guard` | |
| 4 | Таймеры: механизм, параллельность, маппинг на `b_max_waiting`+votingTimer | |
| 5 | Re-matching есть? (= развилка C) | |
| 6 | Агрегаты vs таблицы движка; CandidatePool/PoolVisibility — проекции или хранимое | |
| 7 | `order_events` / журнал переходов в движке (дедуп, аналитика) | |
| 8 | DIRECT: только «первый принявший» или подбор лучшего системой | |
| 9 | Boarding — отдельная сущность/состояние или флаг `b_driver_code` | |

---

## 5. Таймеры ([fsm-core-design.md](fsm-core-design.md) §7)

| Таймер | Фаза | Истечение → переход | Механизм в движке |
|---|---|---|---|
| `matchingTimeout` | created (DIRECT) | T15 → expired | |
| `candidateTimeout` | vote_waiting_candidates | T15 → expired / re-match | |
| `offerTimeout` | offer_waiting | T15 → expired | |
| `boardingTimeout` | driver_arrived (VOTE) | отмена / re-match | |
| `pickupWindowTimeout` | *_assigned → arrival | T16 → no_show / re-match | |

---

## 6. Итог встречи

- **Дата / участники:** ____________
- **Принятые решения (A / B / C):** ____________
- **Что меняем в `fsm-core-design.md` / `states.md`:** ____________
- **Машинный перечень состояний/переходов движка получен:** ☐ да ☐ нет → где: ____________
- **Следующие действия:** ____________
