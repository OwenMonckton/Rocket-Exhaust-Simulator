import { describe, expect, it } from 'vitest';
import { REACTANTS, speciesFor } from './thermo';
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
