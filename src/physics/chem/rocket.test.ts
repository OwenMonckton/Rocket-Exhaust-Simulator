import { describe, expect, it } from 'vitest';
import { R_UNIVERSAL, REACTANTS } from './thermo';
import { equilibrate, mixtureFrom, type Mixture } from './equilibrium';
import { rocket } from './rocket';
import { areaRatio, cStar, exitVelocity, pressureRatio } from '../nozzle';
import { mixtureOf } from './ingredients';

const G0 = 9.80665;

/** Mass fractions from amounts in moles. */
function byMoles(parts: [string, number][]) {
  const masses = parts.map(([name, mol]) => mol * REACTANTS[name].molarMass);
  const total = masses.reduce((a, b) => a + b, 0);
  return mixtureFrom(parts.map(([name], k) => ({ reactant: REACTANTS[name], massFraction: masses[k] / total })));
}

/** Mass fractions from an oxidiser-to-fuel mass ratio. */
function byRatio(fuel: string, oxidiser: string, of: number) {
  return mixtureFrom([
    { reactant: REACTANTS[fuel], massFraction: 1 / (1 + of) },
    { reactant: REACTANTS[oxidiser], massFraction: of / (1 + of) },
  ]);
}

const relErr = (got: number, want: number) => Math.abs(got - want) / Math.abs(want);
const flame = (mix: Mixture, pBar: number) => ({ kind: 'hp', h: mix.h0, pBar }) as const;

