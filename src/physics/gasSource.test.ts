import { describe, expect, it } from 'vitest';
import { FUEL_IDS, OXIDISER_IDS } from './chem/ingredients';
import { solvePair } from './chem/pair';
import { sanitize, simulate } from './engine';
import { mixRange, resolveGas } from './gasSource';
import { propellantsFor } from './parts';
import { PRESETS, getPreset } from './presets';
import { PROPELLANTS, gasProps } from './propellants';
import { starterEngine } from './reshape';
import type { EngineConfig } from './types';

const sl = { altitudeKm: 0, throttle: 1 };
const vac = { altitudeKm: 100, throttle: 1 };
const TABLED = propellantsFor('combustion').filter((id) => id !== 'calculated');

describe('the gas of a tabled propellant', () => {
  it('is its table, with no failure of its own', () => {
    expect(TABLED).toEqual(['kerolox', 'hydrolox', 'methalox', 'hypergolic']);
    for (const id of TABLED) {
      const of = PROPELLANTS[id].ofDefault;
      const cfg = sanitize({ ...starterEngine(), propellant: id, mixtureRatio: of });
      const src = resolveGas(cfg, 70, 16);
      expect(src.gas, id).toEqual(gasProps(id, of));
      expect(src.calculated).toBe(false);
      expect(src.failure).toBeNull();
      expect(mixRange(cfg)).toEqual({ ofMin: PROPELLANTS[id].ofMin, ofMax: PROPELLANTS[id].ofMax, ofDefault: of });
    }
  });

  it('leaves every example engine tabled, with no notes and no exhaust list', () => {
    for (const preset of PRESETS) {
      for (const flight of [sl, vac]) {
        const r = simulate(preset.config, flight);
        expect(r.calculated, preset.id).toBe(false);
        expect(r.notes).toEqual([]);
        expect(r.exhaust).toEqual([]);
      }
    }
  });

  it('keeps every example as it is when sanitised', () => {
    for (const preset of PRESETS) expect(sanitize(preset.config), preset.id).toEqual(preset.config);
  });
});

describe('a calculated engine', () => {
  it('is the starter engine: RP-1 and oxygen, solved', () => {
    const cfg = starterEngine();
    expect(cfg.propellant).toBe('calculated');
    expect([cfg.fuel, cfg.oxidiser]).toEqual(['rp1', 'lox']);
    const r = simulate(cfg, sl);
    expect(r.calculated).toBe(true);
    expect(r.failure).toBeNull();
    expect(r.ispVacuum).toBeGreaterThan(290);
    expect(r.ispVacuum).toBeLessThan(360);
    expect(r.exhaust.length).toBeGreaterThan(0);
  });

  it('gives the same result for the same inputs, whatever was picked in between', () => {
    const cfg = starterEngine();
    const before = simulate(cfg, sl);
    simulate({ ...cfg, fuel: 'h2' }, sl);
    expect(simulate({ ...cfg, fuel: 'rp1' }, sl)).toEqual(before);
  });

  it('fails as the chemistry says', () => {
    const cfg = starterEngine();
    expect(simulate({ ...cfg, oxidiser: 'o3' }, sl).failure).toBe('detonation');
    expect(simulate({ ...cfg, mixtureRatio: mixRange(cfg).ofMax }, sl).failure).toBe('flameout');
    expect(simulate({ ...cfg, oxidiser: 'none' }, sl).failure).toBe('inert');
  });

  it('does not carry the tables\' pressure correction', () => {
    const cfg = starterEngine();
    const r = simulate(cfg, sl);
    const eps = (cfg.exitDia / cfg.throatDia) ** 2;
    expect(r.tc).toBe(solvePair(cfg.fuel, cfg.oxidiser, cfg.mixtureRatio, cfg.chamberPressureBar, eps).tc);
  });

  it('stays within 10% of the tables for the four tabled pairs', () => {
    for (const id of TABLED) {
      const p = PROPELLANTS[id];
      const tabled: EngineConfig = { ...starterEngine(), chamberPressureBar: 70, propellant: id, mixtureRatio: p.ofDefault };
      const pair = p.pair!;
      const calc: EngineConfig = { ...tabled, propellant: 'calculated', fuel: pair.fuel, oxidiser: pair.oxidiser };
      const a = simulate(tabled, vac);
      const b = simulate(calc, vac);
      expect(a.expansionRatio).toBeCloseTo(16, 6);
      expect(b.calculated, id).toBe(true);
      const diff = (100 * Math.abs(b.ispVacuum - a.ispVacuum)) / a.ispVacuum;
      expect(Number.isFinite(diff), id).toBe(true);
      expect(diff, id).toBeLessThan(10);
    }
  });
});

describe('sanitize: fuel and oxidiser', () => {
  it('replaces a fuel it does not know, and gives a tabled propellant its own pair', () => {
    expect(sanitize({ ...starterEngine(), fuel: 'bogus' }).fuel).toBe('rp1');
    expect(sanitize({ ...starterEngine(), oxidiser: 'bogus' }).oxidiser).toBe('lox');
    const merlin = sanitize({ ...getPreset('merlin-1d')!.config, fuel: 'h2', oxidiser: 'n2o4' });
    expect([merlin.fuel, merlin.oxidiser, merlin.propellant]).toEqual(['rp1', 'lox', 'kerolox']);
  });

  it('clamps a calculated mixture to the pair\'s range', () => {
    const cfg = starterEngine();
    const range = mixRange(cfg);
    expect(cfg.mixtureRatio).toBe(range.ofDefault);
    expect(sanitize({ ...cfg, mixtureRatio: 1e6 }).mixtureRatio).toBe(range.ofMax);
    expect(sanitize({ ...cfg, mixtureRatio: Number.NaN }).mixtureRatio).toBe(range.ofDefault);
  });
});

describe('every pick gives finite figures', () => {
  const finite = (cfg: EngineConfig, label: string) => {
    const r = simulate(cfg, sl);
    for (const v of [r.thrust, r.isp, r.tc]) expect(Number.isFinite(v), `${label}: ${r.failure}`).toBe(true);
  };
  it('each fuel against oxygen', () => {
    for (const fuel of FUEL_IDS) finite({ ...starterEngine(), fuel }, `${fuel}/lox`);
  }, 120_000);
  it('hydrogen against each oxidiser', () => {
    for (const oxidiser of OXIDISER_IDS) finite({ ...starterEngine(), fuel: 'h2', oxidiser }, `h2/${oxidiser}`);
  }, 120_000);
});
