// The fuels and oxidisers a user can pick: what each is made of, and facts about it.
// Every fact carries its source. Where no source was found the fact is left unset (see docs/future-work.md).
import { REACTANTS, type Reactant } from './thermo';
import { mixtureFrom, type Mixture } from './equilibrium';

export type Family = 'hydrogen' | 'hydrocarbon' | 'alcohol' | 'amine' | 'borane' | 'metal' | 'nitro' | 'cyanogen'
  | 'oxygen' | 'nitrogen-oxide' | 'peroxide' | 'halogen' | 'none';
export interface Fact { text: string; source: string }
export interface Ingredient {
  id: string; name: string; tip: string;
  group: 'Everyday' | 'Storable' | 'Exotic';
  family: Family;
  /** What it is made of: thermo.inp reactants and their mass shares (sum 1) */
  parts: { reactant: string; share: number }[];
  /** Heat content not from thermo.inp: the reactant record and where it came from */
  custom?: { reactant: Reactant; source: string }[];
  freezeC?: number; boilC?: number; pointsSource?: string;
  toxicity?: 0 | 1 | 2 | 3; toxicitySource?: string; toxicExhaust?: Fact;
  detonates?: Fact; attacksMaterials?: Fact; warning?: Fact;
  /** Runs alone over a catalyst */
  monopropellant?: Fact;
}

export const NO_OXIDISER = 'none';

// ---- Sources ----
const clark = (ch: string) => `Clark, Ignition! (1972), ${ch}`;
const hsdb = (what: string) => `HSDB via PubChem: ${what}`;
const MONOPROPS = clark('"The Hopeful Monoprops"');
const SP8081 = 'NASA SP-8081 (1972), Table I';

/** Freezing and boiling points, deg C at 1 atm. */
const pts = (freezeC: number | undefined, boilC: number | undefined, pointsSource: string) =>
  ({ freezeC, boilC, pointsSource });
/** NFPA 704 health rating mapped H0-1 -> 0, H2 -> 1, H3 -> 2, H4 -> 3. */
const nfpa = (health: 0 | 1 | 2 | 3 | 4, where: string) => ({
  toxicity: Math.max(0, health - 1) as 0 | 1 | 2 | 3,
  toxicitySource: `NFPA 704 health ${health}, ${where}`,
});
const one = (reactant: string) => [{ reactant, share: 1 }];
const nist = (name: string, elements: Record<string, number>, molarMass: number, kJ: number, id: string, ref: string) => ({
  reactant: { name, elements, molarMass, h: kJ * 1000, t: 298.15 },
  source: `NIST WebBook, liquid dfH ${kJ} kJ/mol (${ref}), https://webbook.nist.gov/cgi/cbook.cgi?ID=${id}&Mask=2`,
});

const HF_EXHAUST: Fact = {
  text: 'The exhaust holds hydrogen fluoride, a highly toxic and corrosive gas.',
  source: 'HSDB, PubChem CID 14917 (hydrogen fluoride)',
};
const NITRIC_ATTACKS: Fact = {
  text: 'Nitric acid attacks most metals; tanks need aluminium or special stainless steel, and an inhibitor.',
  source: `HSDB corrosivity, PubChem CID 944; ${clark('ch. 4')}`,
};
const PEROXIDE_ATTACKS: Fact = {
  text: 'Iron, copper, chromium and most metals make strong peroxide break down; it needs very clean aluminium tanks.',
  source: `CAMEO Chemicals (hydrogen peroxide); ${clark('ch. 5')}`,
};
const PEROXIDE_WARNING: Fact = {
  text: 'Strong peroxide breaks down violently on contact with rust, dust or metals, and can detonate if mixed with organics.',
  source: 'CAMEO Chemicals, PubChem CID 784 (hydrogen peroxide)',
};
const PEROXIDE_MONO: Fact = {
  text: 'Decomposes over a catalyst into hot steam and oxygen, with no fuel needed (the V-2 drove its pumps this way).',
  source: clark('ch. 1-2'),
};
const N2O_WARNING: Fact = {
  text: 'Nitrous oxide vapour can explode when heated strongly.',
  source: 'CAMEO Chemicals 8909 (nitrous oxide)',
};
const N2O_POINTS = pts(-90.8, -88.48, hsdb('nitrous oxide'));

