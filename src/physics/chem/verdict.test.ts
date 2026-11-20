import { describe, expect, it } from 'vitest';
import { FLAMEOUT_K, verdictFor } from './verdict';
import { pairRange, solvePair, type SolvedGas } from './pair';

const PC = 70;
const EPS = 40;
const at = (fuel: string, ox: string, of: number) => solvePair(fuel, ox, of, PC, EPS);
const dflt = (fuel: string, ox: string) => verdictFor(fuel, ox, at(fuel, ox, pairRange(fuel, ox).ofDefault));
const has = (notes: string[], text: string) => notes.some((n) => n.includes(text));

describe('verdictFor', () => {
  it('uses the SP-8081 flame-out threshold', () => expect(FLAMEOUT_K).toBe(800));

  it('says kerosene and oxygen need an igniter', () => {
    const v = dflt('rp1', 'lox');
    expect(v.failure).toBeNull();
    expect(has(v.notes, 'igniter')).toBe(true);
  });

  it('says MMH and nitrogen tetroxide light on contact', () => {
    const v = dflt('mmh', 'n2o4');
    expect(v.failure).toBeNull();
    expect(has(v.notes, 'on contact')).toBe(true);
  });

  it('calls ozone and acetylene detonations', () => {
    expect(dflt('h2', 'o3').failure).toBe('detonation');
    expect(dflt('c2h2', 'lox').failure).toBe('detonation');
  });

  it('flames out at the ends of the mixture range', () => {
    const { ofMin, ofMax } = pairRange('h2', 'lox');
    expect(verdictFor('h2', 'lox', at('h2', 'lox', ofMin)).failure).toBe('flameout');
    expect(verdictFor('h2', 'lox', at('h2', 'lox', ofMax)).failure).toBe('flameout');
    expect(verdictFor('rp1', 'lox', at('rp1', 'lox', pairRange('rp1', 'lox').ofMax)).failure).toBe('flameout');
  });

  it('finds nothing to burn without an oxidiser', () => {
    for (const fuel of ['nh3', 'li', 'rp1']) {
      const gas = solvePair(fuel, 'none', 0, PC, EPS);
      expect(verdictFor(fuel, 'none', gas).failure, fuel).toBe('inert');
      expect(verdictFor(fuel, 'none', { ...gas, ok: true, tc: 3000 }).failure, fuel).toBe('inert');
    }
  });

  it('lets hydrazine run alone, with a caveat', () => {
    const v = verdictFor('n2h4', 'none', solvePair('n2h4', 'none', 0, PC, EPS));
    expect(v.failure).toBeNull();
    expect(has(v.notes, 'real thrusters')).toBe(true);
  });

  it('warns about toxic propellant, droplets and materials', () => {
    expect(has(dflt('b5h9', 'of2').notes, 'Extremely toxic')).toBe(true);
    expect(dflt('b5h9', 'of2').failure).toBeNull();
    expect(has(dflt('al-slurry', 'lox').notes, 'droplets')).toBe(true);
    const f = dflt('h2', 'lf2');
    expect(f.failure).toBeNull();
    expect(has(f.notes, 'almost every material')).toBe(true);
  });

  it('judges an unsettled solve unsolved', () => {
    const bad: SolvedGas = { ok: false, tc: 0, gamma: 0, molarMass: 0, cStar: 0, ispVac: 0, condensedShare: 0, exhaust: [] };
    expect(verdictFor('rp1', 'lox', bad).failure).toBe('unsolved');
  });

  it('notes when one freezes the other', () => {
    expect(has(dflt('h2', 'n2o4').notes, 'freeze')).toBe(true);
  });
});
