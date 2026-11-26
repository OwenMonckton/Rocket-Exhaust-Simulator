import { describe, expect, it } from 'vitest';
import { sanitize, simulate } from '../physics/engine';
import { getPreset } from '../physics/presets';
import { starterEngine, withEnergy } from '../physics/reshape';
import type { EngineConfig } from '../physics/types';
import { partDescription, partEffect } from './partEffect';

const ground = { altitudeKm: 0, throttle: 1 };
const space = { altitudeKm: 100, throttle: 1 };
const at = (config: EngineConfig, flight = ground) => ({ state: { config, flight }, result: simulate(config, flight) });

describe('the line under each part: what it is doing to this engine now', () => {
  const merlin = getPreset('merlin-1d')!.config;

  it('says how hot the chamber runs, from the physics', () => {
    const { state, result } = at(merlin);
    expect(partEffect('energy', state, result)).toBe(`Flame at ${Math.round(result.tc).toLocaleString('en-US')} K`);
    const nerva = at(getPreset('nerva')!.config, space);
    expect(partEffect('energy', nerva.state, nerva.result)).toMatch(/^Gas heated to 2,3\d\d K$/);
    const arcjet = at(getPreset('mr-510')!.config, space);
    expect(partEffect('energy', arcjet.state, arcjet.result)).toMatch(/^2\.00 kW heating the gas to 3,\d{3} K$/);
    const ion = at(getPreset('nstar')!.config, space);
    expect(partEffect('energy', ion.state, ion.result)).toBe('2.30 kW at 1,100 V');
  });

  it('says what the nozzle is doing at this altitude', () => {
    expect(partEffect('exhaust', at(merlin).state, at(merlin).result)).toBe('Over-expanded here');
    expect(partEffect('exhaust', at(merlin, space).state, at(merlin, space).result)).toBe('Under-expanded here');
  });

  it('says how fast the exhaust leaves, and at what mixture', () => {
    const { state, result } = at(merlin);
    expect(partEffect('fuel', state, result)).toBe(`Exhaust leaving at ${(result.exitVelocity / 1000).toFixed(2)} km/s`);
    expect(partEffect('oxidiser', state, result)).toBe('Mixture 2.36 : 1');
    const ion = at(getPreset('nstar')!.config, space);
    expect(partEffect('propellant', ion.state, ion.result)).toBe(`Atoms leaving at ${(ion.result.exitVelocity / 1000).toFixed(1)} km/s`);
  });

  it('says nothing where no figure would be real', () => {
    const lost = at(sanitize({ ...starterEngine(), fuel: 'rp1', oxidiser: 'none' }));
    expect(lost.result.settled).toBe(false);
    for (const id of ['energy', 'exhaust', 'fuel', 'oxidiser']) expect(partEffect(id, lost.state, lost.result), id).toBe('');
  });
});

describe('the description of a part, shown while it is being picked', () => {
  it('is a sentence, never shorthand', () => {
    const ion = withEnergy(starterEngine(), 'ion');
    expect(partDescription('propellant', { config: ion, flight: space })).toBe('Xenon gas, with a voltage to throw it out.');
    const arc = withEnergy(starterEngine(), 'arcjet');
    expect(partDescription('propellant', { config: arc, flight: space })).toBe('Hydrazine, with an electric arc to heat it.');
    expect(partDescription('energy', { config: starterEngine(), flight: ground })).toMatch(/^Burns a liquid fuel/);
  });
});