const H2O2_90 = [{ reactant: 'H2O2(L)', share: 0.9 }, { reactant: 'H2O(L)', share: 0.1 }];

const fuels: Ingredient[] = [
  // Everyday
  {
    id: 'rp1', name: 'RP-1 (rocket kerosene)', group: 'Everyday', family: 'hydrocarbon', parts: one('RP-1'),
    tip: 'A refined kerosene, the fuel of the Saturn V first stage and the Falcon 9.',
    ...nfpa(2, 'CAMEO 960 (kerosene)'),
  },
  {
    id: 'h2', name: 'Liquid hydrogen', group: 'Everyday', family: 'hydrogen', parts: one('H2(L)'),
    tip: 'The lightest fuel there is, giving the highest performance of any common chemical rocket.',
    ...pts(-259.18, -252.8, 'DOE-PAC via PubChem: hydrogen'), ...nfpa(0, hsdb('hydrogen')),
  },
  {
    id: 'ch4', name: 'Liquid methane', group: 'Everyday', family: 'hydrocarbon', parts: one('CH4(L)'),
    tip: 'Natural gas chilled to a liquid, burned by newer engines such as SpaceX Raptor.',
    ...pts(-182.57, -161.5, hsdb('methane')), ...nfpa(2, hsdb('methane')),
  },
  {
    id: 'ethanol', name: 'Ethanol', group: 'Everyday', family: 'alcohol', parts: one('C2H5OH(L)'),
    tip: 'Drinking alcohol, one of the first rocket fuels ever used.',
    ...pts(-114.14, 78.24, hsdb('ethanol')), ...nfpa(2, hsdb('ethanol')),
  },
  {
    id: 'ethanol75', name: 'Ethanol 75% with water', group: 'Everyday', family: 'alcohol',
    parts: [{ reactant: 'C2H5OH(L)', share: 0.75 }, { reactant: 'H2O(L)', share: 0.25 }],
    tip: 'Alcohol watered down to keep the engine cool, as burned by the German V-2.',
  },
  {
    id: 'methanol', name: 'Methanol', group: 'Everyday', family: 'alcohol', parts: one('CH3OH(L)'),
    tip: 'Wood alcohol, a simple fuel used in early and amateur rockets.',
    ...pts(-97.8, 64.7, hsdb('methanol')), ...nfpa(1, hsdb('methanol')),
  },
  {
    id: 'gasoline', name: 'Gasoline (iso-octane)', group: 'Everyday', family: 'hydrocarbon', parts: one('C8H18(L),isooct'),
    tip: 'Car petrol, modelled here as pure iso-octane; Goddard flew the first liquid rocket on gasoline.',
  },
  {
    id: 'jeta', name: 'Jet-A (aviation kerosene)', group: 'Everyday', family: 'hydrocarbon', parts: one('Jet-A(L)'),
    tip: 'The kerosene airliners burn, close to rocket kerosene but less tightly refined.',
    ...nfpa(2, 'CAMEO 960 (kerosene)'),
  },
  {
    id: 'c3h8', name: 'Liquid propane', group: 'Everyday', family: 'hydrocarbon', parts: one('C3H8(L)'),
    tip: 'Barbecue gas, which stays liquid under modest pressure.',
    ...pts(-187.6, -42.1, hsdb('propane')), ...nfpa(2, hsdb('propane')),
  },
  {
    id: 'c2h6', name: 'Liquid ethane', group: 'Everyday', family: 'hydrocarbon', parts: one('C2H6(L)'),
    tip: 'A light hydrocarbon gas from natural gas, studied as a denser alternative to methane.',
    ...pts(-182.79, -88.6, hsdb('ethane')), ...nfpa(1, hsdb('ethane')),
  },
  {
    id: 'ipa', name: 'Isopropyl alcohol', group: 'Everyday', family: 'alcohol', parts: one('C3H8O(L),isopropanol'),
    custom: [nist('C3H8O(L),isopropanol', { C: 3, H: 8, O: 1 }, 60.095, -317.0, 'C67630', 'Chao and Rossini, 1965')],
    tip: 'Rubbing alcohol, a favourite of amateur and small rocket engines.',
    ...pts(-87.9, 82.3, hsdb('isopropanol')), ...nfpa(1, hsdb('isopropanol')),
  },
  // Storable
  {
    id: 'n2h4', name: 'Hydrazine', group: 'Storable', family: 'amine', parts: one('N2H4(L)'),
    tip: 'A storable fuel that can also run alone over a catalyst, common in spacecraft thrusters.',
    ...pts(1.54, 113.55, hsdb('hydrazine')), ...nfpa(4, hsdb('hydrazine')),
    warning: {
      text: 'Breaks down with flame on rusty metal surfaces, though it takes a strong shock to make it detonate.',
      source: 'CAMEO Chemicals (hydrazine)',
    },
    monopropellant: {
      text: 'Decomposes alone when passed through a catalyst bed.',
      source: MONOPROPS,
    },
  },
  {
    id: 'mmh', name: 'Monomethylhydrazine (MMH)', group: 'Storable', family: 'amine', parts: one('CH6N2(L)'),
    tip: 'A hydrazine cousin that ignites on contact with nitrogen tetroxide, used in the Space Shuttle thrusters.',
    ...pts(-52.4, 87.5, hsdb('methylhydrazine')), ...nfpa(4, hsdb('methylhydrazine')),
  },
  {
    id: 'udmh', name: 'UDMH', group: 'Storable', family: 'amine', parts: one('C2H8N2(L),UDMH'),
    tip: 'Unsymmetrical dimethylhydrazine, a storable fuel used by Soviet and Chinese launchers.',
    ...pts(-58, 63.9, hsdb('1,1-dimethylhydrazine')), ...nfpa(4, hsdb('1,1-dimethylhydrazine')),
  },
  {
    id: 'aerozine50', name: 'Aerozine 50', group: 'Storable', family: 'amine',
    parts: [{ reactant: 'N2H4(L)', share: 0.5 }, { reactant: 'C2H8N2(L),UDMH', share: 0.5 }],
    tip: 'Half hydrazine and half UDMH, the fuel of the Titan II and the Apollo lunar module.',
  },
  {
    id: 'nh3', name: 'Liquid ammonia', group: 'Storable', family: 'amine', parts: one('NH3(L)'),
    tip: 'Ammonia, the fuel of the X-15 rocket plane.',
    ...pts(-77.7, -33.35, hsdb('ammonia')), ...nfpa(3, hsdb('ammonia')),
  },
  {
    id: 'aniline', name: 'Aniline', group: 'Storable', family: 'amine', parts: one('C6H5NH2(L)'),
    tip: 'An oily chemical once burned with nitric acid because the two ignite on contact.',
    ...pts(-6.0, 184.1, hsdb('aniline')), ...nfpa(2, hsdb('aniline')),
  },
  {
    id: 'furfuryl', name: 'Furfuryl alcohol', group: 'Storable', family: 'alcohol', parts: one('C5H6O2(L),furfuryl'),
    custom: [nist('C5H6O2(L),furfuryl', { C: 5, H: 6, O: 2 }, 98.0999, -276.4, 'C98000', 'Parks, Mosley, et al., 1950')],
    tip: 'A chemical made from farm waste that ignites on contact with nitric acid, used in early US rockets.',
    ...pts(-14.6, 171, hsdb('furfuryl alcohol')), ...nfpa(3, hsdb('furfuryl alcohol')),
  },
  {
    id: 'jp10', name: 'JP-10', group: 'Storable', family: 'hydrocarbon', parts: one('JP-10(L)'),
    tip: 'A dense, man-made missile fuel that packs more energy per litre than kerosene.',
  },
  // Exotic
  {
    id: 'syntin', name: 'Syntin', group: 'Exotic', family: 'hydrocarbon', parts: one('C10H16(L),syntin'),
    custom: [nist('C10H16(L),syntin', { C: 10, H: 16 }, 136.234, 131.9, 'C150895640',
      'trans-1-methyl-1,2-dicyclopropylcyclopropane; Pimenova, Kozina, et al., 1993')],
    tip: 'A strained, man-made Soviet hydrocarbon that held more energy than kerosene.',
  },
  {
    id: 'c2h2', name: 'Liquid acetylene', group: 'Exotic', family: 'hydrocarbon', parts: one('C2H2(L),acetyle'),
    tip: 'The welding gas, energetic but too unstable to keep as a liquid.',
    ...pts(-80.7, -84.7, `${hsdb('acetylene')} (triple point; sublimes)`), ...nfpa(0, hsdb('acetylene')),
    detonates: {
      text: 'Liquid acetylene is too unstable to use; its use is prohibited.',
      source: '29 CFR 1910.253(a)(2)',
    },
  },
  {
    id: 'b2h6', name: 'Diborane', group: 'Exotic', family: 'borane', parts: one('B2H6(L)'),
    tip: 'A boron hydride gas studied in the 1950s for its high energy.',
    ...pts(-165, -92.8, 'CAMEO Chemicals 4943 (diborane)'), ...nfpa(4, 'CAMEO Chemicals 4943'),
    warning: { text: 'Boranes catch fire on their own in air.', source: clark('ch. 10') },
  },
  {
    id: 'b5h9', name: 'Pentaborane', group: 'Exotic', family: 'borane', parts: one('B5H9(L)'),
    tip: 'A toxic boron fuel the US spent millions on in the 1950s, then abandoned.',
    ...pts(-46.6, undefined, 'CAMEO Chemicals 1285 (pentaborane)'), ...nfpa(4, 'CAMEO Chemicals 1285'),
    warning: { text: 'Boranes catch fire on their own in air.', source: clark('ch. 10') },
  },
  {
    id: 'li', name: 'Lithium', group: 'Exotic', family: 'metal', parts: one('Li(cr)'),
    tip: 'The lightest metal, tested as a fuel with fluorine for very high performance.',
    ...pts(180.54, 1342, hsdb('lithium')),
  },
  {
    id: 'al-slurry', name: 'Aluminium in kerosene (30%)', group: 'Exotic', family: 'metal',
    parts: [{ reactant: 'AL(cr)', share: 0.3 }, { reactant: 'RP-1', share: 0.7 }],
    tip: 'Fine aluminium powder carried in kerosene, adding the heat of burning metal.',
  },
  {
    id: 'be', name: 'Beryllium', group: 'Exotic', family: 'metal', parts: one('Be(a)'),
    tip: 'A light metal with a huge heat of burning, never flown because of its toxic exhaust.',
    toxicExhaust: { text: 'The exhaust holds beryllium oxide, a highly toxic dust.', source: 'HSDB, PubChem CID 14775 (beryllium oxide)' },
  },
  {
    id: 'c2n2', name: 'Cyanogen', group: 'Exotic', family: 'cyanogen', parts: one('C2N2(L)'),
    tip: 'A poisonous carbon-nitrogen gas that burns with one of the hottest flames known.',
    ...pts(-27.83, -21.1, hsdb('cyanogen')), ...nfpa(4, hsdb('cyanogen')),
  },
  {
    id: 'ch3no2', name: 'Nitromethane', group: 'Exotic', family: 'nitro', parts: one('CH3NO2(L)'),
    tip: 'The drag-racing fuel, which carries some of its own oxygen.',
    ...pts(-28.7, 101.1, hsdb('nitromethane')), ...nfpa(2, hsdb('nitromethane')),
    warning: {
      text: 'May explode if heated or strongly shocked; a little butanol makes it safer.',
      source: `CAMEO Chemicals (nitromethane); ${clark('ch. 2')}`,
    },
    monopropellant: { text: 'Was studied as a fuel that burns alone, with no oxidiser.', source: clark('ch. 1-2') },
  },
  {
    id: 'n2o-mono', name: 'Nitrous oxide alone', group: 'Exotic', family: 'nitrogen-oxide', parts: one('N2O'),
    tip: 'Laughing gas, which can break down on its own and release heat.',
    ...N2O_POINTS, warning: N2O_WARNING,
    monopropellant: { text: 'Can break down by itself and so act as a monopropellant.', source: clark('ch. 2') },
  },
  {
    id: 'htp90-mono', name: 'Hydrogen peroxide 90% alone', group: 'Exotic', family: 'peroxide', parts: H2O2_90,
    tip: 'Strong peroxide decomposed over a catalyst, as in jet packs and the V-2 turbopumps.',
    ...pts(-11, 141, 'ICSC via PubChem: hydrogen peroxide 90%'), ...nfpa(3, hsdb('hydrogen peroxide')),
    warning: PEROXIDE_WARNING, attacksMaterials: PEROXIDE_ATTACKS, monopropellant: PEROXIDE_MONO,
  },
];

