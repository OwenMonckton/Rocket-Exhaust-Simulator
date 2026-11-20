import { describe, expect, it } from 'vitest';
import { simulate } from './engine';
import { ENERGY_SOURCES, propellantsFor } from './parts';
import { getPreset } from './presets';
import { PROPELLANTS, PROPELLANT_IDS, gasProps, richness } from './propellants';
import type { PropellantId } from './types';

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
    // Vacuum efficiency at 2800 K as a share of hydrogen's, from published nuclear-thermal figures.
    const bands: [PropellantId, number, number][] = [
      ['ntr-ammonia', 0.44, 0.52],
      ['ntr-methane', 0.55, 0.7],
      ['ntr-water', 0.36, 0.44],
      ['ntr-co2', 0.24, 0.33],
      ['ntr-helium', 0.5, 0.62],
    ];
    it('offers a reactor six fluids, hydrogen first', () => {
      expect(propellantsFor('reactor')).toEqual(['ntr-hydrogen', ...bands.map((b) => b[0])]);
    });
    for (const [id, lo, hi] of bands) {
      it(`gives ${id} its share of hydrogen's efficiency`, () => {
        const share = run(id, 2800).ispVacuum / run('ntr-hydrogen', 2800).ispVacuum;
        expect(share).toBeGreaterThan(lo);
        expect(share).toBeLessThan(hi);
      });
      it(`melts the core at the same temperature whatever ${id} flows through it`, () => {
        expect(run(id, 3200).failure).toBe('meltdown');
        expect(run(id, 2360).failure).toBeNull();
      });
      it(`keeps ${id} finite across its range`, () => {
        for (const t of [1500, 2000, 2360, 2800, 3200]) {
          expect(Number.isFinite(richness(id, t))).toBe(true);
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
