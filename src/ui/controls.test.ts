import { describe, expect, it } from 'vitest';
import { formatMixture, innerExitRange, propellantNote, roundMixture, shapeSlidersShown } from './controls';
import { getPreset } from '../physics/presets';
import { sanitize } from '../physics/engine';
import { starterEngine } from '../physics/reshape';
import type { ExhaustId } from '../physics/types';

describe('the mixture slider', () => {
  const range = { ofMin: 0.02, ofMax: 40 };
  it('rounds a log-scaled ratio to three significant figures, so the fuel-rich end does not snap', () => {
    expect(roundMixture(0.023456, 'ratio', true, range)).toBe(0.0235);
    expect(roundMixture(0.031234, 'ratio', true, range)).toBe(0.0312);
    expect(roundMixture(12.345, 'ratio', true, range)).toBe(12.3);
  });
  it('keeps hundredths on a linear ratio slider', () => {
    expect(roundMixture(2.3456, 'ratio', false, range)).toBe(2.35);
  });
  it('steps a temperature in round numbers suited to its range', () => {
    expect(roundMixture(2364, 'temperature', false, { ofMin: 1500, ofMax: 3200 })).toBe(2360);
  });
  it('shows enough digits for a small ratio', () => {
    expect(formatMixture(2.5, 'ratio', false)).toBe('2.50 : 1');
    expect(formatMixture(0.0235, 'ratio', false)).toBe('0.0235 : 1');
    expect(formatMixture(0.5, 'ratio', false)).toBe('0.500 : 1');
    expect(formatMixture(2360, 'temperature', false)).toBe('2,360 K');
    expect(formatMixture(0, 'none', false)).toBe('fixed in the grain');
  });
  it('says there is nothing to mix with when there is no oxidiser', () => {
    expect(formatMixture(0, 'ratio', true)).toBe('nothing to mix with');
  });
});

describe('the propellant note', () => {
  const nerva = getPreset('nerva')!.config;
  const reactor = (propellant: 'ntr-methane' | 'ntr-hydrogen') => ({
    config: sanitize({ ...nerva, presetId: null, propellant, mixtureRatio: 2360 }),
    flight: { altitudeKm: 0, throttle: 1 },
  });
  it('carries the warnings about a reactor fluid, which have no oxidiser picker to sit under', () => {
    expect(propellantNote(reactor('ntr-methane'))).toMatch(/droplets/);
    expect(propellantNote(reactor('ntr-hydrogen'))).not.toMatch(/droplets/);
  });
});

describe('the nozzle shape sliders', () => {
  const shown = (exhaust: ExhaustId) => shapeSlidersShown(sanitize({ ...starterEngine(), exhaust }));
  it('shows each exhaust its own sliders', () => {
    expect(shown('cone')).toContain('coneAngleDeg');
    expect(shown('cone')).not.toContain('nozzleLenPct');
    expect(shown('dualBell')).toEqual(expect.arrayContaining(['exitDia', 'nozzleLenPct', 'innerExitDia']));
    expect(shown('none')).not.toContain('exitDia');
    expect(shown('none')).not.toContain('nozzleLenPct');
    expect(shown('bell')).not.toContain('coneAngleDeg');
    expect(shown('bell')).not.toContain('innerExitDia');
  });
  it('keeps the kink slider between the throat and the exit', () => {
    const cfg = sanitize({ ...starterEngine(), exhaust: 'dualBell' });
    const range = innerExitRange(cfg);
    expect(range.min).toBeCloseTo(1.1 * cfg.throatDia, 9);
    expect(range.max).toBeCloseTo(0.95 * cfg.exitDia, 9);
  });
});
