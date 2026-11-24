import { SEA_LEVEL_PRESSURE } from '../physics/atmosphere';
import { machFromAreaRatio, machFromPressureRatio, pressureRatio } from '../physics/nozzle';
import { ENERGY_SOURCES } from '../physics/parts';
import { jetLeftWall, lipSlope } from '../physics/exhausts';
import { resolveGas } from '../physics/gasSource';
import type { EngineConfig, FlightState, RGB, SimResult } from '../physics/types';
import { SPIKE_SAMPLES, type SimInputs } from './fluidSim';
import { engineProfile, spikeJetRadius, spikeSurfaceRadius, type SpikeGeometry } from './geometry';

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
  /** Glowing particles in the exhaust, which stay bright where plain gas would cool and fade (simulated plume only) */
  particles: number;
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

/**
 * The solver cannot reach a true vacuum: the surroundings never get thinner than this fraction of
 * the exhaust's exit pressure. The lower it is, the further each plume can fan out before the
 * leftover gas hems it in, and the more the engines differ from one another in vacuum.
 */
export const VACUUM_FLOOR = 1 / 20000;

const R_AIR = 287.05;
/** One representative air temperature (K); the solver only needs air to be cold and dense next to exhaust. */
const AIR_TEMP = 250;

/** The gas as it leaves a fixed nozzle that has a deployable extension, whatever the extension is doing. */
export interface FixedExitFlow {
  radiusM: number;
  mach: number;
  /** Pa */
  pressure: number;
  /** True when the jet tore off the wall before reaching the end of the fixed nozzle */
  separated: boolean;
}

/**
 * Null for an ordinary one-piece nozzle. With `wholeNozzle`, the gas as it would leave if it
 * filled the nozzle, whether or not the jet has really torn off the wall: for when the gas
 * simulation is left to work that out for itself.
 */
export function fixedExitFlow(cfg: EngineConfig, r: SimResult, wholeNozzle = false): FixedExitFlow | null {
  if (!(cfg.extFixedDia > 0)) return null;
  const fixedR = cfg.extFixedDia / 2;
  if (!wholeNozzle && jetLeftWall(r.state) && r.effectiveExitDia / 2 < fixedR * 0.999) {
    return { radiusM: r.effectiveExitDia / 2, mach: r.exitMach, pressure: r.pe, separated: true };
  }
  const mach = machFromAreaRatio((cfg.extFixedDia / cfg.throatDia) ** 2, r.gamma);
  return { radiusM: fixedR, mach, pressure: r.pc * pressureRatio(mach, r.gamma), separated: false };
}

/**
 * Pressure of the still gas filling the engine's grid before it fires, over chamber pressure:
 * the outside air, but never a true vacuum, which the solver cannot hold. In vacuum it is a
 * fraction of the pressure the gas leaves at, and no more than 3% of the chamber's. Without
 * that limit an engine with no nozzle, whose gas leaves at about half the chamber pressure, began
 * full of cold gas some ten times as dense as its flame; a big chamber took thousands of frames
 * to clear it, and the simulated figures were far out all that time. `exitPressure` is over
 * chamber pressure too.
 */
export function engineRestPressure(exitPressure: number, pa: number, pc: number): number {
  return Math.min(0.3, Math.max(Math.min(0.03, 0.3 * exitPressure), pa / pc));
}

/**
 * The gas as it would leave a one-piece nozzle if it filled it all the way to the exit. With no
 * nozzle that is the throat.
 */
export function wholeNozzleFlow(r: SimResult): FixedExitFlow {
  const mach = machFromAreaRatio(r.expansionRatio, r.gamma);
  return { radiusM: r.flowExitDia / 2, mach, pressure: r.pc * pressureRatio(mach, r.gamma), separated: false };
}

/**
 * Boundary conditions for the gas simulation, in units of the state where the gas enters it.
 * That is the nozzle exit, or with `start` the exit of a fixed nozzle whose extension the
 * simulation then treats as a solid wall.
 */
