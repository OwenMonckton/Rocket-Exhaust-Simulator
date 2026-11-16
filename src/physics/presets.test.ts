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
    for (const id of ['merlin-1d', 'raptor-2', 'rs-25', 'rd-180', 'rd-170', 'f-1', 'solid-booster']) {
      expect(state(id), id).not.toBe('separated');
    }
  });

  it('gives NERVA about twice the efficiency of chemical engines, limited by its core', () => {
    const nerva = getPreset('nerva')!.config;
    const vac = { altitudeKm: 100, throttle: 1 };
    const r = simulate(nerva, vac);
    expect(r.ispVacuum).toBeGreaterThan(1.75 * simulate(getPreset('rs-25')!.config, vac).ispVacuum);
    expect(r.limits.heating).toBeGreaterThan(0.75);
    expect(r.rough).toBe(false);
    // Hotter core: more efficient, then the core melts.
    const hot = simulate({ ...nerva, mixtureRatio: 2800 }, vac);
    expect(hot.ispVacuum).toBeGreaterThan(r.ispVacuum);
    expect(hot.failure).toBe(null);
    expect(simulate({ ...nerva, mixtureRatio: 3000 }, vac).failure).toBe('meltdown');
    // Core temperature is not affected by throttling the chamber pressure.
    expect(simulate(nerva, { altitudeKm: 100, throttle: 0.5 }).tc).toBe(r.tc);
  });

  it('loses vacuum efficiency with the RL10B-2 nozzle extension stowed', () => {
    const rl10 = getPreset('rl10b-2')!;
    expect(rl10.extension).toBeDefined();
    expect(rl10.extension!.stowedExitDia).toBeLessThan(rl10.config.exitDia);
    const vac = { altitudeKm: 100, throttle: 1 };
    const deployed = simulate(rl10.config, vac);
    const stowed = simulate({ ...rl10.config, exitDia: rl10.extension!.stowedExitDia }, vac);
    expect(stowed.ispVacuum).toBeLessThan(deployed.ispVacuum);
    expect(stowed.ispVacuum).toBeGreaterThan(0.95 * deployed.ispVacuum);
    expect(PRESETS.filter((p) => p.extension).map((p) => p.id)).toEqual(['rl10b-2']);
  });

  it('has a default preset', () => {
    expect(getPreset(DEFAULT_PRESET_ID)).toBeDefined();
    expect(getPreset('nope')).toBeUndefined();
  });
});
