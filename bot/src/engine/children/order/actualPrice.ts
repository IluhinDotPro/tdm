/**
 * Расчёт ФАКТИЧЕСКОЙ стоимости заказа (Actual Price) — чистая доменная логика.
 *
 * Реализует бизнес-правила заказчика (Валентин, 2026-06-20), зафиксированные в
 * docs/domain/business-rules.md §1–§2. Здесь ТОЛЬКО вычисление: ни UI, ни l10n, ни API, ни eval.
 * Представление (форматирование суммы/разбивки для сообщения) строится отдельно по результату —
 * это и есть «отделить вычисление от представления» (implementation-plan, Блок C4).
 *
 * Формы стоимости (§1): Estimated (информац., к оплате НЕ предъявляется — здесь не считается),
 * Pickup Fee (задаёт пассажир), Minimum Ride Price (флор региона посадки), Actual (единственная к оплате).
 *
 * Инварианты (§1):
 *   - Actual = стоимость поездки + Pickup Fee (если указана и применима к режиму);
 *   - Actual ≥ Minimum Ride Price — ВСЕГДА (флор);
 *   - Estimated к оплате не предъявляется и состояние FSM не определяет.
 */

/** Режим формирования фактической стоимости (business-rules §2). */
export type ActualPriceMode = 'PETIT' | 'OFFER' | 'DIRECT';

export interface ActualPriceInput {
  mode: ActualPriceMode;
  /** Pickup Fee (цена подачи) — задаёт пассажир; в OFFER отсутствует (§2.2). */
  pickupFee?: number;
  /** Minimum Ride Price — нижняя граница, параметр региона посадки (§1). */
  minimumRidePrice?: number;
  /** PETIT: показания таксометра (§2.1). */
  taximeter?: number;
  /** PETIT: корректировка маршрута за попутчиков по правилам сервиса (§2.1), может быть отрицательной. */
  adjustment?: number;
  /** OFFER: принятая цена выбранного водителя (§2.2). */
  acceptedDriverPrice?: number;
  /** DIRECT (не-Petit): сумма по договорённости при посадке (§2.3). */
  agreedAmount?: number;
}

export interface ActualPriceResult {
  /** Итоговая сумма к оплате (после прибавления Pickup Fee и применения флора Minimum). */
  actual: number;
  /** Стоимость поездки ДО прибавления Pickup Fee и флора (таксометр+корректировка / offer / договорённость). */
  rideCost: number;
  /** Фактически добавленный Pickup Fee (0, если режим его не учитывает или не задан). */
  pickupApplied: number;
  /** Сумма поездки и подачи ДО применения флора Minimum. */
  subtotal: number;
  /** Применённый флор Minimum Ride Price (0, если не задан). */
  minimumApplied: number;
  /** true, если Actual поднят до Minimum (subtotal был ниже флора). */
  flooredToMinimum: boolean;
}

function assertFiniteNonNegative(name: string, v: number | undefined, required: boolean): number {
  if (v == null) {
    if (required) throw new Error(`actualPrice: отсутствует обязательное поле '${name}'`);
    return 0;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`actualPrice: поле '${name}' должно быть конечным числом, получено ${v}`);
  }
  if (v < 0) throw new Error(`actualPrice: поле '${name}' не может быть отрицательным (${v})`);
  return v;
}

/**
 * Вычислить Actual Price по режиму (business-rules §2). Бросает Error при отсутствии обязательного
 * для режима поля или некорректном (NaN/∞/отрицательном) значении — это ошибка вызова, не данных.
 *
 * Поведение по режимам:
 *   - PETIT  (§2.1): rideCost = таксометр + корректировка; + Pickup Fee; флор Minimum.
 *   - OFFER  (§2.2): rideCost = принятая цена водителя; Pickup Fee НЕ применяется; флор Minimum.
 *   - DIRECT (§2.3): rideCost = договорённость при посадке (Pickup Fee уже учтён в ней — программно
 *                    не прибавляем во избежание двойного счёта); флор Minimum как инвариант.
 */
export function computeActualPrice(input: ActualPriceInput): ActualPriceResult {
  const minimumRidePrice = assertFiniteNonNegative('minimumRidePrice', input.minimumRidePrice, false);

  let rideCost: number;
  let pickupApplied: number;

  switch (input.mode) {
    case 'PETIT': {
      const taximeter = assertFiniteNonNegative('taximeter', input.taximeter, true);
      // adjustment допускается отрицательной (скидка за попутчиков), но итог поездки не ниже 0.
      const adjustment = input.adjustment == null
        ? 0
        : (typeof input.adjustment === 'number' && Number.isFinite(input.adjustment)
            ? input.adjustment
            : (() => { throw new Error(`actualPrice: поле 'adjustment' должно быть конечным числом`); })());
      rideCost = Math.max(0, taximeter + adjustment);
      pickupApplied = assertFiniteNonNegative('pickupFee', input.pickupFee, false);
      break;
    }
    case 'OFFER': {
      rideCost = assertFiniteNonNegative('acceptedDriverPrice', input.acceptedDriverPrice, true);
      pickupApplied = 0; // §2.2: Pickup Fee в OFFER отсутствует.
      break;
    }
    case 'DIRECT': {
      rideCost = assertFiniteNonNegative('agreedAmount', input.agreedAmount, true);
      pickupApplied = 0; // §2.3: Pickup Fee учтён в договорённости, программно не прибавляем.
      break;
    }
    default:
      throw new Error(`actualPrice: неизвестный режим '${(input as ActualPriceInput).mode}'`);
  }

  const subtotal = rideCost + pickupApplied;
  const flooredToMinimum = subtotal < minimumRidePrice;
  const actual = flooredToMinimum ? minimumRidePrice : subtotal;

  return {
    actual,
    rideCost,
    pickupApplied,
    subtotal,
    minimumApplied: minimumRidePrice,
    flooredToMinimum,
  };
}
