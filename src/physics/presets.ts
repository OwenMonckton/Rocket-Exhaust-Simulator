import { FUEL_IDS, OXIDISER_IDS } from './chem/ingredients';
import { simulate } from './engine';
import { ENERGY_SOURCES } from './parts';
import { PROPELLANTS } from './propellants';
import { chamberShape, wallFor } from './reshape';
import type { EngineConfig, ExhaustId, PropellantId } from './types';

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  config: EngineConfig;
  published: { thrustKN: number; atVacuum: boolean; ispSL?: number; ispVac: number };
}

interface Spec {
  id: string;
  name: string;
  blurb: string;
  propellant: PropellantId;
  pcBar: number;
  of: number;
  /** Nozzle expansion ratio (exit area / throat area) */
  eps: number;
  /** Expansion ratio of the fixed nozzle, for an engine with a deployable nozzle extension */
  epsStowed?: number;
  /** Chamber diameter as a multiple of throat diameter */
  contraction: number;
  /** Chamber length: characteristic length L* in m, or a multiple of chamber diameter where nothing burns in a liquid spray (solids, nuclear) */
  lStar: number;
  nozzleLenPct: number;
  /** Fraction of the structural limit the stock engine runs at */
  structural: number;
  /** Number of identical chambers sharing one turbopump (default 1), or an aerospike's thrust cells */
  chambers?: number;
  /** How the gas leaves (default a bell) */
  exhaust?: ExhaustId;
  published: Preset['published'];
}

