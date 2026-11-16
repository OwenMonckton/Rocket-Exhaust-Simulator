import { describe, expect, it } from 'vitest';
import { SIM_MAX_LENGTH, gridLength } from './plume';

describe('simulation grid length', () => {
  it('always covers what is needed, up to the cap', () => {
    for (let needed = 0; needed <= 40; needed += 0.137) {
      const length = gridLength(needed);
      expect(length).toBeGreaterThanOrEqual(Math.min(Math.max(4, needed), SIM_MAX_LENGTH) - 1e-9);
      expect(length).toBeLessThanOrEqual(SIM_MAX_LENGTH);
    }
  });

  it('never starts shorter than 4 exit radii', () => {
    expect(gridLength(0)).toBe(4);
    expect(gridLength(4)).toBe(4);
  });

  it('changes in steps, so a smooth zoom only resizes the grid now and then', () => {
    const sizes = new Set<number>();
    for (let n = 0; n <= 400; n++) sizes.add(gridLength(4 + n / 100));
    // Doubling the view takes 8 steps, not hundreds.
    expect(sizes.size).toBe(9);
  });

  it('is never more than one step (about 9%) longer than needed', () => {
    for (let needed = 4; needed <= SIM_MAX_LENGTH; needed += 0.137) {
      expect(gridLength(needed) / needed).toBeLessThan(2 ** (1 / 8) + 1e-9);
    }
  });
});
