// The one place an engine's gas comes from: a hand-tuned table for the tabled propellants, the
// chemistry solver for a fuel and oxidiser picked freely ('calculated') and for a reactor fluid
// that names its thermo reactant (`fluid`).
import { FUELS, NO_OXIDISER, type Family } from './chem/ingredients';
import { pairRange, solveFluid, solveHeated, solvePair, type SolvedGas } from './chem/pair';
import { ENERGY_SOURCES } from './parts';
import { dropletNote, verdictFor, type ChemFailure } from './chem/verdict';
import { lookFromExhaust } from './plumeLook';
import { PROPELLANTS, gasProps, richness } from './propellants';
import type { EngineConfig, Failure, GasProps, PlumeLook, PropellantId } from './types';

const R_UNIVERSAL = 8314.46;

export interface GasSource {
  /** True when the solver worked the gas out */
  calculated: boolean;
  /** False when `gas` is the cold-air stand-in because there was no settled solve: no figure from it is real */
  settled: boolean;
  gas: GasProps;
  /**
   * What `simulate` scales its thrust by (never its mass flow) so that a solved gas shows the
   * solver's own vacuum Isp where the one-gamma gas cannot carry it. Exactly 1 for a tabled gas.
   */
  ispScale: number;
  /** Characteristic chamber length (m) needed for complete combustion */
  lStarRef: number;
  look: PlumeLook;
  /** True when `look` was worked out from this gas's own exhaust; false for a hand-picked or borrowed one */
  derivedLook: boolean;
  /** -1 oxidiser-rich, 0 at the hottest mixture, +1 fuel-rich */
  richness: number;
  failure: ChemFailure | Extract<Failure, 'underpowered' | 'meltdown'> | null;
  exhaust: { name: string; share: number }[];
  notes: string[];
}

/** What stands in for the gas when the chemistry gives none: cold air, never shown as real. */
const NO_GAS: GasProps = { tc: 300, gamma: 1.4, molarMass: 28, R: R_UNIVERSAL / 28 };
const NOT_SOLVED: SolvedGas = {
  ok: false, tc: 0, gamma: 0, molarMass: 0, cStar: 0, ispVac: 0, ispScale: 1, condensedShare: 0, exhaust: [], makeup: [],
};
/** The thrust scale of a solve: 1 for the stand-in gas. */
const scaleOf = (solved: SolvedGas) => (solved.ok ? solved.ispScale : 1);

/** The simulator's gas from a solve, or cold air if it did not settle. */
function gasOf(solved: SolvedGas): GasProps {
  return solved.ok
    ? { tc: solved.tc, gamma: solved.gamma, molarMass: solved.molarMass, R: R_UNIVERSAL / solved.molarMass }
    : { ...NO_GAS };
}

/** The tabled propellant whose chamber length and plume a calculated fuel borrows, by its family. */
function borrowedFrom(fuel: string): PropellantId {
  const family: Family | undefined = FUELS[fuel]?.family;
  switch (family) {
    case 'hydrogen':
      return 'hydrolox';
    case 'hydrocarbon':
    case 'metal':
    case 'cyanogen':
      return 'kerolox';
    case 'alcohol':
    case 'nitro':
      return 'methalox';
    default:
      return 'hypergolic';
  }
}

/** The span of the mixture setting. A tabled propellant's own; a calculated pair's from the solver (cached). */
export function mixRange(cfg: EngineConfig): { ofMin: number; ofMax: number; ofDefault: number } {
  if (cfg.propellant !== 'calculated') {
    const p = PROPELLANTS[cfg.propellant];
    return { ofMin: p.ofMin, ofMax: p.ofMax, ofDefault: p.ofDefault };
  }
  const r = pairRange(cfg.fuel, cfg.oxidiser);
  return { ofMin: r.ofMin, ofMax: r.ofMax, ofDefault: r.ofDefault };
}

/**
 * The look last worked out from each calculated pair's or fluid's own exhaust, by what it is made
 * from. The gas is resolved every frame for the plume, so this is the plume's look.
 */
const derivedLooks = new Map<string, PlumeLook>();
const lookKey = (cfg: EngineConfig) =>
  cfg.propellant === 'calculated' ? `pair|${cfg.fuel}|${cfg.oxidiser}` : `fluid|${cfg.propellant}`;

/** The look for a settled solve, remembered for `staticLook`. */
function derive(cfg: EngineConfig, solved: SolvedGas): PlumeLook {
  // From the whole make-up, not the six species the readout lists: a species that slips to seventh
  // place is still in the plume.
  const look = lookFromExhaust({ exhaust: solved.makeup, tc: solved.tc, condensedShare: solved.condensedShare });
  derivedLooks.set(lookKey(cfg), look);
  return look;
}

