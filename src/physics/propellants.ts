import type { GasProps, PlumeLook, Propellant, PropellantId } from './types';

const R_UNIVERSAL = 8314.46;

/** A fluid a nuclear reactor heats, its gas worked out by the solver from thermo reactant `fluid`
 * at the core temperature (the "mixture" setting, K). */
function reactorFluid(id: PropellantId, name: string, tip: string, fuel: string, fluid: string, look: PlumeLook): Propellant {
  return {
    id,
    energy: 'reactor',
    name,
    tip,
    fuel,
    oxidiser: 'a reactor to heat it',
    ofMin: 1500,
    ofMax: 3200,
    ofDefault: 2360,
    lStarRef: 0,
    table: [],
    look,
    fluid,
  };
}

/**
 * The look an electrically heated fluid has until the solver has worked one out from its exhaust:
 * a faint warm glow.
 */
const HEATED_LOOK: PlumeLook = {
    core: [0.98, 0.94, 0.95], mid: [0.9, 0.8, 0.85], edge: [0.8, 0.65, 0.75], richTint: [0.8, 0.65, 0.75],
    opacity: 0.35, soot: 0, smoke: 0, afterburn: [1.0, 0.7, 0.4], afterburnStrength: 0.5, particles: 0,
  };

/**
 * A fluid an electric heater or arc heats, its gas worked out by the solver from thermo reactant
 * `fluid` and the energy the engine's power gives each kilogram. There is no mixture setting.
 */
function heatedFluid(id: PropellantId, energy: 'resistojet' | 'arcjet', name: string, tip: string, fuel: string, fluid: string): Propellant {
  return {
    id,
    energy,
    name,
    tip,
    fuel,
    oxidiser: energy === 'arcjet' ? 'an electric arc to heat it' : 'an electric heater to warm it',
    ofMin: 0,
    ofMax: 0,
    ofDefault: 0,
    lStarRef: 0,
    table: [],
    look: HEATED_LOOK,
    fluid,
  };
}

const KEROLOX_LOOK: PlumeLook = {
  core: [1.0, 0.93, 0.72],
  mid: [1.0, 0.62, 0.2],
  edge: [0.95, 0.33, 0.06],
  richTint: [0.85, 0.3, 0.04],
  opacity: 1.0,
  soot: 0.45,
  smoke: 0.08,
  afterburn: [1.0, 0.5, 0.14],
  afterburnStrength: 0.8,
  particles: 0.3,
};

