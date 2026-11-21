import { describe, expect, it } from 'vitest';
import { FLAMEOUT_K, verdictFor } from './verdict';
import { FUEL_IDS, OXIDISER_IDS, FUELS, OXIDISERS, NO_OXIDISER } from './ingredients';
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
    expect(has(v.notes, 'eal thrusters')).toBe(true);
  });

  it('warns of one propellant freezing the other only where it really would', () => {
    const gas = at('h2', 'lox', 6);
    // Nitrous oxide, propane and the like are kept liquid by pressure, not cold; methane and oxygen
    // are within a degree of each other.
    for (const [f, o] of [['ch4', 'lox'], ['ipa', 'n2o'], ['c3h8', 'n2o4'], ['c2h6', 'lox'], ['n2h4', 'n2o']]) {
      expect(verdictFor(f, o, gas).notes.filter((n) => /freez/.test(n)), `${f}/${o}`).toEqual([]);
    }
    const h2 = verdictFor('h2', 'lox', gas).notes.filter((n) => /freez/.test(n));
    expect(h2.length).toBe(1);
    expect(h2[0]).toContain('freeze liquid oxygen');
    expect(h2[0]).toContain('°C');
  });

  it('says when the flame is hotter than the data covers', () => {
    const hot = verdictFor('be', 'lf2', solvePair('be', 'lf2', 4.5, 100, 40));
    expect(has(hot.notes, '6,000 K')).toBe(true);
    expect(has(verdictFor('h2', 'lox', at('h2', 'lox', 6)).notes, '6,000 K')).toBe(false);
  });

  it('drops "alone" from a fuel named for running alone once it has an oxidiser', () => {
    const notes = verdictFor('htp90-mono', 'lox', at('h2', 'lox', 6)).notes;
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.join(' ')).not.toMatch(/alone/);
  });

  it('warns about aniline and about blends of toxic propellants', () => {
    const gas = at('h2', 'lox', 6);
    expect(verdictFor('aniline', 'wfna', gas).notes).toContain('Toxic: aniline.');
    expect(verdictFor('aerozine50', 'n2o4', gas).notes).toContain('Extremely toxic: aerozine 50.');
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
    const bad: SolvedGas = { ok: false, tc: 0, gamma: 0, molarMass: 0, cStar: 0, ispVac: 0, ispScale: 1, condensedShare: 0, exhaust: [] };
    expect(verdictFor('rp1', 'lox', bad).failure).toBe('unsolved');
  });

  it('notes when one freezes the other', () => {
    expect(has(dflt('h2', 'n2o4').notes, 'freeze')).toBe(true);
  });

  it('writes clean notes for every pair', () => {
    const stand: SolvedGas = { ok: true, tc: 3000, gamma: 1.2, molarMass: 20, cStar: 1700, ispVac: 3000, ispScale: 1, condensedShare: 0.05, exhaust: [] };
    const names = [...Object.values(FUELS), ...Object.values(OXIDISERS)].map((i) => i.name);
    for (const f of FUEL_IDS) for (const o of [NO_OXIDISER, ...OXIDISER_IDS]) {
      for (const n of verdictFor(f, o, stand).notes) {
        const where = `${f}/${o}: ${n}`;
        expect(n.length, where).toBeGreaterThan(0);
        expect(n, where).not.toMatch(/undefined|NaN/);
        expect(n, where).toMatch(/^[A-Z0-9]/);
        expect(n, where).toMatch(/\.$/);
        for (const name of names) {
          const bad = name.charAt(0).toLowerCase() + name.slice(1);
          if (bad !== name && /[A-Z]/.test(name.charAt(1))) expect(n, where).not.toContain(bad);
        }
      }
    }
  });

  it('keeps acronyms intact', () => {
    const v = verdictFor('udmh', 'lox', { ok: true, tc: 3000, gamma: 1.2, molarMass: 20, cStar: 1700, ispVac: 3000, ispScale: 1, condensedShare: 0, exhaust: [] });
    const all = v.notes.join(' ');
    expect(all).toContain('UDMH');
    expect(all).not.toContain('uDMH');
  });

  it('explains the hydrazine caveat in plain words', () => {
    const v = verdictFor('n2h4', 'none', { ok: true, tc: 1200, gamma: 1.3, molarMass: 10, cStar: 1500, ispVac: 2000, ispScale: 1, condensedShare: 0, exhaust: [] });
    expect(v.notes.some((n) => /^Hydrazine alone breaks down into ammonia, hydrogen and nitrogen\./.test(n) && n.includes('eal thrusters'))).toBe(true);
  });
});
