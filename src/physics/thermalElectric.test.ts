import { describe, expect, it } from 'vitest';
import { solveHeated } from './chem/pair';
import { rangesFor, sanitize, simulate } from './engine';
import { destroys } from './limits';
import { ENERGY_SOURCES, isBeam, isElectric, propellantsFor } from './parts';
import { PROPELLANTS } from './propellants';
import { starterEngine, withEnergy, withPropellant } from './reshape';
import type { EngineConfig, PropellantId } from './types';

const space = { altitudeKm: 100, throttle: 1 };
const arcjet = (patch: Partial<EngineConfig> = {}) => sanitize({ ...withEnergy(starterEngine(), 'arcjet'), ...patch });
const resistojet = (patch: Partial<EngineConfig> = {}) => sanitize({ ...withEnergy(starterEngine(), 'resistojet'), ...patch });

describe('the two heated-gas electric sources', () => {
  it('are energy sources set by power, with their own propellants', () => {
    for (const id of ['resistojet', 'arcjet'] as const) {
      expect(ENERGY_SOURCES[id]).toMatchObject({ kind: 'thermal', mixKind: 'power', throttleable: true });
      expect(isElectric(id)).toBe(true);
      expect(isBeam(id)).toBe(false);
    }
    expect(isElectric('reactor')).toBe(false);
    expect(propellantsFor('resistojet')).toEqual(['rj-hydrazine', 'rj-ammonia', 'rj-hydrogen', 'rj-water']);
    expect(propellantsFor('arcjet')).toEqual(['aj-hydrazine', 'aj-ammonia', 'aj-hydrogen']);
    expect(ENERGY_SOURCES.resistojet.coreTempLimit).toBe(2400);
    expect(ENERGY_SOURCES.arcjet.coreTempLimit).toBe(6000);
    expect(propellantsFor('reactor')).toContain('ntr-ammonia');
  });

  it('may be far smaller than any other engine', () => {
    const r = rangesFor('arcjet');
    expect(r.throatDia.min).toBe(0.0003);
    expect(r.chamberPressureBar.min).toBe(0.5);
    expect(rangesFor('combustion').throatDia.min).toBe(0.02);
    const small = arcjet({ throatDia: 0.0004, chamberPressureBar: 0.7 });
    expect(small.throatDia).toBe(0.0004);
    expect(small.chamberPressureBar).toBe(0.7);
    expect(sanitize({ ...small, energy: 'combustion', propellant: 'kerolox' }).throatDia).toBe(0.02);
  });

  it('start as a small engine that runs within its limits', () => {
    for (const cfg of [arcjet(), resistojet()]) {
      expect(cfg.throatDia).toBeLessThan(0.002);
      const r = simulate(cfg, space);
      expect(r.failure, cfg.energy).toBeNull();
      expect(r.limits.heating, cfg.energy).toBeLessThan(0.9);
      expect(r.limits.structural, cfg.energy).toBeLessThan(0.9);
      expect(r.limits.instability, cfg.energy).toBeLessThan(0.1);
      expect(r.thrust, cfg.energy).toBeGreaterThan(0.01);
      expect(r.thrust, cfg.energy).toBeLessThan(5);
    }
  });
});

