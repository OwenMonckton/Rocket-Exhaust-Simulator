import { ENERGY_SOURCES } from './parts';
import { describe, expect, it } from 'vitest';
import { PROPELLANTS, PROPELLANT_IDS, gasProps, richness } from './propellants';

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
        // Pure hydrogen (nuclear thermal) has a higher ratio than combustion products.
        expect(row.gamma).toBeLessThan(ENERGY_SOURCES[PROPELLANTS[id].energy].mixKind === 'temperature' ? 1.4 : 1.3);
      }
      const p = PROPELLANTS[id];
      expect(p.ofDefault).toBeGreaterThanOrEqual(p.ofMin);
      expect(p.ofDefault).toBeLessThanOrEqual(p.ofMax);
    }
  });
  it('reports richness from -1 to +1', () => {
    expect(richness('kerolox', 1.8)).toBeCloseTo(1, 6);
    expect(richness('kerolox', 3.4)).toBeCloseTo(-1, 6);
    expect(richness('kerolox', 3.0)).toBeCloseTo(0, 6);
    expect(richness('solid', 1)).toBe(0);
  });
});
