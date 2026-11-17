import type { EngineConfig } from '../physics/types';

export interface ProfilePoint {
  /** Distance from the injector face, m */
  x: number;
  /** Inner wall radius, m */
  r: number;
}

export interface EngineProfile {
  points: ProfilePoint[];
  chamberEndX: number;
  throatX: number;
  exitX: number;
  length: number;
  maxRadius: number;
  /**
   * Centreline offsets (m) of the chambers that are drawn. A multi-chamber engine shows two,
   * side by side; the rest are hidden behind them.
   */
  offsets: number[];
  /** Half the height of everything drawn, m */
  halfHeight: number;
  /** Space needed ahead of the injector face for a shared turbopump or a stowed nozzle extension, m */
  frontSpace: number;
  /** Present when the nozzle has a deployable extension */
  extension: NozzleExtension | null;
}

export interface NozzleExtension {
  /** Where the extension seats: the exit of the fixed nozzle */
  seam: ProfilePoint;
  /** The fixed nozzle's contour, from the injector face to the seam */
  fixedPoints: ProfilePoint[];
  /** The extension's contour in its seated position, from the seam to the exit */
  points: ProfilePoint[];
  /** Axial length of the extension, m */
  length: number;
  /** How far forward of its seated position it currently sits, m (0 when seated) */
  shift: number;
  /** Slope (dr/dx) of the nozzle wall at the seam */
  seamSlope: number;
}

export interface View {
  /** Pixels per metre */
  ppm: number;
  /** Screen x of the injector face */
  originX: number;
  /** Screen y of the engine centreline */
  centreY: number;
}

const DEG = Math.PI / 180;

/** Inner wall contour: cylinder, smooth converging section, parabolic bell. */
export function engineProfile(cfg: EngineConfig): EngineProfile {
  const rc = cfg.chamberDia / 2;
  const rt = cfg.throatDia / 2;
  const re = cfg.exitDia / 2;
  const points: ProfilePoint[] = [
    { x: 0, r: rc },
    { x: cfg.chamberLen, r: rc },
  ];

  const convLen = Math.max((rc - rt) / Math.tan(30 * DEG), 0.15 * rt);
  const N_CONV = 14;
  for (let i = 1; i <= N_CONV; i++) {
    const t = i / N_CONV;
    points.push({ x: cfg.chamberLen + convLen * t, r: rt + (rc - rt) * (0.5 + 0.5 * Math.cos(Math.PI * t)) });
  }
  const throatX = cfg.chamberLen + convLen;

  // Quadratic Bezier bell: steep just after the throat, shallow at the exit.
  const bellLen = (cfg.nozzleLenPct / 100) * ((re - rt) / Math.tan(15 * DEG));
  const p1x = 0.379 * bellLen;
  const p1r = rt + 0.72 * (re - rt);
  const N_BELL = 28;
  for (let i = 1; i <= N_BELL; i++) {
    const t = i / N_BELL;
    const u = 1 - t;
    points.push({
      x: throatX + 2 * u * t * p1x + t * t * bellLen,
      r: u * u * rt + 2 * u * t * p1r + t * t * re,
    });
  }
  // Guard against any floating-point wobble in the final point.
  points[points.length - 1] = { x: throatX + bellLen, r: re };

  // Chambers of a multi-chamber engine sit just far enough apart for their nozzles to clear.
  const multi = cfg.chambers > 1;
  const pitch = 1.18 * 2 * Math.max(rc, re);

  // Deployable extension: split the bell where the fixed nozzle ends. Stowed, the extension
  // sits forward by its own length, wrapped around the engine.
  let extension: NozzleExtension | null = null;
  const fixedR = cfg.extFixedDia / 2;
  if (fixedR > rt && fixedR < re) {
    const i = points.findIndex((p) => p.x > throatX && p.r >= fixedR);
    if (i > 0) {
      const a = points[i - 1];
      const b = points[i];
      const f = (fixedR - a.r) / Math.max(1e-12, b.r - a.r);
      const seam = { x: a.x + (b.x - a.x) * f, r: fixedR };
      const length = throatX + bellLen - seam.x;
      extension = {
        seam,
        fixedPoints: [...points.slice(0, i), seam],
        points: [seam, ...points.slice(i)],
        length,
        shift: (1 - cfg.extDeploy) * length,
        seamSlope: (b.r - a.r) / Math.max(1e-12, b.x - a.x),
      };
    }
  }
  const stowedOverhang = extension ? Math.max(0, extension.length - extension.seam.x) + 0.1 * re : 0;

  return {
    points,
    extension,
    chamberEndX: cfg.chamberLen,
    throatX,
    exitX: throatX + bellLen,
    length: throatX + bellLen,
    maxRadius: Math.max(rc, re),
    offsets: multi ? [-pitch / 2, pitch / 2] : [0],
    halfHeight: Math.max(rc, re) + (multi ? pitch / 2 : 0),
    frontSpace: Math.max(multi ? 0.75 * pitch : 0, stowedOverhang),
  };
}