const SPECS: Spec[] = [
  {
    id: 'merlin-1d',
    name: 'Merlin 1D',
    blurb: 'SpaceX Falcon 9 first-stage engine. A simple, sturdy kerolox workhorse.',
    propellant: 'kerolox', pcBar: 97, of: 2.36, eps: 16, contraction: 1.7, lStar: 1.1,
    nozzleLenPct: 80, structural: 0.6,
    published: { thrustKN: 845, atVacuum: false, ispSL: 282, ispVac: 311 },
  },
  {
    id: 'merlin-vac',
    name: 'Merlin Vacuum',
    blurb: 'Falcon 9 upper-stage engine. The huge nozzle only works properly in space.',
    propellant: 'kerolox', pcBar: 97, of: 2.36, eps: 165, contraction: 1.7, lStar: 1.1,
    nozzleLenPct: 85, structural: 0.6,
    published: { thrustKN: 981, atVacuum: true, ispVac: 348 },
  },
  {
    id: 'raptor-2',
    name: 'Raptor 2',
    blurb: 'SpaceX Starship engine. Methane-fuelled, with the highest chamber pressure ever flown.',
    propellant: 'methalox', pcBar: 300, of: 3.6, eps: 36, contraction: 1.75, lStar: 1.0,
    nozzleLenPct: 80, structural: 0.87,
    published: { thrustKN: 2260, atVacuum: false, ispSL: 327, ispVac: 350 },
  },
  {
    id: 'rs-25',
    name: 'RS-25',
    blurb: 'Space Shuttle main engine. Hydrogen-fuelled and very efficient from ground to orbit.',
    propellant: 'hydrolox', pcBar: 206, of: 6.03, eps: 69, contraction: 1.72, lStar: 0.9,
    nozzleLenPct: 80, structural: 0.72,
    published: { thrustKN: 1860, atVacuum: false, ispSL: 366, ispVac: 452 },
  },
  {
    id: 'rd-180',
    name: 'RD-180',
    blurb: 'Russian engine used on Atlas V: half an RD-170. One turbopump feeds two very high pressure chambers.',
    propellant: 'kerolox', pcBar: 257, of: 2.72, eps: 36.9, contraction: 1.6, lStar: 1.1,
    nozzleLenPct: 80, structural: 0.8, chambers: 2,
    published: { thrustKN: 3830, atVacuum: false, ispSL: 311, ispVac: 338 },
  },
  {
    id: 'rd-170',
    name: 'RD-170',
    blurb: 'Energia and Zenit booster engine, the most powerful liquid engine flown. One turbopump feeds four chambers; two are shown.',
    propellant: 'kerolox', pcBar: 245, of: 2.63, eps: 36.87, contraction: 1.6, lStar: 1.1,
    nozzleLenPct: 80, structural: 0.8, chambers: 4,
    published: { thrustKN: 7257, atVacuum: false, ispSL: 309, ispVac: 337 },
  },
  {
    id: 'f-1',
    name: 'F-1',
    blurb: 'Saturn V first-stage engine. Enormous, low pressure, and famous for combustion instability.',
    propellant: 'kerolox', pcBar: 70, of: 2.27, eps: 16, contraction: 1.12, lStar: 1.2,
    nozzleLenPct: 80, structural: 0.55,
    published: { thrustKN: 6770, atVacuum: false, ispSL: 263, ispVac: 304 },
  },
  {
    id: 'rl10b-2',
    name: 'RL10B-2',
    blurb: 'Delta IV upper-stage engine. Small and gentle, with a gigantic nozzle extension that slides into place in space.',
    propellant: 'hydrolox', pcBar: 44, of: 5.88, eps: 280, epsStowed: 130, contraction: 2.0, lStar: 0.9,
    nozzleLenPct: 90, structural: 0.4,
    published: { thrustKN: 110, atVacuum: true, ispVac: 465 },
  },
  {
    id: 'nerva',
    name: 'NERVA',
    blurb: '1960s nuclear thermal engine. A reactor heats hydrogen instead of burning it, for roughly twice the efficiency of any chemical engine.',
    propellant: 'ntr-hydrogen', pcBar: 38.6, of: 2360, eps: 100, contraction: 6.0, lStar: 1.3,
    nozzleLenPct: 80, structural: 0.4,
    published: { thrustKN: 246.7, atVacuum: true, ispVac: 841 },
  },
  {
    id: 'nswr',
    name: 'Nuclear salt water',
    blurb: "Robert Zubrin's 1991 concept, never built: uranium salt water fissions continuously in the nozzle, giving huge thrust and huge efficiency at once.",
    // No combustion chamber: a feed pipe barely wider than the throat opens straight into the nozzle.
    propellant: 'saltwater', pcBar: 100, of: 470000, eps: 40, contraction: 1.12, lStar: 4.0,
    nozzleLenPct: 80, structural: 0.5,
    published: { thrustKN: 12900, atVacuum: true, ispVac: 6730 },
  },
  {
    id: 'xrs-2200',
    name: 'XRS-2200 aerospike',
    blurb: 'Linear aerospike built for the X-33, test-fired but never flown. Twenty small thrust cells fire along a spike, and the outside air shapes the jet, so it suits every altitude.',
    // Dimensions are per thrust cell; the spike is cut off at about a third of its full length.
    propellant: 'hydrolox', pcBar: 58.9, of: 5.5, eps: 58, contraction: 2.0, lStar: 0.9,
    nozzleLenPct: 65, structural: 0.4, chambers: 20, exhaust: 'aerospike',
    published: { thrustKN: 917, atVacuum: false, ispSL: 338, ispVac: 428 },
  },
  {
    id: 'solid-booster',
    name: 'Solid booster',
    blurb: 'A generic strap-on solid rocket motor. Bright, smoky, and it cannot be throttled.',
    propellant: 'solid', pcBar: 60, of: 1, eps: 10, contraction: 3.0, lStar: 5,
    nozzleLenPct: 75, structural: 0.5,
    published: { thrustKN: 1200, atVacuum: false, ispSL: 240, ispVac: 265 },
  },
];

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** Size the engine so the model reproduces the published thrust. Thrust is proportional to throat area. */
function build(s: Spec): Preset {
  const shape = (throatDia: number): EngineConfig => {
    const { chamberDia, chamberLen } = chamberShape(throatDia, s.contraction, s.lStar, PROPELLANTS[s.propellant].lStarRef);
    return {
      presetId: s.id,
      energy: PROPELLANTS[s.propellant].energy,
      exhaust: s.exhaust ?? 'bell',
      propellant: s.propellant,
      // What sanitize gives: the propellant's own fuel and oxidiser, or the first of each.
      fuel: PROPELLANTS[s.propellant].pair?.fuel ?? FUEL_IDS[0],
      oxidiser: PROPELLANTS[s.propellant].pair?.oxidiser ?? OXIDISER_IDS[0],
      chamberDia,
      chamberLen,
      throatDia: round(throatDia),
      exitDia: round(throatDia * Math.sqrt(s.eps)),
      nozzleLenPct: s.nozzleLenPct,
      wall: round(wallFor(s.pcBar, chamberDia, s.structural)),
      chamberPressureBar: s.pcBar,
      // Where the source has no mixture setting, the propellant's own figure stands.
      mixtureRatio: ENERGY_SOURCES[PROPELLANTS[s.propellant].energy].mixKind !== 'none' ? s.of : PROPELLANTS[s.propellant].ofDefault,
      scale: 1,
      chambers: s.chambers ?? 1,
      // Deployable extension: stock engines have it seated.
      extFixedDia: s.epsStowed ? round(throatDia * Math.sqrt(s.epsStowed)) : 0,
      extDeploy: 1,
      coneAngleDeg: 15,
      innerExitDia: 0,
    };
  };
  const flight = { altitudeKm: s.published.atVacuum ? 100 : 0, throttle: 1 };
  const trial = simulate(shape(0.3), flight).thrust;
  const throatDia = 0.3 * Math.sqrt((s.published.thrustKN * 1000) / trial);
  return { id: s.id, name: s.name, blurb: s.blurb, config: shape(throatDia), published: s.published };
}

export const PRESETS: Preset[] = SPECS.map(build);

export function getPreset(id: string | null | undefined): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
