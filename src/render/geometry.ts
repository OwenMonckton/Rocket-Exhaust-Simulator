import { areaRatio, machFromAreaRatio } from '../physics/nozzle';
import { gasFor } from '../physics/engine';
import { EXHAUSTS, divergingWall, ringWallRadius } from '../physics/exhausts';
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
  /**
   * Present for an aerospike. `points` is then just the jet's design outline, from the lip to
   * the spike's base, `throatX` the lip and `exitX` the base.
   */
  spike: SpikeGeometry | null;
  /** Where a dual bell's wall kinks; null for every other exhaust */
  kink: ProfilePoint | null;
  /** The plug in the throat of an expansion-deflection nozzle; null for every other exhaust */
  plug: PlugGeometry | null;
}

/**
 * The plug of an expansion-deflection nozzle: a stalk down the middle of the chamber that flares
 * out to a flat-backed rim at the throat. The gas passes through the ring between rim and wall.
 */
export interface PlugGeometry {
  /** x of the plug's flat back, which is the plane of the ring (the profile's `throatX`) */
  baseX: number;
  /** Radius of the rim, m */
  rimR: number;
  /** Where the stalk starts, back in the chamber, and its radius */
  stalkX: number;
  stalkR: number;
  /** Where the stalk begins to flare out to the rim */
  flareX: number;
}

/** Radius of the plug at x: nothing ahead of the stalk or behind the flat back. */
export function plugRadius(plug: PlugGeometry, x: number): number {
  if (x < plug.stalkX || x > plug.baseX) return 0;
  if (x <= plug.flareX) return plug.stalkR;
  const t = (x - plug.flareX) / (plug.baseX - plug.flareX);
  return plug.stalkR + (plug.rimR - plug.stalkR) * t;
}

export interface SpikePoint extends ProfilePoint {
  /** Mach number of the flow along the spike surface here */
  mach: number;
}

/**
 * Cross-section through an aerospike: one thrust cell above the axis (mirrored below), tilted
 * in towards the spike it fires along.
 */
export interface SpikeGeometry {
  /** Outer lip of the cell exit, where the jet's free outer edge begins */
  lip: ProfilePoint;
  /** Spike surface from the inner edge of the cell exit to the flat base */
  contour: SpikePoint[];
  /** Where the spike is cut off */
  base: ProfilePoint;
  /** How far a full-length spike would run from the lip before coming to a point, m */
  fullLength: number;
  cell: ThrustCell;
}