const oxidisers: Ingredient[] = [
  {
    id: 'lox', name: 'Liquid oxygen', group: 'Everyday', family: 'oxygen', parts: one('O2(L)'),
    tip: 'Oxygen chilled to a liquid, the most common rocket oxidiser.',
    ...pts(-218.4, -182.96, hsdb('oxygen')),
    toxicity: 0, toxicitySource: 'NFPA 704 health 3 (HSDB via PubChem: oxygen) rates cold burns only; set to 0',
  },
  {
    id: 'n2o', name: 'Nitrous oxide', group: 'Everyday', family: 'nitrogen-oxide', parts: one('N2O'),
    tip: 'Laughing gas, the oxidiser of many hobby and hybrid rockets.',
    ...N2O_POINTS, warning: N2O_WARNING,
  },
  {
    id: 'htp90', name: 'Hydrogen peroxide 90%', group: 'Everyday', family: 'peroxide', parts: H2O2_90,
    tip: 'Strong peroxide, an oxidiser that is liquid at room temperature.',
    ...pts(-11, 141, 'ICSC via PubChem: hydrogen peroxide 90%'), ...nfpa(3, hsdb('hydrogen peroxide')),
    warning: PEROXIDE_WARNING, attacksMaterials: PEROXIDE_ATTACKS,
  },
  {
    id: 'htp98', name: 'Hydrogen peroxide 98%', group: 'Storable', family: 'peroxide',
    parts: [{ reactant: 'H2O2(L)', share: 0.98 }, { reactant: 'H2O(L)', share: 0.02 }],
    tip: 'Nearly pure peroxide, a little more energetic than the 90% grade.',
    ...nfpa(3, hsdb('hydrogen peroxide')), warning: PEROXIDE_WARNING, attacksMaterials: PEROXIDE_ATTACKS,
  },
  {
    id: 'n2o4', name: 'Nitrogen tetroxide', group: 'Storable', family: 'nitrogen-oxide', parts: one('N2O4(L)'),
    tip: 'The standard storable oxidiser, which ignites hydrazine fuels on contact.',
    ...pts(-9.3, 21.15, hsdb('dinitrogen tetroxide')), ...nfpa(3, hsdb('dinitrogen tetroxide')),
  },
  {
    id: 'mon25', name: 'MON-25 (mixed oxides of nitrogen)', group: 'Storable', family: 'nitrogen-oxide',
    parts: [{ reactant: 'N2O4(L)', share: 0.75 }, { reactant: 'NO', share: 0.25 }],
    tip: 'Nitrogen tetroxide with a quarter nitric oxide, which stays liquid in colder conditions.',
  },
  {
    id: 'irfna', name: 'Inhibited red fuming nitric acid', group: 'Storable', family: 'nitrogen-oxide', parts: one('IRFNA'),
    tip: 'Nitric acid with dissolved nitrogen dioxide and a corrosion inhibitor, used in many missiles.',
    attacksMaterials: NITRIC_ATTACKS, toxicExhaust: HF_EXHAUST,
  },
  {
    id: 'wfna', name: 'White fuming nitric acid', group: 'Storable', family: 'nitrogen-oxide', parts: one('HNO3(L)'),
    tip: 'Nearly pure nitric acid, an early storable oxidiser.',
    ...pts(-41.6, 83, hsdb('nitric acid')), ...nfpa(4, 'OSHA via PubChem CID 944'),
    attacksMaterials: NITRIC_ATTACKS,
  },
  {
    id: 'tnm', name: 'Tetranitromethane', group: 'Exotic', family: 'nitro', parts: one('CN4O8(L),TNM'),
    custom: [nist('CN4O8(L),TNM', { C: 1, N: 4, O: 8 }, 196.0327, 38, 'C509148', 'Lebedev, Miroshnichenko, et al., 1975')],
    tip: 'A dense, oxygen-rich liquid tried as an oxidiser, but dangerously sensitive.',
    ...pts(13.8, 126, hsdb('tetranitromethane')), ...nfpa(4, hsdb('tetranitromethane')),
    detonates: {
      text: 'A highly sensitive explosive that detonates if contaminated with fuel.',
      source: 'CAMEO Chemicals (NFPA instability 4), PubChem CID 10509',
    },
  },
  {
    id: 'lf2', name: 'Liquid fluorine', group: 'Exotic', family: 'halogen', parts: one('F2(L)'),
    tip: 'The most reactive element, a very powerful but very dangerous oxidiser.',
    ...pts(-219.67, -188.13, hsdb('fluorine')), ...nfpa(4, 'PubChem CID 24524 (fluorine)'),
    attacksMaterials: { text: 'Fluorine reacts with almost every material.', source: `${clark('ch. 8')}; ${hsdb('fluorine')}` },
    toxicExhaust: HF_EXHAUST,
  },
  {
    id: 'flox70', name: 'FLOX-70', group: 'Exotic', family: 'halogen',
    parts: [{ reactant: 'F2(L)', share: 0.7 }, { reactant: 'O2(L)', share: 0.3 }],
    tip: 'Liquid fluorine mixed with liquid oxygen, more energetic than oxygen alone.',
    attacksMaterials: { text: 'The fluorine in it reacts with almost every material.', source: `${clark('ch. 8')}; ${hsdb('fluorine')}` },
    toxicExhaust: HF_EXHAUST,
  },
  {
    id: 'o3', name: 'Liquid ozone', group: 'Exotic', family: 'oxygen', parts: one('O3(L)'),
    tip: 'A more energetic form of oxygen, abandoned because the liquid explodes so easily.',
    ...pts(-192.7, -111.9, hsdb('ozone')),
    detonates: {
      text: 'Liquid ozone explodes with little or no provocation.',
      source: `${clark('ch. 8')}; CAMEO Chemicals 5102`,
    },
  },
  {
    id: 'of2', name: 'Oxygen difluoride', group: 'Exotic', family: 'halogen', parts: one('F2O(L)'),
    tip: 'A compound of oxygen and fluorine, among the most energetic oxidisers known.',
    ...pts(-223.8, -144.75, hsdb('oxygen difluoride')), toxicExhaust: HF_EXHAUST,
  },
  {
    id: 'nf3', name: 'Nitrogen trifluoride', group: 'Exotic', family: 'halogen', parts: one('NF3(L)'),
    tip: 'A fluorine compound used to clean microchip factories, studied as an oxidiser.',
    ...pts(-208.79, -128.75, hsdb('nitrogen trifluoride')), toxicExhaust: HF_EXHAUST,
  },
  {
    id: 'clf3', name: 'Chlorine trifluoride', group: 'Exotic', family: 'halogen', parts: one('CLF3(L)'),
    tip: 'A notorious oxidiser that sets fire to almost anything it touches.',
    ...pts(-76.34, 11.75, hsdb('chlorine trifluoride')), ...nfpa(4, hsdb('chlorine trifluoride')),
    attacksMaterials: {
      text: 'Metals survive it only behind a thin fluoride film; it attacks glass and explodes with water.',
      source: `${clark('ch. 6')}; ${hsdb('chlorine trifluoride')}`,
    },
    toxicExhaust: HF_EXHAUST,
  },
  {
    id: 'clo3f', name: 'Perchloryl fluoride', group: 'Exotic', family: 'halogen', parts: one('CLO3F(L)'),
    tip: 'A chlorine-oxygen-fluorine compound tested as a storable oxidiser.',
    ...pts(-146, -46.8, hsdb('perchloryl fluoride')), toxicExhaust: HF_EXHAUST,
  },
  {
    id: NO_OXIDISER, name: 'None (fuel alone)', group: 'Everyday', family: 'none', parts: [],
    tip: 'Run the fuel by itself, broken down over a catalyst, with no oxidiser.',
  },
];

