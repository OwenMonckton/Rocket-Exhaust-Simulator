import type { EngineConfig, ExhaustId, ExpansionState } from './types';

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
  sliders: { exitDia: boolean; nozzleLenPct: boolean; coneAngleDeg: boolean; innerExitDia: boolean; plugShare: boolean };
}

export const EXHAUSTS: Record<ExhaustId, ExhaustType> = {
  bell: {
    id: 'bell',
    name: 'Bell nozzle',
    tip: 'The classic curved nozzle. It suits one altitude best: too big near the ground, too small in space.',
    counts: 'chambers',
    hasNozzle: true,
    extension: true,
    sliders: { exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: false, plugShare: false },
  },
  cone: {
    id: 'cone',
    name: 'Plain cone',
    tip: 'A straight-sided cone, the simplest nozzle to build. It gives a little less thrust than a bell of the same size, because the jet leaves slightly spread out.',
    counts: 'chambers',
    hasNozzle: true,
    extension: false,
    sliders: { exitDia: true, nozzleLenPct: false, coneAngleDeg: true, innerExitDia: false, plugShare: false },
  },
  dualBell: {
    id: 'dualBell',
    name: 'Dual bell',
    tip: 'Two bells in one: a short one for the ground and a wider one that takes over higher up. It pays off on a nozzle too big for the ground.',
    counts: 'chambers',
    hasNozzle: true,
    extension: false,
    sliders: { exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: true, plugShare: false },
  },
  aerospike: {
    id: 'aerospike',
    name: 'Aerospike',
    tip: 'A ring of small thrust cells fires along a central spike, and the outside air shapes the jet, so it suits every altitude.',
    counts: 'cells',
    hasNozzle: true,
    extension: false,
    sliders: { exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: false, plugShare: false },
  },
  expansionDeflection: {
    id: 'expansionDeflection',
    name: 'Expansion-deflection',
    tip: 'A plug sits in the throat, so the gas leaves through a ring and runs out along a short bell. Near the ground the outside air fills the hollow behind the plug and the nozzle acts like a smaller one; higher up the hollow closes and the gas fills the bell.',
    counts: 'chambers',
    hasNozzle: true,
    extension: false,
    sliders: { exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: false, plugShare: true },
  },
  none: {
    id: 'none',
    name: 'No nozzle',
    tip: 'The chamber ends at the throat, with no nozzle at all. The gas leaves as it is, so much of the engine\'s power is wasted.',
    counts: 'chambers',
    hasNozzle: false,
    extension: false,
    sliders: { exitDia: false, nozzleLenPct: false, coneAngleDeg: false, innerExitDia: false, plugShare: false },
  },
};

/** Menu order. */
export const EXHAUST_IDS: ExhaustId[] = ['bell', 'cone', 'dualBell', 'aerospike', 'expansionDeflection', 'none'];

export function isExhaustId(v: unknown): v is ExhaustId {
  return typeof v === 'string' && Object.hasOwn(EXHAUSTS, v);
}

/** The kink diameter a dual bell opens with: the inner bell gets the square root of the full area ratio. */
export function defaultInnerExitDia(throatDia: number, exitDia: number): number {
  return throatDia * Math.sqrt(exitDia / throatDia);
}

/**
 * Radius of the wall where the gas passes through at its narrowest, m. For every type but one
 * that is the throat's radius. An expansion-deflection nozzle's throat is the ring between its
 * plug and its wall, and the ring has the throat's area, so its wall is wider than a plain throat
 * of the same area would be.
 */
export function ringWallRadius(cfg: EngineConfig): number {
  const rt = cfg.throatDia / 2;
  return cfg.exhaust === 'expansionDeflection' ? rt / Math.sqrt(1 - cfg.plugShare ** 2) : rt;
}

/** How far the cap of an expansion-deflection nozzle's plug runs past the ring, in ring-wall radii. */
export const ED_CAP_RADII = 0.6;
/** The steepest the cap sends the gas outward, radians. */
const ED_MAX_TILT = (30 * Math.PI) / 180;

/**
 * The angle the cap of an expansion-deflection nozzle's plug flares outward at, radians: the
 * angle its bell leaves the ring at (1.8 times the bell's average slope, as the gas simulation
 * fits it), so that cap and wall run side by side. This is what throws the gas onto the wall.
 */
export function edCapTilt(cfg: EngineConfig): number {
  const rw = ringWallRadius(cfg);
  const re = cfg.exitDia / 2;
  const chord = (re - rw) / bellLength(cfg, rw, re);
  return Math.min(Math.atan(1.8 * chord), ED_MAX_TILT);
}

/** True where the jet has left the nozzle wall before the exit, by tearing off or by being held at a kink. */
export function jetLeftWall(state: ExpansionState): boolean {
  return state === 'separated' || state === 'held';
}

export interface Diverging {
  /** Wall from just after the throat to the lip, x measured from the throat */
  points: WallPoint[];
  /** Length from the throat to the lip, m */
  length: number;
  /** Where a dual bell's wall kinks, x measured from the throat; null for every other type */
  kink: WallPoint | null;
}

const DEG = Math.PI / 180;
/** Points along the throat arc, the bell's curve, the cone's straight wall and a dual bell's outer bell. */
const N_ARC = 8;
const N_BELL = 28;
const N_CONE = 12;
const N_OUTER = 20;
/** A dual bell's outer bell leaves the kink at this times its chord slope and reaches the lip at `OUTER_EXIT`. */
const OUTER_START = 1.4;
const OUTER_EXIT = 0.6;

/** Radius of the throat arc: what real nozzles use (0.382 throat radii), made smaller where it would not fit. */
function arcRadius(rt: number, re: number, turn: number, len: number): number {
  return Math.min(0.382 * rt, (0.25 * len) / Math.sin(turn), (0.25 * (re - rt)) / (1 - Math.cos(turn)));
}

