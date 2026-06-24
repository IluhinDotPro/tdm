import { evaluateGuard, GuardError } from './evaluateGuard';

/** Минимальная форма перехода, нужная для выбора (совместима с Transition/TransitionDef). */
export interface GuardedTransition {
  event: string;
  guard?: string;
  [k: string]: any;
}

/**
 * Выбрать переход по принципу first_match (dsl-spec §3):
 *   среди transitions с `event === event` берётся ПЕРВЫЙ, чей guard истинен.
 *   Переход без guard считается всегда проходящим.
 *
 * Память (ctx) — корень данных пользователя (order.*, user.*, snapshot.* и т.п.).
 * Битый guard трактуется как НЕ прошедший (fail-closed) и логируется через onGuardError.
 *
 * Обратная совместимость: если ни у одного перехода нет guard, поведение идентично
 * прежнему `transitions.find(t => t.event === event)`.
 */
export function chooseTransition<T extends GuardedTransition>(
  transitions: T[] | undefined,
  event: string,
  ctx: Record<string, any>,
  onGuardError?: (e: GuardError, t: T) => void,
): T | undefined {
  if (!transitions?.length) return undefined;
  for (const t of transitions) {
    if (t.event !== event) continue;
    const passed = evaluateGuard(t.guard, ctx, {
      onError: (e) => onGuardError?.(e, t),
    });
    if (passed) return t;
  }
  return undefined;
}