const byId = (list: Ingredient[]) => Object.fromEntries(list.map((i) => [i.id, i])) as Record<string, Ingredient>;
export const FUELS: Record<string, Ingredient> = byId(fuels);
export const FUEL_IDS: string[] = fuels.map((i) => i.id);
export const OXIDISERS: Record<string, Ingredient> = byId(oxidisers);
export const OXIDISER_IDS: string[] = oxidisers.map((i) => i.id);

export function isFuelId(v: unknown): v is string {
  return typeof v === 'string' && Object.hasOwn(FUELS, v);
}
export function isOxidiserId(v: unknown): v is string {
  return typeof v === 'string' && Object.hasOwn(OXIDISERS, v);
}

const CUSTOM: Record<string, Reactant> = Object.fromEntries(
  [...fuels, ...oxidisers].flatMap((i) => (i.custom ?? []).map((c) => [c.reactant.name, c.reactant])),
);

/** A reactant record, from thermo.inp or from an ingredient's cited custom record. */
export function reactantOf(name: string): Reactant {
  const r = Object.hasOwn(REACTANTS, name) ? REACTANTS[name] : Object.hasOwn(CUSTOM, name) ? CUSTOM[name] : undefined;
  if (!r) throw new Error(`Unknown reactant ${name}`);
  return r;
}

