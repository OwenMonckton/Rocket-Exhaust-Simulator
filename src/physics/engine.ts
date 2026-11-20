import { SEA_LEVEL_PRESSURE, ambientPressure } from './atmosphere';
import { computeLimits, failureFor } from './limits';
import {
  areaRatio,
  cStar,
  exitVelocity,
  machFromAreaRatio,
  machFromPressureRatio,
  pressureRatio,
} from './nozzle';
import { ENERGY_SOURCES, isEnergyId, isExhaustId, propellantsFor } from './parts';
import { PROPELLANTS, clampMixture, gasProps, isPropellantId } from './propellants';
import type { EngineConfig, ExpansionState, FlightState, SimResult } from './types';

const G0 = 9.80665;
/** Baseline combustion efficiency of a well-sized chamber. */
const BASE_COMBUSTION_EFF = 0.98;
/** Lumped real-world thrust losses (boundary layer, chemistry lag). */
const THRUST_EFF = 1.0;
/** Schmucker separation criterion multiplier, tuned so the RS-25 stays attached at sea level. */
const SEPARATION_K = 0.62;
/**
 * Below its design altitude, the share an aerospike recovers of the gap between a bell of the
 * same size (separated flow and all) and a nozzle perfectly matched to the air. Tuned to the
 * XRS-2200's sea-level Isp, where it leaves the spike about 4.5 % short of a perfect match.
 */
const AEROSPIKE_COMPENSATION = 0.7;

export interface Range {
  min: number;
  max: number;
  fallback: number;
}

export const RANGES = {
  chamberDia: { min: 0.05, max: 8, fallback: 0.4 },
  chamberLen: { min: 0.05, max: 40, fallback: 0.5 },
  throatDia: { min: 0.02, max: 5, fallback: 0.2 },
  exitDia: { min: 0.03, max: 25, fallback: 0.8 },
  nozzleLenPct: { min: 60, max: 100, fallback: 80 },
  wall: { min: 0.0002, max: 2, fallback: 0.01 },
  chamberPressureBar: { min: 5, max: 400, fallback: 100 },
  scale: { min: 0.25, max: 5, fallback: 1 },
  chambers: { min: 1, max: 4, fallback: 1 },
  /** An aerospike's thrust cells, which all feed one spike */
  cells: { min: 1, max: 40, fallback: 20 },
  extFixedDia: { min: 0, max: 25, fallback: 0 },
  extDeploy: { min: 0, max: 1, fallback: 1 },
  altitudeKm: { min: 0, max: 100, fallback: 0 },
  throttle: { min: 0.4, max: 1, fallback: 1 },
} satisfies Record<string, Range>;

function clampTo(v: unknown, r: Range): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return r.fallback;
  return Math.min(r.max, Math.max(r.min, v));
}

/** Force a config into a physically drawable, computable shape. Never throws. */
export function sanitize(cfg: EngineConfig): EngineConfig {
  // The three parts always agree: a source the engine doesn't know is worked out from the
  // propellant, and a propellant the source can't use is swapped for its first one.
  const known = isPropellantId(cfg.propellant) ? cfg.propellant : null;
  const energy = isEnergyId(cfg.energy) ? cfg.energy : known ? PROPELLANTS[known].energy : 'combustion';
  const propellant = known && PROPELLANTS[known].energy === energy ? known : propellantsFor(energy)[0];
  const chamberDia = clampTo(cfg.chamberDia, RANGES.chamberDia);
  const throatDia = Math.min(clampTo(cfg.throatDia, RANGES.throatDia), 0.9 * chamberDia);
  const exitDia = Math.max(clampTo(cfg.exitDia, RANGES.exitDia), 1.05 * throatDia);
  // An extension must be wider than the throat and narrower than the full nozzle; otherwise there isn't one.
  // An aerospike has no bell to extend.
  const exhaust = isExhaustId(cfg.exhaust) ? cfg.exhaust : 'bell';
  const aerospike = exhaust === 'aerospike';
  let extFixedDia = clampTo(cfg.extFixedDia, RANGES.extFixedDia);
  if (aerospike || extFixedDia < 1.05 * throatDia || extFixedDia > 0.98 * exitDia) extFixedDia = 0;
  return {
    presetId: typeof cfg.presetId === 'string' ? cfg.presetId : null,
    energy,
    exhaust,
    propellant,
    chamberDia,
    chamberLen: clampTo(cfg.chamberLen, RANGES.chamberLen),
    throatDia,
    exitDia,
    nozzleLenPct: clampTo(cfg.nozzleLenPct, RANGES.nozzleLenPct),
    wall: clampTo(cfg.wall, RANGES.wall),
    chamberPressureBar: clampTo(cfg.chamberPressureBar, RANGES.chamberPressureBar),
    mixtureRatio: clampMixture(propellant, cfg.mixtureRatio),
    scale: clampTo(cfg.scale, RANGES.scale),
    chambers: Math.round(clampTo(cfg.chambers, aerospike ? RANGES.cells : RANGES.chambers)),
    extFixedDia,
    extDeploy: extFixedDia > 0 ? clampTo(cfg.extDeploy, RANGES.extDeploy) : 1,
  };
}

