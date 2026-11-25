import { jetLeftWall } from '../physics/exhausts';
import { ENERGY_SOURCES } from '../physics/parts';
import type { EnergyId, ExhaustId, ExpansionState, Failure, SimResult } from '../physics/types';

export const TIPS = {
  scale: 'Grows or shrinks the whole engine in proportion, walls included. Thrust grows with the square of size.',
  chamberDia: 'Width of the combustion chamber. Wider chambers strain the walls more and are prone to instability.',
  chamberLen: 'Length of the combustion chamber. Too short and the propellant leaves before it finishes burning.',
  throatDia: 'The narrowest point. A wider throat lets more propellant through, which means more thrust.',
  exitDia: 'Width of the nozzle exit. Bigger suits thin air and vacuum; smaller suits sea level.',
  nozzleLenPct: 'How long the bell is. Longer bells point the exhaust straighter for slightly better efficiency.',
  coneAngleDeg: "How steeply the cone's wall opens out. A wide cone is short and light, but the jet leaves it spread sideways, which wastes thrust. A narrow cone points the jet straighter, but it has to be longer and heavier.",
  innerExitDia: 'Width of the nozzle at the kink, where the short inner bell opens into the outer one. Near the ground only the inner bell works, so size it for the ground: the closer it is to the right size there, the less thrust is wasted low down.',
  plugShare: 'How much of the throat the plug fills. A bigger plug leaves a thinner ring further out: it adjusts better to the thick air near the ground, but its wide flat back drags more once the engine is in space.',
  chamberPressureBar: 'How hard the engine is pushed. More pressure means more thrust, more heat and more stress.',
  energy: 'Where the engine gets its energy. Changing it rebuilds the chamber to suit, keeping the throat and nozzle.',
  exhaust: 'How the hot gas is turned into a jet. Changing it keeps the same total throat size, so as much propellant flows through.',
  propellant: 'What the engine pushes out of the nozzle. Each has its own efficiency, temperature and plume colour.',
  fuel: 'What burns in the chamber. Changing it works the flame out afresh from the chemistry and sets the mixture ratio to suit.',
  oxidiser: 'What the fuel burns with. Changing it works the flame out afresh from the chemistry and sets the mixture ratio to suit.',
  mixtureRatio: 'Kilograms of oxidiser burned per kilogram of fuel. Lower is fuel-rich, higher is oxidiser-rich.',
  noMixture: 'There is no oxidiser, so there is nothing to mix the fuel with and no ratio to set. Pick an oxidiser to set one.',
  deploy: 'Slide the nozzle extension into place, or stow it. The longer nozzle is far more efficient in vacuum.',
  altitudeKm: 'How high the engine is. The air thins out as you climb, and is effectively gone by 86 km.',
  throttle: 'Run the engine below full power by lowering chamber pressure.',
  ascent: 'Fire the engine and climb from the ground to space over about 30 seconds.',
  descent: 'Fire the engine and come down from space to the ground over about 30 seconds.',
  overlay: 'Colour the gas inside the engine by how fast or how hot it is.',
};

/** Slider names and tips for an aerospike, whose dimensions describe one of its thrust cells. */
export const AEROSPIKE_DIMS = {
  chamberDia: {
    label: 'Thrust cell width',
    tip: 'Width of each small combustion chamber feeding the spike. Wider cells strain their walls more and are prone to instability.',
  },
  chamberLen: {
    label: 'Thrust cell length',
    tip: 'Length of each thrust cell. Too short and the propellant leaves before it finishes burning.',
  },
  throatDia: {
    label: 'Cell throat diameter',
    tip: 'The narrowest point of each thrust cell. Wider throats let more propellant through, which means more thrust.',
  },
  exitDia: {
    label: 'Engine exit diameter',
    tip: 'Width of the ring of thrust cells, which sets how far the gas can expand along the spike. Below the altitude it suits, the air squeezes the jet to fit, so it never over-expands.',
  },
  nozzleLenPct: {
    label: 'Spike length',
    tip: 'How much of a full-length spike is kept before it is cut off flat. The cut-off end costs only a little efficiency and saves a lot of weight.',
  },
};

