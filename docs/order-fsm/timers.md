# FSM заказа — таймеры

> Таймеры — cross-cutting слой: **не состояния, а триггеры переходов**. Источник:
> `OrderManager.isOutOfTime`, `api/order.ts` (votingTimer). См. [states.md](states.md), [events.md](events.md).

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

---

## 3. Открытые вопросы (отмечено grok1)
- **Параллельные таймеры:** могут ли работать одновременно, приоритеты, взаимодействие?
- Маппинг целевых таймеров на текущий механизм `b_max_waiting_list` (сейчас по сути один общий таймер
  ожидания + votingTimer).
