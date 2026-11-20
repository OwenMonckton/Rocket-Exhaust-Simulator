import { describe, expect, it } from 'vitest';
import { R_UNIVERSAL, REACTANTS } from './thermo';
import { equilibrate, mixtureFrom, type Mixture } from './equilibrium';
import { rocket } from './rocket';

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
