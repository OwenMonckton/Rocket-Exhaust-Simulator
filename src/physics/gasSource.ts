// The one place an engine's gas comes from: a hand-tuned table for the tabled propellants, the
// chemistry solver for a fuel and oxidiser picked freely ('calculated') and for a reactor fluid
// that names its thermo reactant (`fluid`).
import { FUELS, NO_OXIDISER, type Family } from './chem/ingredients';
import { pairRange, solveFluid, solvePair, type SolvedGas } from './chem/pair';
import { dropletNote, verdictFor, type ChemFailure } from './chem/verdict';
import { lookFromExhaust } from './plumeLook';
import { PROPELLANTS, gasProps, richness } from './propellants';
import type { EngineConfig, GasProps, PlumeLook, PropellantId } from './types';

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
  failure: ChemFailure | null;
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

/** The engine's gas at chamber pressure `pcBar` and area ratio `eps`. Cheap when nothing changed. */
export function resolveGas(cfg: EngineConfig, pcBar: number, eps: number): GasSource {
  if (cfg.propellant !== 'calculated') {
    const p = PROPELLANTS[cfg.propellant];
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
