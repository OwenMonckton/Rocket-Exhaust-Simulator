// What Relight or Rebuild puts back after a failure.
import { simulate } from '../physics/engine';
import type { AppState } from '../state/store';

/**
 * The engine to stand after Relight or Rebuild: the one now set up, if it would run (the user may
 * have done what the failure box said while it was showing), or else the last one that ran.
 */
export function engineAfterRebuild(current: AppState, lastGood: AppState): AppState {
  return simulate(current.config, current.flight).failure ? lastGood : current;
}
