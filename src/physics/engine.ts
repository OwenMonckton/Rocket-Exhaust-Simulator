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
import { FUEL_IDS, OXIDISER_IDS, isFuelId, isOxidiserId } from './chem/ingredients';
import { mixRange, resolveGas, type GasSource } from './gasSource';
import { ENERGY_SOURCES, isEnergyId, propellantsFor } from './parts';
import { EXHAUSTS, defaultInnerExitDia, isExhaustId } from './exhausts';
import { PROPELLANTS, isPropellantId } from './propellants';
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
/** A bell's nozzle efficiency at its longest: what a cone or an engine with no nozzle loses to everything but the angle. */
const BEST_NOZZLE_EFF = 0.99;
/** A dual bell running full keeps this share of a bell's momentum thrust: the kink leaves an imperfect shape. */
const DUAL_BELL_FULL_EFF = 0.985;
/** In a dual bell held at its kink, the pressure on the outer bell's wall is this share below the outside air's. */
const DUAL_BELL_WALL_SUCTION = 0.05;

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
  /** Half-angle of a plain cone, degrees */
  coneAngleDeg: { min: 8, max: 30, fallback: 15 },
  /** Diameter at a dual bell's kink, m; 0 means not set yet */
  innerExitDia: { min: 0, max: 25, fallback: 0 },
  /** An expansion-deflection nozzle's plug, as a share of the wall's diameter at the ring */
  plugShare: { min: 0.5, max: 0.8, fallback: 0.7 },
  extDeploy: { min: 0, max: 1, fallback: 1 },
  altitudeKm: { min: 0, max: 100, fallback: 0 },
  throttle: { min: 0.4, max: 1, fallback: 1 },
} satisfies Record<string, Range>;

/**
 * How wide the wall at an expansion-deflection nozzle's ring may be: this share of the chamber's
 * width, and the exit must be this many times wider than it for the bell to open at all.
 */
const ED_CHAMBER_SHARE = 0.95;
const ED_EXIT_RATIO = 1.15;

/**
 * The share of its momentum an expansion-deflection nozzle keeps after the drag of its plug's flat
 * back, which grows with the back's area. A proposal, to be set beside the gas simulation.
 */
export function edBaseDrag(plugShare: number): number {
  return 1 - 0.02 * plugShare ** 2;
}

/**
 * How far an expansion-deflection nozzle's open wake makes up for a bell too big for the altitude:
 * the share of the way from that bell's thrust to a matched nozzle's. A bigger plug leaves a
 * thinner ring further out, which holds to the wall better and leaves a bigger hollow for the air
 * to fill. Always short of an aerospike's. A proposal, to be set beside the gas simulation.
 */
export function edCompensation(plugShare: number): number {
  return 0.1 + 0.7 * plugShare;
}

/**
 * The outside pressure, over chamber pressure, below which the hollow behind an
 * expansion-deflection nozzle's plug seals itself off from the outside air. It is the pressure
 * the sealed hollow settles to, as measured in the gas simulation (docs/future-work.md): 2.2% of
 * chamber pressure at a plug of 0.7 or more, rising to 4% at the smallest plug. So at sea level
 * the hollow is open on an engine below about 46 bar and sealed on one above it.
 */