describe('rocket: chamber, throat and exit', () => {
  const ex8Mix = byRatio('H2(L)', 'O2(L)', 5.55157);

  it('matches RP-1311 Example 8 (hydrogen and oxygen at three area ratios)', () => {
    for (const [eps, isp] of [[25, 4348.51], [50, 4487.30], [75, 4554.91]]) {
      const r = rocket(ex8Mix, flame(ex8Mix, 53.3172), eps);
      expect(r.ok).toBe(true);
      expect(relErr(r.cStar, 2332.34), `c* at ${eps}`).toBeLessThan(0.002);
      expect(relErr(r.ispVac, isp), `Isp at ${eps}`).toBeLessThan(0.002);
    }
  });

  it('puts the throat where the flow reaches the speed of sound', () => {
    const r = rocket(ex8Mix, flame(ex8Mix, 53.3172), 25);
    const u2 = 2 * (r.chamber.h - r.throat.h);
    const a2 = r.throat.n * R_UNIVERSAL * r.throat.t * r.throat.gammaS;
    expect(Math.abs(u2 - a2) / u2).toBeLessThanOrEqual(0.4e-4);
    expect(r.throat.pBar).toBeLessThan(r.chamber.pBar);
    expect(r.pExitBar).toBe(r.exit.pBar);
    expect(r.exit.pBar).toBeLessThan(r.throat.pBar);
    expect(relErr(r.exit.s, r.chamber.s)).toBeLessThan(1e-6);
  });

  it('gives the same answer from a warm start', () => {
    const cold = rocket(ex8Mix, flame(ex8Mix, 53.3172), 50);
    const warm = rocket(ex8Mix, flame(ex8Mix, 53.3172), 50, cold);
    expect(warm.ok).toBe(true);
    expect(relErr(warm.ispVac, cold.ispVac)).toBeLessThan(1e-5);
    expect(relErr(warm.cStar, cold.cStar)).toBeLessThan(1e-5);
  });

  it('matches RocketCEA for hydrogen and oxygen out to area ratio 280', () => {
    const mix = byRatio('H2(L)', 'O2(L)', 5.88);
    for (const [eps, isp] of [[84, 464.9], [100, 467.7], [150, 473.5], [200, 477.1], [280, 481.0]]) {
      const r = rocket(mix, flame(mix, 32.75), eps);
      expect(r.ok).toBe(true);
      expect(relErr(r.ispVac / G0, isp), `Isp at ${eps}`).toBeLessThan(0.003);
    }
  });

  it('matches a RocketCEA mixture-ratio sweep for hydrogen and oxygen', () => {
    const want = [424.360, 445.444, 453.133, 453.240, 448.190, 438.743, 424.700];
    want.forEach((isp, k) => {
      const of = 2 + k;
      const mix = byRatio('H2(L)', 'O2(L)', of);
      const r = rocket(mix, flame(mix, 6.895), 40);
      expect(r.ok).toBe(true);
      expect(relErr(r.ispVac / G0, isp), `Isp at O/F ${of}`).toBeLessThan(0.005);
    });
  });

  it('matches a RocketCEA mixture-ratio sweep for N2O4 and MMH', () => {
    const rows = [
      // O/F, Isp (s), c* (m/s), Tc (K), chamber molar mass
      [1.5, 329.3, 1736.9, 2988.7, 19.75],
      [2.0, 340.8, 1735.2, 3223.3, 21.99],
      [2.3, 343.0, 1706.5, 3241.8, 22.98],
      [2.9, 329.3, 1638.5, 3181.3, 24.47],
    ];
    for (const [of, isp, cStar, tc, mm] of rows) {
      const mix = byRatio('CH6N2(L)', 'N2O4(L)', of);
      const r = rocket(mix, flame(mix, 17.237), 50);
      expect(r.ok).toBe(true);
      expect(relErr(r.ispVac / G0, isp), `Isp at O/F ${of}`).toBeLessThan(0.01);
      expect(relErr(r.cStar, cStar), `c* at O/F ${of}`).toBeLessThan(0.01);
      expect(relErr(r.chamber.t, tc), `Tc at O/F ${of}`).toBeLessThan(0.01);
      expect(relErr(r.chamber.molarMass, mm), `M at O/F ${of}`).toBeLessThan(0.01);
    }
  });

  it('carries beryllium oxide droplets through the nozzle (RP-1311 Example 13)', () => {
    const mix = mixtureFrom([
      { reactant: REACTANTS['N2H4(L)'], massFraction: 0.67 * 0.8 },
      { reactant: REACTANTS['Be(a)'], massFraction: 0.67 * 0.2 },
      { reactant: REACTANTS['H2O2(L)'], massFraction: 0.33 },
    ]);
    const r = rocket(mix, flame(mix, 206.84), 30.0004);
    expect(r.ok).toBe(true);
    expect(relErr(r.ispVac, 3770.30)).toBeLessThan(0.01);
    expect(relErr(r.cStar, 1946.68)).toBeLessThan(0.01);
    expect(r.exit.condensedMassFraction).toBeGreaterThan(0);
    const again = rocket(mix, flame(mix, 206.84), 30.0004, r);
    expect(again.ok).toBe(true);
    expect(relErr(again.cStar, r.cStar)).toBeLessThan(1e-4);
    expect(relErr(again.ispVac, r.ispVac)).toBeLessThan(1e-4);
  });

  /** Example 13's propellants in other proportions: `fuel` of the total mass, `be` of the fuel. */
  const beryllium = (fuel: number, be: number) => mixtureFrom([
    { reactant: REACTANTS['N2H4(L)'], massFraction: fuel * (1 - be) },
    { reactant: REACTANTS['Be(a)'], massFraction: fuel * be },
    { reactant: REACTANTS['H2O2(L)'], massFraction: 1 - fuel },
  ]);
  const sonic = (mix: Mixture, s: number, hc: number, pBar: number) => {
    const st = equilibrate(mix, { kind: 'sp', s, pBar });
    return 2 * (hc - st.h) - st.n * R_UNIVERSAL * st.t * st.gammaS; // u² − a²
  };

  it('puts the throat at a jump in the sound speed where the oxide starts to freeze', () => {
    // Just upstream of the throat the oxide is all liquid and the flow below sonic; just downstream
    // solid has formed, the sound speed has dropped, and the flow is above sonic. No pressure has
    // u = a, so the throat is where the flow goes from one to the other.
    const mix = beryllium(0.5, 0.155);
    const r = rocket(mix, flame(mix, 206.84), 30);
    expect(r.ok).toBe(true);
    const pt = r.throat.pBar;
    expect(sonic(mix, r.chamber.s, r.chamber.h, pt)).toBeLessThan(0);
    expect(sonic(mix, r.chamber.s, r.chamber.h, pt * (1 - 1e-5))).toBeGreaterThan(0);
    const again = rocket(mix, flame(mix, 206.84), 30, r);
    expect(again.ok).toBe(true);
    expect(relErr(again.cStar, r.cStar)).toBeLessThan(1e-5);
  });

  it('finds a jump throat even when the search lands on the melting point itself', () => {
    // Beryllium nitride freezes at the throat here; the solver cannot settle a point exactly on
    // the edge of the band where solid and liquid coexist, and a halving of the bracket lands on it.
    const mix = beryllium(0.85, 0.215);
    const r = rocket(mix, flame(mix, 20), 30);
    expect(r.ok).toBe(true);
    expect(sonic(mix, r.chamber.s, r.chamber.h, r.throat.pBar)).toBeLessThan(0);
    expect(sonic(mix, r.chamber.s, r.chamber.h, r.throat.pBar * (1 - 1e-5))).toBeGreaterThan(0);
  });

  it('settles an exit far below a melting point reached at the throat', () => {
    // The throat holds solid and liquid oxide together; the exit, at 1200 K, cannot start from that.
    const mix = beryllium(0.75, 0.19);
    const r = rocket(mix, flame(mix, 206.84), 30);
    expect(r.ok).toBe(true);
    const exit = equilibrate(mix, { kind: 'sp', s: r.chamber.s, pBar: r.pExitBar });
    expect(relErr(r.exit.t, exit.t)).toBeLessThan(1e-4);
    expect(Number.isFinite(r.ispVac)).toBe(true);
  });

  it('takes the first sonic point when a product melts near the throat', () => {
    // Very fuel-rich beryllium and peroxide at 5 bar: the flow goes sonic, back below sonic as the
    // oxide starts to freeze, and sonic again further down. The throat is the first, where the mass
    // flux is greatest; the second once gave c* 4% high.
    const mix = mixtureOf('be', 'htp90', 1.127);
    const r = rocket(mix, flame(mix, 5), 10);
    expect(r.ok).toBe(true);
    const throatFlux = (1e5 * 5) / r.cStar;
    let from = r.chamber;
    let best = 0;
    for (let p = 5 * 0.95; p > r.throat.pBar; p *= 0.995) {
      let st = equilibrate(mix, { kind: 'sp', s: r.chamber.s, pBar: p }, undefined, from);
      if (!st.ok) st = equilibrate(mix, { kind: 'sp', s: r.chamber.s, pBar: p });
      if (!st.ok) continue;
      from = st;
      const u2 = 2 * (r.chamber.h - st.h);
      best = Math.max(best, ((1e5 * p) / (st.n * R_UNIVERSAL * st.t)) * Math.sqrt(u2));
    }
    expect(best).toBeGreaterThan(0);
    expect(best / throatFlux).toBeLessThan(1.001);
  });

  it('keeps the throat on the flux maximum where a vapour sits over its own liquid', () => {
    // Lithium and peroxide at 200 bar: the equilibrium gamma_s falls below 1 as lithium oxide and
    // hydroxide liquids condense. That is real; replacing it with the frozen value once moved the
    // throat to 113 bar where the mass flux peaks at 130, and gave c* 1.8% high.
    const mix = mixtureOf('li', 'htp90', 2.69);
    const r = rocket(mix, flame(mix, 200), 16);
    expect(r.ok).toBe(true);
    const throatFlux = (1e5 * 200) / r.cStar;
    let from = r.chamber;
    let best = 0;
    for (let p = 200 * 0.95; p > 200 * 0.4; p *= 0.995) {
      let st = equilibrate(mix, { kind: 'sp', s: r.chamber.s, pBar: p }, undefined, from);
      if (!st.ok) st = equilibrate(mix, { kind: 'sp', s: r.chamber.s, pBar: p });
      if (!st.ok) continue;
      from = st;
      const u2 = 2 * (r.chamber.h - st.h);
      best = Math.max(best, ((1e5 * p) / (st.n * R_UNIVERSAL * st.t)) * Math.sqrt(u2));
    }
    expect(best).toBeGreaterThan(0);
    expect(best / throatFlux).toBeLessThan(1.002);
  });

  it('gives no answer where the throat would rest on frozen-composition derivatives', () => {
    // Fuel-rich lithium and oxygen at 400 bar: liquid lithium and liquid lithium oxide together make
    // the derivative matrix singular, so gamma_s there is the frozen value; a throat found with it
    // sits where the speed equals the frozen sound speed (c* once 18% high, shown as settled).
    const mix = mixtureOf('li', 'lox', 0.65);
    const r = rocket(mix, flame(mix, 400), 16);
    expect(r.ok).toBe(false);
  });

  it('is not ok when the chamber would settle colder than the data covers', () => {
    const mix = beryllium(0.85, 0.3775); // once a false chamber at 86 K
    expect(rocket(mix, flame(mix, 206.84), 30).ok).toBe(false);
  });

  it('runs lithium and fluorine without ions (RP-1311 Example 11)', () => {
    const mix = byMoles([['Li(cr)', 1], ['F2(L)', 0.5556]]);
    const r = rocket(mix, flame(mix, 68.948), 100);
    expect(r.ok).toBe(true);
    expect(relErr(r.cStar, 2274.40)).toBeLessThan(0.02);
    expect(relErr(r.ispVac, 4504.51)).toBeLessThan(0.02);
  });

  it('keeps an ordinary exit in equilibrium', () => {
    expect(rocket(ex8Mix, flame(ex8Mix, 53.3172), 25).coldExit).toBe(false);
  });

  it('expands helium frozen below the data floor, as a perfect gas', () => {
    const mix = mixtureFrom([{ reactant: REACTANTS['He'], massFraction: 1 }]);
    const r = rocket(mix, { kind: 'tp', t: 2360, pBar: 30 }, 100);
    expect(r.ok).toBe(true);
    expect(r.coldExit).toBe(true);
    expect(r.exit.t).toBeLessThan(200);
    // Exact for a perfect gas: gamma 5/3, M 4.002602.
    const g = 5 / 3;
    const Rgas = R_UNIVERSAL / 4.002602;
    let lo = 1, hi = 50;
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (areaRatio(mid, g) < 100) lo = mid; else hi = mid; }
    const mach = (lo + hi) / 2;
    const isp = exitVelocity(mach, g, Rgas, 2360) + 100 * pressureRatio(mach, g) * cStar(g, Rgas, 2360);
    expect(relErr(r.ispVac, isp)).toBeLessThan(0.003);
  });

  it('expands a hydrogen-rich exhaust frozen below the data floor', () => {
    // At O/F 0.5 the exit would be near 110 K. (At O/F 1.0 it is 273 K: freezing water's heat
    // keeps it warm, so that exit is in equilibrium.)
    const mix = byRatio('H2(L)', 'O2(L)', 0.5);
    const r = rocket(mix, flame(mix, 70), 40);
    expect(r.ok).toBe(true);
    expect(r.coldExit).toBe(true);
    expect(r.exit.t).toBeLessThan(200);
    expect(Number.isFinite(r.ispVac)).toBe(true);
    const smaller = rocket(mix, flame(mix, 70), 20);
    expect(smaller.ok).toBe(true);
    expect(r.ispVac).toBeGreaterThan(smaller.ispVac);
  });

  it('joins the frozen and equilibrium exits without a step', () => {
    // Step O/F up from 0.5 until the exit warms past the floor, then narrow that step to 0.001 in O/F,
    // so the change across it is the switch itself and not the slope of Isp with mixture (about 2%
    // per 0.05 here).
    const at = (of: number) => { const mix = byRatio('H2(L)', 'O2(L)', of); return rocket(mix, flame(mix, 70), 40); };
    let lo = 0.5;
    expect(at(lo).coldExit).toBe(true);
    let hi = lo;
    while (at(hi).coldExit) { hi += 0.05; expect(hi).toBeLessThan(2); }
    lo = hi - 0.05;
    while (hi - lo > 1e-3) { const mid = (lo + hi) / 2; if (at(mid).coldExit) lo = mid; else hi = mid; }
    const cold = at(lo);
    const warm = at(hi);
    expect(cold.ok && warm.ok).toBe(true);
    expect(cold.coldExit && !warm.coldExit).toBe(true);
    expect(relErr(warm.ispVac, cold.ispVac)).toBeLessThan(0.005);
  });

  it('expands a fluid heated to a fixed temperature', () => {
    const mix = mixtureFrom([{ reactant: REACTANTS['NH3(L)'], massFraction: 1 }]);
    const r = rocket(mix, { kind: 'tp', t: 2800, pBar: 55 }, 100);
    expect(r.ok).toBe(true);
    expect(r.chamber.t).toBe(2800);
    expect(r.chamber.molarMass).toBeGreaterThan(8.3);
    expect(r.chamber.molarMass).toBeLessThan(8.7);
  });
});