export interface ThrustCell {
  /** Centre of the injector face */
  origin: ProfilePoint;
  /** Inward tilt of the cell's axis from the engine axis, radians */
  tilt: number;
  /**
   * Inner wall contour in the cell's own frame, seen from the side: `x` along its axis from the
   * injector face, `r` half the height of the passage. The chamber and throat are round; past
   * the throat the nozzle flattens into a slot, so its height there says nothing about its area.
   */
  points: ProfilePoint[];
  /** Radius of the round throat, m */
  throatR: number;
  chamberEndS: number;
  throatS: number;
  exitS: number;
  /** Area ratio at the cell exit, where the spike takes over */
  exitAreaRatio: number;
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

/** Inner wall contour: cylinder, smooth converging section, then the exhaust's diverging wall. */
export function engineProfile(cfg: EngineConfig): EngineProfile {
  if (cfg.exhaust === 'aerospike') return aerospikeProfile(cfg);
  const rc = cfg.chamberDia / 2;
  // The wall's radius at the throat: wider than a plain throat where a plug fills its middle.
  const rt = ringWallRadius(cfg);
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

  // The diverging wall, if there is one: a bell, a cone or a dual bell.
  const wall = divergingWall(cfg);
  for (const p of wall.points) points.push({ x: throatX + p.x, r: p.r });
  const exitX = throatX + wall.length;
  const kink = wall.kink ? { x: throatX + wall.kink.x, r: wall.kink.r } : null;
  // With no nozzle the engine ends at its throat.
  const lipR = EXHAUSTS[cfg.exhaust].hasNozzle ? re : rt;

  // An expansion-deflection nozzle's plug: its rim fills the middle of the throat, and it flares
  // out to there over a length of about its own width from a thin stalk.
  let plug: PlugGeometry | null = null;
  if (cfg.exhaust === 'expansionDeflection') {
    const rimR = cfg.plugShare * rt;
    const flareX = Math.max(throatX - 1.5 * rimR, 0.5 * throatX);
    plug = { baseX: throatX, rimR, stalkX: 0.3 * flareX, stalkR: 0.3 * rimR, flareX };
  }

  // Chambers of a multi-chamber engine sit just far enough apart for their nozzles to clear.
  const multi = cfg.chambers > 1;
  const pitch = 1.18 * 2 * Math.max(rc, lipR);

  // Deployable extension: split the bell where the fixed nozzle ends. Stowed, the extension
  // sits forward by its own length, wrapped around the engine.
  let extension: NozzleExtension | null = null;
  const fixedR = cfg.extFixedDia / 2;
  if (EXHAUSTS[cfg.exhaust].extension && fixedR > rt && fixedR < re) {
    const i = points.findIndex((p) => p.x > throatX && p.r >= fixedR);
    if (i > 0) {
      const a = points[i - 1];
      const b = points[i];
      const f = (fixedR - a.r) / Math.max(1e-12, b.r - a.r);
      const seam = { x: a.x + (b.x - a.x) * f, r: fixedR };
      const length = exitX - seam.x;
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
    exitX,
    length: exitX,
    maxRadius: Math.max(rc, lipR),
    offsets: multi ? [-pitch / 2, pitch / 2] : [0],
    halfHeight: Math.max(rc, lipR) + (multi ? pitch / 2 : 0),
    frontSpace: Math.max(multi ? 0.75 * pitch : 0, stowedOverhang),
    spike: null,
    kink,
    plug,
  };
}

/** Prandtl–Meyer angle: how far supersonic flow has turned to reach a Mach number, radians. */
export function prandtlMeyer(mach: number, g: number): number {
  const k = Math.sqrt((g + 1) / (g - 1));
  const b = Math.sqrt(Math.max(0, mach * mach - 1));
  return k * Math.atan(b / k) - Math.atan(b);
}

/** Largest inward tilt of the thrust cells. The cells do the first part of the expansion themselves. */
const CELL_TILT = 40 * DEG;
const SPIKE_SAMPLES = 40;

/**
 * Aerospike geometry. The spike contour is Angelino's approximation of an ideal plug: each Mach
 * line fanning out from the lip ends on the spike where the flow crossing it has the area its
 * Mach number needs. Thrust cells tilted in by up to `CELL_TILT` deliver gas already partly
 * expanded, and the spike is cut off flat according to `nozzleLenPct`.
 */
function aerospikeProfile(cfg: EngineConfig): EngineProfile {
  const g = gasFor(cfg).gas.gamma;
  // The whole engine's flow leaves across a circle n times one cell's share of the exit area.
  const lipR = (Math.sqrt(cfg.chambers) * cfg.exitDia) / 2;
  const eps = (cfg.exitDia / cfg.throatDia) ** 2;
  const exitMach = machFromAreaRatio(eps, g);
  const nuExit = prandtlMeyer(exitMach, g);
  const tilt = Math.min(CELL_TILT, 0.6 * nuExit);

  // Mach number leaving the cells: the flow still has `tilt` left to turn along the spike.
  let lo = 1;
  let hi = exitMach;
  for (let i = 0; i < 50; i++) {
    const mid = 0.5 * (lo + hi);
    if (prandtlMeyer(mid, g) < nuExit - tilt) lo = mid;
    else hi = mid;
  }
  const cellMach = 0.5 * (lo + hi);
  const cellEps = areaRatio(cellMach, g);

  // Spike surface, measured from the lip.
  const raw: SpikePoint[] = [];
  for (let i = 0; i <= SPIKE_SAMPLES; i++) {
    const t = i / SPIKE_SAMPLES;
    const mach = cellMach + (exitMach - cellMach) * t;
    const mu = Math.asin(1 / mach);
    const alpha = nuExit - prandtlMeyer(mach, g) + mu;
    const share = (areaRatio(mach, g) / eps) * (Math.sin(alpha) / Math.sin(mu));
    const r = lipR * Math.sqrt(Math.max(0, 1 - share));
    raw.push({ x: (lipR - r) / Math.tan(alpha), r, mach });
  }
  raw[raw.length - 1].r = 0;
  const fullLength = raw[raw.length - 1].x;

  // The cells' exit is a thin slot running round the lip, square to the flow. Its height is what
  // the gas needs at the cell's exit Mach number: the first Mach line from the lip, seen at its
  // Mach angle. With the cell tilted in, the slot's inner edge sits a little forward of the lip.
  const firstMu = Math.asin(1 / cellMach);
  const exitH = Math.hypot(raw[0].x, lipR - raw[0].r) * Math.sin(firstMu);
  const inner = { x: -exitH * Math.sin(tilt), r: lipR - exitH * Math.cos(tilt) };

  // Each cell has a round chamber and throat, and a nozzle that flattens into its share of the
  // slot, so seen from the side it can narrow towards the exit while its area still grows.
  const rc = cfg.chamberDia / 2;
  const rt = cfg.throatDia / 2;
  const convLen = Math.max((rc - rt) / Math.tan(30 * DEG), 0.15 * rt);
  const divLen = Math.max(((Math.sqrt(cellEps) - 1) * rt) / Math.tan(15 * DEG), 2 * rt);
  const throatS = cfg.chamberLen + convLen;
  const exitS = throatS + divLen;
  const cellPts: ProfilePoint[] = [
    { x: 0, r: rc },
    { x: cfg.chamberLen, r: rc },
  ];
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    cellPts.push({ x: cfg.chamberLen + convLen * t, r: rt + (rc - rt) * (0.5 + 0.5 * Math.cos(Math.PI * t)) });
  }
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    cellPts.push({ x: throatS + divLen * t, r: rt + (exitH / 2 - rt) * t * t * (3 - 2 * t) });
  }