export function sanitizeFlight(f: FlightState): FlightState {
  return {
    altitudeKm: clampTo(f?.altitudeKm, RANGES.altitudeKm),
    throttle: clampTo(f?.throttle, RANGES.throttle),
  };
}

/** Exit diameter of the nozzle the gas is expanding through, allowing for a part-deployed extension. */
export function flowExitDiameter(cfg: EngineConfig): number {
  if (!(cfg.extFixedDia > 0)) return cfg.exitDia;
  const t = Math.min(1, Math.max(0, (cfg.extDeploy - 0.9) / 0.1));
  const seated = t * t * (3 - 2 * t);
  return cfg.extFixedDia + (cfg.exitDia - cfg.extFixedDia) * seated;
}

function combustionEfficiency(lStar: number, lStarRef: number): number {
  if (lStarRef <= 0 || lStar >= lStarRef) return BASE_COMBUSTION_EFF;
  const third = lStarRef / 3;
  let rel: number;
  if (lStar >= third) rel = 0.85 + (0.15 * (lStar - third)) / (lStarRef - third);
  else rel = 0.6 + (0.25 * lStar) / third;
  return BASE_COMBUSTION_EFF * rel;
}

export function simulate(rawCfg: EngineConfig, rawFlight: FlightState): SimResult {
  const cfg = sanitize(rawCfg);
  const flight = sanitizeFlight(rawFlight);
  const prop = PROPELLANTS[cfg.propellant];
  const source = ENERGY_SOURCES[cfg.energy];
  const throttle = source.throttleable ? flight.throttle : 1;
  const pcBar = cfg.chamberPressureBar * throttle;
  const pc = pcBar * 1e5;
  const table = gasProps(cfg.propellant, cfg.mixtureRatio);
  // Higher pressure suppresses dissociation, so a flame runs a little hotter.
  // A reactor-heated gas is simply as hot as the reactor core.
  const gas = source.mixKind === 'temperature' ? table : { ...table, tc: table.tc * Math.pow(pcBar / 70, 0.03) };
  const g = gas.gamma;

  const at = (Math.PI / 4) * cfg.throatDia ** 2;
  // A nozzle extension does nothing until it is nearly seated: before that the exhaust simply
  // leaves the fixed nozzle. It comes into play over the last tenth of its travel.
  const flowExitDia = flowExitDiameter(cfg);
  const ae = (Math.PI / 4) * flowExitDia ** 2;
  const eps = ae / at;
  const lStar = ((Math.PI / 4) * cfg.chamberDia ** 2 * cfg.chamberLen) / at;

  const limits = computeLimits(cfg, pcBar, gas.tc);
  const shudder = Math.min(1, Math.max(0, (limits.instability - 0.7) / 0.3));
  const span = prop.ofMax - prop.ofMin;
  const rough =
    source.mixKind === 'ratio' &&
    span > 0 &&
    (cfg.mixtureRatio - prop.ofMin < 0.04 * span || prop.ofMax - cfg.mixtureRatio < 0.04 * span);

  let combustionEff = combustionEfficiency(lStar, prop.lStarRef);
  if (rough) combustionEff *= 0.97;
  combustionEff *= 1 - 0.03 * shudder;

  const cStarIdeal = cStar(g, gas.R, gas.tc);
  const cStarEff = cStarIdeal * combustionEff;
  // Totals across all chambers; everything else below is per chamber.
  const n = cfg.chambers;
  const massFlow = (n * pc * at) / cStarEff;
  // Thrust depends on chamber pressure and throat area, not on how efficiently
  // that pressure was produced, so the momentum term uses the ideal flow.
  const idealFlow = (pc * at) / cStarIdeal;
  const nozzleEff = 0.965 + (0.025 * (cfg.nozzleLenPct - 60)) / 40;

  const exitMach = machFromAreaRatio(eps, g);
  const pe = pc * pressureRatio(exitMach, g);

  const thrustAt = (pa: number) => {
    let mach = exitMach;
    let pExit = pe;
    let area = ae;
    let state: ExpansionState;
    const sepRatio = (m: number) => SEPARATION_K * Math.pow(1.88 * m - 1, -0.64);
    // First, what a bell of this size would do.
    if (pa <= 0) {
      state = 'under';
    } else if (pe < sepRatio(exitMach) * pa) {
      state = 'separated';
      let lo = 1;
      let hi = exitMach;
      for (let i = 0; i < 50; i++) {
        const mid = 0.5 * (lo + hi);
        if (pc * pressureRatio(mid, g) > sepRatio(mid) * pa) lo = mid;
        else hi = mid;
      }
      mach = 0.5 * (lo + hi);
      pExit = pc * pressureRatio(mach, g);
      area = at * areaRatio(mach, g);
    } else {
      const r = pe / pa;
      state = Math.abs(r - 1) <= 0.1 ? 'ideal' : r < 1 ? 'over' : 'under';
    }
    let ve = exitVelocity(mach, g, gas.R, gas.tc);
    let thrust = nozzleEff * idealFlow * ve + (pExit - pa) * area;
    if (cfg.exhaust === 'aerospike' && pa > 0 && pe < pa) {
      // Altitude compensation. Nothing but the surrounding air holds in the outside of an
      // aerospike's jet, so below its design altitude the air squeezes the jet in until it leaves
      // at the outside pressure: it never over-expands and never separates.
      state = 'compensating';
      mach = Math.max(1, machFromPressureRatio(pa / pc, g));
      pExit = pa;
      area = at * areaRatio(mach, g);
      ve = exitVelocity(mach, g, gas.R, gas.tc);
      // Air is a poor wall, and some of the expansion is lost in waves along the spike and in
      // drag on its flat base. Measuring the loss from what a real bell manages, separation
      // included, keeps it to a few percent however large the spike is.
      const matched = nozzleEff * idealFlow * ve;
      thrust += AEROSPIKE_COMPENSATION * Math.max(0, matched - thrust);
    }
    return { thrust: n * Math.max(0, THRUST_EFF * thrust), state, mach, pExit, area, ve };
  };

  const pa = ambientPressure(flight.altitudeKm * 1000);
  const now = thrustAt(pa);
  const sl = thrustAt(SEA_LEVEL_PRESSURE);
  const vac = thrustAt(0);

  return {
    thrust: now.thrust,
    isp: now.thrust / (massFlow * G0),
    ispSeaLevel: sl.thrust / (massFlow * G0),
    ispVacuum: vac.thrust / (massFlow * G0),
    massFlow,
    pc,
    pe: now.pExit,
    pa,
    exitMach: now.mach,
    exitVelocity: now.ve,
    expansionRatio: eps,
    effectiveExitDia: Math.sqrt((4 * now.area) / Math.PI),
    flowExitDia,
    tc: gas.tc,
    gamma: g,
    cStarEff,
    lStar,
    combustionEff,
    nozzleEff,
    state: now.state,
    rough,
    shudder,
    limits,
    failure: failureFor(cfg, pcBar, gas.tc),
  };
}