/** Name and tip of the slider that sets how many chambers, or thrust cells, the engine has. */
export const COUNT_COPY = {
  chambers: {
    label: 'Chambers',
    tip: 'How many identical chambers share the engine. Thrust and propellant flow rise with each one.',
  },
  cells: {
    label: 'Thrust cells',
    tip: 'How many small chambers fire along the spike. Thrust and propellant flow rise with each one.',
  },
};

/** Tooltip for the figures worked out from the simulated gas. */
export const SIMULATED_TIP =
  'The same figure worked out from the simulated gas, and how far it is from the one above, which comes from a formula. Thrust is measured where the gas leaves the nozzle and propellant flow at the throat. It needs the engine firing with Engine gas set to Simulated, and Plume set to Simulated too while the jet has left the wall, torn off or held at a dual bell\'s kink. There is none for an aerospike, for a nuclear engine whose jet has left the wall, or with a nozzle extension partly seated.';

export const STATE_COPY: Record<ExpansionState, { label: string; text: string }> = {
  ideal: {
    label: 'Ideally expanded',
    text: 'Exhaust pressure matches the surrounding air. This nozzle is the right size for this altitude.',
  },
  over: {
    label: 'Over-expanded',
    text: 'The nozzle is too big for this altitude, so the surrounding air pinches the plume inward.',
  },
  under: {
    label: 'Under-expanded',
    text: 'The nozzle is too small for this altitude, so the plume balloons outward after leaving it.',
  },
  compensating: {
    label: 'Altitude compensating',
    text: 'Nothing but air holds in the outside of an aerospike jet, so the air squeezes it until the exhaust leaves at the outside pressure. A bell this size would be over-expanded here.',
  },
  separated: {
    label: 'Flow separation!',
    text: 'The nozzle is far too big for this altitude. The exhaust has torn away from the nozzle wall, wasting thrust.',
  },
  held: {
    label: 'Held at the kink',
    text: 'The big bell is too big for the air here, so the jet lets go of the wall at the kink, on purpose. Only the short inner bell is working, which wastes less thrust than a jet torn off a bell this size.',
  },
};

/** What the air does for an expansion-deflection nozzle too big for the altitude. */
const ED_COMPENSATING_TEXT =
  'The outside air reaches up into the hollow behind the plug, so the gas hugs the wall and leaves at the outside pressure. A plain bell this size would be over-expanded here.';

/** What the gas does as it leaves an engine with no nozzle, which can be in only these three states. */
const NO_NOZZLE_TEXT: Partial<Record<ExpansionState, string>> = {
  under: 'There is no nozzle, so the gas leaves the throat at well above the outside pressure and balloons outward.',
  ideal: 'There is no nozzle, but the chamber pressure is low enough that the gas leaves the throat at about the outside pressure.',
  over: 'There is no nozzle, but the chamber pressure is so low that the gas leaves the throat below the outside pressure, and the air pinches it inward.',
};

/**
 * The line under the "Nozzle exit vs outside air" state. A dual bell whose jet still has hold of
 * the wall says it fills the outer bell; an engine with no nozzle has its own words.
 */
export function expansionText(result: SimResult, exhaust: ExhaustId): string {
  if (exhaust === 'none' && NO_NOZZLE_TEXT[result.state]) return NO_NOZZLE_TEXT[result.state]!;
  if (exhaust === 'expansionDeflection' && result.state === 'compensating') return ED_COMPENSATING_TEXT;
  const text = STATE_COPY[result.state].text;
  return exhaust === 'dualBell' && !jetLeftWall(result.state) ? `${text} The jet fills the outer bell.` : text;
}

