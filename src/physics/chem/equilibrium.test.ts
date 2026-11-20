import { describe, expect, it } from 'vitest';
import { REACTANTS, SPECIES, speciesFor } from './thermo';
import { equilibrate, mixtureFrom, type EqState } from './equilibrium';

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

function moleFraction(st: EqState, name: string): number {
  const j = st.species.findIndex((s) => s.name === name);
  expect(j, name).toBeGreaterThanOrEqual(0);
  return st.moles[j] / st.n;
}

const relErr = (got: number, want: number) => Math.abs(got - want) / Math.abs(want);

const ex8Mix = byRatio('H2(L)', 'O2(L)', 5.55157);
const ex8 = () => equilibrate(ex8Mix, { kind: 'hp', h: ex8Mix.h0, pBar: 53.3172 });
const ex12Mix = byRatio('CH6N2(L)', 'N2O4(L)', 2.5);

describe('equilibrium of a gas mixture', () => {
  it('finds the make-up at a fixed temperature (RP-1311 Example 14, gas only)', () => {
    const mix = byMoles([['H2(L)', 100], ['O2(L)', 60]]);
    const st = equilibrate(mix, { kind: 'tp', t: 1000, pBar: 0.0506625 });
    expect(st.ok).toBe(true);
    expect(st.t).toBe(1000);
    expect(Math.abs(moleFraction(st, 'H2O') - 0.90909)).toBeLessThan(1e-4);
    expect(Math.abs(moleFraction(st, 'O2') - 0.090909)).toBeLessThan(1e-4);
  });

  it('finds the hydrogen-oxygen chamber (RP-1311 Example 8)', () => {
    const st = ex8();
    expect(st.ok).toBe(true);
    expect(relErr(st.t, 3383.845)).toBeLessThan(1e-3);
    expect(relErr(st.molarMass, 12.716)).toBeLessThan(1e-3);
    expect(Math.abs(moleFraction(st, 'H2O') - 0.63456)).toBeLessThan(2e-4);
    expect(Math.abs(moleFraction(st, 'H2') - 0.29479)).toBeLessThan(2e-4);
    expect(Math.abs(moleFraction(st, 'OH') - 0.033341)).toBeLessThan(2e-4);
    expect(Math.abs(moleFraction(st, 'H') - 0.033498)).toBeLessThan(2e-4);
    expect(relErr(st.gammaS, 1.145)).toBeLessThan(2e-3);
  });

  it('finds the MMH-N2O4 chamber (RP-1311 Example 12)', () => {
    const st = equilibrate(ex12Mix, { kind: 'hp', h: ex12Mix.h0, pBar: 68.948 });
    expect(st.ok).toBe(true);
    expect(relErr(st.t, 3382.32)).toBeLessThan(3e-3);
    expect(relErr(st.molarMass, 23.845)).toBeLessThan(3e-3);
    expect(relErr(st.gammaS, 1.138)).toBeLessThan(5e-3);
  });

  it('conserves atoms', () => {
    const st = ex8();
    const b0max = Math.max(...Object.values(ex8Mix.b0));
    for (const [el, b0] of Object.entries(ex8Mix.b0)) {
      let b = 0;
      st.species.forEach((s, j) => { b += (s.elements[el] ?? 0) * st.moles[j]; });
      expect(Math.abs(b - b0), el).toBeLessThanOrEqual(1e-6 * b0max);
    }
  });

  it('returns to its own temperature at fixed entropy', () => {
    const hp = ex8();
    const sp = equilibrate(ex8Mix, { kind: 'sp', s: hp.s, pBar: 53.3172 });
    expect(sp.ok).toBe(true);
    expect(relErr(sp.t, hp.t)).toBeLessThan(1e-4);
  });

  it('solves fixed enthalpy at the enthalpy it is given, not the mixture\'s own', () => {
    const tp = equilibrate(ex8Mix, { kind: 'tp', t: 3000, pBar: 53.3172 });
    expect(tp.ok).toBe(true);
    const hp = equilibrate(ex8Mix, { kind: 'hp', h: tp.h, pBar: 53.3172 });
    expect(hp.ok).toBe(true);
    expect(relErr(hp.t, 3000)).toBeLessThan(1e-4);
  });

  it('settles quickly from a warm start', () => {
    const first = equilibrate(ex12Mix, { kind: 'hp', h: ex12Mix.h0, pBar: 68.948 });
    const again = equilibrate(ex12Mix, { kind: 'hp', h: ex12Mix.h0, pBar: 68.948 * 1.01 }, undefined, first);
    expect(again.ok).toBe(true);
    expect(again.iterations).toBeLessThanOrEqual(5);
  });

  it('ignores species made of elements that are not present', () => {
    const wide = equilibrate(ex8Mix, { kind: 'hp', h: ex8Mix.h0, pBar: 53.3172 }, speciesFor(['C', 'H', 'O', 'N']));
    expect(wide.ok).toBe(true);
    expect(relErr(wide.t, ex8().t)).toBeLessThan(1e-4);
  });
});