describe('gas heated by electrical power', () => {
  it('takes up exactly the share of the power that reaches it', () => {
    for (const cfg of [arcjet(), arcjet({ powerKW: 1 }), resistojet(), resistojet({ propellant: 'rj-ammonia', powerKW: 0.5 })]) {
      const r = simulate(cfg, space);
      expect(r.failure, cfg.propellant).toBeNull();
      const heat = ENERGY_SOURCES[cfg.energy].heatingShare! * cfg.powerKW * 1000;
      const q = heat / r.massFlow;
      // The same energy per kilogram, solved afresh, reaches the temperature the engine reports.
      const again = solveHeated(PROPELLANTS[cfg.propellant].fluid!, q, cfg.chamberPressureBar, r.expansionRatio);
      expect(again.ok, cfg.propellant).toBe(true);
      expect(Math.abs(again.tc - r.electric!.heatedTo!) / again.tc, cfg.propellant).toBeLessThan(0.01);
      expect(r.tc).toBe(r.electric!.heatedTo);
      expect(r.electric!.power).toBeCloseTo(cfg.powerKW * 1000, 6);
    }
  });

  it('runs hotter and more efficiently on more power, through less flow', () => {
    let last = simulate(arcjet({ powerKW: 0.5 }), space);
    for (const powerKW of [1, 2, 3]) {
      const now = simulate(arcjet({ powerKW }), space);
      expect(now.failure, `${powerKW} kW`).toBeNull();
      expect(now.tc).toBeGreaterThan(last.tc);
      expect(now.ispVacuum).toBeGreaterThan(last.ispVacuum);
      expect(now.massFlow).toBeLessThan(last.massFlow);
      last = now;
    }
  });

  it('holds its temperature when throttled: power and flow come down together', () => {
    const cfg = arcjet();
    const full = simulate(cfg, space);
    const half = simulate(cfg, { altitudeKm: 100, throttle: 0.5 });
    // Not exactly: at half the pressure a little more of the gas is torn into atoms, which takes heat.
    expect(Math.abs(half.tc - full.tc) / full.tc).toBeLessThan(0.06);
    expect(half.electric!.power).toBeCloseTo(full.electric!.power / 2, 6);
    expect(half.thrust).toBeLessThan(0.6 * full.thrust);
  });

  it('reports how much of the power becomes thrust', () => {
    for (const cfg of [arcjet(), resistojet(), arcjet({ propellant: 'aj-hydrogen', powerKW: 3 })]) {
      const r = simulate(cfg, space);
      const e = r.electric!.thrustEfficiency;
      expect(e).toBeCloseTo(r.thrust ** 2 / (2 * r.massFlow * r.electric!.power), 9);
      expect(e).toBeGreaterThan(0.05);
    }
    // A propellant with no heat of its own cannot put more into its jet than the arc gave it.
    const h2 = simulate(arcjet({ propellant: 'aj-hydrogen', powerKW: 3 }), space);
    expect(h2.failure).toBeNull();
    expect(h2.electric!.thrustEfficiency).toBeLessThan(ENERGY_SOURCES.arcjet.heatingShare!);
  });

  it('fails by overheating when given far too much power for its flow', () => {
    const cooked = simulate(arcjet({ powerKW: 100 }), space);
    expect(cooked.failure).toBe('meltdown');
    expect(simulate(resistojet({ powerKW: 100 }), space).failure).toBe('meltdown');
    for (const v of Object.values(cooked.limits)) expect(Number.isFinite(v)).toBe(true);
    expect(Number.isFinite(cooked.thrust)).toBe(true);
  });

  it('will not start on too little power to boil its propellant, and is not destroyed by it', () => {
    const wet = simulate(resistojet({ propellant: 'rj-water', powerKW: 0.05, throatDia: 0.002, chamberPressureBar: 4 }), space);
    expect(wet.failure).toBe('underpowered');
    expect(destroys('underpowered')).toBe(false);
    expect(wet.settled).toBe(false);
  });

  it('runs hydrazine on almost no power, on the heat of its own breakdown', () => {
    const r = simulate(resistojet({ powerKW: 0.05, throatDia: 0.002 }), space);
    expect(r.failure).toBeNull();
    expect(r.tc).toBeGreaterThan(700);
    expect(r.notes.join(' ')).not.toMatch(/adding little/);
  });

  it('says so when the heater is adding little', () => {
    // Enough to boil ammonia, not enough to make it hot.
    let found = false;
    for (const powerKW of [0.4, 0.45, 0.5, 0.55, 0.6]) {
      const r = simulate(resistojet({ propellant: 'rj-ammonia', powerKW }), space);
      if (r.failure === null && r.tc < 700) {
        expect(r.notes.join(' ')).toMatch(/adding little/);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('gives finite figures for every propellant at the starter engine', () => {
    for (const energy of ['resistojet', 'arcjet'] as const) {
      for (const propellant of propellantsFor(energy)) {
        const cfg = withPropellant(energy === 'arcjet' ? arcjet() : resistojet(), propellant as PropellantId);
        const r = simulate(cfg, space);
        for (const [k, v] of Object.entries(r)) if (typeof v === 'number') expect(Number.isFinite(v), `${propellant} ${k}`).toBe(true);
        for (const v of Object.values(r.electric!)) expect(Number.isFinite(v), propellant).toBe(true);
      }
    }
  });
});

describe('swapping to and from a heated-gas electric source', () => {
  it('goes from a big burning engine to an arcjet and back without breaking anything', () => {
    const big = sanitize({ ...starterEngine(), throatDia: 2, chamberDia: 4, exitDia: 8 });
    const small = withEnergy({ ...big, presetId: 'merlin-1d' }, 'arcjet');
    expect(small.energy).toBe('arcjet');
    // Nothing of the example is left, so it is not that example modified.
    expect(small.presetId).toBeNull();
    expect(small.propellant).toBe('aj-hydrazine');
    expect(simulate(small, space).failure).toBeNull();
    const back = withEnergy(small, 'combustion');
    expect(back.energy).toBe('combustion');
    expect(withEnergy({ ...small, presetId: 'merlin-1d' }, 'combustion').presetId).toBeNull();
    expect(back.throatDia).toBeGreaterThanOrEqual(0.02);
    expect(simulate(back, space).failure).toBeNull();
    const nuclear = withEnergy(small, 'reactor');
    expect(nuclear.energy).toBe('reactor');
    expect(simulate(nuclear, space).failure).toBeNull();
  });

  it('keeps the size and power when the propellant changes', () => {
    const a = arcjet();
    const b = withPropellant(a, 'aj-ammonia');
    expect(b).toMatchObject({ throatDia: a.throatDia, chamberPressureBar: a.chamberPressureBar, powerKW: a.powerKW, propellant: 'aj-ammonia' });
  });

  it('leaves every other source without electric figures', () => {
    expect(simulate(starterEngine(), space).electric).toBeUndefined();
  });
});