export function edWakeSeals(plugShare: number): number {
  return 0.022 + 0.09 * Math.max(0, 0.7 - plugShare);
}

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
  // A tabled propellant made of a fuel and oxidiser the solver knows names them; otherwise the
  // picks stay as they are, or the first of each where they are not known.
  const pair = PROPELLANTS[propellant].pair;
  const fuel = pair ? pair.fuel : isFuelId(cfg.fuel) ? cfg.fuel : FUEL_IDS[0];
  const oxidiser = pair ? pair.oxidiser : isOxidiserId(cfg.oxidiser) ? cfg.oxidiser : OXIDISER_IDS[0];
  const mix = mixRange({ ...cfg, propellant, fuel, oxidiser });
  const chamberDia = clampTo(cfg.chamberDia, RANGES.chamberDia);
  const throatDia = Math.min(clampTo(cfg.throatDia, RANGES.throatDia), 0.9 * chamberDia);
  let exitDia = Math.max(clampTo(cfg.exitDia, RANGES.exitDia), 1.05 * throatDia);
  // An extension must be wider than the throat and narrower than the full nozzle; otherwise there isn't one.
  // Only a bell has one to extend.
  const exhaust = isExhaustId(cfg.exhaust) ? cfg.exhaust : 'bell';
  const type = EXHAUSTS[exhaust];
  let extFixedDia = clampTo(cfg.extFixedDia, RANGES.extFixedDia);
  if (!type.extension || extFixedDia < 1.05 * throatDia || extFixedDia > 0.98 * exitDia) extFixedDia = 0;
  let innerExitDia = clampTo(cfg.innerExitDia, RANGES.innerExitDia);
  if (exhaust === 'dualBell') {
    if (!(innerExitDia > 0)) innerExitDia = defaultInnerExitDia(throatDia, exitDia);
    const lo = 1.1 * throatDia;
    const hi = 0.95 * exitDia;
    innerExitDia = lo <= hi ? Math.min(hi, Math.max(lo, innerExitDia)) : (throatDia + exitDia) / 2;
  }
  // A plug pushes the wall at the ring outward. Where that wall would be wider than the chamber
  // can feed or the exit can open from, the plug gives way first, as far as its smallest; if that
  // is still not enough, the exit is widened.
  // Every exhaust keeps its plug setting, as it keeps its cone angle, so a swap away and back
  // does not lose it; only an expansion-deflection nozzle uses it.
  let plugShare = clampTo(cfg.plugShare, RANGES.plugShare);
  if (exhaust === 'expansionDeflection') {
    // The widest the wall at the ring may be, as a diameter.
    const room = Math.min(ED_CHAMBER_SHARE * chamberDia, exitDia / ED_EXIT_RATIO);
    const fits = room > throatDia ? Math.sqrt(1 - (throatDia / room) ** 2) : 0;
    plugShare = Math.max(RANGES.plugShare.min, Math.min(plugShare, fits));
    exitDia = Math.max(exitDia, (ED_EXIT_RATIO * throatDia) / Math.sqrt(1 - plugShare ** 2));
  }
  return {
    presetId: typeof cfg.presetId === 'string' ? cfg.presetId : null,
    energy,
    exhaust,
    propellant,
    fuel,
    oxidiser,
    chamberDia,
    chamberLen: clampTo(cfg.chamberLen, RANGES.chamberLen),
    throatDia,
    exitDia,
    nozzleLenPct: clampTo(cfg.nozzleLenPct, RANGES.nozzleLenPct),
    wall: clampTo(cfg.wall, RANGES.wall),
    chamberPressureBar: clampTo(cfg.chamberPressureBar, RANGES.chamberPressureBar),
    mixtureRatio: Number.isFinite(cfg.mixtureRatio)
      ? Math.min(mix.ofMax, Math.max(mix.ofMin, cfg.mixtureRatio))
      : mix.ofDefault,
    scale: clampTo(cfg.scale, RANGES.scale),
    chambers: Math.round(clampTo(cfg.chambers, type.counts === 'cells' ? RANGES.cells : RANGES.chambers)),
    extFixedDia,
    extDeploy: extFixedDia > 0 ? clampTo(cfg.extDeploy, RANGES.extDeploy) : 1,
    coneAngleDeg: clampTo(cfg.coneAngleDeg, RANGES.coneAngleDeg),
    innerExitDia,
    plugShare,
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
  // With no nozzle the gas leaves at the throat.
  if (EXHAUSTS[cfg.exhaust]?.hasNozzle === false) return cfg.throatDia;
  if (!(cfg.extFixedDia > 0)) return cfg.exitDia;
  const t = Math.min(1, Math.max(0, (cfg.extDeploy - 0.9) / 0.1));
  const seated = t * t * (3 - 2 * t);
  return cfg.extFixedDia + (cfg.exitDia - cfg.extFixedDia) * seated;
}

