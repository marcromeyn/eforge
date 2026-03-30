/**
 * Plan lifecycle guards - validates status transitions before delegating
 * to the low-level `updatePlanStatus()` mutator in state.ts.
 */

import type { EforgeState, PlanState } from '../events.js';
import { updatePlanStatus } from '../state.js';

type PlanStatus = PlanState['status'];

/**
 * Valid transitions: from-status -> list of allowed to-statuses.
 *
 * pending  -> running  (plan starts executing)
 * pending  -> blocked  (dependency failed)
 * running  -> completed (plan finished successfully)
 * running  -> failed   (plan errored)
 * completed -> merged  (squash-merged into feature branch)
 * completed -> failed  (merge failed or skipped due to dep merge failure)
 * failed   -> pending  (resume resets failed plans)
 * blocked  -> pending  (resume unblocks when deps resolve)
 */
export const VALID_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  pending: ['running', 'blocked'],
  running: ['completed', 'failed'],
  completed: ['merged', 'failed'],
  failed: ['pending'],
  blocked: ['pending'],
  merged: [],
};

export interface TransitionMetadata {
  error?: string;
}

/**
 * Transition a plan to a new status, validating the transition is legal.
 * Throws if the transition is not in `VALID_TRANSITIONS`.
 *
 * Delegates to `updatePlanStatus()` from state.ts for the actual mutation
 * and `completedPlans` bookkeeping.
 */
export function transitionPlan(
  state: EforgeState,
  planId: string,
  to: PlanStatus,
  metadata?: TransitionMetadata,
): EforgeState {
  const plan = state.plans[planId];
  if (!plan) {
    throw new Error(`Unknown plan ID: '${planId}'`);
  }

  const from = plan.status;
  const allowed = VALID_TRANSITIONS[from];

  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid plan transition for '${planId}': '${from}' -> '${to}'. ` +
      `Allowed transitions from '${from}': [${allowed.map((s) => `'${s}'`).join(', ')}]`,
    );
  }

  updatePlanStatus(state, planId, to);

  if (metadata?.error !== undefined) {
    plan.error = metadata.error;
  }

  return state;
}