/** Points of the throat arc, from just after the throat to where it has turned through `turn`. */
function throatArc(rt: number, arcR: number, turn: number): WallPoint[] {
  const points: WallPoint[] = [];
  for (let i = 1; i <= N_ARC; i++) {
    const a = (turn * i) / N_ARC;
    points.push({ x: arcR * Math.sin(a), r: rt + arcR * (1 - Math.cos(a)) });
  }
  return points;
}

/** A bell from the throat radius `rt` to `re`, `len` long: steep just after the throat, shallow at the exit. */
function bellWall(rt: number, re: number, len: number): WallPoint[] {
  // Slope of the wall where the bell proper begins, and at the lip.
  const startSlope = (0.72 * (re - rt)) / (0.379 * len);
  const exitSlope = (0.28 * (re - rt)) / (0.621 * len);
  // The wall cannot turn from the throat straight onto that slope: a sharp corner there is not
  // how nozzles are made, and the gas solver marks it with a layer of spoiled gas down the whole
  // wall. It turns along a short arc instead.
  const turn = Math.atan(startSlope);
  const arcR = arcRadius(rt, re, turn, len);
  const points = throatArc(rt, arcR, turn);
  // From the end of the arc, a quadratic Bezier: it leaves along the arc's slope and arrives at
  // the lip along the exit slope, so its middle point is where those two lines cross.
  const ax = arcR * Math.sin(turn);
  const ar = rt + arcR * (1 - Math.cos(turn));
  const p1x = (re - exitSlope * len - ar + startSlope * ax) / (startSlope - exitSlope);
  const p1r = ar + startSlope * (p1x - ax);
  for (let i = 1; i <= N_BELL; i++) {
    const t = i / N_BELL;
    const u = 1 - t;
    points.push({
      x: u * u * ax + 2 * u * t * p1x + t * t * len,
      r: u * u * ar + 2 * u * t * p1r + t * t * re,
    });
  }
  // Guard against any floating-point wobble in the final point.
  points[points.length - 1] = { x: len, r: re };
  return points;
}

/** Length of a bell from `rt` to `re`: `nozzleLenPct` of a 15 degree cone's. */
function bellLength(cfg: EngineConfig, rt: number, re: number): number {
  return (cfg.nozzleLenPct / 100) * ((re - rt) / Math.tan(15 * DEG));
}

/** The wall after the throat. Not for an aerospike, which has its own geometry. */
export function divergingWall(cfg: EngineConfig): Diverging {
  const rt = cfg.throatDia / 2;
  const re = cfg.exitDia / 2;
  switch (cfg.exhaust) {
    case 'bell': {
      const length = bellLength(cfg, rt, re);
      return { points: bellWall(rt, re, length), length, kink: null };
    }
    case 'expansionDeflection': {
      // The ordinary bell, started from the wall of the ring.
      const rw = ringWallRadius(cfg);
      const length = bellLength(cfg, rw, re);
      return { points: bellWall(rw, re, length), length, kink: null };
    }
    case 'cone': {
      // The throat arc turns onto the half-angle, then the wall runs straight to the exit.
      const turn = cfg.coneAngleDeg * DEG;
      const arcR = Math.min(0.382 * rt, (0.25 * (re - rt)) / (1 - Math.cos(turn)));
      const points = throatArc(rt, arcR, turn);
      const ax = arcR * Math.sin(turn);
      const ar = rt + arcR * (1 - Math.cos(turn));
      const length = ax + (re - ar) / Math.tan(turn);
      for (let i = 1; i <= N_CONE; i++) {
        const t = i / N_CONE;
        points.push({ x: ax + (length - ax) * t, r: ar + (re - ar) * t });
      }
      points[points.length - 1] = { x: length, r: re };
      return { points, length, kink: null };
    }
    case 'dualBell': {
      // An ordinary bell to the kink, then a second, wider bell that leaves it more steeply.
      const rk = cfg.innerExitDia / 2;
      const innerLen = bellLength(cfg, rt, rk);
      const points = bellWall(rt, rk, innerLen);
      const kink = points[points.length - 1];
      const outerLen = bellLength(cfg, rk, re);
      const chord = (re - rk) / outerLen;
      // The control point is where the leaving and arriving tangents cross.
      const cx = (re - rk - OUTER_EXIT * chord * outerLen) / ((OUTER_START - OUTER_EXIT) * chord);
      const cr = rk + OUTER_START * chord * cx;
      for (let i = 1; i <= N_OUTER; i++) {
        const t = i / N_OUTER;
        const u = 1 - t;
        points.push({
          x: innerLen + 2 * u * t * cx + t * t * outerLen,
          r: u * u * rk + 2 * u * t * cr + t * t * re,
        });
      }
      const length = innerLen + outerLen;
      points[points.length - 1] = { x: length, r: re };
      return { points, length, kink };
    }
    case 'none':
    case 'aerospike':
      return { points: [], length: 0, kink: null };
  }
}

/** Slope (dr/dx) of the wall at the lip, which the plume leaves along. */
export function lipSlope(cfg: EngineConfig): number {
  switch (cfg.exhaust) {
    case 'bell':
    case 'expansionDeflection':
      return (0.45 * Math.tan((15 * Math.PI) / 180) * 100) / cfg.nozzleLenPct;
    case 'cone':
      return Math.tan(cfg.coneAngleDeg * DEG);
    case 'dualBell': {
      const rk = cfg.innerExitDia / 2;
      const re = cfg.exitDia / 2;
      return (OUTER_EXIT * (re - rk)) / bellLength(cfg, rk, re);
    }
    case 'none':
    case 'aerospike':
      return 0;
  }
}
