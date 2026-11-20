import { describe, expect, it } from 'vitest';
import { simulate } from './engine';
import { ENERGY_SOURCES, propellantsFor } from './parts';
import { getPreset } from './presets';
import { PROPELLANTS, PROPELLANT_IDS, gasProps, richness } from './propellants';
import type { PropellantId } from './types';
import { mixtureFrom } from './chem/equilibrium';
import { rocket } from './chem/rocket';
import { REACTANTS } from './chem/thermo';

const G0 = 9.80665;

describe('propellants', () => {
  it('interpolates linearly between rows', () => {
    const a = PROPELLANTS.kerolox.table[1];
    const b = PROPELLANTS.kerolox.table[2];
    const mid = gasProps('kerolox', (a.of + b.of) / 2);
    expect(mid.tc).toBeCloseTo((a.tc + b.tc) / 2, 6);
    expect(mid.molarMass).toBeCloseTo((a.molarMass + b.molarMass) / 2, 6);
  });
  it('clamps out-of-range and non-finite mixture ratios', () => {
    expect(gasProps('kerolox', 0).tc).toBe(PROPELLANTS.kerolox.table[0].tc);
    expect(gasProps('kerolox', 99).tc).toBe(PROPELLANTS.kerolox.table.at(-1)!.tc);
    expect(Number.isFinite(gasProps('kerolox', NaN).tc)).toBe(true);
    expect(gasProps('solid', 5).tc).toBe(3400);
  });
  it('has plausible values', () => {
    const peak = Math.max(...PROPELLANTS.kerolox.table.map((r) => r.tc));
    expect(peak).toBeGreaterThan(3500);
    expect(peak).toBeLessThan(3700);
    const h = gasProps('hydrolox', 6).molarMass;
    expect(h).toBeGreaterThan(13);
    expect(h).toBeLessThan(14.5);
    for (const id of PROPELLANT_IDS) {
      for (const row of PROPELLANTS[id].table) {
        expect(row.gamma).toBeGreaterThan(1.1);
        // A gas that is only heated has a higher ratio than combustion products: up to 5/3 for helium.
        expect(row.gamma).toBeLessThan(ENERGY_SOURCES[PROPELLANTS[id].energy].mixKind === 'temperature' ? 1.7 : 1.3);
      }
      const p = PROPELLANTS[id];
      expect(p.ofDefault).toBeGreaterThanOrEqual(p.ofMin);
      expect(p.ofDefault).toBeLessThanOrEqual(p.ofMax);
    }
  });
  describe('nuclear working fluids', () => {
    const nerva = getPreset('nerva')!.config;
    const vacuum = { altitudeKm: 100, throttle: 1 };
    const run = (propellant: PropellantId, coreTemp: number) =>
      simulate({ ...nerva, propellant, mixtureRatio: coreTemp }, vacuum);
    const fluids: [PropellantId, string][] = [
      ['ntr-ammonia', 'NH3(L)'],
      ['ntr-methane', 'CH4(L)'],
      ['ntr-water', 'H2O(L)'],
      ['ntr-co2', 'CO2'],
      ['ntr-helium', 'He'],
    ];
    it('offers a reactor six fluids, hydrogen first', () => {
      expect(propellantsFor('reactor')).toEqual(['ntr-hydrogen', ...fluids.map((f) => f[0])]);
    });
    it('works out every fluid but hydrogen with the solver', () => {
      expect(PROPELLANTS['ntr-hydrogen'].fluid).toBeUndefined();
      expect(PROPELLANTS['ntr-hydrogen'].table.length).toBeGreaterThan(1);
      for (const [id, reactant] of fluids) {
        expect(PROPELLANTS[id].fluid, id).toBe(reactant);
        expect(PROPELLANTS[id].table, id).toEqual([]);
      }
    });
    // Zubrin, NIMF study (NTRS 19910012833, Table 1), 2,800 K, infinite expansion: methane 606 s,
    // water 370 s, carbon dioxide 283 s. The solver at 55 bar and area ratio 100 (no droplet loss);
    // docs/future-work.md records the gaps.
    it("lands near Zubrin's figures at 2,800 K and area ratio 100", () => {
      const isp = (reactant: string) =>
        rocket(mixtureFrom([{ reactant: REACTANTS[reactant], massFraction: 1 }]), { kind: 'tp', t: 2800, pBar: 55 }, 100).ispVac / G0;
      expect(Math.abs(isp('H2O(L)') / 364 - 1)).toBeLessThan(0.02);
      expect(Math.abs(isp('CO2') / 247 - 1)).toBeLessThan(0.02);
      const methane = isp('CH4(L)');
      expect(Math.abs(methane - 564)).toBeLessThan(Math.abs(methane - 474));
    });
    it('ranks the fluids by vacuum efficiency on the NERVA example', () => {
      const order: PropellantId[] = ['ntr-hydrogen', 'ntr-helium', 'ntr-methane', 'ntr-ammonia', 'ntr-water', 'ntr-co2'];
      const isps = order.map((id) => {
        const r = run(id, PROPELLANTS[id].ofDefault);
        expect(r.failure, id).toBeNull();
        expect(Number.isFinite(r.ispVacuum), id).toBe(true);
        expect(Number.isFinite(r.thrust), id).toBe(true);
        return r.ispVacuum;
      });
      for (let i = 1; i < isps.length; i++) expect(isps[i], order[i]).toBeLessThan(isps[i - 1]);
    });
    for (const [id] of fluids) {
      it(`melts the core at the same temperature whatever ${id} flows through it`, () => {
        expect(run(id, 3200).failure).toBe('meltdown');
        expect(run(id, 2360).failure).toBeNull();
      });
      it(`keeps ${id} finite across its range`, () => {
        for (const t of [1500, 2000, 2360, 2800, 3200]) {
          expect(Number.isFinite(run(id, t).ispVacuum)).toBe(true);
          expect(Number.isFinite(run(id, t).thrust)).toBe(true);
        }
      });
    }
  });
  it('reports richness from -1 to +1', () => {
    expect(richness('kerolox', 1.8)).toBeCloseTo(1, 6);
    expect(richness('kerolox', 3.4)).toBeCloseTo(-1, 6);
    expect(richness('kerolox', 3.0)).toBeCloseTo(0, 6);
    expect(richness('solid', 1)).toBe(0);
  });
});
