import type { ExhaustId, ExpansionState } from './types';

export interface WallPoint { x: number; r: number }

/** How the engine turns hot gas into a jet. */
export interface ExhaustType {
  id: ExhaustId;
  name: string;
  tip: string;
  /** What the count slider counts */
  counts: 'chambers' | 'cells';
  /** False where there is no diverging wall at all */
  hasNozzle: boolean;
  /** True where a deployable extension can be fitted */
  extension: boolean;
  /** Which shape sliders this type shows */
  sliders: { exitDia: boolean; nozzleLenPct: boolean; coneAngleDeg: boolean; innerExitDia: boolean };
}

export const EXHAUSTS: Record<ExhaustId, ExhaustType> = {
  bell: {
    id: 'bell',
    name: 'Bell nozzle',
    tip: 'The classic curved nozzle. It suits one altitude best: too big near the ground, too small in space.',
    counts: 'chambers',
    hasNozzle: true,
    extension: true,
    sliders: { exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: false },
  },
  cone: {
    id: 'cone',
    name: 'Plain cone',
    tip: 'A straight-sided cone, the simplest nozzle to build. It gives a little less thrust than a bell of the same size, because the jet leaves slightly spread out.',
    counts: 'chambers',
    hasNozzle: true,
    extension: false,
    sliders: { exitDia: true, nozzleLenPct: false, coneAngleDeg: true, innerExitDia: false },
  },
  dualBell: {
    id: 'dualBell',
    name: 'Dual bell',
    tip: 'Two bells in one: a short one for the ground and a wider one that takes over higher up. It pays off on a nozzle too big for the ground.',
    counts: 'chambers',
    hasNozzle: true,
    extension: false,
    sliders: { exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: true },
  },
  aerospike: {
    id: 'aerospike',
    name: 'Aerospike',
    tip: 'A ring of small thrust cells fires along a central spike, and the outside air shapes the jet, so it suits every altitude.',
    counts: 'cells',
    hasNozzle: true,
    extension: false,
    sliders: { exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: false },
  },
  none: {
    id: 'none',
    name: 'No nozzle',
    tip: 'The chamber ends at the throat, with no nozzle at all. The gas leaves as it is, so much of the engine\'s power is wasted.',
    counts: 'chambers',
    hasNozzle: false,
    extension: false,
    sliders: { exitDia: false, nozzleLenPct: false, coneAngleDeg: false, innerExitDia: false },
  },
};

/** Menu order. */
export const EXHAUST_IDS: ExhaustId[] = ['bell', 'cone', 'dualBell', 'aerospike', 'none'];

export function isExhaustId(v: unknown): v is ExhaustId {
  return typeof v === 'string' && Object.hasOwn(EXHAUSTS, v);
}

/** The kink diameter a dual bell opens with: the inner bell gets the square root of the full area ratio. */
export function defaultInnerExitDia(throatDia: number, exitDia: number): number {
  return throatDia * Math.sqrt(exitDia / throatDia);
}

/** True where the jet has left the nozzle wall before the exit, by tearing off or by being held at a kink. */
export function jetLeftWall(state: ExpansionState): boolean {
  return state === 'separated' || state === 'held';
}
