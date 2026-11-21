import { describe, expect, it } from 'vitest';
import { sanitize, simulate } from './engine';
import { PRESETS } from './presets';
import type { EngineConfig, SimResult } from './types';

const base: EngineConfig = {
  presetId: null,
  energy: 'combustion',
  propellant: 'kerolox',
  fuel: 'rp1',
  oxidiser: 'lox',
  chamberDia: 0.4,
  chamberLen: 0.5,
  throatDia: 0.22,
  exitDia: 0.9,
  nozzleLenPct: 80,
  wall: 0.012,
  chamberPressureBar: 100,
  mixtureRatio: 2.4,
  scale: 1,
  chambers: 1,
  extFixedDia: 0,
  extDeploy: 1,
  exhaust: 'bell' as const,
};
const sl = { altitudeKm: 0, throttle: 1 };

function allFinite(r: SimResult) {
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'number') expect(Number.isFinite(v), k).toBe(true);
  }
  for (const v of Object.values(r.limits)) expect(Number.isFinite(v)).toBe(true);
}

describe('aerospike', () => {
  it('only exists as a real choice, and never with a nozzle extension', () => {
    expect(sanitize({ ...base, exhaust: 'yes' as never }).exhaust).toBe('bell');
    const spike = sanitize({ ...base, exhaust: 'aerospike' as const, extFixedDia: 0.5, extDeploy: 0.3, chambers: 20 });
    expect(spike.exhaust).toBe('aerospike');
    expect(spike.extFixedDia).toBe(0);
    expect(spike.extDeploy).toBe(1);
    // Up to 40 thrust cells; bells stay at four chambers or fewer.
    expect(spike.chambers).toBe(20);
    expect(sanitize({ ...base, exhaust: 'aerospike' as const, chambers: 99 }).chambers).toBe(40);
    expect(sanitize({ ...base, chambers: 20 }).chambers).toBe(4);
  });
  it('matches a bell that is the right size for the altitude, less a little loss', () => {
    const spike = { ...base, exhaust: 'aerospike' as const, exitDia: 1.3 };
    const r = simulate(spike, sl);
    expect(r.state).toBe('compensating');
    // A bell whose exit matches the air exactly does at least as well as the spike.
    const matched = simulate({ ...base, exitDia: r.effectiveExitDia }, sl);
    expect(matched.state).toBe('ideal');
    expect(r.thrust).toBeLessThanOrEqual(matched.thrust * 1.001);
    expect(r.thrust).toBeGreaterThan(simulate({ ...base, exitDia: 1.3 }, sl).thrust);
    allFinite(r);
    allFinite(simulate({ ...spike, chamberPressureBar: 5 }, { altitudeKm: 0, throttle: 0.4 }));
  });
  it('is never worse than the bell it replaces, on any engine at any altitude', () => {
    for (const p of PRESETS) {
      const bell = { ...p.config, exhaust: 'bell' as const, extFixedDia: 0 };
      const spike = { ...bell, exhaust: 'aerospike' as const };
      for (let h = 0; h <= 100; h += 0.5) {
        const f = { altitudeKm: h, throttle: 1 };
        const s = simulate(spike, f);
        const b = simulate(bell, f);
        expect(s.isp, `${p.id} at ${h} km`).toBeGreaterThanOrEqual(b.isp * (1 - 1e-9));
        // Nor better than a nozzle perfectly matched to the air.
        if (s.state === 'compensating') {
          const matched = simulate({ ...bell, exitDia: s.effectiveExitDia }, f);
          expect(s.isp, `${p.id} at ${h} km`).toBeLessThanOrEqual(matched.isp * 1.001);
          expect(s.isp, `${p.id} at ${h} km`).toBeGreaterThan(0.9 * matched.isp);
        }
      }
    }
  });
  it('loses nothing at sea level by having a spike far too big for it', () => {
    // The air decides how far the gas expands, so past a point a bigger spike changes nothing.
    const spike = { ...base, exhaust: 'aerospike' as const };
    const big = simulate({ ...spike, exitDia: 3 }, sl);
    const huge = simulate({ ...spike, exitDia: 20 }, sl);
    expect(big.state).toBe('compensating');
    expect(huge.thrust).toBeCloseTo(big.thrust, 3);
    expect(huge.effectiveExitDia).toBeCloseTo(big.effectiveExitDia, 9);
    // Throttled right down, or at very low pressure, it still makes thrust.
    for (const chamberPressureBar of [5, 20, 100]) {
      for (const throttle of [0.4, 1]) {
        const r = simulate({ ...spike, exitDia: 20, chamberPressureBar }, { altitudeKm: 0, throttle });
        const bell = simulate({ ...base, exitDia: 20, chamberPressureBar }, { altitudeKm: 0, throttle });
        expect(r.thrust).toBeGreaterThan(0);
        expect(r.thrust).toBeGreaterThanOrEqual(bell.thrust);
      }
    }
  });
});

