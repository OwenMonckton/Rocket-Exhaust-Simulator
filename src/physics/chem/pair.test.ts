import { describe, expect, it } from 'vitest';
import { cStar, exitVelocity, machFromAreaRatio, pressureRatio } from '../nozzle';
import { mixtureOf } from './ingredients';
import { rocket } from './rocket';
import {
  DROPLET_LOSS, chemCacheSize, clearChemCache, fitGas, pairRange, solveFluid, solvePair, type SolvedGas,
} from './pair';

const G0 = 9.80665;
const relErr = (got: number, want: number) => Math.abs(got - want) / Math.abs(want);

/** c* and vacuum Isp (m/s) of the fitted gas, worked as `simulate` does with every efficiency at 1. */
function simulator(gas: SolvedGas, eps: number) {
  const g = gas.gamma;
  const R = 8314.46 / gas.molarMass;
  const cs = cStar(g, R, gas.tc);
  const mach = machFromAreaRatio(eps, g);
  // Vacuum thrust over mass flow: ve + pe·ae/ṁ, with ṁ = pc·at/c*.
  const isp = exitVelocity(mach, g, R, gas.tc) + eps * pressureRatio(mach, g) * cs;
  return { cStar: cs, ispVac: isp };
}

describe('solvePair: the fitted gas', () => {
  it('reproduces the solver through the simulator\'s maths', () => {
    for (const [fuel, ox, of, pc, eps] of [['h2', 'lox', 5.88, 32.75, 280], ['mmh', 'n2o4', 2.0, 17.237, 50]] as const) {
      const gas = solvePair(fuel, ox, of, pc, eps);
      expect(gas.ok).toBe(true);
      const sim = simulator(gas, eps);
      expect(relErr(sim.cStar, gas.cStar), `${fuel} c*`).toBeLessThan(0.005);
      expect(relErr(sim.ispVac, gas.ispVac), `${fuel} Isp`).toBeLessThan(0.005);
    }
  });

  it('is the documented fit', () => {
    const fit = fitGas(3384.18, 2299.03, 481.02 * G0, 280);
    expect(Math.abs(fit.gamma - 1.17705)).toBeLessThan(0.002);
    expect(Math.abs(fit.molarMass - 12.835)).toBeLessThan(0.05);
  });

  it('takes the droplet loss off the vacuum Isp', () => {
    const of = pairRange('al-slurry', 'lox').ofDefault;
    clearChemCache(); // a cold solve, to compare with a cold rocket
    const gas = solvePair('al-slurry', 'lox', of, 70, 40);
    expect(gas.ok).toBe(true);
    expect(gas.condensedShare).toBeGreaterThan(0.1);
    const mix = mixtureOf('al-slurry', 'lox', of);
    const r = rocket(mix, { kind: 'hp', h: mix.h0, pBar: 70 }, 40);
    expect(gas.condensedShare).toBe(r.exit.condensedMassFraction);
    expect(DROPLET_LOSS).toBe(0.105);
    expect(relErr(gas.ispVac, r.ispVac * (1 - 0.105 * gas.condensedShare))).toBeLessThan(1e-9);
  });

  it('reads out the exhaust make-up', () => {
    const { exhaust } = solvePair('h2', 'lox', 6, 70, 40);
    expect(exhaust[0].name).toBe('H2O');
    expect(exhaust[0].share).toBeGreaterThan(0.6);
    expect(exhaust.length).toBeLessThanOrEqual(6);
    for (let k = 1; k < exhaust.length; k++) expect(exhaust[k].share).toBeLessThanOrEqual(exhaust[k - 1].share);
    for (const e of exhaust) expect(e.share).toBeGreaterThanOrEqual(0.005);
  });

  it('fits small nozzles too', () => {
    for (const eps of [1.1025, 2]) {
      const gas = solvePair('rp1', 'lox', 2.5, 70, eps);
      expect(gas.ok, `ok at ${eps}`).toBe(true);
      expect(gas.gamma, `gamma at ${eps}`).toBeGreaterThan(1.05);
      expect(gas.gamma, `gamma at ${eps}`).toBeLessThan(1.4);
      expect(relErr(simulator(gas, eps).cStar, gas.cStar), `c* at ${eps}`).toBeLessThan(0.005);
    }
  });

  it('settles peroxide alone in a vacuum nozzle at a round 70 bar, as at 69', () => {
    // A cold first guess at the exit once settled on vapour below 200 K, where the true state is
    // warm with liquid water, and the solve gave up.
    clearChemCache();
    const at69 = solvePair('htp90-mono', 'none', 0, 69, 100);
    clearChemCache();
    const at70 = solvePair('htp90-mono', 'none', 0, 70, 100);
    expect(at69.ok && at70.ok).toBe(true);
    expect(relErr(at70.ispVac, at69.ispVac)).toBeLessThan(0.002);
  });

  it('runs a monopropellant alone', () => {
    expect(pairRange('n2h4', 'none')).toEqual({ ofMin: 0, ofMax: 0, ofDefault: 0, ofPeak: 0 });
    const gas = solvePair('n2h4', 'none', 0, 20, 50);
    expect(gas.ok).toBe(true);
    expect(gas.tc).toBeGreaterThan(800);
    expect(gas.tc).toBeLessThan(1500);
  });

  it('says when it has no answer, with no NaN figures', () => {
    const bad = [
      solvePair('h2', 'lox', 6, NaN, 40), solvePair('h2', 'lox', NaN, 70, 40), solvePair('h2', 'lox', -1, 70, 40),
      solvePair('h2', 'lox', 6, -70, 40), solvePair('h2', 'lox', 6, 70, Infinity), solvePair('h2', 'lox', 6, 70, -3),
    ];
    for (const gas of bad) {
      expect(gas.ok).toBe(false);
      for (const v of [gas.tc, gas.gamma, gas.molarMass, gas.cStar, gas.ispVac, gas.condensedShare]) {
        expect(Number.isNaN(v)).toBe(false);
      }
    }
  });
});

