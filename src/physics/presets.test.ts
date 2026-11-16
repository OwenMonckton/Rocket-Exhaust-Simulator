import { describe, expect, it } from 'vitest';
import { sanitize, simulate } from './engine';
import { DEFAULT_PRESET_ID, PRESETS, getPreset } from './presets';

const within = (actual: number, target: number, tol = 0.1) =>
  expect(Math.abs(actual - target) / target, `${actual} vs ${target}`).toBeLessThan(tol);

describe('presets', () => {
  for (const p of PRESETS) {
    it(`${p.name} matches published figures and stays inside its limits`, () => {
      const r = simulate(p.config, { altitudeKm: p.published.atVacuum ? 100 : 0, throttle: 1 });
      within(r.thrust / 1000, p.published.thrustKN);
      within(r.ispVacuum, p.published.ispVac);
      if (p.published.ispSL !== undefined) within(r.ispSeaLevel, p.published.ispSL);
      expect(Math.max(r.limits.structural, r.limits.heating, r.limits.instability)).toBeLessThan(1);
      expect(r.failure).toBe(null);
      // The F-1 shudders a little at stock, which costs a sliver of efficiency.
      expect(r.combustionEff).toBeGreaterThan(0.96);
      expect(sanitize(p.config)).toEqual(p.config);
    });
  }

  it('puts Raptor and the F-1 near their limits', () => {
    const raptor = simulate(getPreset('raptor-2')!.config, { altitudeKm: 0, throttle: 1 }).limits;
    const top = Math.max(raptor.structural, raptor.heating, raptor.instability);
    expect(top).toBeGreaterThan(0.82);
    expect(top).toBeLessThan(0.92);
    const f1 = simulate(getPreset('f-1')!.config, { altitudeKm: 0, throttle: 1 }).limits;
    expect(f1.instability).toBeGreaterThan(0.75);
    expect(f1.instability).toBeLessThan(0.85);
  });

  it('separates vacuum nozzles at sea level but not sea-level engines', () => {
    const state = (id: string) => simulate(getPreset(id)!.config, { altitudeKm: 0, throttle: 1 }).state;
    expect(state('merlin-vac')).toBe('separated');
    expect(state('rl10b-2')).toBe('separated');
    for (const id of ['merlin-1d', 'raptor-2', 'rs-25', 'rd-180', 'f-1', 'solid-booster']) {
      expect(state(id), id).not.toBe('separated');
    }
  });

  it('has a default preset', () => {
    expect(getPreset(DEFAULT_PRESET_ID)).toBeDefined();
    expect(getPreset('nope')).toBeUndefined();
  });
});
