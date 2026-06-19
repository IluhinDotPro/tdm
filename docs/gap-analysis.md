# Gap-анализ кода и выбор базы (Этап 5)

> Цель: сопоставить обе кодовые базы с целевой моделью (Этапы 1–4) и выбрать базу **эволюции**
> (решение заказчика — «эволюция понятнее»). Методология — gpt4: reverse-mapping → сопоставление →
> gap → выбор.
>
> Источники: прямое чтение кода + архитектурные карты (см. `_workspace/notes/`). Пути — в
> `_workspace/sources/{WATaxiBot-main,MultiBot-main}/`.

---

## 1. Reverse-mapping: WATaxiBot (старый)

**Что это:** production-бот на `whatsapp-web.js`. FSM — кастомная: `StateMachine{id,state,data}`,
переходы зашиты в `switch/case` обработчиков (`handlers/*.ts`), состояние в памяти (`MemoryStorage`).

**Автоматы (id):** `order`, `ride`, `register`, `settings`, `childrenProfile`, `voting`.

**Сильное (бизнес-зрелость):**
- Полный рабочий поток заказа такси (collectionFrom…confirm), цена, рейтинг/отзыв.
- Реальная механика VOTE: `isVoting`, votingTimer (+3 мин, уведомление ≤30с), код посадки.
- OFFER/адресный: `b_only_offer`, `addOffer`/`set_offer`.
- Спец-сценарии: truck (TripWatcher, truckDriverWatcher), children-профили, AI-помощник.
- Класс `Order` инкапсулирует API iBronevik (`new`, `getState`, `cancel`, polling).

**Gap против целевой модели:**
- FSM не декларативна — граф переходов не виден целиком (gpt: «потерянные» состояния).
- Состояние **in-memory** → теряется при рестарте.
- Polling и отрисовка смешаны в `observer/order.ts` (455 строк: домен + представление).
- `Order` (API+логика) хранится прямо в `data` состояния — нарушение SoC.
- Нет Guard, нет единой модели событий, нет персистентного реестра наблюдения.
- Один канал (WhatsApp).

---

## 2. Reverse-mapping: MultiBot (новый)

**Что это:** декларативный FSM-движок. Схемы — JSON (`schemas/children/*.json`), состояние в **Redis**
(state/memory раздельно), мульти-канал (WA+Telegram через `transport/`), оркестратор.

**Слои:** `Engine`(FSMManager+TaskManager+Redis) · `Orchestrator` · `OrderManager`(polling→system-events)
· `DriverSearchManager` · `APIManager` · `transport/` адаптеры.

**Сильное (архитектура = целевая):**
- FSM декларативна (JSON-DSL: states/validation/transitions/actions) — ровно то, что специфицировано в Этапе 4.
- State/Memory разделены на уровне движка (`getState/setState` vs `getData/mergeData`).
- Персистентность (Redis) — переживает рестарт бота.
- **OrderManager уже реализует целевой паттерн** «FSM бота реагирует на внешний FSM заказа»:
  поллит API, `deriveEvent`, шлёт `order_status_*` как system-events в FSM (= наш `OrderGateway`).
- Мульти-канал из коробки (ответ 3 — +Telegram «бесплатно»).
- `order.json` — почти готовая реализация tracking-FSM (Этап 4.2).

**Gap против целевой модели:**
- Нет Guard в DSL (условность в JS `MainHandler`) — Этап 4.3.
- События смешаны по природе (нет UI/System/Domain разделения) — Этап 4.4.
- Протечка домена в validation (`additionalOptionsAllowed/TokenMap`).
- `OrderManager`/`DriverSearchManager` — реестр в памяти процесса (не Redis) → поиск рвётся при рестарте.
- `OrderGateway` не выделен явным портом; маппинг статусов не вынесен в адаптер.
- Бизнес-зрелость **ниже** WATaxiBot: меньше спец-сценариев (truck и пр.), часть на «children».

---

## 3. Сопоставление с целевой моделью