/**
 * The plume's look, for callers with no chamber pressure to hand (the gas drawn inside the engine).
 * Never solves: an engine whose look comes from its exhaust gets the one last worked out for it,
 * and until there is one, the hand-picked look it would otherwise borrow.
 */
export function staticLook(cfg: EngineConfig): PlumeLook {
  const calculated = cfg.propellant === 'calculated';
  const picked = PROPELLANTS[calculated ? borrowedFrom(cfg.fuel) : cfg.propellant];
  if (!calculated && !picked.fluid) return picked.look;
  return derivedLooks.get(lookKey(cfg)) ?? picked.look;
}

// ---- A fluid heated by electrical power ----

/**
 * The share of the ideal flow's characteristic velocity a chamber where nothing burns delivers, as
 * `simulate` has it: what the flow through the throat is worked out with.
 */
const HEATED_FLOW_EFF = 0.98;
/** The energies per kilogram, J/kg, the search looks between: far less than boils anything, to more than tears hydrogen into atoms. */
const HEAT_LO = 1e4;
const HEAT_HI = 5e8;
const HEAT_SCAN = 24;
/** A settled result colder than this is not a gas an engine can run on. */
const GAS_MIN_T = 300;
/** Below this the heater is adding little. */
const LUKEWARM_T = 700;
const HEATED_CACHE = 500;

interface Heated {
  solved: SolvedGas;
  /** 'cold': the power cannot make a gas of the propellant. 'hot': it gives more heat than the solver can follow. */
  out: null | 'cold' | 'hot';
}
const heatedResults = new Map<string, Heated>();

/**
 * The gas of an electrically heated engine. The power that reaches the gas, divided by the flow,
 * is the heat each kilogram takes up; but the flow through the throat falls as the gas gets
 * hotter, so the heat per kilogram is searched for: the one at which heat per kilogram times flow
 * equals the power. `pcBar` below the engine's own is the throttle, which turns the power down with it.
 */
function heated(cfg: EngineConfig, fluid: string, pcBar: number, eps: number): Heated {
  const sig = (x: number) => Number(x.toPrecision(4));
  const key = [fluid, cfg.energy, sig(cfg.powerKW), sig(pcBar), sig(cfg.chamberPressureBar), sig(eps), sig(cfg.throatDia), cfg.chambers].join('|');
  const hit = heatedResults.get(key);
  if (hit) return hit;
  const throttle = cfg.chamberPressureBar > 0 ? pcBar / cfg.chamberPressureBar : 1;
  const heat = (ENERGY_SOURCES[cfg.energy].heatingShare ?? 1) * cfg.powerKW * 1000 * throttle;
  const pcAt = cfg.chambers * pcBar * 1e5 * (Math.PI / 4) * cfg.throatDia ** 2;
  const usable = (g: SolvedGas) => g.ok && g.tc >= GAS_MIN_T;
  /** Heat taken up at `q` J/kg, less the heat on offer: rises with `q`. */
  const excess = (q: number, g: SolvedGas) => (q * pcAt) / (g.cStar * HEATED_FLOW_EFF) - heat;

  // A coarse scan finds where the fluid makes a usable gas at all, and brackets the answer.
  let lowest: { q: number; g: SolvedGas } | null = null;
  let below: { q: number; g: SolvedGas } | null = null;
  let above: { q: number; g: SolvedGas } | null = null;
  let highest: { q: number; g: SolvedGas } | null = null;
  let boiled = true; // false once a lower energy has failed to make a gas
  for (let k = 0; k < HEAT_SCAN && !above; k++) {
    const q = HEAT_LO * (HEAT_HI / HEAT_LO) ** (k / (HEAT_SCAN - 1));
    const g = solveHeated(fluid, q, pcBar, eps);
    if (!usable(g)) {
      if (!lowest) boiled = false;
      continue;
    }
    const point = { q, g };
    lowest ??= point;
    highest = point;
    if (excess(q, g) < 0) below = point;
    else above = point;
  }
  let out: Heated;
  if (!lowest) {
    out = { solved: NOT_SOLVED, out: 'cold' };
  } else if (!below) {
    // Even the least heat that makes a gas is more than the power gives. A fluid that is a gas
    // with no help (hydrazine, broken down) simply runs on its own heat.
    out = boiled ? { solved: lowest.g, out: null } : { solved: NOT_SOLVED, out: 'cold' };
  } else if (!above) {
    out = { solved: highest!.g, out: 'hot' };
  } else {
    let lo = below;
    let hi = above;
    for (let i = 0; i < 30 && hi.q / lo.q > 1.001; i++) {
      const q = Math.sqrt(lo.q * hi.q);
      const g = solveHeated(fluid, q, pcBar, eps);
      // A point that will not settle between two that do: keep the cooler side, which is known good.
      if (!usable(g)) break;
      if (excess(q, g) < 0) lo = { q, g };
      else hi = { q, g };
    }
    out = { solved: lo.g, out: null };
  }
  heatedResults.set(key, out);
  while (heatedResults.size > HEATED_CACHE) heatedResults.delete(heatedResults.keys().next().value!);
  return out;
}

