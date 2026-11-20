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
    for (const id of ['merlin-1d', 'raptor-2', 'rs-25', 'rd-180', 'rd-170', 'f-1', 'solid-booster', 'xrs-2200']) {
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

  it('gives the nuclear salt-water rocket huge thrust and efficiency together, limited by its nozzle', () => {
    const nswr = getPreset('nswr')!.config;
    const vac = { altitudeKm: 100, throttle: 1 };
    const r = simulate(nswr, vac);
    // Several times NERVA's efficiency and far more thrust than any chemical engine here.
    expect(r.ispVacuum).toBeGreaterThan(6 * simulate(getPreset('nerva')!.config, vac).ispVacuum);
    expect(r.thrust).toBeGreaterThan(simulate(getPreset('rd-170')!.config, vac).thrust);
    expect(r.exitVelocity).toBeGreaterThan(55000);
    expect(r.rough).toBe(false);
    // No reactor core to melt: what gives way is the nozzle.
    expect(r.limits.heating).toBeGreaterThan(0.7);
    expect(r.limits.heating).toBeLessThan(0.9);
    const hotter = simulate({ ...nswr, mixtureRatio: 550000 }, vac);
    expect(hotter.ispVacuum).toBeGreaterThan(r.ispVacuum);
    expect(hotter.failure).toBe(null);
    expect(simulate({ ...nswr, mixtureRatio: 700000 }, vac).failure).toBe('burnthrough');
  });

  it('gives the RL10B-2 a nozzle extension that only works once it seats', () => {
    const rl10 = getPreset('rl10b-2')!.config;
    expect(rl10.extFixedDia).toBeGreaterThan(rl10.throatDia);
    expect(rl10.extFixedDia).toBeLessThan(rl10.exitDia);
    expect(rl10.extDeploy).toBe(1);
    const vac = { altitudeKm: 100, throttle: 1 };
    const at = (extDeploy: number) => simulate({ ...rl10, extDeploy }, vac);
    const seated = at(1);
    const stowed = at(0);
    expect(seated.flowExitDia).toBeCloseTo(rl10.exitDia, 9);
    expect(stowed.flowExitDia).toBeCloseTo(rl10.extFixedDia, 9);
    expect(stowed.ispVacuum).toBeLessThan(seated.ispVacuum);
    expect(stowed.ispVacuum).toBeGreaterThan(0.95 * seated.ispVacuum);
    // Halfway down its rails it is still doing nothing; it comes in over the last tenth of travel.
    expect(at(0.5).thrust).toBe(stowed.thrust);
    expect(at(0.9).thrust).toBe(stowed.thrust);
    expect(at(0.95).thrust).toBeGreaterThan(stowed.thrust);
    expect(at(0.95).thrust).toBeLessThan(seated.thrust);
    // Only this engine has one; everything else ignores the setting.
    expect(PRESETS.filter((p) => p.config.extFixedDia > 0).map((p) => p.id)).toEqual(['rl10b-2']);
    const merlin = getPreset('merlin-1d')!.config;
    expect(simulate({ ...merlin, extDeploy: 0 }, vac).thrust).toBe(simulate(merlin, vac).thrust);
  });
  it('models the RD-170 as four chambers sharing one pump', () => {
    const rd170 = getPreset('rd-170')!.config;
    expect(rd170.chambers).toBe(4);
    // Each real chamber is about 0.38 m across with a 1.43 m nozzle exit.
    expect(rd170.chamberDia).toBeGreaterThan(0.34);
    expect(rd170.chamberDia).toBeLessThan(0.42);
    expect(rd170.exitDia).toBeGreaterThan(1.35);
    expect(rd170.exitDia).toBeLessThan(1.5);
    const sl = { altitudeKm: 0, throttle: 1 };
    const all = simulate(rd170, sl);
    const one = simulate({ ...rd170, chambers: 1 }, sl);
    expect(all.thrust / one.thrust).toBeCloseTo(4, 9);
    expect(all.massFlow / one.massFlow).toBeCloseTo(4, 9);
    expect(all.isp).toBeCloseTo(one.isp, 9);
    // Chamber count does not change how hard each chamber is working.
    expect(all.limits).toEqual(one.limits);
    // Four small chambers are far less prone to instability than one big one of the same thrust.
    expect(all.limits.instability).toBeLessThan(0.3);
    expect(PRESETS.filter((p) => p.config.chambers > 1 && p.config.exhaust !== 'aerospike').map((p) => p.id)).toEqual(['rd-180', 'rd-170']);
    // The RD-180 is half an RD-170: two chambers of nearly the same size.
    const rd180 = getPreset('rd-180')!.config;
    expect(rd180.chambers).toBe(2);
    expect(Math.abs(rd180.chamberDia - rd170.chamberDia) / rd170.chamberDia).toBeLessThan(0.05);
    expect(Math.abs(rd180.exitDia - rd170.exitDia) / rd170.exitDia).toBeLessThan(0.05);
  });

  it('gives the XRS-2200 aerospike a jet the air shapes at every altitude below its design', () => {
    const xrs = getPreset('xrs-2200')!.config;
    expect(xrs.exhaust).toBe('aerospike');
    expect(xrs.chambers).toBe(20);
    expect(PRESETS.filter((p) => p.config.exhaust === 'aerospike').map((p) => p.id)).toEqual(['xrs-2200']);
    // The same cells and expansion ratio with a bell instead. A bell engine has at most four
    // chambers, so compare Isp, not thrust.
    const bell = { ...xrs, exhaust: 'bell' as const };
    const at = (cfg: typeof xrs, altitudeKm: number) => simulate(cfg, { altitudeKm, throttle: 1 });
    // Below its design altitude it never over-expands or separates: the exhaust leaves at the
    // outside pressure, and it beats a bell of the same size.
    for (const h of [0, 2, 5, 8, 12, 16]) {
      const r = at(xrs, h);
      expect(r.state, `${h} km`).toBe('compensating');
      expect(r.pe).toBeCloseTo(r.pa, 6);
      expect(r.effectiveExitDia).toBeLessThan(xrs.exitDia);
      expect(r.isp, `${h} km`).toBeGreaterThan(at(bell, h).isp);
    }
    expect(at(bell, 0).state).toBe('separated');
    // The jet widens as the air thins, until it fills the base at its design altitude.
    expect(at(xrs, 10).effectiveExitDia).toBeGreaterThan(at(xrs, 0).effectiveExitDia);
    // Above it, it is just a fixed nozzle of that size.
    for (const h of [30, 100]) {
      const r = at(xrs, h);
      expect(r.state).toBe('under');
      expect(r.isp).toBeCloseTo(at(bell, h).isp, 6);
      expect(r.effectiveExitDia).toBeCloseTo(xrs.exitDia, 9);
    }
    // Thrust climbs smoothly the whole way up.
    let prev = 0;
    for (let h = 0; h <= 100; h += 0.5) {
      const t = at(xrs, h).thrust;
      expect(t, `${h} km`).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    // Every cell is small, so none of them is near combustion instability.
    expect(at(xrs, 0).limits.instability).toBeLessThan(0.2);
  });

  it('has a default preset', () => {
    expect(getPreset(DEFAULT_PRESET_ID)).toBeDefined();
    expect(getPreset('nope')).toBeUndefined();
  });
});