// Chamber properties from published chemical-equilibrium (NASA CEA) results at
// roughly 70 bar. Gamma is an effective value for the nozzle expansion.
export const PROPELLANTS: Record<PropellantId, Propellant> = {
  kerolox: {
    id: 'kerolox',
    energy: 'combustion',
    name: 'Kerolox',
    tip: 'Kerosene and liquid oxygen. Dense, cheap and powerful, with a bright sooty flame.',
    fuel: 'RP-1 kerosene',
    oxidiser: 'liquid oxygen',
    ofMin: 1.8,
    ofMax: 3.4,
    ofDefault: 2.36,
    lStarRef: 1.0,
    table: [
      { of: 1.8, tc: 3050, gamma: 1.225, molarMass: 19.3 },
      { of: 2.1, tc: 3350, gamma: 1.21, molarMass: 20.9 },
      { of: 2.4, tc: 3540, gamma: 1.195, molarMass: 22.4 },
      { of: 2.7, tc: 3640, gamma: 1.185, molarMass: 23.7 },
      { of: 3.0, tc: 3670, gamma: 1.18, molarMass: 24.8 },
      { of: 3.4, tc: 3620, gamma: 1.175, molarMass: 26.2 },
    ],
    look: KEROLOX_LOOK,
    pair: { fuel: 'rp1', oxidiser: 'lox' },
  },
  hydrolox: {
    id: 'hydrolox',
    energy: 'combustion',
    name: 'Hydrolox',
    tip: 'Liquid hydrogen and liquid oxygen. The most efficient pair that burns, with a faint blue flame.',
    fuel: 'liquid hydrogen',
    oxidiser: 'liquid oxygen',
    ofMin: 3.5,
    ofMax: 8.0,
    ofDefault: 6.0,
    lStarRef: 0.7,
    table: [
      { of: 3.5, tc: 2650, gamma: 1.215, molarMass: 8.9 },
      { of: 4.5, tc: 3050, gamma: 1.195, molarMass: 10.8 },
      { of: 5.5, tc: 3350, gamma: 1.175, molarMass: 12.6 },
      { of: 6.0, tc: 3470, gamma: 1.165, molarMass: 13.4 },
      { of: 7.0, tc: 3600, gamma: 1.155, molarMass: 14.9 },
      { of: 8.0, tc: 3650, gamma: 1.145, molarMass: 16.2 },
    ],
    look: {
      core: [0.86, 0.9, 1.0],
      mid: [0.5, 0.62, 1.0],
      edge: [0.42, 0.36, 0.9],
      richTint: [0.75, 0.5, 0.85],
      opacity: 0.42,
      soot: 0,
      smoke: 0,
      afterburn: [1.0, 0.5, 0.36],
      afterburnStrength: 1.0,
      particles: 0,
    },
    pair: { fuel: 'h2', oxidiser: 'lox' },
  },
  methalox: {
    id: 'methalox',
    energy: 'combustion',
    name: 'Methalox',
    tip: 'Liquid methane and liquid oxygen. Cleaner than kerosene and nearly as dense.',
    fuel: 'liquid methane',
    oxidiser: 'liquid oxygen',
    ofMin: 2.6,
    ofMax: 4.2,
    ofDefault: 3.6,
    lStarRef: 0.9,
    table: [
      { of: 2.6, tc: 3150, gamma: 1.185, molarMass: 18.3 },
      { of: 3.0, tc: 3400, gamma: 1.175, molarMass: 19.8 },
      { of: 3.4, tc: 3550, gamma: 1.165, molarMass: 21.2 },
      { of: 3.8, tc: 3620, gamma: 1.16, molarMass: 22.4 },
      { of: 4.2, tc: 3610, gamma: 1.155, molarMass: 23.5 },
    ],
    look: {
      core: [0.8, 0.86, 1.0],
      mid: [0.52, 0.5, 1.0],
      edge: [1.0, 0.45, 0.5],
      richTint: [1.0, 0.55, 0.3],
      opacity: 0.6,
      soot: 0.04,
      smoke: 0,
      afterburn: [1.0, 0.52, 0.42],
      afterburnStrength: 0.6,
      particles: 0,
    },
    pair: { fuel: 'ch4', oxidiser: 'lox' },
  },
  hypergolic: {
    id: 'hypergolic',
    energy: 'combustion',
    name: 'Hypergolic',
    tip: 'Hydrazine fuel and nitrogen tetroxide. They ignite on contact, so the engine always lights.',
    fuel: 'UDMH hydrazine',
    oxidiser: 'nitrogen tetroxide',
    ofMin: 1.6,
    ofMax: 3.2,
    ofDefault: 2.6,
    lStarRef: 0.8,
    table: [
      { of: 1.6, tc: 2950, gamma: 1.225, molarMass: 20.0 },
      { of: 2.0, tc: 3200, gamma: 1.215, molarMass: 21.5 },
      { of: 2.4, tc: 3380, gamma: 1.205, molarMass: 23.0 },
      { of: 2.8, tc: 3430, gamma: 1.2, molarMass: 24.3 },
      { of: 3.2, tc: 3380, gamma: 1.195, molarMass: 25.4 },
    ],
    look: {
      core: [1.0, 0.86, 0.7],
      mid: [1.0, 0.55, 0.3],
      edge: [0.75, 0.3, 0.14],
      richTint: [0.7, 0.36, 0.16],
      opacity: 0.7,
      soot: 0.15,
      smoke: 0.12,
      afterburn: [0.9, 0.45, 0.2],
      afterburnStrength: 0.5,
      particles: 0.05,
    },
    pair: { fuel: 'udmh', oxidiser: 'n2o4' },
  },
  // Any fuel and oxidiser, worked out by the chemistry solver (see gasSource.ts). None of the
  // figures below is read: the solver answers for it.
  calculated: {
    id: 'calculated',
    energy: 'combustion',
    name: 'Calculated',
    tip: 'Any fuel with any oxidiser, its flame worked out from the chemistry as it burns.',
    fuel: 'the chosen fuel',
    oxidiser: 'the chosen oxidiser',
    ofMin: 0,
    ofMax: 0,
    ofDefault: 0,
    lStarRef: 1.0,
    table: [],
    look: KEROLOX_LOOK,
  },
  solid: {
    id: 'solid',
    energy: 'solid',
    name: 'Solid (APCP)',
    tip: 'Aluminium powder and ammonium perchlorate set in rubber. Very bright, very smoky.',
    fuel: 'aluminium + rubber binder',
    oxidiser: 'ammonium perchlorate',
    ofMin: 1,
    ofMax: 1,
    ofDefault: 1,
    lStarRef: 0,
    table: [{ of: 1, tc: 3400, gamma: 1.18, molarMass: 28.5 }],
    look: {
      core: [1.0, 0.98, 0.9],
      mid: [1.0, 0.86, 0.55],
      edge: [1.0, 0.6, 0.25],
      richTint: [1.0, 0.6, 0.25],
      opacity: 1.0,
      soot: 0.1,
      smoke: 1.0,
      afterburn: [1.0, 0.7, 0.4],
      afterburnStrength: 0.7,
      particles: 1.0,
    },
  },
  'ntr-hydrogen': {
    id: 'ntr-hydrogen',
    energy: 'reactor',
    name: 'Hydrogen',
    tip: 'The lightest gas there is, so it leaves fastest: about twice as efficient as any flame.',
    fuel: 'liquid hydrogen',
    oxidiser: 'a reactor to heat it',
    // For this propellant the "mixture" setting is the reactor core temperature in kelvin.
    ofMin: 1500,
    ofMax: 3200,
    ofDefault: 2360,
    lStarRef: 0,
    table: [
      { of: 1500, tc: 1500, gamma: 1.36, molarMass: 2.016 },
      { of: 2000, tc: 2000, gamma: 1.34, molarMass: 2.016 },
      { of: 2360, tc: 2360, gamma: 1.33, molarMass: 2.016 },
      { of: 2800, tc: 2800, gamma: 1.315, molarMass: 2.01 },
      { of: 3200, tc: 3200, gamma: 1.3, molarMass: 1.99 },
    ],
    look: {
      core: [0.92, 0.88, 1.0],
      mid: [0.72, 0.62, 0.98],
      edge: [0.6, 0.45, 0.9],
      richTint: [0.6, 0.45, 0.9],
      opacity: 0.42,
      soot: 0,
      smoke: 0,
      afterburn: [1.0, 0.55, 0.4],
      afterburnStrength: 1.0,
      particles: 0,
    },
  },
  // The other fluids a reactor can heat. The solver works out how each breaks apart at the core's
  // temperature and how it expands (see gasSource.ts); docs/future-work.md compares the results with
  // the figures Zubrin gives for a reactor at 2800 K in his NIMF study (1991).
  'ntr-ammonia': 
    reactorFluid('ntr-ammonia', 'Ammonia',
    'Breaks into nitrogen and hydrogen as it is heated. About half as efficient as hydrogen, but far easier to store.',
    'liquid ammonia', 'NH3(L)', {
    // Mostly hydrogen and nitrogen: as faint as a hydrogen plume, a little warmer in colour.
    core: [0.98, 0.94, 0.9],
    mid: [0.9, 0.78, 0.7],
    edge: [0.8, 0.6, 0.6],
    richTint: [0.8, 0.6, 0.6],
    opacity: 0.4,
    soot: 0,
    smoke: 0,
    afterburn: [1.0, 0.7, 0.35],
    afterburnStrength: 0.7,
    particles: 0,
  }),
  'ntr-methane': 
    reactorFluid('ntr-methane', 'Methane',
    'Breaks into hydrogen and carbon as it is heated. A little better than ammonia, and it leaves carbon behind.',
    'liquid methane', 'CH4(L)', {
    // Hydrogen carrying the carbon the methane left behind, glowing orange.
    core: [1.0, 0.9, 0.7],
    mid: [1.0, 0.66, 0.28],
    edge: [0.9, 0.4, 0.1],
    richTint: [0.9, 0.4, 0.1],
    opacity: 0.8,
    soot: 0.5,
    smoke: 0.1,
    afterburn: [1.0, 0.55, 0.2],
    afterburnStrength: 0.9,
    particles: 0.6,
  }),
  'ntr-water': 
    reactorFluid('ntr-water', 'Water',
    'Leaves as superheated steam. Under half as efficient as hydrogen, but it can be found almost anywhere.',
    'water', 'H2O(L)', {
    // Superheated steam: almost nothing to see, and nothing left to burn.
    core: [0.95, 0.96, 1.0],
    mid: [0.8, 0.85, 0.95],
    edge: [0.7, 0.75, 0.85],
    richTint: [0.7, 0.75, 0.85],
    opacity: 0.3,
    soot: 0,
    smoke: 0,
    afterburn: [0.8, 0.85, 1.0],
    afterburnStrength: 0,
    particles: 0,
  }),
  'ntr-co2': 
    reactorFluid('ntr-co2', 'Carbon dioxide',
    'The heaviest choice, and the least efficient: about a quarter of hydrogen. It is what the air on Mars is made of.',
    'liquid carbon dioxide', 'CO2', {
    // Nearly invisible; the little carbon monoxide in it burns faintly blue.
    core: [0.92, 0.94, 1.0],
    mid: [0.75, 0.8, 0.95],
    edge: [0.6, 0.66, 0.9],
    richTint: [0.6, 0.66, 0.9],
    opacity: 0.25,
    soot: 0,
    smoke: 0,
    afterburn: [0.5, 0.65, 1.0],
    afterburnStrength: 0.1,
    particles: 0,
  }),
  'ntr-helium': 
    reactorFluid('ntr-helium', 'Helium',
    'An inert gas that cannot react with the core. Heavier than hydrogen, so a little over half as efficient.',
    'liquid helium', 'He', {
    // A hot inert gas: the faintest glow, and it cannot burn.
    core: [1.0, 0.95, 0.9],
    mid: [0.95, 0.85, 0.8],
    edge: [0.85, 0.75, 0.75],
    richTint: [0.85, 0.75, 0.75],
    opacity: 0.2,
    soot: 0,
    smoke: 0,
    afterburn: [1.0, 0.9, 0.8],
    afterburnStrength: 0,
    particles: 0,
  }),
  saltwater: {
    id: 'saltwater',
    energy: 'saltwater',
    name: 'Nuclear salt water',
    tip: 'Water carrying dissolved uranium salt: the propellant is also the fuel for its own fission.',
    fuel: 'uranium salt dissolved in water',
    oxidiser: 'its own fission to heat it',
    // For this propellant the "mixture" setting is the temperature of the fission reaction in
    // kelvin. The exhaust is water torn apart into a plasma of hydrogen and oxygen.
    ofMin: 100000,
    ofMax: 1000000,
    ofDefault: 470000,
    lStarRef: 0,
    table: [
      { of: 100000, tc: 100000, gamma: 1.3, molarMass: 6 },
      { of: 1000000, tc: 1000000, gamma: 1.3, molarMass: 6 },
    ],
    look: {
      core: [1.0, 1.0, 1.0],
      mid: [0.75, 0.88, 1.0],
      edge: [0.4, 0.62, 1.0],
      richTint: [0.4, 0.62, 1.0],
      opacity: 1.0,
      soot: 0,
      smoke: 0,
      afterburn: [0.6, 0.75, 1.0],
      afterburnStrength: 0,
      particles: 1.0,
    },
  },
  // What an electric heater or arc can heat. Hydrazine breaks down by itself and gives off heat,
  // so it leaves hot before the electricity adds anything.
  'rj-hydrazine': heatedFluid('rj-hydrazine', 'resistojet', 'Hydrazine',
    'Breaks down into hot gas by itself; the heater makes that gas hotter still. What most real ones use.',
    'hydrazine', 'N2H4(L)'),
  'rj-ammonia': heatedFluid('rj-ammonia', 'resistojet', 'Ammonia',
    'Easy to store, and breaks into light gases as it is heated. It has to be boiled first.',
    'liquid ammonia', 'NH3(L)'),
  'rj-hydrogen': heatedFluid('rj-hydrogen', 'resistojet', 'Hydrogen',
    'The lightest gas, so the most efficient, but it takes a great deal of power to heat each gram.',
    'liquid hydrogen', 'H2(L)'),
  'rj-water': heatedFluid('rj-water', 'resistojet', 'Water',
    'Safe and found everywhere, but boiling it uses up much of the power before it gets hot.',
    'water', 'H2O(L)'),
  'aj-hydrazine': heatedFluid('aj-hydrazine', 'arcjet', 'Hydrazine',
    'Breaks down into hot gas by itself, and the arc heats that gas much further. What flown arcjets use.',
    'hydrazine', 'N2H4(L)'),
  'aj-ammonia': heatedFluid('aj-ammonia', 'arcjet', 'Ammonia',
    'Easy to store. The arc tears it into nitrogen and hydrogen.',
    'liquid ammonia', 'NH3(L)'),
  'aj-hydrogen': heatedFluid('aj-hydrogen', 'arcjet', 'Hydrogen',
    'The most efficient choice by far, and the hardest to store.',
    'liquid hydrogen', 'H2(L)'),
};

