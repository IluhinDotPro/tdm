# FSM заказа — таймеры

> Таймеры — cross-cutting слой: **не состояния, а триггеры переходов**. Источник:
> `OrderManager.isOutOfTime`, `api/order.ts` (votingTimer). См. [states.md](states.md), [events.md](events.md).

---

## 0. Статус: Timer Worker — часть MVP (ревью 2026-06-26)

> Сверка с Иваном 2026-06-26: переходы `order_expire` (T15) и `order_no_show` (T16) **есть в графе движка,
> но сами не срабатывают** — их обязан запускать worker по `server_fsm_instances.next_timer_at`. Значит
> таймеры перестали быть «архитектурным улучшением после MVP» и стали **обязательной частью исполнения
> FSM**: без них часть графа недостижима при штатном сценарии.

Различаем два уровня (раньше оба ошибочно относили к «после MVP»):

| Уровень | Что это | Когда |
|---|---|---|
| **Timer Worker** | простой воркер: читает `next_timer_at`, по истечении дёргает timeout-действие (`order_expire`/`order_no_show`) через обычный переход | **часть MVP** 🔴 |
| **универсальный Timer Subsystem** | параметризуемые таймеры состояния, registry, приоритеты, параллельность, продление | **после MVP** 🟡 |

В MVP worker обслуживает: `matchingTimeout`/`candidateTimeout`/`offerTimeout` → `order_expired` (T15, до
назначения) и `pickupWindowTimeout` (VOTE) → `order_vote_no_show` (T16). Для DIRECT/OFFER таймера подачи в
MVP **нет** — «не приехал» там закрывается ручной отменой ([states.md](states.md) §1a, решение 2026-06-26).
Таймаут — это **событие**, разрешаемое по режиму ([events.md](events.md) §4), а не отдельный терминал.

См. [fsm-core-design.md](fsm-core-design.md) §7 и §5a, [fsm-core-sync-checklist.md](fsm-core-sync-checklist.md) §5,
[fsm-engine-rfc.md](fsm-engine-rfc.md) (вопрос 5 — таймер как источник синтетического Action).

---

## 1. Реализованные таймеры (текущий бэкенд)

### 1.1 Окно ожидания заказа → `OUT_OF_TIME`
Вычисляется в `OrderManager.isOutOfTime` двумя способами:
1. **По данным API:** `b_start_datetime + Σ(b_max_waiting_list.additional)` (сек). Если прошло — таймаут.
2. **Fallback:** `registeredAt + maxWaitingSecs` (по умолчанию **600 сек**).

При срабатывании: бот шлёт `cancelOrder(reason="Max waiting time exceeded")`, эмитит
`order_status_out_of_time` → состояние EXPIRED, заказ снят с наблюдения.

### 1.2 votingTimer (режим VOTE)
Из `api/order.ts`:
- старт: `maxVotingWaitingTimeSecs` (конфиг);
- уменьшается на `observerFrequency` каждый тик поллинга;
- уведомление клиента при ≤30 сек;
- продление: `addVotingTime()` → **+3 мин**;
- при `≤0`: `cancel("Voting time expired")`.

---

## 2. Целевые таймеры (ориентир, gpt3)

Полный набор cross-cutting таймеров для целевого FSM:

| Таймер | Ограничивает | Эффект истечения |
|---|---|---|
| `matchingTimeout` | общий поиск исполнителя | EXPIRED |
| `candidateTimeout` | ожидание кандидатов (VOTE) | re-matching / EXPIRED |
| `offerTimeout` | сбор предложений (OFFER) | EXPIRED |
| `boardingTimeout` | подтверждение посадки | отмена / re-matching |
| `pickupWindowTimeout` | прибытие к клиенту | NO_SHOW_DRIVER / re-matching |

Эффект истечения (общий): смена состояния, отмена назначения, повторный поиск или EXPIRED.

> ⚠️ **`pickupWindowTimeout` → терминал зависит от режима** (решение 2026-06-26, §0). Это **событие**
> `pickup_timeout`, не прямой переход в один общий `NO_SHOW_DRIVER`: VOTE → `order_vote_no_show` (MVP, T16);
> DIRECT/OFFER → `order_cancelled` (в MVP — ручная отмена, авто-таймаута подачи нет). См. [events.md](events.md) §4.

---

## 3. Открытые вопросы (отмечено grok1)
- **Параллельные таймеры:** могут ли работать одновременно, приоритеты, взаимодействие?
- Маппинг целевых таймеров на текущий механизм `b_max_waiting_list` (сейчас по сути один общий таймер
  ожидания + votingTimer).
