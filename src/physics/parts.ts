import { PROPELLANTS, PROPELLANT_IDS } from './propellants';
import type { EnergyId, PropellantId } from './types';

/** Where an engine gets the energy it turns into thrust. */
export interface EnergySource {
  id: EnergyId;
  name: string;
  /** One-line explanation, shown on hover */
  tip: string;
  throttleable: boolean;
  /**
   * What the engine's `mixtureRatio` setting means with this source:
   * 'ratio' is oxidiser-to-fuel mass ratio, 'temperature' is the temperature in K the propellant
   * is heated to (nuclear engines: nothing burns), 'none' is fixed, and 'power' means there is no
   * such setting: the engine's electrical power and its flow set the temperature between them.
   */
  mixKind: 'ratio' | 'temperature' | 'none' | 'power';
  /** An electric engine: 'thermal' heats a gas and sends it through a nozzle. Absent for every other source. */
  kind?: 'thermal' | 'beam';
  /**
   * Heated-gas electric engines: the share of the electrical power that ends up in the gas as heat
   * the nozzle can turn into speed.
   */
  heatingShare?: number;
  /** Name and one-line explanation of the temperature setting, for 'temperature' sources */
  mixLabel?: { label: string; tip: string };
  /** Temperature (K) at which a solid reactor core, a heater or an arc's electrodes fail; absent where there is none */
  coreTempLimit?: number;
  /**
   * Fraction of the gas temperature the nozzle wall is exposed to (default 1). Far below 1 where
   * the reaction is held away from the walls, as in a nuclear salt-water rocket.
   */
  wallHeatFactor?: number;
  /** Chamber diameter (m) at which instability destroys the engine */
  instabilityRefDia: number;
  /**
   * Usual proportions of an engine built round this source. `contraction` is chamber diameter
   * as a multiple of throat diameter. `lStar` is the chamber's characteristic length in m where
   * a liquid burns in it, or its length as a multiple of its diameter where nothing does.
   */
  starter: { contraction: number; lStar: number };
}

