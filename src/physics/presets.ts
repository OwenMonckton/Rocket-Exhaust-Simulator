import { simulate } from './engine';
import { SIGMA_ALLOW_BAR } from './limits';
import { PROPELLANTS } from './propellants';
import type { EngineConfig, PropellantId } from './types';

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  config: EngineConfig;
  published: { thrustKN: number; atVacuum: boolean; ispSL?: number; ispVac: number };
  /** Present when the nozzle has a deployable extension: the exit diameter (m) with it stowed. The stock config has it deployed. */
  extension?: { stowedExitDia: number };
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
  /** Expansion ratio with a deployable nozzle extension stowed */
  epsStowed?: number;
  /** Chamber diameter as a multiple of throat diameter */
  contraction: number;
  /** Chamber length: characteristic length L* in m, or a multiple of chamber diameter where nothing burns in a liquid spray (solids, nuclear) */
  lStar: number;
  nozzleLenPct: number;
  /** Fraction of the structural limit the stock engine runs at */
  structural: number;
  /** Number of identical chambers sharing one turbopump (default 1) */
  chambers?: number;
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
    propellant: 'nuclear', pcBar: 38.6, of: 2360, eps: 100, contraction: 6.0, lStar: 1.3,
    nozzleLenPct: 80, structural: 0.4,
    published: { thrustKN: 246.7, atVacuum: true, ispVac: 841 },
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
    const chamberDia = round(throatDia * s.contraction);
    const at = (Math.PI / 4) * throatDia ** 2;
    const chamberLen =
      PROPELLANTS[s.propellant].lStarRef === 0
        ? round(chamberDia * s.lStar)
        : round((s.lStar * at) / ((Math.PI / 4) * chamberDia ** 2));
    return {
      presetId: s.id,
      propellant: s.propellant,
      chamberDia,
      chamberLen,
      throatDia: round(throatDia),
      exitDia: round(throatDia * Math.sqrt(s.eps)),
      nozzleLenPct: s.nozzleLenPct,
      wall: round((s.pcBar * chamberDia) / (2 * SIGMA_ALLOW_BAR * s.structural)),
      chamberPressureBar: s.pcBar,
      mixtureRatio: PROPELLANTS[s.propellant].throttleable ? s.of : PROPELLANTS[s.propellant].ofDefault,
      scale: 1,
      chambers: s.chambers ?? 1,
    };
  };
  const flight = { altitudeKm: s.published.atVacuum ? 100 : 0, throttle: 1 };
  const trial = simulate(shape(0.3), flight).thrust;
  const throatDia = 0.3 * Math.sqrt((s.published.thrustKN * 1000) / trial);
  const preset: Preset = { id: s.id, name: s.name, blurb: s.blurb, config: shape(throatDia), published: s.published };
  if (s.epsStowed) preset.extension = { stowedExitDia: round(preset.config.throatDia * Math.sqrt(s.epsStowed)) };
  return preset;
}

export const PRESETS: Preset[] = SPECS.map(build);
export const DEFAULT_PRESET_ID = 'merlin-1d';

export function getPreset(id: string | null | undefined): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