export const FAILURE_COPY: Record<Exclude<Failure, null>, { title: string; text: string }> = {
  burst: {
    title: 'Chamber burst',
    text: 'The chamber pressure was more than the walls could hold. Lower the chamber pressure or narrow the chamber. Growing the whole engine with Engine scale is safe, because the walls thicken with it.',
  },
  burnthrough: {
    title: 'Throat burn-through',
    text: 'The throat got too hot and melted through. Lower the chamber pressure or widen the throat. Small, high-pressure throats are the hardest to keep cool.',
  },
  meltdown: {
    title: 'Reactor core meltdown',
    text: 'The reactor core ran hotter than its fuel elements can take and they broke up. Lower the core temperature. Hotter propellant is more efficient, which is why real nuclear engines run so close to this limit.',
  },
  instability: {
    title: 'Combustion instability',
    text: 'The chamber is so wide that pressure waves built up inside it and shook the engine apart. Narrow the chamber or lower the chamber pressure.',
  },
  flameout: {
    title: 'Flame-out',
    text: 'The mixture is too cold to keep burning: there is so much more of one propellant than the other that the flame went out. The engine is unharmed. Move the mixture ratio back toward the middle of its range. Relighting with nothing changed goes back to the last setup that ran.',
  },
  inert: {
    title: 'Nothing to burn it with',
    text: 'This fuel cannot burn without an oxidiser, and it does not break down by itself, so the engine never lit. The engine is unharmed. Pick an oxidiser. Relighting with nothing changed goes back to the last setup that ran.',
  },
  detonation: {
    title: 'Detonation',
    text: 'One of these propellants explodes when it is pumped or jolted, and it went off in the engine instead of burning steadily. Pick a different fuel or oxidiser.',
  },
  unsolved: {
    title: 'No answer',
    text: 'The chemistry would not settle for this mixture, so there is no way to say how the engine runs, and no figures are shown. Try a different mixture ratio or chamber pressure. Relighting with nothing changed goes back to the last setup that ran.',
  },
};

/** False when the figures cannot be trusted at all: no solve settled, so none are shown. */
export function showsFigures(result: SimResult): boolean {
  return result.settled;
}

/** What the line under the limit bars says about a failure, when it is not the usual one. */
const FAILURE_NOTE: Partial<Record<Exclude<Failure, null>, string>> = {
  flameout: 'This mixture will not keep burning.',
  inert: 'Nothing here will burn.',
  detonation: 'A propellant here would explode in the engine.',
  unsolved: 'No figures: the chemistry would not settle.',
};

/** The line under the limit bars about the engine's failure, or '' when it has none. */
export function limitNote(result: SimResult): string {
  const f = result.failure;
  if (!showsFigures(result)) return (f && FAILURE_NOTE[f]) ?? FAILURE_NOTE.unsolved!;
  if (!f) return '';
  return FAILURE_NOTE[f] ?? 'Past a limit: this engine will fail when fired.';
}

