import { SEA_LEVEL_PRESSURE, ambientPressure } from './atmosphere';
import { computeLimits, failureFor } from './limits';
import {
  areaRatio,
  cStar,
  exitVelocity,
  machFromAreaRatio,
  pressureRatio,
} from './nozzle';
import { PROPELLANTS, clampMixture, gasProps, isPropellantId } from './propellants';
import type { EngineConfig, ExpansionState, FlightState, SimResult } from './types';

const G0 = 9.80665;
/** Baseline combustion efficiency of a well-sized chamber. */
const BASE_COMBUSTION_EFF = 0.98;
/** Lumped real-world thrust losses (boundary layer, chemistry lag). */
const THRUST_EFF = 1.0;
/** Schmucker separation criterion multiplier, tuned so the RS-25 stays attached at sea level. */
const SEPARATION_K = 0.62;

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
  altitudeKm: { min: 0, max: 100, fallback: 0 },
  throttle: { min: 0.4, max: 1, fallback: 1 },
} satisfies Record<string, Range>;

function clampTo(v: unknown, r: Range): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return r.fallback;
  return Math.min(r.max, Math.max(r.min, v));
}

/** Force a config into a physically drawable, computable shape. Never throws. */
export function sanitize(cfg: EngineConfig): EngineConfig {
  const propellant = isPropellantId(cfg.propellant) ? cfg.propellant : 'kerolox';
  const chamberDia = clampTo(cfg.chamberDia, RANGES.chamberDia);
  const throatDia = Math.min(clampTo(cfg.throatDia, RANGES.throatDia), 0.9 * chamberDia);
  const exitDia = Math.max(clampTo(cfg.exitDia, RANGES.exitDia), 1.05 * throatDia);
  return {
    presetId: typeof cfg.presetId === 'string' ? cfg.presetId : null,
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
  };
}

export function sanitizeFlight(f: FlightState): FlightState {
  return {
    altitudeKm: clampTo(f?.altitudeKm, RANGES.altitudeKm),
    throttle: clampTo(f?.throttle, RANGES.throttle),
  };
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
  const throttle = prop.throttleable ? flight.throttle : 1;
  const pcBar = cfg.chamberPressureBar * throttle;
  const pc = pcBar * 1e5;
  const table = gasProps(cfg.propellant, cfg.mixtureRatio);
  // Higher pressure suppresses dissociation, so a flame runs a little hotter.
  // A reactor-heated gas is simply as hot as the reactor core.
  const gas = prop.mixKind === 'temperature' ? table : { ...table, tc: table.tc * Math.pow(pcBar / 70, 0.03) };
  const g = gas.gamma;

  const at = (Math.PI / 4) * cfg.throatDia ** 2;
  const ae = (Math.PI / 4) * cfg.exitDia ** 2;
  const eps = ae / at;
  const lStar = ((Math.PI / 4) * cfg.chamberDia ** 2 * cfg.chamberLen) / at;

  const limits = computeLimits(cfg, pcBar, gas.tc);
  const shudder = Math.min(1, Math.max(0, (limits.instability - 0.7) / 0.3));
  const span = prop.ofMax - prop.ofMin;
  const rough =
    prop.mixKind === 'ratio' &&
    span > 0 &&
    (cfg.mixtureRatio - prop.ofMin < 0.04 * span || prop.ofMax - cfg.mixtureRatio < 0.04 * span);

  let combustionEff = combustionEfficiency(lStar, prop.lStarRef);
  if (rough) combustionEff *= 0.97;
  combustionEff *= 1 - 0.03 * shudder;

  const cStarIdeal = cStar(g, gas.R, gas.tc);
  const cStarEff = cStarIdeal * combustionEff;
  const massFlow = (pc * at) / cStarEff;
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
    const ve = exitVelocity(mach, g, gas.R, gas.tc);
    const thrust = THRUST_EFF * (nozzleEff * idealFlow * ve + (pExit - pa) * area);
    return { thrust: Math.max(0, thrust), state, mach, pExit, area, ve };
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