| Критерий | Целевое | WATaxiBot | MultiBot |
|---|---|---|---|
| Декларативная FSM | да | ❌ switch/case | ✅ JSON-DSL |
| State/Memory раздельно | да | ⚠️ в одном `data` | ✅ |
| Персистентность состояния | да (Redis) | ❌ in-memory | ✅ Redis |
| Паттерн «бот ↔ внешний FSM заказа» | OrderGateway | ⚠️ Order+observer | ✅ OrderManager→system-events |
| Мульти-канал (WA+TG) | желательно | ❌ только WA | ✅ |
| Guard в DSL | да | ❌ | ❌ (оба) |
| Единая модель событий | да | ❌ | ❌ (оба) |
| Бизнес-зрелость (VOTE/OFFER/truck/цена) | да | ✅ высокая | ⚠️ средняя |
| Чистота SoC (домен/представление) | да | ❌ | ⚠️ частично |

**Вывод:** MultiBot **архитектурно совпадает** с целевой моделью (4 из 4 ключевых критериев), но
**отстаёт по бизнес-зрелости**. WATaxiBot — наоборот: зрелый бизнес, но архитектура противоречит цели.

---

## 4. Решение: база эволюции

### Рекомендация: **MultiBot** как база, WATaxiBot — источник бизнес-логики для переноса.

Обоснование:
1. «Эволюция понятнее» (заказчик) + цель = декларативная FSM, реагирующая на внешний FSM заказа →
   MultiBot уже **является** этой эволюцией WATaxiBot (тот же домен, тот же API iBronevik, тот же
   `deriveEvent`, конфиг children). Это не greenfield, а продолжение начатого рефакторинга.
2. Ответы заказчика 1/3/5 (поллинг / +Telegram / текущий бэкенд) — все нативны для MultiBot.
3. Архитектурные gap'ы MultiBot (Guard, модель событий, порт Gateway, персистентность менеджеров) —
   **аддитивные доработки**, а не переписывание. Gap'ы WATaxiBot (декларативность, Redis, мульти-канал)
   требовали бы переписать ядро.
4. Бизнес-зрелость переносится из WATaxiBot **порциями** в декларативные схемы/actions (votingTimer,
   offer, цена, спец-сценарии) — управляемо и тестируемо.

### Что переносим из WATaxiBot в MultiBot
- votingTimer (продление +3 мин, уведомление ≤30с) → System-события сопровождения.
- OFFER/адресный (`set_offer`, `b_only_offer`) → команды `OrderGateway`.
- Расчёт/отрисовка цены, рейтинг/отзыв → actions (отделив вычисление от представления).
- Спец-сценарии (truck/children) — по необходимости, после MVP.

### Риски
- MultiBot менее «обкатан» в проде → нужен план тестов (Этап 6.4) и поэтапное переключение (6.5).
- Реестры OrderManager/DriverSearchManager в памяти → персистентность обязательна до прода.

> Финальное утверждение базы — за заказчиком. Если приоритет — минимальный риск к проду «прямо
> сейчас», возможен временный путь: довести WATaxiBot (перенести state в Redis), но это противоречит
> цели декларативной FSM. Рекомендация остаётся — **MultiBot**.

---

## 5. Карта переиспользования (целевой компонент → откуда)

| Целевой компонент (Этап 4/3) | Берём из |
|---|---|
| FSM-движок (DSL, dispatch) | MultiBot `engine/` (+ Guard, модель событий) |
| tracking-FSM (`order.*`) | MultiBot `order.json` (готово на 90%) |
| form-FSM (`form.*`) | MultiBot `main.json` + бизнес-нюансы WATaxiBot |
| OrderGateway | рефакторинг MultiBot `OrderManager` + адаптер iBronevik |
| Транспорт WA/TG | MultiBot `transport/` |
| Бизнес-логика (voting/offer/price) | WATaxiBot (`api/order.ts`, `observer/order.ts`) → actions |