/** Plain names for what the exhaust is made of, keyed by the thermo data's species names. */
export const SPECIES_NAMES: Record<string, string> = {
  // Hydrogen, oxygen, carbon, nitrogen
  H2O: 'Steam',
  'H2O(L)': 'Liquid water',
  'H2O(cr)': 'Ice',
  H2: 'Hydrogen',
  H: 'Hydrogen atoms',
  O2: 'Oxygen',
  O: 'Oxygen atoms',
  OH: 'Hydroxyl (OH)',
  CO2: 'Carbon dioxide',
  CO: 'Carbon monoxide',
  'C(gr)': 'Soot',
  C3: 'Carbon vapour (C3)',
  CH4: 'Methane',
  'C10H8,naphthale': 'Naphthalene',
  N2: 'Nitrogen',
  NO: 'Nitric oxide',
  NH3: 'Ammonia',
  He: 'Helium',
  // Fluorine and chlorine
  HF: 'Hydrogen fluoride',
  H2F2: 'Paired hydrogen fluoride (H2F2)',
  H6F6: 'Hydrogen fluoride clusters (H6F6)',
  F: 'Fluorine atoms',
  F2: 'Fluorine',
  HCL: 'Hydrogen chloride',
  CL: 'Chlorine atoms',
  CL2: 'Chlorine',
  CLF: 'Chlorine monofluoride',
  CLF3: 'Chlorine trifluoride',
  CF: 'Carbon monofluoride (CF)',
  CF2: 'Carbon difluoride (CF2)',
  CF3: 'Trifluoromethyl (CF3)',
  CF4: 'Carbon tetrafluoride',
  CF3CL: 'Chlorotrifluoromethane (CF3Cl)',
  C2F2: 'Difluoroacetylene (C2F2)',
  COF2: 'Carbonyl fluoride',
  NF3: 'Nitrogen trifluoride',
  NOF: 'Nitrosyl fluoride',
  NOF3: 'Trifluoramine oxide (NOF3)',
  NO2F: 'Nitryl fluoride',
  'NH4CL(II)': 'Solid ammonium chloride',
  'NH4F(cr)': 'Solid ammonium fluoride',
  // Boron
  'B(b)': 'Solid boron',
  BO: 'Boron monoxide (BO)',
  B2O2: 'Diboron dioxide (B2O2)',
  B2O3: 'Boron oxide vapour',
  'B2O3(L)': 'Liquid boron oxide',
  'B2O3(cr)': 'Solid boron oxide',
  BOF: 'Boron oxyfluoride (BOF)',
  BF: 'Boron monofluoride (BF)',
  BF2: 'Boron difluoride (BF2)',
  BF3: 'Boron trifluoride',
  BF2CL: 'Boron chlorodifluoride (BF2Cl)',
  BF2OH: 'Difluoroboric acid (BF2OH)',
  'BN(cr)': 'Solid boron nitride',
  HBO: 'Oxoborane (HBO)',
  HBO2: 'Metaboric acid',
  'HBO2(L)': 'Liquid metaboric acid',
  'HBO2(cr)': 'Solid metaboric acid',
  // Aluminium
  'AL2O3(a)': 'Solid aluminium oxide',
  'AL2O3(L)': 'Liquid aluminium oxide',
  'AL(OH)3(a)': 'Solid aluminium hydroxide',
  'AL4C3(cr)': 'Solid aluminium carbide',
  ALF3: 'Aluminium fluoride',
  'ALF3(II)': 'Solid aluminium fluoride',
  ALF2CL: 'Aluminium chlorodifluoride (AlF2Cl)',
  // Beryllium
  Be: 'Beryllium vapour',
  'Be(OH)2': 'Beryllium hydroxide',
  Be2F4: 'Paired beryllium fluoride (Be2F4)',
  Be2O: 'Diberyllium oxide (Be2O)',
  Be2OF2: 'Beryllium oxyfluoride (Be2OF2)',
  'Be3N2(L)': 'Liquid beryllium nitride',
  Be3O3: 'Beryllium oxide rings (Be3O3)',
  Be4O4: 'Beryllium oxide rings (Be4O4)',
  BeCL2: 'Beryllium chloride',
  BeF: 'Beryllium monofluoride (BeF)',
  BeF2: 'Beryllium fluoride',
  'BeF2(a)': 'Solid beryllium fluoride',
  'BeO(L)': 'Liquid beryllium oxide',
  'BeO(a)': 'Solid beryllium oxide',
  'BeO(b)': 'Solid beryllium oxide',
  // Lithium
  Li: 'Lithium vapour',
  Li2: 'Paired lithium (Li2)',
  'Li2CO3(L)': 'Liquid lithium carbonate',
  'Li2CO3(cr)': 'Solid lithium carbonate',
  Li2F2: 'Paired lithium fluoride (Li2F2)',
  Li3F3: 'Lithium fluoride clusters (Li3F3)',
  Li2O: 'Lithium oxide',
  'Li2O(L)': 'Liquid lithium oxide',
  'Li2O(cr)': 'Solid lithium oxide',
  Li2O2H2: 'Paired lithium hydroxide (Li2O2H2)',
  LiCL: 'Lithium chloride',
  LiF: 'Lithium fluoride',
  'LiF(L)': 'Liquid lithium fluoride',
  'LiF(cr)': 'Solid lithium fluoride',
  LiNO3: 'Lithium nitrate',
  'LiNO3(L)': 'Liquid lithium nitrate',
  'LiNO3(cr)': 'Solid lithium nitrate',
  LiO: 'Lithium monoxide (LiO)',
  LiOH: 'Lithium hydroxide',
  'LiOH(cr)': 'Solid lithium hydroxide',
  // Found by sweeping every pair across its mixtures, and every liquid and solid in the data
  HCN: 'Hydrogen cyanide',
  AL: 'Aluminium vapour',
  CN: 'Cyano radical (CN)',
  'C2H2,acetylene': 'Acetylene',
  BO2: 'Boron dioxide (BO2)',
  H3B3O6: 'Metaboric acid rings (H3B3O6)',
  BHF2: 'Difluoroborane (BHF2)',
  B3O3F3: 'Boron oxyfluoride rings (B3O3F3)',
  BFCL2: 'Boron dichlorofluoride (BFCl2)',
  Li2CL2: 'Paired lithium chloride (Li2Cl2)',
  LiH: 'Lithium hydride',
  ALF: 'Aluminium monofluoride (AlF)',
  AL2O: 'Dialuminium oxide (Al2O)',
  ALCL3: 'Aluminium chloride',
  ALFCL2: 'Aluminium dichlorofluoride (AlFCl2)',
  BeO: 'Beryllium oxide vapour',
  BeOH: 'Beryllium monohydroxide (BeOH)',
  BeCL: 'Beryllium monochloride (BeCl)',
  'AL(cr)': 'Solid aluminium',
  'AL(L)': 'Liquid aluminium',
  ALCL: 'Aluminium monochloride (AlCl)',
  'ALCL3(cr)': 'Solid aluminium chloride',
  'ALCL3(L)': 'Liquid aluminium chloride',
  'ALF3(I)': 'Solid aluminium fluoride',
  'ALH3(a)': 'Solid aluminium hydride',
  'ALN(cr)': 'Solid aluminium nitride',
  'ALN(L)': 'Liquid aluminium nitride',
  'B(L)': 'Liquid boron',
  'BN(L)': 'Liquid boron nitride',
  'B3O3H3(cr)': 'Solid boroxine (B3O3H3)',
  'B4C(cr)': 'Solid boron carbide',
  'B4C(L)': 'Liquid boron carbide',
  'Be(a)': 'Solid beryllium',
  'Be(b)': 'Solid beryllium',
  'Be(L)': 'Liquid beryllium',
  'BeAL2O4(cr)': 'Solid beryllium aluminate',
  'BeAL2O4(L)': 'Liquid beryllium aluminate',
  'BeCO3(cr)': 'Solid beryllium carbonate',
  'BeCL2(a)': 'Solid beryllium chloride',
  'BeCL2(b)': 'Solid beryllium chloride',
  'BeCL2(L)': 'Liquid beryllium chloride',
  'BeF2(b)': 'Solid beryllium fluoride',
  'BeF2(L)': 'Liquid beryllium fluoride',
  'Be(OH)2(b)': 'Solid beryllium hydroxide',
  'Be2C(cr)': 'Solid beryllium carbide',
  'Be2C(L)': 'Liquid beryllium carbide',
  'Be3N2(a)': 'Solid beryllium nitride',
  'Be3N2(b)': 'Solid beryllium nitride',
  'H3BO3(cr)': 'Solid boric acid',
  'H3BO3(L)': 'Liquid boric acid',
  'Li(cr)': 'Solid lithium',
  'Li(L)': 'Liquid lithium',
  'LiALO2(cr)': 'Solid lithium aluminate',
  'LiALO2(L)': 'Liquid lithium aluminate',
  'LiBO2(cr)': 'Solid lithium metaborate',
  'LiBO2(L)': 'Liquid lithium metaborate',
  'LiCL(cr)': 'Solid lithium chloride',
  'LiCL(L)': 'Liquid lithium chloride',
  'LiH(cr)': 'Solid lithium hydride',
  'LiH(L)': 'Liquid lithium hydride',
  'LiNO2(II)': 'Solid lithium nitrite',
  'LiNO2(I)': 'Solid lithium nitrite',
  'LiNO2(L)': 'Liquid lithium nitrite',
  'LiOH(L)': 'Liquid lithium hydroxide',
  'Li2O2(cr)': 'Solid lithium peroxide',
  'Li3ALF6(IV)': 'Solid lithium hexafluoroaluminate',
  'Li3ALF6(III)': 'Solid lithium hexafluoroaluminate',
  'Li3ALF6(II)': 'Solid lithium hexafluoroaluminate',
  'Li3ALF6(I)': 'Solid lithium hexafluoroaluminate',
  'Li3ALF6(L)': 'Liquid lithium hexafluoroaluminate',
  'Li3N(cr)': 'Solid lithium nitride',
  'NH4CL(III)': 'Solid ammonium chloride',
  'NH4F(L)': 'Liquid ammonium fluoride',
};

