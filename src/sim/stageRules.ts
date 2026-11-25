// What the stage does differently for an electric engine. Kept apart from the frame loop so the
// rules can be tested without a canvas.
import { isBeam, isElectric } from '../physics/parts';
import type { EngineConfig } from '../physics/types';

/**
 * True for a beam thruster: there is no hot gas, so the plume layer draws only the sky behind it,
 * and the thruster and its beam are drawn over that.
 */
export function skyOnly(cfg: EngineConfig): boolean {
  return isBeam(cfg.energy);
}

/** False for a beam thruster: a beam of charged atoms is not a gas the simulation can follow. */
export function simulationOffered(cfg: EngineConfig): boolean {
  return !isBeam(cfg.energy);
}

/** Why the gas simulation is not on offer, for the menus that would switch it on. */
export const NO_SIMULATION_NOTE = 'A beam of charged atoms is not a gas the simulation can follow.';

/**
 * The share of an ordinary engine's rumble this one makes: none from a beam thruster, which is
 * silent, and little from a heated-gas electric engine, whose push is a fraction of a newton.
 */
export function rumbleShare(cfg: EngineConfig): number {
  if (isBeam(cfg.energy)) return 0;
  return isElectric(cfg.energy) ? 0.15 : 1;
}
