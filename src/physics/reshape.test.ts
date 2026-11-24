import { describe, expect, it } from 'vitest';
import { pairRange } from './chem/pair';
import { defaultInnerExitDia } from './exhausts';
import { sanitize, simulate } from './engine';
import { ENERGY_IDS, propellantsFor } from './parts';
import { PRESETS, getPreset } from './presets';
import { DEFAULT_CELLS, starterEngine, withEnergy, withExhaust, withPropellant } from './reshape';
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
    expect(s).toMatchObject({ energy: 'combustion', exhaust: 'bell', propellant: 'calculated', fuel: 'rp1', oxidiser: 'lox' });
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
      // A combustion chamber burns RP-1 with liquid oxygen, worked out by the solver.
      expect(next.propellant).toBe(e === 'combustion' ? 'calculated' : propellantsFor(e)[0]);
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

  it('gives a burning engine RP-1 and liquid oxygen, worked out by the solver', () => {
    const back = withEnergy(withEnergy(starterEngine(), 'reactor'), 'combustion');
    expect(back).toMatchObject({ propellant: 'calculated', fuel: 'rp1', oxidiser: 'lox', mixtureRatio: pairRange('rp1', 'lox').ofDefault });
    expect(simulate(back, ground).calculated).toBe(true);
    expect(simulate(back, ground).failure).toBeNull();
  });

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

describe('swapping between the new exhaust types', () => {
  const chamberTypes = ['bell', 'cone', 'dualBell', 'none'] as const;
  it('changes only the nozzle between exhausts that count chambers', () => {
    const from = starterEngine();
    for (const to of chamberTypes) {
      const next = withExhaust(from, to);
      expect(next.exhaust).toBe(to);
      for (const key of ['chamberDia', 'chamberLen', 'throatDia', 'exitDia', 'wall', 'chamberPressureBar', 'chambers'] as const) {
        expect(next[key], `${to} ${key}`).toBe(from[key]);
      }
    }
  });
  it('brings the nozzle back exactly after no nozzle', () => {
    const from = starterEngine();
    expect(withExhaust(withExhaust(from, 'none'), 'bell')).toEqual(from);
  });
  it('gives a dual bell a kink when it is first chosen, and keeps one already set', () => {
    const first = withExhaust(starterEngine(), 'dualBell');
    expect(first.innerExitDia).toBeCloseTo(defaultInnerExitDia(first.throatDia, first.exitDia), 9);
    const moved = sanitize({ ...first, innerExitDia: 1.3 * first.throatDia });
    expect(withExhaust(withExhaust(moved, 'cone'), 'dualBell').innerExitDia).toBeCloseTo(moved.innerExitDia, 9);
  });
  it("carries a dual bell's kink in proportion through an aerospike, when the chamber count changes", () => {
    const rd180 = PRESETS.find((p) => p.id === 'rd-180')!.config;
    const first = withExhaust(rd180, 'dualBell');
    const from = sanitize({ ...first, innerExitDia: 1.3 * first.throatDia });
    const back = withExhaust(withExhaust(from, 'aerospike'), 'dualBell');
    expect(back.chambers).not.toBe(from.chambers);
    expect(back.innerExitDia / back.throatDia).toBeCloseTo(from.innerExitDia / from.throatDia, 6);
  });
  it('drops an extension on leaving a bell, and stays finite', () => {
    const rl10 = PRESETS.find((p) => p.id === 'rl10b-2')!.config;
    for (const to of ['cone', 'dualBell', 'none'] as const) {
      const next = withExhaust(rl10, to);
      expect(next.extFixedDia).toBe(0);
      const r = simulate(next, { altitudeKm: 100, throttle: 1 });
      expect(Number.isFinite(r.thrust) && Number.isFinite(r.isp)).toBe(true);
    }
  });
  it('keeps total throat area through an aerospike and back, for each chamber type', () => {
    const area = (c: EngineConfig) => c.chambers * c.throatDia ** 2;
    for (const type of chamberTypes) {
      const from = withExhaust(starterEngine(), type);
      const back = withExhaust(withExhaust(from, 'aerospike'), type);
      expect(back.exhaust).toBe(type);
      expect(area(back)).toBeCloseTo(area(from), 6);
    }
  });
  it('keeps a multi-chamber engine as it was between exhausts that count chambers', () => {
    for (const id of ['rd-180', 'rd-170']) {
      const preset = PRESETS.find((p) => p.id === id)!;
      for (const to of ['cone', 'dualBell', 'none'] as const) {
        const next = withExhaust(preset.config, to);
        for (const key of ['chambers', 'chamberDia', 'chamberLen', 'throatDia', 'exitDia', 'wall', 'chamberPressureBar'] as const) {
          expect(next[key], `${id} ${to} ${key}`).toBe(preset.config[key]);
        }
      }
    }
  });
  it('does not destroy any example by swapping in a new exhaust', () => {
    for (const preset of PRESETS) for (const to of ['cone', 'dualBell', 'none'] as const) {
      if (simulate(preset.config, { altitudeKm: 0, throttle: 1 }).failure) continue;
      expect(simulate(withExhaust(preset.config, to), { altitudeKm: 0, throttle: 1 }).failure, `${preset.id} → ${to}`).toBeNull();
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

  it('does not burst a throttled-down engine by switching it to a source that cannot throttle', () => {
    const throttled = { altitudeKm: 0, throttle: 0.4 };
    const from = sanitize({ ...starterEngine(), chamberDia: 0.8 });
    const before = simulate(from, throttled);
    expect(before.failure).toBeNull();
    const next = withEnergy(from, 'solid', throttled.throttle);
    const after = simulate(next, throttled);
    expect(after.failure).toBeNull();
    expect(after.limits.structural).toBeLessThanOrEqual(before.limits.structural * 1.01);
    // At full throttle the swap changes nothing.
    expect(withEnergy(starterEngine(), 'solid', 1)).toEqual(withEnergy(starterEngine(), 'solid'));
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

describe('swaps that used to destroy the engine by themselves (code review)', () => {
  it('does not burn through a turned-down reactor by changing its propellant', () => {
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
    const next = withPropellant(from, 'ntr-ammonia');
    expect(next.propellant).toBe('ntr-ammonia');
    expect(simulate(next, ground).failure).toBeNull();
    expect(simulate(next, ground).limits.heating).toBeLessThanOrEqual(0.9);
  });

  it('gives a new propellant its usual setting where that is safe', () => {
    expect(withPropellant(starterEngine(), 'hydrolox')).toMatchObject({ propellant: 'hydrolox', mixtureRatio: 6 });
    const reactor = withEnergy(starterEngine(), 'reactor');
    expect(withPropellant(reactor, 'ntr-water')).toMatchObject({ propellant: 'ntr-water', mixtureRatio: 2360 });
    expect(withPropellant(reactor, 'ntr-hydrogen')).toBe(reactor);
  });

  it('merges a spike into enough bells to stay stable, where one wide chamber would not be', () => {
    const spike = sanitize({
      ...withExhaust(starterEngine(), 'aerospike'),
      chambers: 20,
      throatDia: 0.2,
      chamberDia: 0.4,
      exitDia: 0.8,
      wall: 0.02,
    });
    expect(simulate(spike, ground).failure).toBeNull();
    const bell = withExhaust(spike, 'bell');
    expect(bell.exhaust).toBe('bell');
    expect(bell.chambers).toBeGreaterThan(1);
    expect(simulate(bell, ground).failure).toBeNull();
    expect(bell.chambers * bell.throatDia ** 2).toBeCloseTo(spike.chambers * spike.throatDia ** 2, 6);
  });
});
