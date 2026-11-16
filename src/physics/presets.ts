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
  /** Chamber diameter as a multiple of throat diameter */
  contraction: number;
  /** Chamber length: characteristic length L* in m, or for solids a multiple of chamber diameter */
  lStar: number;
  nozzleLenPct: number;
  /** Fraction of the structural limit the stock engine runs at */
  structural: number;
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
    blurb: 'Russian engine used on Atlas V. Very high pressure kerolox (drawn here as one chamber).',
    propellant: 'kerolox', pcBar: 257, of: 2.72, eps: 36.9, contraction: 1.6, lStar: 1.1,
    nozzleLenPct: 80, structural: 0.8,
    published: { thrustKN: 3830, atVacuum: false, ispSL: 311, ispVac: 338 },
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
    blurb: 'Delta IV upper-stage engine. Small and gentle, with a gigantic vacuum nozzle.',
    propellant: 'hydrolox', pcBar: 44, of: 5.88, eps: 280, contraction: 2.0, lStar: 0.9,
    nozzleLenPct: 90, structural: 0.4,
    published: { thrustKN: 110, atVacuum: true, ispVac: 465 },
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
      s.propellant === 'solid'
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
    };
  };
  const flight = { altitudeKm: s.published.atVacuum ? 100 : 0, throttle: 1 };
  const trial = simulate(shape(0.3), flight).thrust;
  const throatDia = 0.3 * Math.sqrt((s.published.thrustKN * 1000) / trial);
  return { id: s.id, name: s.name, blurb: s.blurb, config: shape(throatDia), published: s.published };
}

export const PRESETS: Preset[] = SPECS.map(build);
export const DEFAULT_PRESET_ID = 'merlin-1d';

export function getPreset(id: string | null | undefined): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