/** Inner wall radius at a distance x along the engine. */
export function radiusAt(profile: EngineProfile, x: number): number {
  const p = profile.points;
  if (x <= p[0].x) return p[0].r;
  for (let i = 1; i < p.length; i++) {
    if (x <= p[i].x) {
      const f = (x - p[i - 1].x) / Math.max(1e-12, p[i].x - p[i - 1].x);
      return p[i - 1].r + (p[i].r - p[i - 1].r) * f;
    }
  }
  return p[p.length - 1].r;
}

/** Fit the engine into the left part of the stage, leaving room for the plume. Zoom below 1 shrinks the engine to show more plume. */
export function viewTransform(profile: EngineProfile, widthPx: number, heightPx: number, zoom = 1): View {
  // The injector head and feed lines sit behind x = 0, so reserve some margin for them.
  const margin = 0.06 * widthPx;
  const fit =
    zoom * Math.min((0.34 * widthPx) / (profile.length + profile.frontSpace), (0.55 * heightPx) / (2 * profile.halfHeight));
  // A long engine with a small nozzle (a solid booster) would leave the plume only a few
  // pixels wide, so keep the nozzle exit a sensible size and let the front of the engine
  // run off the left edge instead.
  const exitRadius = profile.points[profile.points.length - 1].r;
  const minExitPx = heightPx * (0.03 + 0.04 * Math.min(zoom, 1));
  const ppm = Math.max(fit, minExitPx / exitRadius);
  const exitLimit = margin + 0.36 * widthPx;
  const originX = Math.min(
    margin + (0.08 * profile.maxRadius + profile.frontSpace) * ppm,
    exitLimit - profile.length * ppm,
  );
  return { ppm, originX, centreY: heightPx / 2 };
}

/** A solid motor's grain stops this fraction of the way along the case. */
export const GRAIN_END = 0.97;

/**
 * Radius of the bore through a solid motor's grain at a distance x along the case, or Infinity
 * past the end of the grain. The bore is a cone: a narrow point at the head of the motor,
 * opening out toward the nozzle. The flame front is the surface of that cone.
 *
 * `burnt` runs from 0 (a freshly cast grain) to 1 (nothing left). The grain burns back from
 * its surface at the same rate everywhere, so the whole cone widens, reaching the case wall
 * first at the nozzle end and last at the head. Where the result is at least the case radius,
 * the grain there is gone.
 */
export function grainBore(cfg: EngineConfig, x: number, burnt = 0): number {
  const rc = cfg.chamberDia / 2;
  const end = cfg.chamberLen * GRAIN_END;
  if (x >= end) return Infinity;
  const tip = 0.07 * rc;
  // Never narrower at its mouth than the throat, or the bore would choke the flow instead.
  const mouth = Math.min(0.9 * rc, Math.max(0.4 * rc, 0.6 * cfg.throatDia));
  // The last of the grain is cut back to the case wall instead of ending in a square step.
  const chamfer = Math.min(0.3 * rc, 0.15 * end);
  const coneEnd = end - chamfer;
  const burnedBack = Math.min(1, Math.max(0, burnt)) * 0.95 * rc;
  if (x <= coneEnd) return tip + (mouth - tip) * Math.max(0, x / coneEnd) + burnedBack;
  const t = (x - coneEnd) / chamfer;
  return mouth + (rc - mouth) * t * t * (3 - 2 * t) + burnedBack;
}

/** How much of a solid motor's propellant is left, as a fraction of a fresh grain. */
export function grainLeft(cfg: EngineConfig, burnt: number): number {
  const rc = cfg.chamberDia / 2;
  const end = cfg.chamberLen * GRAIN_END;
  const N = 60;
  let left = 0;
  let fresh = 0;
  for (let i = 0; i < N; i++) {
    const x = ((i + 0.5) / N) * end;
    left += Math.max(0, rc * rc - Math.min(rc, grainBore(cfg, x, burnt)) ** 2);
    fresh += rc * rc - Math.min(rc, grainBore(cfg, x, 0)) ** 2;
  }
  return fresh > 0 ? left / fresh : 0;
}