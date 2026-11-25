import { describe, expect, it } from 'vitest';
import { FUEL_IDS, NO_OXIDISER, OXIDISER_IDS } from './chem/ingredients';
import { clearChemCache, solveFluid, solvePair } from './chem/pair';
import { showsFigures } from '../ui/copy';
import { sanitize, simulate } from './engine';
import { mixRange, resolveGas, staticLook } from './gasSource';
import { propellantsFor } from './parts';
import { PRESETS, getPreset } from './presets';
import { PROPELLANTS, gasProps } from './propellants';
import { starterEngine } from './reshape';
import type { EngineConfig, PropellantId } from './types';

const G0 = 9.80665;
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
    // Each solve from an emptied cache, so the comparison is of two solves and not of one cached result.
    const cfg = starterEngine();
    clearChemCache();
    simulate({ ...cfg, fuel: 'h2' }, sl);
    const after = simulate(cfg, sl);
    clearChemCache();
    const alone = simulate(cfg, sl);
    for (const k of ['ispVacuum', 'thrust', 'tc'] as const) {
      expect(Math.abs(after[k] / alone[k] - 1), k).toBeLessThan(0.001);
    }
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

  it('shows the solver\'s own vacuum Isp, droplet loss included, on a stub nozzle', () => {
    const base = sanitize({ ...starterEngine(), fuel: 'al-slurry', oxidiser: 'lox', mixtureRatio: Number.NaN, nozzleLenPct: 100 });
    const r = simulate(sanitize({ ...base, exitDia: base.throatDia * Math.sqrt(2) }), vac);
    const solved = solvePair('al-slurry', 'lox', base.mixtureRatio, base.chamberPressureBar, r.expansionRatio);
    expect(solved.ok && solved.condensedShare > 0.1).toBe(true);
    const ratio = (r.ispVacuum * G0) / r.combustionEff / solved.ispVac;
    expect(ratio).toBeGreaterThan(0.985);
    expect(ratio).toBeLessThan(1.005);
  });

  it('has no step down in vacuum Isp as an aluminised engine\'s nozzle grows past area ratio 3', () => {
    const base = sanitize({ ...starterEngine(), fuel: 'al-slurry', oxidiser: 'lox', mixtureRatio: Number.NaN });
    let prev = 0;
    for (let k = 1.5; k <= 2.2; k *= 1.01) {
      const r = simulate(sanitize({ ...base, exitDia: k * base.throatDia }), vac);
      if (prev) expect(r.ispVacuum / prev - 1, `at area ratio ${r.expansionRatio.toFixed(3)}`).toBeGreaterThan(-0.005);
      prev = r.ispVacuum;
    }
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

describe('a reactor fluid', () => {
  const nerva = getPreset('nerva')!.config;
  const at = (propellant: EngineConfig['propellant'], coreTemp: number) =>
    sanitize({ ...nerva, propellant, mixtureRatio: coreTemp });
  const eps = (nerva.exitDia / nerva.throatDia) ** 2;

  it('is tabled for hydrogen, which the NERVA example is pinned to', () => {
    expect(resolveGas(at('ntr-hydrogen', 2360), nerva.chamberPressureBar, eps).calculated).toBe(false);
  });

  it('is the solver\'s for the others, with no chamber length to need', () => {
    const cfg = at('ntr-water', 2800);
    const src = resolveGas(cfg, cfg.chamberPressureBar, eps);
    const solved = solveFluid('H2O(L)', 2800, cfg.chamberPressureBar, eps);
    expect(src.calculated).toBe(true);
    expect(src.failure).toBeNull();
    expect(src.lStarRef).toBe(0);
    expect(src.gas.tc).toBe(solved.tc);
    expect(src.gas.gamma).toBe(solved.gamma);
    expect(src.gas.molarMass).toBe(solved.molarMass);
    expect(src.exhaust).toEqual(solved.exhaust);
  });

  it('is helium alone for helium, as the perfect gas it is', () => {
    const cfg = at('ntr-helium', 2360);
    const src = resolveGas(cfg, cfg.chamberPressureBar, eps);
    expect(src.exhaust).toEqual([{ name: 'He', share: 1 }]);
    expect(Math.abs(src.gas.gamma - 1.667)).toBeLessThan(0.01);
  });

  it('tells of the soot methane leaves at 2,800 K', () => {
    const cfg = at('ntr-methane', 2800);
    const src = resolveGas(cfg, cfg.chamberPressureBar, eps);
    expect(src.notes.some((n) => /droplets/.test(n))).toBe(true);
  });

  it('shows the solver\'s own vacuum Isp where the fitted gas cannot carry it', () => {
    // Below area ratio 3, or with droplets in the exhaust, the one-gamma gas cannot match the
    // solver's Isp; it once read 9% high for methane here. With every efficiency but the nozzle's
    // and the chamber's at 1, the shown vacuum Isp over the combustion efficiency is the solver's
    // less up to the nozzle's 1% (a full-length bell).
    const engine = { ...nerva, propellant: 'ntr-methane' as const, mixtureRatio: 2360, chamberPressureBar: 30, nozzleLenPct: 100 };
    for (const e of [1.5, 3, 5, 7]) {
      const cfg = sanitize({ ...engine, presetId: null, exitDia: engine.throatDia * Math.sqrt(e) });
      const r = simulate(cfg, vac);
      const solved = solveFluid('CH4(L)', 2360, 30, r.expansionRatio);
      expect(solved.ok).toBe(true);
      const ratio = (r.ispVacuum * G0) / r.combustionEff / solved.ispVac;
      expect(ratio, `area ratio ${e}`).toBeGreaterThan(0.985);
      expect(ratio, `area ratio ${e}`).toBeLessThan(1.005);
    }
  });

  it('never shows less vacuum Isp for a bigger nozzle', () => {
    const engine = { ...nerva, propellant: 'ntr-methane' as const, mixtureRatio: 2360, chamberPressureBar: 30, presetId: null };
    const isp = (e: number) => simulate(sanitize({ ...engine, exitDia: engine.throatDia * Math.sqrt(e) }), vac).ispVacuum;
    expect(isp(10)).toBeGreaterThan(isp(7));
  });

  it('fails only as unsolved', () => {
    const cfg = at('ntr-co2', 2360);
    expect(resolveGas(cfg, 0, eps).failure).toBe('unsolved');
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
    // And a plume that can be drawn: every number of its look in range, and never invisible.
    const { look } = resolveGas(cfg, r.pc / 1e5, r.expansionRatio);
    const parts = [...look.core, ...look.mid, ...look.edge, ...look.richTint, ...look.afterburn,
      look.opacity, look.soot, look.smoke, look.afterburnStrength, look.particles];
    for (const v of parts) {
      expect(Number.isFinite(v), `${label}: look`).toBe(true);
      expect(v, `${label}: look`).toBeGreaterThanOrEqual(0);
      expect(v, `${label}: look`).toBeLessThanOrEqual(1);
    }
    expect(look.opacity, `${label}: opacity`).toBeGreaterThanOrEqual(0.15);
  };
  it('each fuel against oxygen', () => {
    for (const fuel of FUEL_IDS) finite({ ...starterEngine(), fuel }, `${fuel}/lox`);
  }, 120_000);
  it('hydrogen against each oxidiser', () => {
    for (const oxidiser of OXIDISER_IDS) finite({ ...starterEngine(), fuel: 'h2', oxidiser }, `h2/${oxidiser}`);
  }, 120_000);
});

describe('whether the gas settled', () => {
  it('hides the figures of a real solve that does not settle, from the solver through to the screen', () => {
    // Beryllium and oxygen burnt to almost nothing but solid oxide: the solver does not settle here
    // today. If it learns to, replace this with another real unsettled point; do not delete it.
    clearChemCache();
    const r = simulate({ ...starterEngine(), fuel: 'be', oxidiser: 'lox', mixtureRatio: 1.78 }, sl);
    expect(r.failure).toBe('unsolved');
    expect(r.settled).toBe(false);
    expect(r.exhaust).toEqual([]);
    expect(showsFigures(r)).toBe(false);
  });

  it('is settled for a tabled example and a solved pair, not for the stand-in gas', () => {
    const cfg = starterEngine();
    expect(simulate(getPreset('merlin-1d')!.config, sl).settled).toBe(true);
    expect(simulate(cfg, sl).settled).toBe(true);
    // Nothing to burn RP-1 with: the solver is never asked, and the gas is the cold-air stand-in.
    expect(simulate({ ...cfg, oxidiser: 'none' }, sl).settled).toBe(false);
  });

  it('follows the solve, not the failure, for a pair that detonates', () => {
    const cfg = sanitize({ ...starterEngine(), fuel: 'h2', oxidiser: 'o3', propellant: 'calculated' });
    const eps = (cfg.exitDia / cfg.throatDia) ** 2;
    const solved = solvePair('h2', 'o3', cfg.mixtureRatio, cfg.chamberPressureBar, eps);
    const r = simulate(cfg, sl);
    expect(r.failure).toBe('detonation');
    expect(r.settled).toBe(solved.ok);
    // A solve that cannot settle (no pressure at all) still detonates, and is not settled.
    const unsettled = resolveGas(cfg, Number.NaN, eps);
    expect(unsettled.failure).toBe('detonation');
    expect(unsettled.settled).toBe(false);
    expect(resolveGas(cfg, cfg.chamberPressureBar, eps).settled).toBe(solved.ok);
  });

  it('is unsettled for a reactor fluid whose solve fails, and settled for the tabled one', () => {
    const nerva = getPreset('nerva')!.config;
    const eps = (nerva.exitDia / nerva.throatDia) ** 2;
    expect(resolveGas(sanitize({ ...nerva, propellant: 'ntr-co2', mixtureRatio: 2360 }), 0, eps).settled).toBe(false);
    expect(resolveGas(nerva, nerva.chamberPressureBar, eps).settled).toBe(true);
  });
});

describe("where the plume's look comes from", () => {
  const built = (fuel: string, oxidiser: string) => sanitize({ ...starterEngine(), propellant: 'calculated', fuel, oxidiser });

  it('leaves every example engine its hand-picked look', () => {
    for (const p of PRESETS) {
      const src = resolveGas(p.config, p.config.chamberPressureBar, (p.config.exitDia / p.config.throatDia) ** 2);
      expect(src.look, p.name).toBe(PROPELLANTS[p.config.propellant as Exclude<PropellantId, 'calculated'>].look);
      expect(src.derivedLook, p.name).toBe(false);
    }
  });

  it('gives a calculated pair a look from its own exhaust', () => {
    const src = resolveGas(built('b5h9', 'lox'), 70, 16);
    expect(src.settled).toBe(true);
    expect(src.derivedLook).toBe(true);
    expect(src.look).not.toEqual(PROPELLANTS.kerolox.look);
    // Boron: greener than it is red or blue.
    expect(src.look.mid[1]).toBeGreaterThan(Math.max(src.look.mid[0], src.look.mid[2]));
  });

  it('gives a solver-worked reactor fluid a look from its own exhaust', () => {
    const cfg = sanitize({ ...getPreset('nerva')!.config, propellant: 'ntr-ammonia', presetId: null });
    const src = resolveGas(cfg, 40, 100);
    expect(src.settled).toBe(true);
    expect(src.derivedLook).toBe(true);
    expect(src.look).not.toBe(PROPELLANTS['ntr-ammonia'].look);
  });

  it('keeps the borrowed look when the gas did not settle', () => {
    const src = resolveGas(built('rp1', NO_OXIDISER), 70, 16);
    expect(src.settled).toBe(false);
    expect(src.derivedLook).toBe(false);
    expect(src.look).toBe(PROPELLANTS.kerolox.look);
  });

  it('shows the same look inside the engine as in the plume once the gas is solved', () => {
    const cfg = built('b5h9', 'lox');
    expect(simulate(cfg, sl).thrust).toBeGreaterThan(0);
    const plume = resolveGas(cfg, cfg.chamberPressureBar, (cfg.exitDia / cfg.throatDia) ** 2).look;
    expect(staticLook(cfg)).toEqual(plume);
  });

  it('shows the borrowed look inside an engine whose gas has never been solved', () => {
    expect(staticLook(built('syntin', 'tnm'))).toBe(PROPELLANTS.kerolox.look);
  });

  it('shows an example engine its hand-picked look inside, whatever was solved before', () => {
    resolveGas(built('rp1', 'lox'), 70, 16);
    expect(staticLook(getPreset('merlin-1d')!.config)).toBe(PROPELLANTS.kerolox.look);
  });
});