describe('pairRange', () => {
  it('finds hydrogen and oxygen\'s mixtures', () => {
    const r = pairRange('h2', 'lox');
    expect(r.ofDefault).toBeGreaterThan(3.5);
    expect(r.ofDefault).toBeLessThan(5.5);
    expect(r.ofDefault).toBe(Math.round(r.ofDefault * 100) / 100);
    expect(r.ofPeak).toBeGreaterThan(7);
    expect(r.ofPeak).toBeLessThan(9);
    expect(r.ofMin).toBeLessThan(1);
    expect(r.ofMax).toBeGreaterThan(20);
    for (const of of [r.ofMin, r.ofMax]) {
      const gas = solvePair('h2', 'lox', of, 70, 40);
      expect(!gas.ok || gas.tc < 800, `cold at ${of}`).toBe(true);
    }
  });

  it('holds kerosene at the fuel-rich end, where it never goes cold', () => {
    const r = pairRange('rp1', 'lox');
    expect(Math.abs(r.ofMin - r.ofDefault / 50)).toBeLessThan(0.01);
    const gas = solvePair('rp1', 'lox', r.ofMax, 70, 40);
    expect(!gas.ok || gas.tc < 800).toBe(true);
  });
});

describe('pairRange: the ends of the slider', () => {
  it('keeps the hottest mixture on the slider and offers no ratio the solver rounds away', () => {
    for (const [f, o] of [['n2o-mono', 'lox'], ['htp90-mono', 'lox'], ['ch3no2', 'lox'], ['n2o-mono', 'o3'],
      ['htp90-mono', 'n2o'], ['c2n2', 'htp90'], ['c2n2', 'nf3'], ['c2n2', 'clf3']]) {
      const r = pairRange(f, o);
      expect(r.ofMin, `${f}/${o} ofMin`).toBeGreaterThanOrEqual(0.01);
      expect(r.ofPeak, `${f}/${o} ofPeak`).toBeGreaterThanOrEqual(r.ofMin);
      expect(r.ofPeak, `${f}/${o} ofPeak`).toBeLessThanOrEqual(r.ofMax);
      expect(r.ofDefault, `${f}/${o} ofDefault`).toBeGreaterThanOrEqual(r.ofMin);
      expect(r.ofDefault, `${f}/${o} ofDefault`).toBeLessThanOrEqual(r.ofMax);
      // A best mixture at the top of the scan is not the middle of a slider reaching 50 times past it.
      if (r.ofDefault >= 100) expect(r.ofMax, `${f}/${o} ofMax`).toBeLessThanOrEqual(100);
    }
  });

  it('ends on mixtures that settle from a cold start', () => {
    // Metal-heavy pairs once ended where only a solve walked in from a neighbouring mixture settled.
    for (const [f, o] of [['be', 'htp90'], ['al-slurry', 'lox'], ['al-slurry', 'clf3'], ['be', 'htp98'], ['li', 'lox']]) {
      clearChemCache();
      const r = pairRange(f, o);
      for (const of of [r.ofMin, 1.2 * r.ofMin, r.ofMax]) {
        clearChemCache();
        expect(solvePair(f, o, of, 70, 40).ok, `${f}/${o} at ${of}`).toBe(true);
      }
    }
  }, 60_000);
});

