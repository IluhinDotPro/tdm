import { TenantSchema, State } from './types';
import { chooseTransition } from './guard/chooseTransition';
import { GuardError } from './guard/evaluateGuard';

/**
 * Результат чистого вычисления перехода (dsl-spec §5, event-model §3).
 * dispatch(state, memory, event) → { from, to, actions, entryActions }.
 */
export interface DispatchResult {
  from: string;
  to: string | null;
  actions: string[];
  entryActions: string[];
}

export type GuardErrorReporter = (e: GuardError, t: { event: string; to: string; guard?: string }) => void;

/** Найти состояние по полному id (`<flow>.<state>`) во всех flow схемы. */
export function findState(schema: TenantSchema, stateId: string): State | undefined {
  for (const flow of Object.values(schema.flows || {})) {
    if (flow.states?.[stateId]) return flow.states[stateId];
  }
  return undefined;
}

/**
 * Чистое ядро движка: по текущему состоянию, памяти и событию вычисляет переход.
 * БЕЗ I/O и побочных эффектов (не читает Redis, не пишет состояние) — это позволяет одному
 * движку обслуживать form-FSM, tracking-FSM (и в будущем web/mobile), а также юнит-тестировать
 * переходы без инфраструктуры.
 *
 * - выбор перехода — first_match по guard (см. chooseTransition / dsl-spec §3);
 * - `to === null`, если состояние не найдено ИЛИ нет подходящего перехода (нет события / все guard ложны);
 * - `entryActions` — действия входа в целевое состояние (если оно описано в схеме).
 *
 * memoryPatch здесь НЕ возвращается: патч памяти формируется выше (validation, до перехода) и ниже
 * (actions через ActionExecutor). Ядро отвечает только за выбор перехода.
 */
export function computeTransition(
  schema: TenantSchema,
  currentState: string,
  memory: Record<string, any>,
  event: string,
  onGuardError?: GuardErrorReporter,
): DispatchResult {
  const stateDef = findState(schema, currentState);
  if (!stateDef) {
    return { from: currentState, to: null, actions: [], entryActions: [] };
  }

  const chosen = chooseTransition(stateDef.transitions, event, memory, onGuardError);
  if (!chosen) {
    return { from: currentState, to: null, actions: [], entryActions: [] };
  }

  const target = findState(schema, chosen.to);
  return {
    from: currentState,
    to: chosen.to,
    actions: chosen.actions || [],
    entryActions: target?.entryActions || [],
  };
}
