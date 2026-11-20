import { PROPELLANTS, PROPELLANT_IDS } from './propellants';
import type { EnergyId, ExhaustId, PropellantId } from './types';

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
   * is heated to (nuclear engines: nothing burns), 'none' is fixed.
   */
  mixKind: 'ratio' | 'temperature' | 'none';
  /** Name and one-line explanation of the temperature setting, for 'temperature' sources */
  mixLabel?: { label: string; tip: string };
  /** Temperature (K) at which a solid reactor core fails; absent where there is no core to melt */
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
};

export const ENERGY_IDS = Object.keys(ENERGY_SOURCES) as EnergyId[];

export function isEnergyId(v: unknown): v is EnergyId {
  return typeof v === 'string' && v in ENERGY_SOURCES;
}

/** How the engine turns hot gas into a jet. */
export const EXHAUSTS: Record<ExhaustId, { id: ExhaustId; name: string; tip: string }> = {
  bell: {
    id: 'bell',
    name: 'Bell nozzle',
    tip: 'The classic curved nozzle. It suits one altitude best: too big near the ground, too small in space.',
  },
  aerospike: {
    id: 'aerospike',
    name: 'Aerospike',
    tip: 'A ring of small thrust cells fires along a central spike, and the outside air shapes the jet, so it suits every altitude.',
  },
};

export const EXHAUST_IDS = Object.keys(EXHAUSTS) as ExhaustId[];

export function isExhaustId(v: unknown): v is ExhaustId {
  return typeof v === 'string' && v in EXHAUSTS;
}

/** The propellants an energy source can use, in menu order. */
export function propellantsFor(energy: EnergyId): PropellantId[] {
  return PROPELLANT_IDS.filter((id) => PROPELLANTS[id].energy === energy);
}
