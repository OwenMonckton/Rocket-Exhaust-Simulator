// The one place an engine's gas comes from: a hand-tuned table for the tabled propellants, the
// chemistry solver for a fuel and oxidiser picked freely ('calculated') and for a reactor fluid
// that names its thermo reactant (`fluid`).
import { FUELS, NO_OXIDISER, type Family } from './chem/ingredients';
import { pairRange, solveFluid, solvePair, type SolvedGas } from './chem/pair';
import { dropletNote, verdictFor, type ChemFailure } from './chem/verdict';
import { PROPELLANTS, gasProps, richness } from './propellants';
import type { EngineConfig, GasProps, PlumeLook, PropellantId } from './types';

const R_UNIVERSAL = 8314.46;

export interface GasSource {
  /** True when the solver worked the gas out */
  calculated: boolean;
  gas: GasProps;
  /** Characteristic chamber length (m) needed for complete combustion */
  lStarRef: number;
  look: PlumeLook;
  /** -1 oxidiser-rich, 0 at the hottest mixture, +1 fuel-rich */
  richness: number;
  failure: ChemFailure | null;
  exhaust: { name: string; share: number }[];
  notes: string[];
}

/** What stands in for the gas when the chemistry gives none: cold air, never shown as real. */
const NO_GAS: GasProps = { tc: 300, gamma: 1.4, molarMass: 28, R: R_UNIVERSAL / 28 };
const NOT_SOLVED: SolvedGas = {
  ok: false, tc: 0, gamma: 0, molarMass: 0, cStar: 0, ispVac: 0, condensedShare: 0, exhaust: [],
};

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

/** The plume's look, for callers with no chamber pressure to hand. Never solves. */
export function staticLook(cfg: EngineConfig): PlumeLook {
  return PROPELLANTS[cfg.propellant === 'calculated' ? borrowedFrom(cfg.fuel) : cfg.propellant].look;
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
        gas: gasOf(solved),
        lStarRef: 0,
        look: p.look,
        // As hydrogen's table gives it: the hottest core, at the top of the range, is the "peak".
        richness: Math.min(1, Math.max(0, (p.ofMax - cfg.mixtureRatio) / (p.ofMax - p.ofMin))),
        failure: solved.ok ? null : 'unsolved',
        exhaust: solved.ok ? solved.exhaust : [],
        notes: drops ? [drops] : [],
      };
    }
    return {
      calculated: false,
      gas: gasProps(cfg.propellant, cfg.mixtureRatio),
      lStarRef: p.lStarRef,
      look: p.look,
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
    gas: gasOf(solved),
    lStarRef: borrowed.lStarRef,
    look: borrowed.look,
    richness: rich,
    failure: verdict.failure,
    exhaust: solved.ok ? solved.exhaust : [],
    notes: verdict.notes,
  };
}