/**
 * A plain name for an exhaust species, or its formula where there is none, tidied from the data's
 * spelling (AL and CL for Al and Cl, a comment after a comma) so that a miss reads as a formula.
 */
export function speciesName(name: string): string {
  if (Object.hasOwn(SPECIES_NAMES, name)) return SPECIES_NAMES[name];
  return name.split(',')[0].replace(/AL/g, 'Al').replace(/CL/g, 'Cl');
}

/** The exhaust as "Steam 63% · Hydrogen 29% · …", the dots marking what is too small to list. Never changes `exhaust`. */
export function exhaustLine(exhaust: readonly { name: string; share: number }[]): string {
  if (exhaust.length === 0) return '';
  // Species with the same plain name (two solid forms of one oxide) are one thing to the reader.
  const byName = new Map<string, number>();
  for (const { name, share } of exhaust) {
    const plain = speciesName(name);
    byName.set(plain, (byName.get(plain) ?? 0) + share);
  }
  const merged = [...byName].sort((a, b) => b[1] - a[1]);
  const parts = merged.map(([name, share]) => `${name} ${share < 0.005 ? '<1' : Math.round(share * 100)}%`);
  const listed = exhaust.reduce((sum, e) => sum + e.share, 0);
  if (listed < 0.99) parts.push('…');
  return parts.join(' · ');
}

