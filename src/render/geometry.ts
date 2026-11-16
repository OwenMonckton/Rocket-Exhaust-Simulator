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

  return {
    points,
    chamberEndX: cfg.chamberLen,
    throatX,
    exitX: throatX + bellLen,
    length: throatX + bellLen,
    maxRadius: Math.max(rc, re),
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
  const fit = zoom * Math.min((0.34 * widthPx) / profile.length, (0.55 * heightPx) / (2 * profile.maxRadius));
  // A long engine with a small nozzle (a solid booster) would leave the plume only a few
  // pixels wide, so keep the nozzle exit a sensible size and let the front of the engine
  // run off the left edge instead.
  const exitRadius = profile.points[profile.points.length - 1].r;
  const minExitPx = heightPx * (0.03 + 0.04 * Math.min(zoom, 1));
  const ppm = Math.max(fit, minExitPx / exitRadius);
  const exitLimit = margin + 0.36 * widthPx;
  const originX = Math.min(margin + 0.08 * profile.maxRadius * ppm, exitLimit - profile.length * ppm);
  return { ppm, originX, centreY: heightPx / 2 };
}