describe('simulate behaviour', () => {
  it('gains thrust with altitude and has better vacuum Isp', () => {
    const a = simulate(base, sl);
    const b = simulate(base, { altitudeKm: 30, throttle: 1 });
    expect(b.thrust).toBeGreaterThan(a.thrust);
    expect(a.ispVacuum).toBeGreaterThan(a.ispSeaLevel);
    expect(a.isp).toBeCloseTo(a.ispSeaLevel, 6);
  });
  it('doubles mass flow when throat area doubles', () => {
    const a = simulate({ ...base, chamberLen: 2 }, sl);
    const b = simulate({ ...base, chamberLen: 4, throatDia: base.throatDia * Math.SQRT2 }, sl);
    expect(b.massFlow / a.massFlow).toBeCloseTo(2, 2);
  });
  it('raises thrust and limits with chamber pressure', () => {
    const a = simulate(base, sl);
    const b = simulate({ ...base, chamberPressureBar: 150 }, sl);
    expect(b.thrust).toBeGreaterThan(a.thrust);
    expect(b.limits.structural).toBeGreaterThan(a.limits.structural);
    expect(b.limits.heating).toBeGreaterThan(a.limits.heating);
    expect(b.limits.instability).toBeGreaterThan(a.limits.instability);
  });
  it('keeps the structural margin under uniform scaling and quadruples thrust', () => {
    const a = simulate(base, sl);
    const big: EngineConfig = {
      ...base,
      chamberDia: base.chamberDia * 2,
      chamberLen: base.chamberLen * 2,
      throatDia: base.throatDia * 2,
      exitDia: base.exitDia * 2,
      wall: base.wall * 2,
      scale: 2,
    };
    const b = simulate(big, sl);
    expect(b.limits.structural).toBeCloseTo(a.limits.structural, 9);
    expect(b.thrust / a.thrust).toBeCloseTo(4, 1);
    expect(b.limits.instability).toBeGreaterThan(a.limits.instability);
    expect(b.limits.heating).toBeLessThan(a.limits.heating);
  });
  it('raises structural load when only the chamber is widened', () => {
    const a = simulate(base, sl);
    const b = simulate({ ...base, chamberDia: 0.6 }, sl);
    expect(b.limits.structural).toBeGreaterThan(a.limits.structural);
  });
  it('loses combustion efficiency with a short chamber', () => {
    const a = simulate({ ...base, chamberLen: 0.6 }, sl);
    const b = simulate({ ...base, chamberLen: 0.08 }, sl);
    expect(b.combustionEff).toBeLessThan(a.combustionEff);
    expect(b.isp).toBeLessThan(a.isp);
  });
  it('labels expansion states', () => {
    expect(simulate({ ...base, exitDia: 0.4 }, sl).state).toBe('under');
    expect(simulate({ ...base, exitDia: 1.3 }, sl).state).toBe('over');
    const sep = simulate({ ...base, exitDia: 3 }, sl);
    expect(sep.state).toBe('separated');
    expect(sep.effectiveExitDia).toBeLessThan(3);
    expect(sep.thrust).toBeGreaterThan(0);
  });
  it('reports failures past the limits', () => {
    expect(simulate({ ...base, wall: 0.002 }, sl).failure).toBe('burst');
    expect(simulate({ ...base, chamberPressureBar: 400, wall: 0.2, throatDia: 0.05 }, sl).failure).toBe(
      'burnthrough',
    );
    expect(
      simulate({ ...base, chamberDia: 1.6, wall: 0.2, throatDia: 1, exitDia: 3, chamberLen: 2 }, sl).failure,
    ).toBe('instability');
    expect(simulate(base, sl).failure).toBe(null);
  });
  it('runs rough at the ends of the mixture range', () => {
    expect(simulate({ ...base, mixtureRatio: 1.8 }, sl).rough).toBe(true);
    expect(simulate(base, sl).rough).toBe(false);
  });
});

describe('degenerate input (review focus)', () => {
  it('survives impossible geometry', () => {
    allFinite(simulate({ ...base, throatDia: 3, chamberDia: 0.2 }, sl));
    allFinite(simulate({ ...base, exitDia: 0.01 }, sl));
    allFinite(simulate({ ...base, chamberDia: 0, chamberLen: 0, throatDia: 0, exitDia: 0, wall: 0 }, sl));
    allFinite(
      simulate(
        { ...base, chamberDia: NaN, throatDia: Infinity, chamberPressureBar: -5, mixtureRatio: NaN, wall: NaN },
        { altitudeKm: NaN, throttle: NaN },
      ),
    );
    allFinite(simulate({ ...base, propellant: 'bogus' as never }, sl));
    const s = sanitize({ ...base, throatDia: 3, chamberDia: 0.2, exitDia: 0.01 });
    expect(s.throatDia).toBeLessThan(s.chamberDia);
    expect(s.exitDia).toBeGreaterThan(s.throatDia);
  });
  it('handles vacuum without dividing by zero', () => {
    const r = simulate(base, { altitudeKm: 100, throttle: 1 });
    allFinite(r);
    expect(r.pa).toBe(0);
    expect(r.state).toBe('under');
    expect(r.isp).toBeCloseTo(r.ispVacuum, 6);
  });
  it('ignores throttle and mixture for solids', () => {
    const solid = { ...base, energy: 'solid' as const, propellant: 'solid' as const, mixtureRatio: 7 };
    const a = simulate(solid, { altitudeKm: 0, throttle: 0.4 });
    const b = simulate({ ...solid, mixtureRatio: 1 }, sl);
    expect(a.thrust).toBe(b.thrust);
    expect(a.massFlow).toBe(b.massFlow);
  });
});