/** The gas of an engine held only as a config: at full throttle, through the nozzle the gas is using. */
export function gasFor(cfg: EngineConfig): GasSource {
  return resolveGas(cfg, cfg.chamberPressureBar, (flowExitDiameter(cfg) / cfg.throatDia) ** 2);
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

  const at = (Math.PI / 4) * cfg.throatDia ** 2;
  // A nozzle extension does nothing until it is nearly seated: before that the exhaust simply
  // leaves the fixed nozzle. It comes into play over the last tenth of its travel.
  const flowExitDia = flowExitDiameter(cfg);
  const ae = (Math.PI / 4) * flowExitDia ** 2;
  const eps = ae / at;

  const gasSource = resolveGas(cfg, pcBar, eps);
  const table = gasSource.gas;
  // Higher pressure suppresses dissociation, so a flame runs a little hotter. A reactor-heated gas
  // is simply as hot as the reactor core, and the solver already allows for the pressure.
  const gas =
    source.mixKind === 'temperature' || gasSource.calculated
      ? table
      : { ...table, tc: table.tc * Math.pow(pcBar / 70, 0.03) };
  const g = gas.gamma;

  const lStar = ((Math.PI / 4) * cfg.chamberDia ** 2 * cfg.chamberLen) / at;

  const limits = computeLimits(cfg, pcBar, gas.tc);
  const shudder = Math.min(1, Math.max(0, (limits.instability - 0.7) / 0.3));
  const span = prop.ofMax - prop.ofMin;
  const rough =
    source.mixKind === 'ratio' &&
    !gasSource.calculated &&
    span > 0 &&
    (cfg.mixtureRatio - prop.ofMin < 0.04 * span || prop.ofMax - cfg.mixtureRatio < 0.04 * span);

  let combustionEff = combustionEfficiency(lStar, gasSource.lStarRef);
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
  // The share of the momentum thrust a nozzle keeps. A bell's grows with its length. Gas leaving a
  // cone fans out, and only the part of its speed pointing straight back pushes; with no nozzle
  // there is no wall to lose anything to, so both take a bell's best for everything else.
  let nozzleEff = 0.965 + (0.025 * (cfg.nozzleLenPct - 60)) / 40;
  if (cfg.exhaust === 'cone') nozzleEff = BEST_NOZZLE_EFF * (1 + Math.cos((cfg.coneAngleDeg * Math.PI) / 180)) / 2;
  else if (cfg.exhaust === 'none') nozzleEff = BEST_NOZZLE_EFF;
  const hasNozzle = EXHAUSTS[cfg.exhaust].hasNozzle;
  // A solved gas's vacuum thrust is scaled to the solver's own Isp (exactly 1, and so no change at
  // all, for a tabled gas): the exit momentum and exit pressure terms, not the ambient pressure.
  const ispScale = gasSource.ispScale;

  const exitMach = machFromAreaRatio(eps, g);
  const pe = pc * pressureRatio(exitMach, g);
  // A dual bell's kink, where its jet is held in low mode.
  const kinkArea = (Math.PI / 4) * cfg.innerExitDia ** 2;
  const kinkMach = cfg.exhaust === 'dualBell' ? machFromAreaRatio((cfg.innerExitDia / cfg.throatDia) ** 2, g) : 1;

  const thrustAt = (pa: number) => {
    let mach = exitMach;
    let pExit = pe;
    let area = ae;
    let state: ExpansionState;
    const sepRatio = (m: number) => SEPARATION_K * Math.pow(1.88 * m - 1, -0.64);
    // First, what a bell of this size would do. With no nozzle there is no wall to tear off.
    if (pa <= 0) {
      state = 'under';
    } else if (hasNozzle && pe < sepRatio(exitMach) * pa) {
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
    let eff = nozzleEff;
    let suction = 0;
    // The flat back of an expansion-deflection nozzle's plug drags on the flow at every altitude.
    if (cfg.exhaust === 'expansionDeflection') eff = nozzleEff * edBaseDrag(cfg.plugShare);
    if (cfg.exhaust === 'dualBell') {
      if (state !== 'separated') {
        // High mode: the jet fills the big bell.
        eff = nozzleEff * DUAL_BELL_FULL_EFF;
      } else if (mach >= kinkMach) {
        // Low mode: a full bell would lose its jet past the kink, so it lets go cleanly at the kink
        // and the engine runs as the inner bell. The big bell's wall stands in air the jet drags
        // along, a little below the outside pressure.
        state = 'held';
        mach = kinkMach;
        pExit = pc * pressureRatio(kinkMach, g);
        area = kinkArea;
        suction = DUAL_BELL_WALL_SUCTION * pa * (ae - kinkArea);
      }
    }
    let ve = exitVelocity(mach, g, gas.R, gas.tc);
    let thrust = ispScale * eff * idealFlow * ve + (ispScale * pExit - pa) * area - suction;
    // How far the outside air makes up for a nozzle too big for it. An aerospike's jet has only
    // air round its outside; an expansion-deflection nozzle's has only air in the hollow behind
    // its plug, which drags on the plug's back, so it makes up less.
    // The hollow behind an expansion-deflection nozzle's plug is open to the outside air only
    // while that air's pressure is above what the hollow settles to when sealed, which is a fixed
    // share of chamber pressure. From four times that pressure down to it, the help the air gives fades to nothing,
    // so thrust does not step as the hollow seals.
    const wakeOpen =
      cfg.exhaust === 'expansionDeflection' ? Math.min(1, Math.max(0, (pa / (edWakeSeals(cfg.plugShare) * pc) - 1) / 3)) : 0;
    const compensation =
      cfg.exhaust === 'aerospike' ? AEROSPIKE_COMPENSATION
      : cfg.exhaust === 'expansionDeflection' ? edCompensation(cfg.plugShare) * wakeOpen
      : 0;
    // Sealed, the nozzle runs as a plain bell this size, but its jet does not tear off the wall:
    // it is thrown onto the wall at the ring and stays there. It reads as too big, not as separated.
    // Its thrust stays the bell's (what a bell loses and keeps by tearing its jet off is the best
    // figure there is for a nozzle this much too big), but the gas it reports is the gas leaving
    // the whole mouth, as "over-expanded" says: set after the thrust is worked out, below.
    const sealedTooBig = cfg.exhaust === 'expansionDeflection' && state === 'separated';
    if (sealedTooBig) state = 'over';
    if (compensation > 0 && pa > 0 && pe < pa) {
      // Altitude compensation. Nothing but the surrounding air holds in the outside of an
      // aerospike's jet (or the inside of an expansion-deflection nozzle's), so below its design
      // altitude the air squeezes the jet until it leaves at the outside pressure: it never
      // over-expands and never separates.
      state = 'compensating';
      mach = Math.max(1, machFromPressureRatio(pa / pc, g));
      pExit = pa;
      area = at * areaRatio(mach, g);
      ve = exitVelocity(mach, g, gas.R, gas.tc);
      // Air is a poor wall, and some of the expansion is lost in waves along the spike and in
      // drag on its flat base. Measuring the loss from what a real bell manages, separation
      // included, keeps it to a few percent however large the spike is.
      const matched = ispScale * eff * idealFlow * ve + (ispScale - 1) * pa * area;
      thrust += compensation * Math.max(0, matched - thrust);
    }
    if (sealedTooBig && state === 'over') {
      mach = exitMach;
      pExit = pe;
      area = ae;
      ve = exitVelocity(mach, g, gas.R, gas.tc);
    }
    return { thrust: n * Math.max(0, THRUST_EFF * thrust), state, mach, pExit, area, ve, eff };
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
    nozzleEff: now.eff,
    state: now.state,
    rough,
    shudder,
    limits,
    failure: gasSource.failure ?? failureFor(cfg, pcBar, gas.tc),
    exhaust: gasSource.exhaust,
    notes: gasSource.notes,
    calculated: gasSource.calculated,
    settled: gasSource.settled,
  };
}
