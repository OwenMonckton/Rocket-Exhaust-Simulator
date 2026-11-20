import { describe, expect, it } from 'vitest';
import { REACTANTS, SPECIES, cpR, hRT, speciesFor } from './thermo';

const byName = (n: string) => SPECIES.find((s) => s.name === n)!;

describe('thermo data', () => {
  it('holds the 511 products within the eleven elements, 427 of them gases', () => {
    expect(SPECIES.length).toBe(511);
    expect(SPECIES.filter((s) => s.phase === 0).length).toBe(427);
  });
  it('has no inert or ionised records', () => {
    expect(SPECIES.some((s) => s.name.startsWith('Inert'))).toBe(false);
    expect(SPECIES.some((s) => 'E' in s.elements)).toBe(false);
  });
  it('reproduces the heat of formation of water vapour', () => {
    expect(Math.abs(hRT(byName('H2O'), 298.15) * 8.31451 * 298.15 - -241826)).toBeLessThan(1);
  });
  it('is continuous across an interval boundary', () => {
    const s = byName('H2O');
    expect(Math.abs(cpR(s, 999.999) - cpR(s, 1000.001))).toBeLessThan(1e-4);
  });
  it('uses the nearest interval outside the stated range', () => {
    const s = byName('H2O');
    const top = s.intervals[s.intervals.length - 1].tMax;
    expect(Number.isFinite(cpR(s, top + 500))).toBe(true);
    expect(Number.isFinite(cpR(s, 50))).toBe(true);
  });
  it('carries reactant records', () => {
    expect(REACTANTS['O2(L)']).toMatchObject({ h: -12979, t: 90.17 });
    expect(REACTANTS['RP-1'].elements).toEqual({ C: 1, H: 1.95 });
    expect(REACTANTS['Li(cr)'].h).toBe(0);
    const names = [
      'O2(L)', 'F2(L)', 'O3(L)', 'F2O(L)', 'NF3(L)', 'CLF3(L)', 'CLO3F(L)', 'N2O4(L)', 'HNO3(L)', 'IRFNA',
      'H2O2(L)', 'H2(L)', 'CH4(L)', 'C2H6(L)', 'C3H8(L)', 'C2H2(L),acetyle', 'RP-1', 'C8H18(L),isooct',
      'Jet-A(L)', 'JP-10(L)', 'C2H5OH(L)', 'CH3OH(L)', 'NH3(L)', 'N2H4(L)', 'CH6N2(L)', 'C2H8N2(L),UDMH',
      'C6H5NH2(L)', 'B2H6(L)', 'B5H9(L)', 'C2N2(L)', 'CH3NO2(L)',
      'NO', 'N2O', 'H2O(L)', 'Li(cr)', 'AL(cr)', 'Be(a)', 'CO2', 'He',
    ];
    for (const n of names) expect(REACTANTS[n], n).toBeDefined();
  });
  it('picks the species that fit a set of elements', () => {
    const list = speciesFor(['H', 'O']);
    expect(list.filter((s) => s.phase === 0).length).toBe(9);
    expect(list.some((s) => s.name === 'H2O(L)')).toBe(true);
    expect(list.some((s) => 'C' in s.elements)).toBe(false);
  });
});
