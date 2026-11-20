import { describe, expect, it } from 'vitest';
import { simulate } from '../physics/engine';
import { pairRange, solvePair } from '../physics/chem/pair';
import { starterEngine } from '../physics/reshape';
import type { Failure } from '../physics/types';
import { SPECIES_NAMES, exhaustLine, failureCopy, showsFigures, speciesName } from './copy';

describe('failure copy for the chemistry failures', () => {
  for (const kind of ['flameout', 'inert', 'detonation', 'unsolved'] as const) {
    it(`has a title and text for ${kind}`, () => {
      const copy = failureCopy(kind, 'combustion');
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.text.length).toBeGreaterThan(20);
    });
  }
  it('uses the final titles', () => {
    expect(failureCopy('flameout', 'combustion').title).toBe('Flame-out');
    expect(failureCopy('inert', 'combustion').title).toBe('Nothing to burn it with');
    expect(failureCopy('detonation', 'combustion').title).toBe('Detonation');
    expect(failureCopy('unsolved', 'combustion').title).toBe('No answer');
  });
});

describe('exhaust species names', () => {
  it('gives plain names and falls back to the formula', () => {
    expect(speciesName('H2O')).toBe('Steam');
    expect(speciesName('XyZ')).toBe('XyZ');
  });

  // The five test pairs, at their own mixtures in the starter engine's chamber and nozzle.
  const cfg = starterEngine();
  const eps = (cfg.exitDia / cfg.throatDia) ** 2;
  const pairs = [
    ['rp1', 'lox'],
    ['h2', 'lf2'],
    ['b5h9', 'of2'],
    ['mmh', 'n2o4'],
    ['al-slurry', 'lox'],
  ] as const;
  for (const [fuel, oxidiser] of pairs) {
    it(`names everything in the ${fuel} and ${oxidiser} exhaust`, () => {
      const gas = solvePair(fuel, oxidiser, pairRange(fuel, oxidiser).ofDefault, cfg.chamberPressureBar, eps);
      expect(gas.ok).toBe(true);
      expect(gas.exhaust.length).toBeGreaterThan(0);
      for (const { name } of gas.exhaust) expect(SPECIES_NAMES, name).toHaveProperty([name]);
    });
  }

  it('writes the exhaust as plain names with shares, without touching the list', () => {
    const exhaust = Object.freeze([
      Object.freeze({ name: 'H2O', share: 0.634 }),
      Object.freeze({ name: 'H2', share: 0.291 }),
      Object.freeze({ name: 'OH', share: 0.004 }),
    ]) as { name: string; share: number }[];
    expect(exhaustLine(exhaust)).toBe('Steam 63% · Hydrogen 29% · Hydroxyl (OH) <1% · …');
    expect(exhaustLine([])).toBe('');
  });
});

describe('showsFigures', () => {
  const base = simulate(starterEngine(), { altitudeKm: 0, throttle: 1 });
  const as = (failure: Failure) => ({ ...base, failure });
  it('hides the figures only when the chemistry did not settle', () => {
    expect(showsFigures(as('unsolved'))).toBe(false);
    expect(showsFigures(as('flameout'))).toBe(true);
    expect(showsFigures(as('burst'))).toBe(true);
    expect(showsFigures(as(null))).toBe(true);
  });
});
