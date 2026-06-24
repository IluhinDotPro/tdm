# План реализации / миграции (Этап 6)

> Превращает спецификации (Этапы 1–4) в инкрементальный план разработки на выбранной базе.
> База (рекомендация, [gap-analysis.md](gap-analysis.md)): **MultiBot** + перенос бизнес-логики из WATaxiBot.
> Подход — эволюция, не переписывание. Источник истины спеки — `docs/`.
>
> ⚠️ Финальное утверждение базы — за заказчиком. Ветки VOTE/OFFER — после ответов бэкенд-команды.

---

## 0. Принцип миграции (gpt4)
Не «переключить разом», а: довести движок → перенести бизнес-логику в декларатив → заменить интеграцию
на порт → тесты → поэтапное переключение канала на FSM как источник истины.

---

## Блок A — Доработка движка (фундамент)

| # | Задача | Спека | Действие в коде (MultiBot) |
|---|---|---|---|
| A1 ✅ | **Guard в DSL** | dsl-spec §3 | ✅ Парсер выражений (`==,!=,>,<,>=,<=,&&,\|\|,!,путь,null`) без eval; `first_match` по guard над памятью. Код: `bot/src/engine/guard/`, врезка в `FSMManager.transition`; тесты `bot/tests/test_guard.ts` |
| A2 | **Единая модель событий** | event-model | Тип события с природой (UI/System/Domain); опц. префиксы `sys_`; не терять Domain-события |
| A3 ✅ | **Единый `dispatch`** | dsl-spec §5 | ✅ Чистое ядро `computeTransition(schema,state,memory,event)→{from,to,actions,entryActions}` в `bot/src/engine/dispatch.ts`; `transition()` — обёртка (+persist), `dispatch()` — read-only. Тесты `bot/tests/test_dispatch.ts`. Перенос determineEvent из MainHandler — в A2/A4 |
| A4 | **Очистка протечек домена** | dsl-spec §2, form-fsm §4 | Убрать `additionalOptionsAllowed/TokenMap` из validation → справочник requirements в конфиг/память |
| A5 | **onActionError** | dsl-spec §4 | Событие при сбое action (сейчас только лог) |

---

## Блок B — OrderGateway (интеграция)

> 🏛 **Переоценено под Вариант 3 (ADR-001):** владелец состояния — серверный Domain FSM. `OrderGateway`
> остаётся **исходящим портом бота**, но за ним теперь **серверный API**, а не iBronevik. Маппинг
> `b_state`/`c_*`, поллинг и команды iBronevik **уходят на сервер** в Core Adapter (наши
> `backend-mapping.md`/`api-payload-reference.md` — спецификация для него). Новый критический
> артефакт — **контракт Бот↔API** (со-дизайн с @spitegod). См.
> [architecture-decision-variant3.md](architecture-decision-variant3.md) §4–5.

| # | Задача | Спека | Действие (Вариант 3) |
|---|---|---|---|
| B1 | **Выделить порт `OrderGateway`** | integration §2,7 | Рефакторинг `OrderManager` в интерфейс (команды + watch/onOrderEvent) — остаётся как порт бота |
| B2 | ~~Адаптер iBronevik~~ → **server-API adapter** | ADR-001 §3–4 | Маппинг iBronevik **уходит на сервер (Core Adapter)**. В боте — тонкий адаптер к серверному API. Интерим до готовности API — см. ADR §5.1 |
| B3 | **OrderSnapshot** | integration §4 | Доменное представление приходит из **API**, бот не деривит из сырого поллера |
| B4 | **Персистентность реестра** | integration §5, gap §2 | Преимущественно серверная забота (FSM-движок); в боте — только активные диалоги/watch |
| B5 | **Гарантии доставки** | integration §5 | Преимущественно серверная забота; в боте — дедуп/упорядочивание входящих доменных событий |
| **B0** | **Контракт Бот↔API** ⭐ | ADR-001 §4 | НОВОЕ: словарь событий вверх + представление доменного состояния вниз + транспорт. Со-дизайн с @spitegod |

---

## Блок C — FSM бота (схемы)