/** Mole fraction over all species, gas and condensed. */
function overallFraction(st: EqState, name: string): number {
  const j = st.species.findIndex((s) => s.name === name);
  expect(j, name).toBeGreaterThanOrEqual(0);
  return st.moles[j] / st.moles.reduce((a, b) => a + b, 0);
}

function molesOf(st: EqState, name: string): number {
  const j = st.species.findIndex((s) => s.name === name);
  expect(j, name).toBeGreaterThanOrEqual(0);
  return st.moles[j];
}

const ex13Mix = mixtureFrom([
  { reactant: REACTANTS['N2H4(L)'], massFraction: 0.67 * 0.8 },
  { reactant: REACTANTS['Be(a)'], massFraction: 0.67 * 0.2 },
  { reactant: REACTANTS['H2O2(L)'], massFraction: 0.33 },
]);
const ex13Chamber = () => equilibrate(ex13Mix, { kind: 'hp', h: ex13Mix.h0, pBar: 206.84 });
/** BeO's melting point: where the BeO(b) range ends and BeO(L) begins. */
const beoMelt = () => {
  const solid = SPECIES.find((s) => s.name === 'BeO(b)')!;
  return solid.intervals[solid.intervals.length - 1].tMax;
};

describe('equilibrium with liquid and solid products', () => {
  it('condenses water (RP-1311 Example 14)', () => {
    const mix = byMoles([['H2(L)', 100], ['O2(L)', 60]]);
    const st = equilibrate(mix, { kind: 'tp', t: 300, pBar: 0.0506625 });
    expect(st.ok).toBe(true);
    expect(Math.abs(overallFraction(st, 'H2O(L)') - 0.69949)).toBeLessThan(0.002);
  });

  it('forms beryllium oxide droplets (RP-1311 Example 13 chamber)', () => {
    const st = ex13Chamber();
    expect(st.ok).toBe(true);
    expect(relErr(st.t, 3002.54)).toBeLessThan(5e-3);
    expect(Math.abs(overallFraction(st, 'BeO(L)') - 0.19218)).toBeLessThan(0.003);
    expect(relErr(st.molarMass, 16.627)).toBeLessThan(5e-3);
  });

  it('forms soot in a very fuel-rich kerosene flame', () => {
    const mix = byRatio('RP-1', 'O2(L)', 0.5);
    const st = equilibrate(mix, { kind: 'hp', h: mix.h0, pBar: 70 });
    expect(st.ok).toBe(true);
    expect(molesOf(st, 'C(gr)')).toBeGreaterThan(0);
    expect(Number.isFinite(st.t)).toBe(true);
    expect(st.t).toBeGreaterThan(800);
    expect(st.t).toBeLessThan(2500);
  });

  it('never returns NaN for almost pure oxidiser', () => {
    const mix = byRatio('RP-1', 'O2(L)', 200);
    const st = equilibrate(mix, { kind: 'hp', h: mix.h0, pBar: 70 });
    if (st.ok) expect(Number.isFinite(st.t)).toBe(true);
    else expect(st.ok).toBe(false);
    expect(Number.isNaN(st.t)).toBe(false);
    expect(Number.isNaN(st.n)).toBe(false);
    expect(Number.isNaN(st.molarMass)).toBe(false);
  });

  it('does not accept a state colder than the thermodynamic data covers', () => {
    // Fuel 85% of the mass, 37.75% of it beryllium: this once "settled" at 86 K, gas only.
    const mix = mixtureFrom([
      { reactant: REACTANTS['N2H4(L)'], massFraction: 0.85 * (1 - 0.3775) },
      { reactant: REACTANTS['Be(a)'], massFraction: 0.85 * 0.3775 },
      { reactant: REACTANTS['H2O2(L)'], massFraction: 0.15 },
    ]);
    expect(equilibrate(mix, { kind: 'hp', h: mix.h0, pBar: 206.84 }).ok).toBe(false);
    expect(equilibrate(ex8Mix, { kind: 'tp', t: 150, pBar: 1 }).ok).toBe(false);
  });

  it('forms alumina from aluminised kerosene', () => {
    const fuel = 1 / 3;
    const mix = mixtureFrom([
      { reactant: REACTANTS['AL(cr)'], massFraction: fuel * 0.3 },
      { reactant: REACTANTS['RP-1'], massFraction: fuel * 0.7 },
      { reactant: REACTANTS['O2(L)'], massFraction: 1 - fuel },
    ]);
    const st = equilibrate(mix, { kind: 'hp', h: mix.h0, pBar: 70 });
    expect(st.ok).toBe(true);
    expect(st.condensedMassFraction).toBeGreaterThan(0.1);
    const alumina = st.species.some((s, j) => s.phase !== 0 && s.name.startsWith('AL2O3') && st.moles[j] > 0);
    expect(alumina).toBe(true);
  });

  it('holds the temperature at the melting point while solid and liquid coexist (Example 13 near the throat)', () => {
    const chamber = ex13Chamber();
    const problem = { kind: 'sp', s: chamber.s, pBar: 118 } as const;
    const cold = equilibrate(ex13Mix, problem);
    const warm = equilibrate(ex13Mix, problem, undefined, chamber);
    for (const st of [cold, warm]) {
      expect(st.ok).toBe(true);
      expect(Math.abs(st.t - beoMelt())).toBeLessThan(0.5);
      expect(molesOf(st, 'BeO(b)')).toBeGreaterThan(0);
      expect(molesOf(st, 'BeO(L)')).toBeGreaterThan(0);
      expect(Number.isFinite(st.cp)).toBe(true);
      expect(st.gammaS).toBeCloseTo(-1 / st.dlnVdlnP, 12);
    }
    expect(relErr(warm.t, cold.t)).toBeLessThan(1e-4);
    expect(relErr(molesOf(warm, 'BeO(b)'), molesOf(cold, 'BeO(b)'))).toBeLessThan(1e-4);
    expect(relErr(molesOf(warm, 'BeO(L)'), molesOf(cold, 'BeO(L)'))).toBeLessThan(1e-4);
  });

  it('keeps a single phase of beryllium oxide well below the melting point', () => {
    const chamber = ex13Chamber();
    const problem = { kind: 'sp', s: chamber.s, pBar: 20 } as const;
    const cold = equilibrate(ex13Mix, problem);
    const warm = equilibrate(ex13Mix, problem, undefined, chamber);
    for (const st of [cold, warm]) {
      expect(st.ok).toBe(true);
      expect(st.t).toBeLessThan(beoMelt());
      const phases = st.species.filter((s, j) => s.phase !== 0 && s.name.startsWith('BeO(') && st.moles[j] > 0);
      expect(phases.length).toBe(1);
    }
    expect(relErr(warm.t, cold.t)).toBeLessThan(1e-4);
  });

  it('keeps one phase at an assigned temperature equal to the melting point', () => {
    const twoPhase = equilibrate(ex13Mix, { kind: 'sp', s: ex13Chamber().s, pBar: 118 });
    const problem = { kind: 'tp', t: beoMelt(), pBar: 118 } as const;
    for (const st of [equilibrate(ex13Mix, problem), equilibrate(ex13Mix, problem, undefined, twoPhase)]) {
      expect(st.ok).toBe(true);
      const phases = st.species.filter((s, j) => s.phase !== 0 && s.name.startsWith('BeO(') && st.moles[j] > 0);
      expect(phases.length).toBe(1);
      for (const v of [st.t, st.n, st.molarMass, st.cp, st.gammaS, st.h, st.s]) expect(Number.isNaN(v)).toBe(false);
    }
  });
});

