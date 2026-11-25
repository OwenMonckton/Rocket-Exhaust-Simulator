// The rules that keep the clock, the log and the readings telling the truth about a test run.
// Kept apart from main.ts so they can be tested without a page.
import { destroys } from '../physics/limits';
import { isBeam } from '../physics/parts';
import type { EnergyId, Failure, SimResult } from '../physics/types';
import { STAND_GONE_KM } from './stand';

/** A frame of a lit engine: what it read, and how far it had run up. */
export interface LiveFrame {
  result: SimResult;
  fire: number;
  /** True once a failure has come and this frame is held for it */
  held: boolean;
}

/**
 * The frame to keep, frame by frame. While the engine runs it is the latest. When a failure comes
 * it becomes the failing engine's figures at the power the run had reached, so the numbers that
 * broke it show (a setting pushed past a limit in one move breaks the engine on the first frame
 * it runs with it, so the last safe frame would show the old setting). It is then held, whatever
 * is changed while the notice shows, and let go once the failure is cleared.
 */
export function nextLive(
  prev: LiveFrame | null,
  now: { result: SimResult; fire: number; firing: boolean; failure: Failure },
): LiveFrame | null {
  if (now.failure) {
    if (!prev) return null;
    return prev.held ? prev : { result: now.result, fire: prev.fire, held: true };
  }
  return now.firing ? { result: now.result, fire: now.fire, held: false } : null;
}

/** What the readings column says it is showing while it holds the moment of a failure. */
export const FROZEN_RUN_LINE = 'Readings at the moment of failure';

/**
 * What the readings column shows. While a failure is showing it holds the last frame the engine
 * was lit, at the power it had reached, so the number that broke it stays in view; an engine that
 * never lit has no such frame, and shows the engine as it stands.
 */
export function readingsFor(
  now: { result: SimResult; fire: number; failure: Failure },
  lastLive: LiveFrame | null,
): { result: SimResult; fire: number; frozen: boolean } {
  if (now.failure && lastLive) return { result: lastLive.result, fire: lastLive.fire, frozen: true };
  return { result: now.result, fire: now.fire, frozen: false };
}

/**
 * The log line written when an engine is put right after a failure: rebuilt if the failure
 * destroyed it, and back on the stand only below the height where the stand has fallen away.
 */
export function restoreLine(failure: Exclude<Failure, null>, altitudeKm: number, energy: EnergyId): string {
  if (destroys(failure)) return altitudeKm < STAND_GONE_KM ? 'Engine rebuilt and back on the stand.' : 'Engine rebuilt.';
  return isBeam(energy) ? 'Ready to switch on again.' : 'Ready to fire again.';
}

/** The controls that use Space for themselves; anywhere else, Space fires or shuts down the engine. */
const OWN_SPACE = new Set(['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'SUMMARY']);
export function spaceFires(tag: string): boolean {
  return !OWN_SPACE.has(tag);
}