/** Atoms and enthalpy per kg of fuel and oxidiser at oxidiser-to-fuel mass ratio `of`. */
export function mixtureOf(fuel: string, oxidiser: string, of: number): Mixture {
  if (!isFuelId(fuel)) throw new Error(`Unknown fuel ${fuel}`);
  if (!isOxidiserId(oxidiser)) throw new Error(`Unknown oxidiser ${oxidiser}`);
  const alone = oxidiser === NO_OXIDISER;
  const wFuel = alone ? 1 : 1 / (1 + of);
  const parts = FUELS[fuel].parts.map((p) => ({ reactant: reactantOf(p.reactant), massFraction: p.share * wFuel }));
  if (!alone) {
    for (const p of OXIDISERS[oxidiser].parts) parts.push({ reactant: reactantOf(p.reactant), massFraction: p.share * (1 - wFuel) });
  }
  return mixtureFrom(parts);
}

const NITRIC_LIGHTS = new Set(['n2h4', 'mmh', 'udmh', 'aerozine50', 'aniline', 'furfuryl']);
const NITRIC_NOT = new Set(['nh3']);

/** Whether the pair ignites on contact, as the sources state it; null where they say nothing. */
export function lightsOnContact(fuel: string, oxidiser: string): { lights: boolean; source: string } | null {
  if (!isFuelId(fuel) || !isOxidiserId(oxidiser)) return null;
  const f = FUELS[fuel];
  // The two monopropellant copies of oxidisers are not fuels the sources pair with anything.
  if (f.family === 'peroxide' || f.family === 'nitrogen-oxide') return null;
  const yes = (source: string) => ({ lights: true, source });
  const no = (source: string) => ({ lights: false, source });
  switch (oxidiser) {
    case 'clf3':
      return yes(`${clark('ch. 6')}: hypergolic with every known fuel`);
    case 'lf2':
    case 'flox70':
      return yes(`${clark('ch. 8')}: fluorine and FLOX ignite with almost anything`);
    case 'clo3f':
      return fuel === 'mmh' ? yes(`${clark('ch. 6')} (hard starts)`) : null;
    case 'lox':
      return f.family === 'hydrocarbon' || f.family === 'hydrogen'
        ? no(`${SP8081}: LOX/RP-1 and LOX/LH2 need an igniter`) : null;
    case 'wfna':
    case 'irfna':
    case 'n2o4':
    case 'mon25':
      if (NITRIC_LIGHTS.has(fuel)) return yes(`${clark('ch. 2-4')}; ${SP8081}`);
      if (NITRIC_NOT.has(fuel)) return no(`${clark('ch. 3')}: ammonia needs an additive`);
      if (f.family === 'alcohol' || (f.family === 'hydrocarbon' && fuel !== 'c2h2')) return no(clark('ch. 2-3'));
      return null;
    case 'htp90':
    case 'htp98':
      if (fuel === 'n2h4') return yes(`${clark('ch. 5')}; CAMEO Chemicals (hydrazine)`);
      if (fuel === 'mmh') return yes('CAMEO Chemicals, PubChem CID 6061 (methylhydrazine)');
      if (fuel === 'methanol' || fuel === 'rp1' || fuel === 'jeta') return no(`${clark('ch. 5')}: needs an igniter`);
      return null;
    default:
      return null;
  }
}
