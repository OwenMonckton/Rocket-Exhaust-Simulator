// Whether a fuel and oxidiser would work: the failures, and the warnings shown beside the pickers.
import { FUELS, OXIDISERS, NO_OXIDISER, lightsOnContact, type Ingredient } from './ingredients';
import type { SolvedGas } from './pair';

/** A chamber gas cooler than this will not sustain a flame. NASA SP-8081 Table I: the coolest operating bipropellant gas generator runs at 811 K. */
export const FLAMEOUT_K = 800;
export type ChemFailure = 'flameout' | 'inert' | 'detonation' | 'unsolved';
export interface Verdict { failure: ChemFailure | null; notes: string[] }

const DROPLET_NOTE_SHARE = 0.02;
/** K: every gas's data in NASA's thermo.inp ends here. */
const DATA_TOP_K = 6000;
/** deg C: one propellant must boil this far below the other's freezing point to freeze it. */
const FREEZE_MARGIN_C = 5;
// Lower-case the first letter for mid-sentence use, but leave acronyms (UDMH, RP-1) alone.
const lower = (name: string) => (/[A-Z]/.test(name.charAt(1)) ? name : name.charAt(0).toLowerCase() + name.slice(1));
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** The note for an exhaust that is 2% or more liquid or solid droplets by mass, or null. */
export function dropletNote(gas: SolvedGas): string | null {
  return gas.condensedShare >= DROPLET_NOTE_SHARE
    ? `${Math.round(gas.condensedShare * 100)}% of the exhaust is liquid or solid droplets.`
    : null;
}

export function verdictFor(fuel: string, oxidiser: string, gas: SolvedGas): Verdict {
  const f: Ingredient | undefined = FUELS[fuel];
  const noOx = oxidiser === NO_OXIDISER;
  const o: Ingredient | undefined = noOx ? undefined : OXIDISERS[oxidiser];
  const parts = [f, o].filter((x): x is Ingredient => x !== undefined);

  let failure: ChemFailure | null = null;
  if (parts.some((p) => p.detonates)) failure = 'detonation';
  else if (noOx && !f?.monopropellant) failure = 'inert';
  else if (!gas.ok) failure = 'unsolved';
  else if (!noOx && gas.tc < FLAMEOUT_K) failure = 'flameout';

  // A fuel named for running alone ("... alone") is not alone once it has an oxidiser.
  const named = (p: Ingredient) => (noOx ? p.name : p.name.replace(/ alone$/, ''));
  const notes: string[] = [];
  if (!noOx) {
    const lit = lightsOnContact(fuel, oxidiser);
    if (lit) notes.push(lit.lights ? 'Lights on contact, so it needs no igniter.' : 'Needs an igniter to start burning.');
  }
  if (f && o) {
    for (const [a, b] of [[f, o], [o, f]] as const) {
      // A propellant kept liquid by pressure is not held at its boiling point, so it freezes nothing.
      if (a.boilC !== undefined && b.freezeC !== undefined && !a.pressurised && a.boilC < b.freezeC - FREEZE_MARGIN_C) {
        notes.push(`${named(a)} is kept below ${Math.round(a.boilC)} °C, cold enough to freeze ${lower(named(b))} (which freezes at ${Math.round(b.freezeC)} °C) in neighbouring plumbing.`);
      }
    }
  }
  for (const p of parts) if (p.attacksMaterials) notes.push(sentence(p.attacksMaterials.text));
  for (const p of parts) {
    if (p.toxicity === 3) notes.push(`Extremely toxic: ${lower(named(p))}.`);
    else if (p.toxicity === 2) notes.push(`Toxic: ${lower(named(p))}.`);
  }
  for (const p of parts) if (p.toxicExhaust) notes.push(sentence(p.toxicExhaust.text));
  for (const p of parts) if (p.warning) notes.push(sentence(p.warning.text));
  const drops = dropletNote(gas);
  if (drops) notes.push(drops);
  if (gas.ok && gas.tc > DATA_TOP_K) {
    notes.push(`The flame is hotter than 6,000 K, where NASA's data stops, so these figures are stretched beyond it; some of the gas would also be ionised, which is not modelled.`);
  }
  if (fuel === 'n2h4' && noOx) {
    // Which way the figure errs is not established here, so the note only says it differs.
    notes.push('Hydrazine alone breaks down into ammonia, hydrogen and nitrogen. Real thrusters stop that part-way, so this figure differs from what a real thruster gives.');
  }
  return { failure, notes };
}