describe('cold exits', () => {
  it('gives an answer for a hydrogen-rich pair in a big nozzle', () => {
    expect(solvePair('h2', 'lox', 1.0, 70, 40).ok).toBe(true);
    expect(solvePair('h2', 'lox', 0.5, 70, 40).ok).toBe(true); // exit near 110 K, frozen below 200 K
  });

  it('fits helium heated in a reactor as the perfect gas it is', () => {
    const gas = solveFluid('He', 2360, 30, 100);
    expect(gas.ok).toBe(true);
    expect(Math.abs(gas.gamma - 1.667)).toBeLessThan(0.01);
  });
});

describe('condensed products below their data', () => {
  // Every lithium and beryllium solid starts at 300 K in NASA's file, as most gases do; between the
  // 200 K floor and 300 K the coldest phase is extrapolated, as those gases are, and kept.
  it('keeps the oxide in an oxidiser-rich beryllium exhaust cooled below 300 K', () => {
    clearChemCache();
    const small = solvePair('be', 'lox', 28.1, 70, 198);
    const big = solvePair('be', 'lox', 28.1, 70, 300);
    expect(small.ok && big.ok).toBe(true);
    expect(big.ispVac).toBeGreaterThanOrEqual(small.ispVac);
    expect(big.condensedShare).toBeGreaterThan(0.05);
  });

  it('keeps the fluoride in an oxidiser-rich lithium exhaust cooled below 300 K', () => {
    clearChemCache();
    const small = solvePair('li', 'lf2', 124, 70, 3);
    const big = solvePair('li', 'lf2', 124, 70, 5);
    expect(small.ok && big.ok).toBe(true);
    expect(big.ispVac).toBeGreaterThanOrEqual(small.ispVac);
  });
});

describe('solveFluid', () => {
  it('expands a fluid heated to a set temperature', () => {
    const gas = solveFluid('NH3(L)', 2800, 55, 100);
    expect(gas.ok).toBe(true);
    expect(gas.tc).toBe(2800);
    expect(gas.ispVac / G0).toBeGreaterThan(380);
    expect(gas.ispVac / G0).toBeLessThan(480);
  });

  it('settles a water reactor whose exhaust condenses in a big nozzle', () => {
    clearChemCache();
    const gas = solveFluid('H2O(L)', 1500, 30, 300);
    expect(gas.ok).toBe(true);
    expect(gas.condensedShare).toBeGreaterThan(0);
  });

  it('settles water over the whole core-temperature slider in vacuum nozzles', () => {
    // The NERVA example's pressure. Each point is solved cold, as after a reload or a shared link.
    const failed: string[] = [];
    for (const eps of [100, 144, 200, 289]) {
      let prev: SolvedGas | undefined;
      for (let t = 1500; t <= 2890; t += 10) {
        clearChemCache();
        const gas = solveFluid('H2O(L)', t, 38.6, eps);
        if (!gas.ok) { failed.push(`${t} K at ${eps}`); prev = undefined; continue; }
        if (prev) expect(relErr(gas.ispVac, prev.ispVac), `Isp step to ${t} K at ${eps}`).toBeLessThan(0.01);
        prev = gas;
      }
    }
    expect(failed).toEqual([]);
  }, 60_000);
});

describe('the cache', () => {
  it('is fast enough to follow a pressure slider', () => {
    clearChemCache();
    const t0 = performance.now();
    solvePair('b5h9', 'of2', 3, 100, 40);
    const first = performance.now() - t0;
    for (let i = 1; i < 200; i++) solvePair('b5h9', 'of2', 3, 100 - (40 * i) / 199, 40);
    const total = performance.now() - t0;
    expect(first, 'first call, ms').toBeLessThan(200);
    expect(total, '200 calls, ms').toBeLessThan(400);
  });

  it('finds a pair\'s mixtures quickly enough for a click', () => {
    clearChemCache();
    const t0 = performance.now();
    pairRange('al-slurry', 'lox');
    expect(performance.now() - t0, 'cold pairRange, ms').toBeLessThan(600);
  });

  it('gives the same answer after a jump in mixture as from a cold start', () => {
    clearChemCache();
    solvePair('al-slurry', 'lox', 100, 70, 40);
    const jumped = solvePair('al-slurry', 'lox', 2.18, 70, 40);
    clearChemCache();
    const cold = solvePair('al-slurry', 'lox', 2.18, 70, 40);
    expect(jumped.ok && cold.ok).toBe(true);
    for (const k of ['tc', 'cStar', 'ispVac'] as const) expect(relErr(jumped[k], cold[k]), k).toBeLessThan(0.001);
  });

  it('keeps at most 2,000 results', () => {
    clearChemCache();
    for (let i = 0; i < 2100; i++) solvePair('h2', 'lox', 2 + i * 0.01, 70, 40);
    expect(chemCacheSize()).toBe(2000);
  }, 30_000);
});