describe('equilibrium does not depend on where it starts', () => {
  /** Aluminised kerosene (30% AL(cr), 70% RP-1) with liquid oxygen. */
  const slurry = (of: number) => mixtureFrom([
    { reactant: REACTANTS['AL(cr)'], massFraction: 0.3 / (1 + of) },
    { reactant: REACTANTS['RP-1'], massFraction: 0.7 / (1 + of) },
    { reactant: REACTANTS['O2(L)'], massFraction: of / (1 + of) },
  ]);
  /** 80% hydrazine, 20% beryllium, with hydrogen peroxide. */
  const beryllium = (of: number) => mixtureFrom([
    { reactant: REACTANTS['N2H4(L)'], massFraction: 0.8 / (1 + of) },
    { reactant: REACTANTS['Be(a)'], massFraction: 0.2 / (1 + of) },
    { reactant: REACTANTS['H2O2(L)'], massFraction: of / (1 + of) },
  ]);
  const flame = (mix: ReturnType<typeof mixtureFrom>) => ({ kind: 'hp', h: mix.h0, pBar: 70 }) as const;
  /** Active condensed species whose own fitted range does not hold T. */
  const outOfRange = (st: EqState) => st.species.filter((s, j) => s.phase !== 0 && st.moles[j] > 0
    && !(s.intervals[0].tMin <= st.t && st.t <= s.intervals[s.intervals.length - 1].tMax)).map((s) => s.name);

  it('drops a solid carried in from a cold start far outside its range', () => {
    const from = equilibrate(slurry(100), flame(slurry(100)));
    expect(from.ok).toBe(true);
    const mix = slurry(2.18);
    const warm = equilibrate(mix, flame(mix), undefined, from);
    const cold = equilibrate(mix, flame(mix));
    expect(warm.ok).toBe(true);
    expect(relErr(warm.t, cold.t)).toBeLessThan(0.001);
    expect(cold.t).toBeGreaterThan(3900);
    expect(outOfRange(warm)).toEqual([]);
  });

  for (const [name, mixOf] of [['aluminised kerosene and oxygen', slurry], ['hydrazine-beryllium and peroxide', beryllium]] as const) {
    it(`gives the same answer along a chained sweep: ${name}`, () => {
      let prev: EqState | undefined;
      for (const of of [100, 0.5, 30, 2, 0.2, 8]) {
        const mix = mixOf(of);
        const warm = equilibrate(mix, flame(mix), undefined, prev);
        const cold = equilibrate(mix, flame(mix));
        expect(warm.ok, `ok at O/F ${of}`).toBe(cold.ok);
        if (warm.ok) {
          expect(relErr(warm.t, cold.t), `T at O/F ${of}`).toBeLessThan(0.001);
          expect(Math.abs(warm.condensedMassFraction - cold.condensedMassFraction), `condensed at O/F ${of}`).toBeLessThan(0.002);
          expect(outOfRange(warm), `out of range at O/F ${of}`).toEqual([]);
          prev = warm;
        }
      }
    });
  }
});