export const ENERGY_SOURCES: Record<EnergyId, EnergySource> = {
  combustion: {
    id: 'combustion',
    name: 'Combustion chamber',
    tip: 'Burns a liquid fuel with a liquid oxidiser. What almost every rocket engine flown has used.',
    throttleable: true,
    mixKind: 'ratio',
    instabilityRefDia: 1.15,
    starter: { contraction: 1.7, lStar: 1.1 },
  },
  solid: {
    id: 'solid',
    name: 'Solid motor',
    tip: 'A cast block of fuel and oxidiser burning from the inside out. Simple and powerful, but it cannot be throttled.',
    throttleable: false,
    mixKind: 'none',
    instabilityRefDia: 4.0,
    starter: { contraction: 3.0, lStar: 5 },
  },
  reactor: {
    id: 'reactor',
    name: 'Nuclear reactor',
    tip: 'A reactor core heats the propellant instead of burning it. Light propellants leave far faster than any flame can push them.',
    throttleable: true,
    mixKind: 'temperature',
    mixLabel: {
      label: 'Core temperature',
      tip: 'How hot the reactor heats the propellant. Hotter is more efficient, until the core melts.',
    },
    // Temperature at which the reactor's fuel elements fail.
    coreTempLimit: 2900,
    instabilityRefDia: 6.0,
    starter: { contraction: 6.0, lStar: 1.3 },
  },
  saltwater: {
    id: 'saltwater',
    name: 'Nuclear salt water',
    tip: 'Uranium salt dissolved in water fissions continuously in the nozzle. Never built.',
    throttleable: true,
    mixKind: 'temperature',
    mixLabel: {
      label: 'Reaction temperature',
      tip: 'How fiercely the uranium fissions in the nozzle. Hotter is far more efficient, until the nozzle vaporises.',
    },
    // The reaction is held away from the walls by a layer of water, so they see only a
    // small fraction of its temperature.
    wallHeatFactor: 0.0225,
    instabilityRefDia: 8.0,
    // No combustion chamber: a feed pipe barely wider than the throat opens straight into the nozzle.
    starter: { contraction: 1.12, lStar: 4.0 },
  },
  resistojet: {
    id: 'resistojet',
    name: 'Resistojet',
    tip: 'An electric heater warms the propellant, which leaves through an ordinary nozzle. Gentle, simple, and limited by how hot a heater can get.',
    throttleable: true,
    mixKind: 'power',
    kind: 'thermal',
    // Most of a heater's power reaches the gas; the rest is lost as the body's own glow. A textbook
    // figure (Sutton, Rocket Propulsion Elements, gives 65 to 90%), not tuned: there is no example.
    heatingShare: 0.8,
    // The heater must be hotter than the gas it heats, and a heater fails a little above this.
    coreTempLimit: 2400,
    // Nothing burns, so there is nothing to shake.
    instabilityRefDia: 100,
    starter: { contraction: 5, lStar: 2 },
  },
  arcjet: {
    id: 'arcjet',
    name: 'Arcjet',
    tip: 'An electric arc heats the propellant far hotter than any heater could. Better efficiency than a flame, on a few kilowatts.',
    throttleable: true,
    mixKind: 'power',
    kind: 'thermal',
    // Much of an arc's power goes into its electrodes and into gas that leaves torn into atoms
    // without giving that energy back. The solver assumes the atoms recombine, so this share
    // covers that loss too. Tuned to the MR-510: at 0.41 the example gives its published 258 mN
    // at 2 kW with an Isp of 574 s against its published 585 s (0.40 gave 567 s).
    heatingShare: 0.41,
    // The average gas temperature at which the electrodes erode away.
    coreTempLimit: 6000,
    // The wall sees a cooler layer of gas than the arc's core.
    wallHeatFactor: 0.4,
    instabilityRefDia: 100,
    starter: { contraction: 5, lStar: 2 },
  },
  ion: {
    id: 'ion',
    name: 'Ion thruster',
    tip: 'Propellant atoms are stripped of an electron and pulled out through two charged grids. The faintest push of any engine here, and by far the most efficient. It only works in a vacuum.',
    throttleable: true,
    mixKind: 'none',
    kind: 'beam',
    instabilityRefDia: 100,
    starter: { contraction: 1, lStar: 1 },
  },
  hall: {
    id: 'hall',
    name: 'Hall thruster',
    tip: 'A ring-shaped channel and a magnetic field do the job of an ion thruster\u2019s grids. More push for the power, at a slower exhaust. It only works in a vacuum.',
    throttleable: true,
    mixKind: 'none',
    kind: 'beam',
    instabilityRefDia: 100,
    starter: { contraction: 1, lStar: 1 },
  },
};

/** True for an engine that runs on electrical power. */
export function isElectric(energy: EnergyId): boolean {
  return ENERGY_SOURCES[energy]?.kind !== undefined;
}

/** True for a thruster that throws out charged atoms with a voltage: no chamber, throat or hot gas. */
export function isBeam(energy: EnergyId): boolean {
  return ENERGY_SOURCES[energy]?.kind === 'beam';
}

export const ENERGY_IDS = Object.keys(ENERGY_SOURCES) as EnergyId[];

export function isEnergyId(v: unknown): v is EnergyId {
  return typeof v === 'string' && Object.hasOwn(ENERGY_SOURCES, v);
}

export { EXHAUSTS, EXHAUST_IDS, isExhaustId } from './exhausts';

/** The propellants an energy source can use, in menu order. */
export function propellantsFor(energy: EnergyId): PropellantId[] {
  // The two beam thrusters share their propellants, which are filed under the ion thruster.
  const filed = isBeam(energy) ? 'ion' : energy;
  return PROPELLANT_IDS.filter((id) => PROPELLANTS[id].energy === filed);
}