export const PROPELLANT_IDS = Object.keys(PROPELLANTS) as PropellantId[];

export function isPropellantId(v: unknown): v is PropellantId {
  return typeof v === 'string' && Object.hasOwn(PROPELLANTS, v);
}

export function clampMixture(id: PropellantId, of: number): number {
  const p = PROPELLANTS[id];
  if (!Number.isFinite(of)) return p.ofDefault;
  return Math.min(p.ofMax, Math.max(p.ofMin, of));
}

/** Chamber gas properties at a mixture ratio (linear interpolation, clamped to the table). */
export function gasProps(id: PropellantId, of: number): GasProps {
  const t = PROPELLANTS[id].table;
  const x = clampMixture(id, of);
  let i = 0;
  while (i < t.length - 2 && x > t[i + 1].of) i++;
  const a = t[i];
  const b = t[Math.min(i + 1, t.length - 1)];
  const f = b.of === a.of ? 0 : Math.min(1, Math.max(0, (x - a.of) / (b.of - a.of)));
  const tc = a.tc + (b.tc - a.tc) * f;
  const gamma = a.gamma + (b.gamma - a.gamma) * f;
  const molarMass = a.molarMass + (b.molarMass - a.molarMass) * f;
  return { tc, gamma, molarMass, R: R_UNIVERSAL / molarMass };
}

/** -1 at the oxidiser-rich end of the range, 0 at peak flame temperature, +1 at the fuel-rich end. */
export function richness(id: PropellantId, of: number): number {
  const p = PROPELLANTS[id];
  if (p.table.length < 2) return 0;
  const peak = p.table.reduce((best, row) => (row.tc > best.tc ? row : best)).of;
  const x = clampMixture(id, of);
  if (x < peak) return (peak - x) / Math.max(1e-9, peak - p.ofMin);
  return -(x - peak) / Math.max(1e-9, p.ofMax - peak);
}
