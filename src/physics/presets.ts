import { FUEL_IDS, OXIDISER_IDS } from './chem/ingredients';
import { sanitize, simulate } from './engine';
import { ENERGY_SOURCES } from './parts';
import { PROPELLANTS } from './propellants';
import { chamberShape, starterEngine, wallFor } from './reshape';
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
  /** Electrical power, kW, for an electric engine */
  powerKW?: number;
  /** A beam thruster: its type, its voltage and the diameter of its face, m. The engine dimensions above are then unused. */
  beam?: { type: 'ion' | 'hall'; voltage: number; diameterM: number };
  published: Preset['published'];
}

/** The engine dimensions a beam thruster's entry does not use. */
const BEAM_SPEC = { propellant: 'xenon', pcBar: 100, of: 0, eps: 16, contraction: 1.7, lStar: 1, nozzleLenPct: 80, structural: 0.5 } as const;

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
  {
    id: 'mr-510',
    name: 'MR-510 arcjet',
    blurb: 'Aerojet arcjet that keeps Lockheed Martin A2100 communications satellites on station. Two kilowatts of arc on hydrazine, for about twice the efficiency of a hydrazine thruster alone.',
    // Published: 222 to 258 mN at 585 to 615 s on 1.53 to 2.04 kW (L3Harris electric propulsion data
    // sheet; satcatalog.com gives the same thrust and Isp ranges). Taken here at the high-thrust end.
    // The chamber pressure and nozzle are not published: 4 bar and an area ratio of 100 are typical.
    propellant: 'aj-hydrazine', pcBar: 4, of: 0, eps: 100, contraction: 5, lStar: 2,
    nozzleLenPct: 80, structural: 0.5, powerKW: 2,
    published: { thrustKN: 0.000258, atVacuum: true, ispVac: 585 },
  },
  // Beam thrusters. Their thrust follows from their power and voltage, so nothing is sized to fit:
  // the figures below are the published ones, and the formula's constants (electric.ts) are set
  // once for all four.
  {
    id: 'nstar',
    name: 'NSTAR ion thruster',
    blurb: 'NASA gridded ion thruster that flew Deep Space 1 and took Dawn to Vesta and Ceres. Less push than the weight of a sheet of paper, kept up for years.',
    // 0.5 to 2.3 kW, 92 mN and over 3,100 s at full power (NASA NEXT/NSTAR comparison tables,
    // NTRS 20080010688; the Deep Space 1 report NTRS 20050237892 gives 92 mN and 2.9 mg/s). The
    // screen grid stands at about 1,090 V at full power. A 30 cm thruster.
    ...BEAM_SPEC, powerKW: 2.3, beam: { type: 'ion', voltage: 1100, diameterM: 0.3 },
    published: { thrustKN: 0.000092, atVacuum: true, ispVac: 3100 },
  },
  {
    id: 'next',
    name: 'NEXT ion thruster',
    blurb: 'NASA\u2019s successor to NSTAR, flown on the DART asteroid mission. Three times the power through grids only a little wider, at a higher voltage.',
    // 6.9 kW, 1,800 V and 3.52 A of beam at full power; 236 mN and 4,190 s; a 36 cm beam (NASA
    // NEXT long-duration test reports, NTRS 20130000079 and 20140016766).
    ...BEAM_SPEC, powerKW: 6.9, beam: { type: 'ion', voltage: 1800, diameterM: 0.36 },
    published: { thrustKN: 0.000236, atVacuum: true, ispVac: 4190 },
  },
  {
    id: 'spt-100',
    name: 'SPT-100 Hall thruster',
    blurb: 'Russian Hall thruster from Fakel, flying since 1994 and the most-flown of its kind. Its name is the width of its channel: 100 mm.',
    // 1,350 W at 300 V, 83 mN (80 mN in some tables), 1,600 s (the SPT-100 and Hall-effect
    // thruster articles on Wikipedia, from Fakel's figures).
    ...BEAM_SPEC, powerKW: 1.35, beam: { type: 'hall', voltage: 300, diameterM: 0.1 },
    published: { thrustKN: 0.000083, atVacuum: true, ispVac: 1600 },
  },
  {
    id: 'xr-5',
    name: 'XR-5 Hall thruster',
    blurb: 'Aerojet Rocketdyne\u2019s 4.5 kW Hall thruster, once called the BPT-4000. In 2010 it became the first American Hall thruster on a working satellite, and later rescued it by raising its orbit alone.',
    // The 4.5 kW rating and 300 to 400 V range are confirmed (Wikipedia; University of Michigan
    // PEPL). The thrust and Isp at 300 V, 290 mN and 1,790 s, are the commonly quoted data-sheet
    // figures and were NOT confirmed against a source when this was written; nor was the channel
    // width, taken as 170 mm. docs/future-work.md says so.
    ...BEAM_SPEC, powerKW: 4.5, beam: { type: 'hall', voltage: 300, diameterM: 0.17 },
    published: { thrustKN: 0.00029, atVacuum: true, ispVac: 1790 },
  },
];

const round = (v: number) => Math.round(v * 1e4) / 1e4;
/** An electric engine's dimensions are fractions of a millimetre, so they are kept to a thousandth of one. */
const fine = (v: number) => Math.round(v * 1e6) / 1e6;

/** Size the engine so the model reproduces the published thrust. Thrust is proportional to throat area. */
function build(s: Spec): Preset {
  if (s.beam) {
    // No chamber, throat or nozzle to shape: sanitize gives the dimensions it does not have.
    const config = sanitize({
      ...starterEngine(),
      presetId: s.id,
      energy: s.beam.type,
      exhaust: 'none',
      propellant: s.propellant,
      exitDia: s.beam.diameterM,
      powerKW: s.powerKW ?? 2,
      voltage: s.beam.voltage,
    });
    return { id: s.id, name: s.name, blurb: s.blurb, config, published: s.published };
  }
  const electric = s.powerKW !== undefined;
  const tidy = electric ? fine : round;
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
      throatDia: tidy(throatDia),
      exitDia: tidy(throatDia * Math.sqrt(s.eps)),
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
      plugShare: 0.7,
      powerKW: s.powerKW ?? 2,
      voltage: 300,
    };
  };
  const flight = { altitudeKm: s.published.atVacuum ? 100 : 0, throttle: 1 };
  if (electric) {
    // On a fixed power thrust does not simply go as throat area (more flow is cooler flow), but it
    // does rise with it, so the throat that gives the published thrust is searched for.
    const target = s.published.thrustKN * 1000;
    let lo = 0.0003;
    let hi = 0.01;
    for (let i = 0; i < 40; i++) {
      const mid = Math.sqrt(lo * hi);
      const r = simulate(sanitize(shape(mid)), flight);
      // Too little flow for the power overheats; too much will not boil.
      if (r.failure === 'meltdown' || (r.failure !== 'underpowered' && r.thrust < target)) lo = mid;
      else hi = mid;
    }
    return { id: s.id, name: s.name, blurb: s.blurb, config: sanitize(shape(Math.sqrt(lo * hi))), published: s.published };
  }
  const trial = simulate(shape(0.3), flight).thrust;
  const throatDia = 0.3 * Math.sqrt((s.published.thrustKN * 1000) / trial);
  return { id: s.id, name: s.name, blurb: s.blurb, config: shape(throatDia), published: s.published };
}

export const PRESETS: Preset[] = SPECS.map(build);

export function getPreset(id: string | null | undefined): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
