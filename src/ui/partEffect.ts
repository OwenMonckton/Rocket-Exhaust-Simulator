// The lines under each part picker in the Build column: one saying what the part is doing to this
// engine now, from the physics, and the part's description, shown while it is being picked.
import { ENERGY_SOURCES, EXHAUSTS } from '../physics/parts';
import { FUELS } from '../physics/chem/ingredients';
import { PROPELLANTS } from '../physics/propellants';
import type { EngineConfig, FlightState, SimResult } from '../physics/types';
import { STATE_COPY, showsFigures } from './copy';

interface PartState {
  config: EngineConfig;
  flight: FlightState;
}

const kelvin = (t: number) => `${Math.round(t).toLocaleString('en-US')} K`;
const kilowatts = (w: number) => (w < 1000 ? `${Math.round(w)} W` : w < 10000 ? `${(w / 1000).toFixed(2)} kW` : `${(w / 1000).toFixed(1)} kW`);

/**
 * What the part picked as `id` is doing to this engine now, in a few words from the physics:
 * how hot it runs, what the nozzle is doing here, how fast the exhaust leaves, at what mixture.
 * Empty where no figure would be real.
 */
export function partEffect(id: string, s: PartState, r: SimResult): string {
  if (!showsFigures(r)) return '';
  const kind = ENERGY_SOURCES[s.config.energy].kind;
  switch (id) {
    case 'energy':
      if (kind === 'beam') return `${kilowatts(r.electric!.power)} at ${Math.round(s.config.voltage).toLocaleString('en-US')} V`;
      if (kind === 'thermal') return `${kilowatts(r.electric!.power)} heating the gas to ${kelvin(r.tc)}`;
      if (s.config.energy === 'reactor') return `Gas heated to ${kelvin(r.tc)}`;
      if (s.config.energy === 'saltwater') return `Reaction at ${kelvin(r.tc)}`;
      return `Flame at ${kelvin(r.tc)}`;
    case 'exhaust':
      return `${STATE_COPY[r.state].label} here`;
    case 'fuel':
      return `Exhaust leaving at ${(r.exitVelocity / 1000).toFixed(2)} km/s`;
    case 'propellant':
      return kind === 'beam'
        ? `Atoms leaving at ${(r.exitVelocity / 1000).toFixed(1)} km/s`
        : `Exhaust leaving at ${(r.exitVelocity / 1000).toFixed(2)} km/s`;
    case 'oxidiser': {
      const of = s.config.mixtureRatio;
      return of > 0 ? `Mixture ${of >= 1 ? of.toFixed(2) : of.toPrecision(3)} : 1` : '';
    }
    default:
      return '';
  }
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The part's description, as a sentence: shown under its picker while it is being picked. */
export function partDescription(id: string, s: PartState): string {
  const c = s.config;
  switch (id) {
    case 'energy':
      return ENERGY_SOURCES[c.energy].tip;
    case 'exhaust':
      return EXHAUSTS[c.exhaust].tip;
    case 'propellant': {
      if (c.propellant === 'calculated') return '';
      const p = PROPELLANTS[c.propellant];
      return `${sentence(p.fuel)}, with ${p.oxidiser}.`;
    }
    case 'fuel':
      // An example on its hand-tuned table says so; a tabled engine with no example (an old link) says nothing.
      return c.propellant === 'calculated' ? (FUELS[c.fuel]?.tip ?? '') : c.presetId ? "Tuned to the real engine's published figures." : '';
    default:
      return '';
  }
}