/** Failure text, with wording specific to an energy source where the general wording would mislead. */
export function failureCopy(failure: Exclude<Failure, null>, energy: EnergyId): { title: string; text: string } {
  if (energy === 'saltwater' && failure === 'burnthrough') {
    return {
      title: 'Nozzle vaporised',
      text: 'The fission reaction ran hotter than the layer of water protecting the nozzle could take. Turn down the reaction temperature, lower the chamber pressure or widen the throat.',
    };
  }
  if (failure === 'unsolved' && ENERGY_SOURCES[energy].mixKind === 'temperature') {
    return {
      title: FAILURE_COPY.unsolved.title,
      text: 'The chemistry of this fluid would not settle at this temperature, so there is no way to say how the engine runs, and no figures are shown. Try a different temperature or chamber pressure. Restarting with nothing changed goes back to the last setup that ran.',
    };
  }
  return FAILURE_COPY[failure];
}

export const LIMIT_COPY = {
  structural: { label: 'Wall stress', tip: 'How close the chamber walls are to bursting from the pressure inside.' },
  heating: { label: 'Heat load', tip: 'How close the hottest part is to melting: the throat, or the reactor core in a nuclear thermal engine. Throat heat rises with chamber pressure and with smaller throats.' },
  instability: { label: 'Instability', tip: 'How close the chamber is to shaking itself apart. Rises with chamber width.' },
};