export function simInputs(
  cfg: EngineConfig,
  r: SimResult,
  fire: number,
  start?: { flow: FixedExitFlow; wallSlope?: number },
): SimInputs {
  const g = r.gamma;
  const mach = start ? start.flow.mach : r.exitMach;
  const pressure = start ? start.flow.pressure : r.pe;
  const separated = start ? start.flow.separated : jetLeftWall(r.state);
  const t0 = 1 + ((g - 1) / 2) * mach * mach;
  const exitTemp = r.tc / t0;
  // The top of the range is a badly over-expanded nozzle at sea level: outside air at a hundred
  // times the pressure the exhaust would leave at.
  const pAmb = r.pa > 0 ? clamp(r.pa / pressure, VACUUM_FLOOR, 150) : VACUUM_FLOOR;
  const gasR = resolveGas(cfg, r.pc / 1e5, r.expansionRatio).gas.R;
  // Slope of the wall at the lip (see engineProfile). An aerospike's jet leaves its base running
  // straight back, the spike having already turned it, and with no nozzle the gas leaves the
  // throat straight back too.
  const wallSlope = start?.wallSlope ?? lipSlope(cfg);
  return {
    gamma: g,
    uExit: mach * Math.sqrt(g),
    pAmb,
    // Air is denser than hot exhaust at the same pressure. The ratio is capped: against an
    // exhaust as hot and thin as a nuclear salt-water rocket's, true air would be thousands of
    // times denser and the plume would take minutes to push through it.
    rhoAmb: pAmb * Math.min(30, (gasR * exitTemp) / (R_AIR * AIR_TEMP)),
    fire: clamp(fire, 0, 1),
    t0,
    // A jet that has already left the wall leaves straighter and more evenly.
    divergence: separated ? 0.06 : wallSlope,
    profile: separated ? 0 : 0.4,
    // Set by the caller from the engine's drawn contour; a straight cone until then.
    wallCurve: 0,
  };
}
/**
 * Boundary conditions for simulating an aerospike. The simulation's origin is the plane of the
 * lip and its unit of length the lip's radius. It is given the spike's shape and the gas as it
 * leaves the thrust cells; everything from there on, it works out for itself.
 */
export function spikeSimInputs(cfg: EngineConfig, r: SimResult, fire: number, spike: SpikeGeometry): SimInputs {
  const lipR = spike.lip.r;
  // The gas leaving the cells: part-expanded, at the Mach number the spike's surface starts from.
  const mach = spike.contour[0].mach;
  const flow = { radiusM: lipR, mach, pressure: r.pc * pressureRatio(mach, r.gamma), separated: false };
  const length = spike.base.x - spike.lip.x;
  const radii: number[] = [];
  for (let i = 0; i < SPIKE_SAMPLES; i++) {
    radii.push(spikeSurfaceRadius(spike, spike.lip.x + (i / (SPIKE_SAMPLES - 1)) * length) / lipR);
  }
  // The last point is the edge of the flat base, not the nothing behind it.
  radii[SPIKE_SAMPLES - 1] = spike.base.r / lipR;
  // How much further the whole spike would expand the gas.
  const g = r.gamma;
  const expansion = pressureRatio(machFromAreaRatio(r.expansionRatio, g), g) / pressureRatio(mach, g);
  return {
    ...simInputs(cfg, r, fire, { flow, wallSlope: 0 }),
    // The cells deliver the same gas all the way across the ring.
    profile: 0,
    spike: {
      radii,
      length: length / lipR,
      tilt: spike.cell.tilt,
      designDensity: Math.pow(expansion, 1 / g),
      designTemp: Math.pow(expansion, (g - 1) / g),
    },
  };
}

/** Turn the physics result into what the plume should look like. `fire` is the 0–1 ignition ramp. */
export function plumeParams(cfg: EngineConfig, r: SimResult, flight: FlightState, fire: number): PlumeParams {
  const gasSource = resolveGas(cfg, r.pc / 1e5, r.expansionRatio);
  const look = gasSource.look;
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

  const rich = gasSource.richness;
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

  const throttle = ENERGY_SOURCES[cfg.energy].throttleable ? flight.throttle : 1;
  const altM = flight.altitudeKm * 1000;

  return {
    pressureRatio,
    settleRadius,
    bloom,
    mach: r.exitMach,
    // An aerospike's cells all feed one jet, wrapped around the spike's flat base.
    exitRadiusM: cfg.exhaust === 'aerospike'
      ? spikeJetRadius(cfg, r.effectiveExitDia, engineProfile(cfg).spike!.base.r)
      : r.effectiveExitDia / 2,
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
    particles: look.particles * (rich > 0 ? 1 : 1 + 0.6 * rich),
    separated: jetLeftWall(r.state),
    skyTop: mix3([0.16, 0.38, 0.74], [0.0, 0.0, 0.015], smooth(0, 45000, altM)),
    skyBottom: mix3([0.56, 0.74, 0.93], [0.008, 0.01, 0.03], smooth(4000, 60000, altM)),
    stars: smooth(25000, 70000, altM),
  };
}