| # | Задача | Спека | Действие |
|---|---|---|---|
| C1 | **tracking-FSM (`order.*`)** | tracking-fsm §1–3 | Довести `order.json` до спеки (наблюдаемый трек уже ~готов); fallback для гонок (§5) |
| C2 ✅ | **form-FSM (`form.*`) такси** | form-fsm | ✅ Схема `schemas/form.json` (from→to→people→carClass→options→when→mode→confirm) верифицирована против ядра `computeTransition`; тест `bot/tests/test_form_fsm.ts` (8 групп). Live-врезка в рантайм (отдельный тенант, validation `requirements`/parseWhen) — после прогона бота |
| C3 ✅ | **Ветвление по режиму (guard)** | form-fsm §2 | ✅ `form.mode` разводит выбор разными событиями (`mode_offer`→offerPrice, `mode_direct/vote`→confirm); **guard** на `form.confirm`: `order.mode == 'DIRECT'`→driverSearch vs `!= 'DIRECT'`→order.start (прямое создание). Покрыто `test_form_fsm.ts` |
| C4 🟡 | **Перенос бизнес-логики из WATaxiBot** | gap §4 | 🟡 Частично: ✅ расчёт `Actual` (business-rules §1–§2) — чистый модуль `bot/src/engine/children/order/actualPrice.ts` (вычисление отделено от представления, без eval), тест `bot/tests/test_actual_price.ts` (7 групп). ⚠️ **Под Вариант 3:** расчёт `Actual` — **доменное** вычисление → вероятно переезжает на сервер; в боте остаётся как клиентская валидация/рендер. Уточнить (ADR-001 §5.3). ⏳ Остальное (votingTimer/offer/рейтинг) — на стороне Domain FSM; бот рендерит |
| C5 | **Ветки VOTE/OFFER в сопровождении** ⏳ | tracking-fsm §4 | `candidateList`/`offerList`/`boarding` поверх `OrderSnapshot` — **после ответа бэкенда** |

---

## Блок D — Каналы и тесты

| # | Задача | Действие |
|---|---|---|
| D1 | **WhatsApp** | основной канал (MultiBot `WhatsappWebPollingAdaptor`) |
| D2 | **Telegram** | включить `TelegramBot*Adaptor` (почти бесплатно; ответ 3) |
| D3 | **Тесты сценариев** | DIRECT happy-path; отмена на каждой стадии; таймаут (out_of_time); гонки Domain-событий; VOTE с external carrier; OFFER; reassignment (по grok1) |
| D4 | **Fake OrderGateway** | тестировать FSM бота без реального API (integration §3) |

---

## Блок E — Переключение

| # | Задача | Действие |
|---|---|---|
| E1 | Поэтапное включение | Канал WhatsApp на новую FSM как источник истины; WATaxiBot — fallback на время миграции |
| E2 | Наблюдаемость | Логи переходов FSM, метрики поллинга, алерты на «потерянные» Domain-события |
| E3 | Депрекация старого | После стабилизации — вывод WATaxiBot |

---

## Порядок и зависимости

```
A1–A4 (движок) ─┬─► C1,C2 (схемы) ─► C3,C4 ─► D3 (тесты) ─► E1 (переключение)
B1,B2 (Gateway) ┘                 ▲
B3,B4 (snapshot/persist) ─────────┘
C5 (VOTE/OFFER) ◄── ответ бэкенд-команды (ROADMAP §4)
D2 (Telegram) — в любой момент после A/C
```

**MVP-срез (минимум до прода):** A1–A4, B1–B4, C1–C2, C4 (цена/рейтинг), D1, D3 (DIRECT+отмена+таймаут), E1.
**После MVP:** C3 (mode-ветвление), C5 (VOTE/OFFER ветки), D2 (Telegram), спец-сценарии.

---

## Открытые зависимости (блокеры)
- **C5 / ветки VOTE/OFFER** — ждут ответа бэкенд-команды (состав кандидатов/предложений, цена OFFER).
- **Финальный выбор базы** — утверждение заказчиком (рекомендация — MultiBot).
- Бизнес-правила ценообразования/отмен/оплаты/SOS (открыты с Этапа 1) — для полноты сценариев D3.

---

## Что НЕ входит (вне scope MVP)
- Переписывание бэкенда под идеализированную модель ТДМ (решение — «под текущий»).
- Web/mobile каналы (архитектура готова, но не в MVP).
- Целевой FSM заказа со стратегиями Carrier Determination (ориентир, не реализация).
