import { describe, expect, it } from 'vitest';
import { sanitize, simulate } from './engine';
import { ENERGY_IDS, propellantsFor } from './parts';
import { PRESETS, getPreset } from './presets';
import { DEFAULT_CELLS, starterEngine, withEnergy, withExhaust } from './reshape';
import type { EngineConfig } from './types';

const ground = { altitudeKm: 0, throttle: 1 };
const space = { altitudeKm: 100, throttle: 1 };
const structural = (cfg: EngineConfig) => simulate(cfg, ground).limits.structural;
const NUMBERS = ['chamberDia', 'chamberLen', 'throatDia', 'exitDia', 'wall', 'chambers', 'chamberPressureBar'] as const;

/** The starter grown or shrunk until its throat is `throatDia` across, as Engine scale would. */
function starterWithThroat(throatDia: number): EngineConfig {
  const s = starterEngine();
  const k = throatDia / s.throatDia;
  return sanitize({ ...s, chamberDia: s.chamberDia * k, chamberLen: s.chamberLen * k, throatDia, exitDia: s.exitDia * k, wall: s.wall * k });
}

describe('the blank engine', () => {
  it('is a valid custom engine that runs well inside every limit', () => {
    const s = starterEngine();
    expect(sanitize(s)).toEqual(s);
    expect(s.presetId).toBeNull();
    expect(s).toMatchObject({ energy: 'combustion', exhaust: 'bell', propellant: 'kerolox' });
    for (const flight of [ground, space]) {
      const r = simulate(s, flight);
      expect(r.failure).toBeNull();
      expect(r.limits.structural).toBeLessThan(0.7);
      expect(r.limits.heating).toBeLessThan(0.7);
      expect(r.limits.instability).toBeLessThan(0.7);
    }
  });
});

describe('changing the energy source', () => {
  it('leaves an engine that already has that source alone', () => {
    const s = starterEngine();
    expect(withEnergy(s, 'combustion')).toBe(s);
  });

  for (const e of ENERGY_IDS) {
    it(`gives a ${e} engine that runs, as stressed as the engine it came from`, () => {
      const from = starterEngine();
      const next = withEnergy(from, e);
      expect(next.energy).toBe(e);
      expect(next.propellant).toBe(propellantsFor(e)[0]);
      expect(next.throatDia).toBe(from.throatDia);
      expect(next.exitDia).toBe(from.exitDia);
      expect(next.chamberPressureBar).toBe(from.chamberPressureBar);
      expect(sanitize(next)).toEqual(next);
      expect(structural(next) / structural(from)).toBeCloseTo(1, 2);
      expect(simulate(next, ground).failure).toBeNull();
      expect(simulate(next, space).failure).toBeNull();
    });

    it(`does not burst a very small or very large engine by switching it to ${e} (review focus)`, () => {
      for (const throat of [0.02, 5]) {
        const from = starterWithThroat(throat);
        expect(structural(withEnergy(from, e))).toBeLessThanOrEqual(structural(from) * 1.01);
      }
    });
  }

  it('shapes the chamber to suit the source', () => {
    const from = starterEngine();
    expect(withEnergy(from, 'reactor').chamberDia).toBeCloseTo(6 * from.throatDia, 6);
    const solid = withEnergy(from, 'solid');
    expect(solid.chamberDia).toBeCloseTo(3 * from.throatDia, 6);
    expect(solid.chamberLen).toBeCloseTo(5 * solid.chamberDia, 6);
  });

  it('keeps an example engine tied to its example', () => {
    expect(withEnergy(getPreset('merlin-1d')!.config, 'reactor').presetId).toBe('merlin-1d');
  });
});