/** The engine's gas at chamber pressure `pcBar` and area ratio `eps`. Cheap when nothing changed. */
export function resolveGas(cfg: EngineConfig, pcBar: number, eps: number): GasSource {
  if (cfg.propellant !== 'calculated') {
    const p = PROPELLANTS[cfg.propellant];
    if (p.fluid && ENERGY_SOURCES[cfg.energy].mixKind === 'power') {
      const { solved, out } = heated(cfg, p.fluid, pcBar, eps);
      const drops = dropletNote(solved);
      const notes = drops ? [drops] : [];
      // Hydrazine's own breakdown already makes hot gas, so a cool jet of it is never the heater's doing.
      if (solved.ok && solved.tc < LUKEWARM_T) {
        notes.push(`The ${cfg.energy === 'arcjet' ? 'arc' : 'heater'} is adding little: the gas leaves at only ${Math.round(solved.tc)} K. More power, or less flow, would heat it further.`);
      }
      return {
        calculated: true,
        settled: solved.ok,
        gas: gasOf(solved),
        ispScale: scaleOf(solved),
        lStarRef: 0,
        look: solved.ok ? derive(cfg, solved) : p.look,
        derivedLook: solved.ok,
        richness: 0,
        // More heat than the solver can follow is more than any heater or arc survives.
        failure: out === 'cold' ? 'underpowered' : out === 'hot' ? 'meltdown' : null,
        exhaust: solved.ok ? solved.exhaust : [],
        notes,
      };
    }
    if (p.fluid) {
      // A reactor heats the fluid to the core temperature, the engine's "mixture" setting.
      const solved = solveFluid(p.fluid, cfg.mixtureRatio, pcBar, eps);
      const drops = dropletNote(solved);
      return {
        calculated: true,
        settled: solved.ok,
        gas: gasOf(solved),
        ispScale: scaleOf(solved),
        lStarRef: 0,
        look: solved.ok ? derive(cfg, solved) : p.look,
        derivedLook: solved.ok,
        // As hydrogen's table gives it: the hottest core, at the top of the range, is the "peak".
        richness: Math.min(1, Math.max(0, (p.ofMax - cfg.mixtureRatio) / (p.ofMax - p.ofMin))),
        failure: solved.ok ? null : 'unsolved',
        exhaust: solved.ok ? solved.exhaust : [],
        notes: drops ? [drops] : [],
      };
    }
    return {
      calculated: false,
      settled: true,
      gas: gasProps(cfg.propellant, cfg.mixtureRatio),
      ispScale: 1,
      lStarRef: p.lStarRef,
      look: p.look,
      derivedLook: false,
      richness: richness(cfg.propellant, cfg.mixtureRatio),
      failure: null,
      exhaust: [],
      notes: [],
    };
  }
  const { fuel, oxidiser } = cfg;
  const of = cfg.mixtureRatio;
  const noOx = oxidiser === NO_OXIDISER;
  const borrowed = PROPELLANTS[borrowedFrom(fuel)];
  // A fuel with nothing to burn it, that cannot break down by itself, has no gas to solve for.
  const solved = noOx && !FUELS[fuel]?.monopropellant ? NOT_SOLVED : solvePair(fuel, oxidiser, of, pcBar, eps);
  const verdict = verdictFor(fuel, oxidiser, solved);
  let rich = 0;
  if (!noOx) {
    const peak = pairRange(fuel, oxidiser).ofPeak;
    if (peak > 0) rich = Math.min(1, Math.max(-1, (peak - of) / peak));
  }
  return {
    calculated: true,
    settled: solved.ok,
    gas: gasOf(solved),
    ispScale: scaleOf(solved),
    lStarRef: borrowed.lStarRef,
    look: solved.ok ? derive(cfg, solved) : borrowed.look,
    derivedLook: solved.ok,
    richness: rich,
    failure: verdict.failure,
    exhaust: solved.ok ? solved.exhaust : [],
    notes: verdict.notes,
  };
}