describe('rocket against Huzel and Huang (1971 table, 68.95 bar, area ratio 40)', () => {
  const rows: [string, string, number, number][] = [
    // oxidiser, fuel, O/F, vacuum Isp (m/s)
    ['O2(L)', 'H2(L)', 4.83, 4462],
    ['O2(L)', 'CH4(L)', 3.45, 3615],
    ['O2(L)', 'RP-1', 2.77, 3510],
    ['F2(L)', 'H2(L)', 9.74, 4697],
    ['F2(L)', 'NH3(L)', 3.35, 4143],
    ['CLF3(L)', 'N2H4(L)', 2.89, 3356],
    ['N2O4(L)', 'CH6N2(L)', 2.37, 3347],
    ['N2O4(L)', 'N2H4(L)', 1.42, 3369],
    ['H2O2(L)', 'N2H4(L)', 2.12, 3308],
    ['O2(L)', 'B2H6(L)', 2.06, 4016],
    ['N2O4(L)', 'B5H9(L)', 3.26, 3513],
  ];
  for (const [ox, fuel, of, isp] of rows) {
    it(`${ox} with ${fuel} at O/F ${of}`, () => {
      const mix = byRatio(fuel, ox, of);
      const r = rocket(mix, flame(mix, 68.95), 40);
      expect(r.ok).toBe(true);
      expect(relErr(r.ispVac, isp)).toBeLessThan(0.03);
    });
  }
});