  // The cell's axis points down the flow, tilted in towards the spike.
  const exitMid = { x: -0.5 * exitH * Math.sin(tilt), r: lipR - 0.5 * exitH * Math.cos(tilt) };
  const injector = { x: exitMid.x - exitS * Math.cos(tilt), r: exitMid.r + exitS * Math.sin(tilt) };
  // The lower corner of the injector face is the furthest-forward part of the engine.
  const shift = -(injector.x - rc * Math.sin(tilt));

  // The spike's surface begins at the slot's inner edge. It runs straight, along the flow, as far
  // as the first Mach line from the lip, then follows Angelino's contour.
  const surface: SpikePoint[] = [{ ...inner, mach: cellMach }, ...raw];
  // Cut the spike off where `nozzleLenPct` says: 60 % keeps a fifth of it, 100 % all of it.
  const keep = 0.2 + (0.8 * (cfg.nozzleLenPct - 60)) / 40;
  const cutX = Math.max(inner.x + 1e-6, keep * fullLength);
  const contour: SpikePoint[] = [surface[0]];
  for (let i = 1; i < surface.length; i++) {
    const a = surface[i - 1];
    const b = surface[i];
    if (b.x >= cutX) {
      const f = Math.min(1, Math.max(0, (cutX - a.x) / Math.max(1e-12, b.x - a.x)));
      contour.push({ x: cutX, r: a.r + (b.r - a.r) * f, mach: a.mach + (b.mach - a.mach) * f });
      break;
    }
    contour.push(b);
  }
  const moved = contour.map((p) => ({ ...p, x: p.x + shift }));
  const base = moved[moved.length - 1];
  const lip = { x: shift, r: lipR };
  const top = injector.r + rc * Math.cos(tilt);

  return {
    points: [lip, { x: base.x, r: lipR }],
    chamberEndX: lip.x,
    throatX: lip.x,
    exitX: base.x,
    length: base.x,
    maxRadius: lipR,
    offsets: [0],
    halfHeight: Math.max(lipR, top),
    frontSpace: 0,
    extension: null,
    kink: null,
    plug: null,
    spike: {
      lip,
      contour: moved,
      base: { x: base.x, r: base.r },
      fullLength,
      cell: {
        origin: { x: injector.x + shift, r: injector.r },
        tilt,
        points: cellPts,
        throatR: rt,
        chamberEndS: cfg.chamberLen,
        throatS,
        exitS,
        exitAreaRatio: cellEps,
      },
    },
  };
}

/**
 * Outer radius (m) of an aerospike's jet at a point along the spike, where the spike's surface
 * is at `spikeR`. The gas flows in a ring around the spike. At the design altitude its outer
 * edge runs straight back from the lip; below it, the air squeezes the jet's flow area down, and
 * the ring fills that same share of the space between the spike and the lip's radius. Behind the
 * base it closes over a pocket of slower gas that travels with it.
 */
export function spikeJetRadius(cfg: EngineConfig, effectiveExitDia: number, spikeR: number): number {
  const lipR = (Math.sqrt(cfg.chambers) * cfg.exitDia) / 2;
  const share = Math.min(1, (effectiveExitDia / cfg.exitDia) ** 2);
  return Math.sqrt(spikeR * spikeR + share * (lipR * lipR - spikeR * spikeR));
}

/**
 * Radius (m) of the spike's surface at a distance x along the engine. Forward of where the
 * surface begins it keeps the radius it begins at; behind the base there is nothing, so 0.
 */
export function spikeSurfaceRadius(spike: SpikeGeometry, x: number): number {
  const c = spike.contour;
  if (x <= c[0].x) return c[0].r;
  for (let i = 1; i < c.length; i++) {
    if (x <= c[i].x) {
      const f = (x - c[i - 1].x) / Math.max(1e-12, c[i].x - c[i - 1].x);
      return c[i - 1].r + (c[i].r - c[i - 1].r) * f;
    }
  }
  return 0;
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

/** What to say under a solid motor about its grain. */
export function grainLabel(cfg: EngineConfig, burnt: number): string {
  const left = grainLeft(cfg, burnt);
  return left > 0.005 ? `Propellant left: ${Math.round(left * 100)}%` : 'Burnt out. Fire loads a fresh motor.';
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