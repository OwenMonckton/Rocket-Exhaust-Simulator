import { describe, expect, it } from 'vitest';
import { simulate } from '../physics/engine';
import { pairRange, solveFluid, solvePair } from '../physics/chem/pair';
import { PROPELLANTS } from '../physics/propellants';
import { starterEngine } from '../physics/reshape';
import type { Failure } from '../physics/types';
import { SPECIES_NAMES, exhaustLine, failureCopy, limitNote, showsFigures, speciesName } from './copy';

describe('failure copy for the chemistry failures', () => {
  for (const kind of ['flameout', 'inert', 'detonation', 'unsolved'] as const) {
    it(`has a title and text for ${kind}`, () => {
      const copy = failureCopy(kind, 'combustion');
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.text.length).toBeGreaterThan(20);
    });
  }
  it('says that relighting unchanged goes back to the last setup that ran', () => {
    for (const kind of ['flameout', 'inert', 'unsolved'] as const) {
      for (const energy of ['combustion', 'reactor'] as const) {
        expect(failureCopy(kind, energy).text, `${kind} ${energy}`).toMatch(/last setup that ran/);
      }
    }
  });
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

  // The five reactor fluids the solver works out, across their core temperatures, pressures and nozzles.
  const FLUIDS = ['ntr-ammonia', 'ntr-methane', 'ntr-water', 'ntr-co2', 'ntr-helium'] as const;
  for (const id of FLUIDS) {
    it(`names everything in the ${id} exhaust`, () => {
      const p = PROPELLANTS[id];
      expect(p.fluid, id).toBeTruthy();
      const unnamed = new Set<string>();
      let solves = 0;
      for (const tK of [p.ofMin, p.ofDefault, p.ofMax]) {
        for (const [pcBar, area] of [[40, 100], [70, 16]]) {
          const gas = solveFluid(p.fluid!, tK, pcBar, area);
          if (!gas.ok) continue;
          solves++;
          for (const { name } of gas.exhaust) if (!Object.hasOwn(SPECIES_NAMES, name)) unnamed.add(name);
        }
      }
      expect(solves, id).toBeGreaterThan(0);
      expect([...unnamed], id).toEqual([]);
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

  it('adds up species that share a plain name, without touching the list', () => {
    const exhaust = Object.freeze([
      Object.freeze({ name: 'BeO(a)', share: 0.3 }),
      Object.freeze({ name: 'H2', share: 0.25 }),
      Object.freeze({ name: 'BeO(b)', share: 0.2 }),
      Object.freeze({ name: 'H2O', share: 0.248 }),
    ]) as { name: string; share: number }[];
    expect(exhaustLine(exhaust)).toBe('Solid beryllium oxide 50% · Hydrogen 25% · Steam 25%');
    expect(exhaust.map((e) => e.name)).toEqual(['BeO(a)', 'H2', 'BeO(b)', 'H2O']);
  });
});

describe('showsFigures', () => {
  const sl = { altitudeKm: 0, throttle: 1 };
  const base = simulate(starterEngine(), sl);
  const as = (failure: Failure, settled: boolean) => ({ ...base, failure, settled });
  it('shows the figures exactly when the gas settled, whatever the failure', () => {
    expect(showsFigures(as('unsolved', false))).toBe(false);
    expect(showsFigures(as('detonation', false))).toBe(false);
    expect(showsFigures(as('inert', false))).toBe(false);
    expect(showsFigures(as('detonation', true))).toBe(true);
    expect(showsFigures(as('flameout', true))).toBe(true);
    expect(showsFigures(as('burst', true))).toBe(true);
    expect(showsFigures(as(null, true))).toBe(true);
  });
  it('hides them for RP-1 with nothing to burn it', () => {
    expect(showsFigures(simulate({ ...starterEngine(), oxidiser: 'none' }, sl))).toBe(false);
  });
});

describe('the line under the limit bars', () => {
  const base = simulate(starterEngine(), { altitudeKm: 0, throttle: 1 });
  const as = (failure: Failure, settled: boolean) => limitNote({ ...base, failure, settled });
  it('names the failure the engine actually has', () => {
    expect(as(null, true)).toBe('');
    expect(as('flameout', true)).toBe('This mixture will not keep burning.');
    expect(as('inert', false)).toBe('Nothing here will burn.');
    expect(as('unsolved', false)).toBe('No figures: the chemistry would not settle.');
    expect(as('burst', true)).toBe('Past a limit: this engine will fail when fired.');
    expect(as('detonation', true)).toBe('One of these propellants would explode in the engine.');
  });
  it('says a detonation is one, settled or not', () => {
    expect(as('detonation', false)).toBe('One of these propellants would explode in the engine.');
  });
});

describe('unsolved wording', () => {
  it('speaks of the core temperature, not a mixture ratio, for a reactor', () => {
    for (const energy of ['reactor', 'saltwater'] as const) {
      const copy = failureCopy('unsolved', energy);
      expect(copy.title).toBe('No answer');
      expect(copy.text).not.toMatch(/mixture ratio/);
      expect(copy.text).toMatch(/temperature/);
    }
    expect(failureCopy('unsolved', 'combustion').text).toMatch(/mixture ratio/);
  });
});
