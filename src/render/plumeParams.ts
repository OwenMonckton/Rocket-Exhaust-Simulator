import { SEA_LEVEL_PRESSURE } from '../physics/atmosphere';
import { machFromPressureRatio } from '../physics/nozzle';
import { PROPELLANTS, gasProps, richness } from '../physics/propellants';
import type { EngineConfig, FlightState, RGB, SimResult } from '../physics/types';
import type { SimInputs } from './fluidSim';

export interface PlumeParams {
  /** Exit pressure over ambient pressure, capped to 0.05–400 */
  pressureRatio: number;
  /** Radius the jet settles to, in exit radii: below 1 pinched, above 1 flared */
  settleRadius: number;
  /** 0 at sea level, 1 for the wide soft fan seen in vacuum */
  bloom: number;
  mach: number;
  /** Radius of the jet where it leaves the engine, m */
  exitRadiusM: number;
  /** 0–1 overall brightness */
  intensity: number;
  /** Visible plume length, in exit radii */
  length: number;
  /** Shock diamond spacing, in exit radii */
  diamondSpacing: number;
  /** 0–1 */
  diamondStrength: number;
  /** Where in each shock cell the bright diamond sits: 0.5 pinched plume, 1 flared plume */
  diamondPhase: number;
  turbulence: number;
  core: RGB;
  mid: RGB;
  edge: RGB;
  opacity: number;
  soot: number;
  smoke: number;
  /** Glow where fuel-rich exhaust burns in the surrounding air (simulated plume only) */
  afterburn: number;
  afterburnColor: RGB;
  separated: boolean;
  skyTop: RGB;
  skyBottom: RGB;
  stars: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix3 = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const OX_RICH_TINT: RGB = [0.86, 0.92, 1.0];

const R_AIR = 287.05;
/** One representative air temperature (K); the solver only needs air to be cold and dense next to exhaust. */
const AIR_TEMP = 250;

/** Boundary conditions for the prototype gas simulation, in units of the nozzle exit state. */
export function simInputs(cfg: EngineConfig, r: SimResult, fire: number): SimInputs {
  const g = r.gamma;
  const t0 = 1 + ((g - 1) / 2) * r.exitMach * r.exitMach;
  const exitTemp = r.tc / t0;
  // The solver cannot reach a true vacuum, so the air never gets thinner than 1/400 of the exhaust pressure.
  const pAmb = r.pa > 0 ? clamp(r.pa / r.pe, 1 / 400, 20) : 1 / 400;
  const gasR = gasProps(cfg.propellant, cfg.mixtureRatio).R;
  return {
    gamma: g,
    uExit: r.exitMach * Math.sqrt(g),
    pAmb,
    rhoAmb: (pAmb * gasR * exitTemp) / (R_AIR * AIR_TEMP),
    fire: clamp(fire, 0, 1),
    t0,
    // Slope of the bell wall at the lip (see engineProfile). A jet that has already torn off the wall leaves straighter and more evenly.
    divergence: r.state === 'separated' ? 0.06 : (0.45 * Math.tan((15 * Math.PI) / 180) * 100) / cfg.nozzleLenPct,
    profile: r.state === 'separated' ? 0 : 0.4,
  };
}

/** Turn the physics result into what the plume should look like. `fire` is the 0–1 ignition ramp. */
export function plumeParams(cfg: EngineConfig, r: SimResult, flight: FlightState, fire: number): PlumeParams {
  const prop = PROPELLANTS[cfg.propellant];
  const look = prop.look;
  const paFrac = r.pa / SEA_LEVEL_PRESSURE;
  const pressureRatio = r.pa > 0 ? clamp(r.pe / r.pa, 0.05, 400) : 400;
  const logPr = Math.log(pressureRatio);
  const bloom = clamp(logPr / Math.log(400), 0, 1);
  const settleRadius = clamp(Math.pow(pressureRatio, 0.45), 0.5, 4.5);

  // Fully-expanded jet Mach number sets the shock cell length (Prandtl), compressed for the screen.
  const jetMach = r.pa > 0 ? machFromPressureRatio(r.pa / r.pc, r.gamma) : r.exitMach;
  const diamondSpacing = clamp(1.3 * 2 * settleRadius * Math.sqrt(Math.max(0.1, jetMach * jetMach - 1)) * 0.3, 1.4, 7);
  const mismatch = Math.sqrt(clamp((Math.abs(logPr) - 0.1) / 0.6, 0, 1));
  const diamondStrength = r.pa > 0 ? Math.pow(paFrac, 0.35) * mismatch * (r.state === 'separated' ? 0.6 : 1) : 0;

  const rich = richness(cfg.propellant, cfg.mixtureRatio);
  let core = look.core;
  let mid = look.mid;
  let edge = look.edge;
  let opacity = look.opacity;
  if (rich > 0) {
    mid = mix3(mid, look.richTint, 0.6 * rich);
    edge = mix3(edge, look.richTint, 0.6 * rich);
  } else {
    core = mix3(core, OX_RICH_TINT, -0.5 * rich);
    mid = mix3(mid, OX_RICH_TINT, -0.5 * rich);
    opacity *= 1 + 0.25 * rich;
  }
  // Soot and smoke only billow where there is air to hold them up; in vacuum there is nothing to see.
  const air = Math.pow(paFrac, 0.4);
  const soot = look.soot * clamp(0.4 + 1.2 * rich, 0, 2) * air;

  const throttle = prop.throttleable ? flight.throttle : 1;
  const altM = flight.altitudeKm * 1000;

  return {
    pressureRatio,
    settleRadius,
    bloom,
    mach: r.exitMach,
    exitRadiusM: r.effectiveExitDia / 2,
    intensity: clamp(fire, 0, 1) * (0.55 + 0.45 * throttle),
    length: (10 + 8 * look.opacity) * (0.7 + 0.3 * throttle) * (1 - 0.35 * bloom) * (0.25 + 0.75 * clamp(fire, 0, 1)),
    diamondSpacing,
    diamondStrength,
    diamondPhase: pressureRatio < 1 ? 0.5 : 1,
    turbulence: 0.35 + 0.65 * Math.sqrt(paFrac) + (r.state === 'separated' ? 0.5 : 0) + (r.rough ? 0.3 : 0) + 0.5 * r.shudder,
    core,
    mid,
    edge,
    opacity,
    soot,
    smoke: look.smoke * air,
    afterburn: look.afterburnStrength * clamp(0.35 + 0.9 * rich, 0, 1.2) * Math.sqrt(paFrac),
    afterburnColor: look.afterburn,
    separated: r.state === 'separated',
    skyTop: mix3([0.16, 0.38, 0.74], [0.0, 0.0, 0.015], smooth(0, 45000, altM)),
    skyBottom: mix3([0.56, 0.74, 0.93], [0.008, 0.01, 0.03], smooth(4000, 60000, altM)),
    stars: smooth(25000, 70000, altM),
  };
}
