import { describe, expect, it } from 'vitest';
import { sanitize, simulate } from './engine';
import { ENERGY_IDS, propellantsFor } from './parts';
import { getPreset } from './presets';
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
