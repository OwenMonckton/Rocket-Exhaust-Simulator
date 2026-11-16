import { describe, expect, it } from 'vitest';
import { ambientPressure } from './atmosphere';
import { areaRatio, cStar, machFromAreaRatio, machFromPressureRatio, pressureRatio } from './nozzle';

describe('atmosphere', () => {
  it('matches the standard atmosphere', () => {
    expect(ambientPressure(0)).toBeCloseTo(101325, 0);
    expect(Math.abs(ambientPressure(11000) - 22632) / 22632).toBeLessThan(0.01);
    expect(Math.abs(ambientPressure(30000) - 1197) / 1197).toBeLessThan(0.03);
    expect(ambientPressure(86000)).toBe(0);
    expect(ambientPressure(100000)).toBe(0);
    expect(ambientPressure(-50)).toBe(101325);
    expect(ambientPressure(NaN)).toBe(101325);
  });
  it('falls monotonically', () => {
    let prev = Infinity;
    for (let h = 0; h <= 86000; h += 500) {
      const p = ambientPressure(h);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('nozzle relations', () => {
  it('inverts the area-Mach relation', () => {
    for (const e of [1.5, 16, 69, 280]) {
      expect(areaRatio(machFromAreaRatio(e, 1.2), 1.2)).toBeCloseTo(e, 5);
    }
    expect(machFromAreaRatio(1, 1.2)).toBe(1);
    expect(machFromAreaRatio(0.5, 1.2)).toBe(1);
  });
  it('gives a plausible exit Mach for a sea-level nozzle', () => {
    const m = machFromAreaRatio(16, 1.2);
    expect(m).toBeGreaterThan(3.2);
    expect(m).toBeLessThan(3.7);
  });
  it('inverts the pressure relation', () => {
    expect(machFromPressureRatio(pressureRatio(3.3, 1.2), 1.2)).toBeCloseTo(3.3, 6);
  });
  it('computes c* for kerolox-like gas', () => {
    const c = cStar(1.2, 8314 / 22, 3550);
    expect(Math.abs(c - 1787) / 1787).toBeLessThan(0.01);
  });
});
