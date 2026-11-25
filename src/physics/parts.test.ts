import { describe, expect, it } from 'vitest';
import { sanitize } from './engine';
import { ENERGY_IDS, ENERGY_SOURCES, isEnergyId, isExhaustId, propellantsFor } from './parts';
import { getPreset } from './presets';
import { PROPELLANTS, PROPELLANT_IDS, isPropellantId } from './propellants';

const base = getPreset('merlin-1d')!.config;

describe('engine parts', () => {
  it('gives every propellant an energy source, and every source its propellants', () => {
    for (const id of PROPELLANT_IDS) expect(ENERGY_SOURCES[PROPELLANTS[id].energy]).toBeDefined();
    for (const e of ENERGY_IDS) {
      const offered = propellantsFor(e);
      expect(offered.length).toBeGreaterThan(0);
      // The two beam thrusters share theirs, which are filed under the ion thruster.
      expect(offered).toEqual(PROPELLANT_IDS.filter((id) => PROPELLANTS[id].energy === (e === 'hall' ? 'ion' : e)));
    }
  });

  it('offers a combustion chamber the four liquid pairs, then any pair worked out by the solver', () => {
    expect(propellantsFor('combustion')).toEqual(['kerolox', 'hydrolox', 'methalox', 'hypergolic', 'calculated']);
  });

  it("swaps a propellant the energy source can't use for its first one", () => {
    const fixed = sanitize({ ...base, energy: 'reactor', propellant: 'kerolox' });
    expect(fixed.energy).toBe('reactor');
    expect(fixed.propellant).toBe('ntr-hydrogen');
    expect(fixed.mixtureRatio).toBeGreaterThanOrEqual(PROPELLANTS['ntr-hydrogen'].ofMin);
    expect(fixed.mixtureRatio).toBeLessThanOrEqual(PROPELLANTS['ntr-hydrogen'].ofMax);
  });

  it('works out a missing energy source from the propellant', () => {
    expect(sanitize({ ...base, energy: 'steam' as never, propellant: 'solid' }).energy).toBe('solid');
    const lost = sanitize({ ...base, energy: undefined as never, propellant: 'jam' as never });
    expect(lost.energy).toBe('combustion');
    expect(lost.propellant).toBe('kerolox');
  });

  it('falls back to a bell for an exhaust type it does not know', () => {
    expect(sanitize({ ...base, exhaust: 'funnel' as never }).exhaust).toBe('bell');
  });
});

describe('part names that are not parts (final review)', () => {
  it('does not take a word every object answers to for a part', () => {
    for (const word of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(isEnergyId(word), word).toBe(false);
      expect(isExhaustId(word), word).toBe(false);
      expect(isPropellantId(word), word).toBe(false);
      const fixed = sanitize({ ...base, energy: word as never, exhaust: word as never, propellant: word as never });
      expect(fixed).toMatchObject({ energy: 'combustion', exhaust: 'bell', propellant: 'kerolox' });
    }
  });

  it('explains every propellant in a line', () => {
    for (const id of PROPELLANT_IDS) expect(PROPELLANTS[id].tip.length, id).toBeGreaterThan(20);
  });
});