describe('changing the exhaust type', () => {
  it('leaves an engine that already has that exhaust alone', () => {
    const s = starterEngine();
    expect(withExhaust(s, 'bell')).toBe(s);
  });

  it('splits a bell engine into thrust cells of the same total size', () => {
    const from = starterEngine();
    const spike = withExhaust(from, 'aerospike');
    expect(spike.exhaust).toBe('aerospike');
    expect(spike.chambers).toBe(DEFAULT_CELLS);
    expect(sanitize(spike)).toEqual(spike);
    expect(spike.chambers * spike.throatDia ** 2).toBeCloseTo(from.chambers * from.throatDia ** 2, 9);
    expect(spike.chambers * spike.exitDia ** 2).toBeCloseTo(from.chambers * from.exitDia ** 2, 9);
    expect(structural(spike) / structural(from)).toBeCloseTo(1, 2);
    const ratio = simulate(spike, space).thrust / simulate(from, space).thrust;
    expect(ratio).toBeGreaterThan(0.97);
    expect(ratio).toBeLessThan(1.03);
  });

  for (const e of ENERGY_IDS) {
    it(`gives a ${e} aerospike that runs`, () => {
      const spike = withExhaust(withEnergy(starterEngine(), e), 'aerospike');
      expect(simulate(spike, ground).failure).toBeNull();
      expect(simulate(spike, space).failure).toBeNull();
    });
  }

  it('comes back to the same bell engine (review focus)', () => {
    const from = starterEngine();
    const back = withExhaust(withExhaust(from, 'aerospike'), 'bell');
    expect(back.exhaust).toBe('bell');
    for (const k of NUMBERS) expect(back[k] / from[k]).toBeCloseTo(1, 9);
  });

  it('drops a nozzle extension, which a spike cannot have (review focus)', () => {
    const spike = withExhaust(getPreset('rl10b-2')!.config, 'aerospike');
    expect(spike.extFixedDia).toBe(0);
    for (const flight of [ground, space]) {
      const r = simulate(spike, flight);
      for (const v of [r.thrust, r.isp, r.massFlow]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('part swaps on engines other than the blank one (final review)', () => {
  it('splits a small engine into fewer cells rather than bursting it', () => {
    for (const throat of [0.03, 0.05, 0.1]) {
      const from = starterWithThroat(throat);
      const spike = withExhaust(from, 'aerospike');
      expect(simulate(spike, ground).failure, `throat ${throat}`).toBeNull();
      expect(structural(spike)).toBeLessThanOrEqual(structural(from) * 1.01);
      expect((spike.chambers * spike.throatDia ** 2) / (from.chambers * from.throatDia ** 2)).toBeCloseTo(1, 6);
      const back = withExhaust(spike, 'bell');
      expect(back.throatDia / from.throatDia).toBeCloseTo(1, 6);
      expect(structural(back) / structural(from)).toBeCloseTo(1, 2);
    }
  });

  it('never destroys an example engine by giving it an aerospike', () => {
    for (const p of PRESETS.filter((q) => q.config.exhaust === 'bell')) {
      const spike = withExhaust(p.config, 'aerospike');
      expect(spike.chambers, p.id).toBeGreaterThanOrEqual(1);
      expect(simulate(spike, ground).failure, p.id).toBeNull();
      expect(simulate(spike, space).failure, p.id).toBeNull();
    }
  });

  it('never bursts, melts or burns through an example engine by changing its energy source', () => {
    for (const p of PRESETS) {
      for (const e of ENERGY_IDS) {
        // A very large engine turned into a combustion chamber is unstable, as the F-1 nearly was: that is the physics, not the swap.
        expect([null, 'instability'], `${p.id} -> ${e}`).toContain(simulate(withEnergy(p.config, e), space).failure);
      }
    }
  });

  it('leaves the temperature alone when the swap is not what made the engine hot', () => {
    const hot = sanitize({ ...getPreset('nerva')!.config, mixtureRatio: 2700 });
    expect(simulate(hot, space).failure).toBeNull();
    const spike = withExhaust(hot, 'aerospike');
    expect(spike.mixtureRatio).toBe(2700);
    expect(withExhaust(spike, 'bell').mixtureRatio).toBe(2700);
  });

  it('sets the new source to its usual setting', () => {
    expect(withEnergy(starterEngine(), 'reactor').mixtureRatio).toBe(2360);
    expect(withEnergy(starterEngine(), 'saltwater').propellant).toBe('saltwater');
  });
});

describe('part swaps at the edges of what can be built (Copilot review)', () => {
  it('does not burn through a high-pressure reactor by switching it to a flame', () => {
    const from = sanitize({
      ...withEnergy(starterEngine(), 'reactor'),
      throatDia: 0.02,
      chamberDia: 0.12,
      exitDia: 0.08,
      wall: 0.016,
      chamberPressureBar: 400,
      mixtureRatio: 1500,
    });
    expect(simulate(from, ground).failure).toBeNull();
    for (const e of ['solid', 'combustion'] as const) {
      const next = withEnergy(from, e);
      expect(simulate(next, ground).failure, e).toBeNull();
      expect(simulate(next, ground).limits.heating, e).toBeLessThanOrEqual(0.9);
      // Turned down, not thinned out: it is no closer to bursting than it was.
      expect(next.chamberPressureBar, e).toBeLessThan(from.chamberPressureBar);
      expect(structural(next) / structural(from), e).toBeCloseTo(1, 1);
    }
  });

  it('leaves the pressure alone when the swap is not what made a flame hot', () => {
    const s = starterEngine();
    const hot = sanitize({ ...s, chamberPressureBar: 300, wall: s.wall * 3 });
    expect(simulate(hot, ground).limits.heating).toBeGreaterThan(0.9);
    expect(simulate(hot, ground).failure).toBeNull();
    expect(withEnergy(hot, 'solid').chamberPressureBar).toBe(300);
  });

  it('merges a spike too big for one bell into as few bells as hold its throat area', () => {
    const spike = sanitize({
      ...withExhaust(starterEngine(), 'aerospike'),
      chambers: 40,
      throatDia: 1,
      chamberDia: 1.5,
      exitDia: 3,
      wall: 0.2,
    });
    const bell = withExhaust(spike, 'bell');
    expect(bell.exhaust).toBe('bell');
    expect(bell.chambers).toBe(2);
    expect(bell.chambers * bell.throatDia ** 2).toBeCloseTo(spike.chambers * spike.throatDia ** 2, 6);
    expect(bell.chambers * bell.exitDia ** 2).toBeCloseTo(spike.chambers * spike.exitDia ** 2, 6);
    const ratio = simulate(bell, space).thrust / simulate(spike, space).thrust;
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
  });

  it('merges a spike too big for any bell engine into the most bells there can be', () => {
    const spike = sanitize({
      ...withExhaust(starterEngine(), 'aerospike'),
      chambers: 40,
      throatDia: 4,
      chamberDia: 6,
      exitDia: 8,
      wall: 0.5,
    });
    const bell = withExhaust(spike, 'bell');
    expect(bell.chambers).toBe(4);
    expect(sanitize(bell)).toEqual(bell);
  });
});
