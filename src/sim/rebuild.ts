// When a failure shows, and what Relight or Rebuild puts back after it.
import { simulate } from '../physics/engine';
import type { Failure } from '../physics/types';
import type { AppState } from '../state/store';

/** How far the start-up ramp gets (0 to 1) before a failure of a lit engine shows. */
const LIT_FAILURE_RAMP = 0.6;

/**
 * Whether a failure shows now, `fire` into the start-up ramp. An engine that never lights (nothing to
 * burn, or no answer from the chemistry) shows it as Fire is pressed, with no flame first.
 */
export function latchesNow(failure: Failure, fire: number): boolean {
  if (!failure) return false;
  return failure === 'inert' || failure === 'unsolved' ? fire > 0 : fire > LIT_FAILURE_RAMP;
}

/**
 * The engine to stand after Relight or Rebuild: the one now set up, if it would run (the user may
 * have done what the failure box said while it was showing), or else the last one that ran.
 */
export function engineAfterRebuild(current: AppState, lastGood: AppState): AppState {
  return simulate(current.config, current.flight).failure ? lastGood : current;
}
