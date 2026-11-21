import { describe, expect, it } from 'vitest';
import {
  FUEL_IDS, FUELS, NO_OXIDISER, OXIDISER_IDS, OXIDISERS, isFuelId, isOxidiserId, lightsOnContact, mixtureOf, reactantOf,
  type Fact, type Ingredient,
} from './ingredients';

const lists: [string, Record<string, Ingredient>, string[]][] = [
  ['fuel', FUELS, FUEL_IDS],
  ['oxidiser', OXIDISERS, OXIDISER_IDS],
];
const all = (): [string, Ingredient][] => lists.flatMap(([, rec, ids]) => ids.map((id) => [id, rec[id]] as [string, Ingredient]));

describe('ingredients: the records', () => {
  it('lists every id once, and every id has a record carrying that id', () => {
    for (const [, rec, ids] of lists) {
      expect(new Set(ids).size).toBe(ids.length);
      expect(Object.keys(rec).sort()).toEqual([...ids].sort());
      for (const id of ids) expect(rec[id].id).toBe(id);
    }
  });

  it('makes every ingredient (bar no oxidiser) of resolvable parts whose shares sum to 1', () => {
    for (const [id, ing] of all()) {
      if (id === NO_OXIDISER) { expect(ing.parts).toEqual([]); continue; }
      const sum = ing.parts.reduce((a, p) => a + p.share, 0);
      expect(Math.abs(sum - 1), id).toBeLessThan(1e-9);
      for (const p of ing.parts) {
        expect(p.share, id).toBeGreaterThan(0);
        expect(() => reactantOf(p.reactant), `${id}: ${p.reactant}`).not.toThrow();
      }
    }
  });

  it('gives every ingredient a tip and a name unique within its list', () => {
    for (const [, rec, ids] of lists) {
      const names = ids.map((id) => rec[id].name);
      expect(new Set(names).size).toBe(names.length);
      for (const id of ids) expect(rec[id].tip.length, id).toBeGreaterThan(20);
    }
  });

  it('gives every fact, custom record and set value a source', () => {
    const facts: (keyof Ingredient)[] = ['toxicExhaust', 'detonates', 'attacksMaterials', 'warning', 'monopropellant', 'pressurised'];
    for (const [id, ing] of all()) {
      for (const k of facts) {
        const f = ing[k] as Fact | undefined;
        if (f) {
          expect(f.text.length, `${id}.${k}`).toBeGreaterThan(8);
          expect(f.source.length, `${id}.${k}`).toBeGreaterThan(8);
        }
      }
      for (const c of ing.custom ?? []) expect(c.source.length, id).toBeGreaterThan(8);
      if (ing.freezeC !== undefined || ing.boilC !== undefined) expect(ing.pointsSource?.length ?? 0, id).toBeGreaterThan(8);
      if (ing.pointsSource !== undefined) expect(ing.freezeC ?? ing.boilC, id).toBeDefined();
      if (ing.toxicity !== undefined) expect(ing.toxicitySource?.length ?? 0, id).toBeGreaterThan(8);
      if (ing.toxicitySource !== undefined) expect(ing.toxicity, id).toBeDefined();
    }
  });

  it('gives a blend the toxicity of its most toxic listed component', () => {
    expect(FUELS.aerozine50.toxicity).toBe(FUELS.n2h4.toxicity);
    expect(OXIDISERS.flox70.toxicity).toBe(OXIDISERS.lf2.toxicity);
    expect(OXIDISERS.mon25.toxicity).toBe(OXIDISERS.n2o4.toxicity);
    expect(OXIDISERS.irfna.toxicity).toBe(OXIDISERS.wfna.toxicity);
    for (const ing of [FUELS.aerozine50, OXIDISERS.flox70, OXIDISERS.mon25, OXIDISERS.irfna]) {
      expect(ing.toxicitySource, ing.id).toMatch(/component/);
    }
  });

  it('rates aniline as CAMEO Chemicals does (NFPA 704 health 3)', () => {
    expect(FUELS.aniline.toxicity).toBe(2);
    expect(FUELS.aniline.toxicitySource).toContain('CAMEO Chemicals 2485');
  });

  it('resolves custom records only through the ingredient that cites them', () => {
    for (const [id, ing] of all()) {
      for (const c of ing.custom ?? []) {
        expect(reactantOf(c.reactant.name)).toBe(c.reactant);
        expect(ing.parts.some((p) => p.reactant === c.reactant.name), id).toBe(true);
      }
    }
    expect(() => reactantOf('not a reactant')).toThrow();
  });

  it('lists the expected fuels and oxidisers, first rp1 and lox', () => {
    expect(FUEL_IDS.length).toBeGreaterThanOrEqual(26);
    expect(FUEL_IDS).toEqual(expect.arrayContaining(['h2', 'ch4', 'rp1', 'ethanol', 'nh3', 'n2h4', 'mmh', 'udmh',
      'aerozine50', 'b5h9', 'li', 'al-slurry', 'c2n2', 'ch3no2', 'n2o-mono', 'htp90-mono']));
    expect(OXIDISER_IDS.length).toBeGreaterThanOrEqual(14);
    expect(OXIDISER_IDS).toEqual(expect.arrayContaining(['none', 'lox', 'lf2', 'flox70', 'o3', 'of2', 'clf3', 'n2o4',
      'mon25', 'irfna', 'wfna', 'htp90', 'htp98']));
    expect(FUEL_IDS[0]).toBe('rp1');
    expect(OXIDISER_IDS[0]).toBe('lox');
    expect(NO_OXIDISER).toBe('none');
    expect(FUELS['n2o-mono'].name).toMatch(/alone/i);
    expect(FUELS['htp90-mono'].name).toMatch(/alone/i);
  });

  it('marks the materials attackers, the detonators and the monopropellants', () => {
    expect(OXIDISERS.lf2.attacksMaterials).toBeDefined();
    expect(OXIDISERS.clf3.attacksMaterials).toBeDefined();
    expect(OXIDISERS.o3.detonates).toBeDefined();
    expect(FUELS.c2h2.detonates).toBeDefined();
    expect(FUELS.ch3no2.detonates).toBeUndefined();
    expect(FUELS.n2h4.detonates).toBeUndefined();
    expect(FUELS.n2h4.monopropellant).toBeDefined();
    expect(FUELS.ch3no2.monopropellant).toBeDefined();
    expect(FUELS.rp1.monopropellant).toBeUndefined();
  });

  it('tells ids apart', () => {
    expect(isFuelId('rp1')).toBe(true);
    expect(isFuelId('lox')).toBe(false);
    expect(isFuelId(3)).toBe(false);
    expect(isFuelId('toString')).toBe(false);
    expect(isOxidiserId('lox')).toBe(true);
    expect(isOxidiserId('none')).toBe(true);
    expect(isOxidiserId('rp1')).toBe(false);
  });
});

describe('ingredients: mixtures', () => {
  it('splits fuel and oxidiser by the mixture ratio', () => {
    const m = mixtureOf('h2', 'lox', 8);
    // 1 kg hydrogen per 8 kg oxygen: atoms of H per atom of O is (16/1)/8. (The brief's extra factor 2 counts H2 per O.)
    const want = (15.9994 / 1.00794) / 8;
    expect(Math.abs(m.b0.H / m.b0.O - want) / want).toBeLessThan(0.005);
  });

  it('ignores the mixture ratio with no oxidiser', () => {
    expect(mixtureOf('n2h4', 'none', 3)).toEqual(mixtureOf('n2h4', 'none', 0));
  });

  it('builds blends from their shares', () => {
    const m = mixtureOf('aerozine50', 'none', 0);
    const n2h4 = reactantOf('N2H4(L)'), udmh = reactantOf('C2H8N2(L),UDMH');
    expect(m.b0.C).toBeCloseTo((0.5 * 2) / udmh.molarMass, 12);
    expect(m.h0).toBeCloseTo(1000 * (0.5 * n2h4.h / n2h4.molarMass + 0.5 * udmh.h / udmh.molarMass), 6);
  });

  it('refuses ids it does not know', () => {
    expect(() => mixtureOf('nope', 'lox', 2)).toThrow();
    expect(() => mixtureOf('rp1', 'nope', 2)).toThrow();
  });
});

describe('ingredients: lights on contact', () => {
  it('answers from the sources, and says nothing where they are silent', () => {
    expect(lightsOnContact('mmh', 'n2o4')).toMatchObject({ lights: true });
    expect(lightsOnContact('rp1', 'lox')).toMatchObject({ lights: false });
    expect(lightsOnContact('h2', 'clf3')).toMatchObject({ lights: true });
    expect(lightsOnContact('ethanol', 'wfna')).toMatchObject({ lights: false });
    expect(lightsOnContact('rp1', 'of2')).toBeNull();
    expect(lightsOnContact('n2h4', 'n2o')).toBeNull();
    expect(lightsOnContact('n2h4', 'none')).toBeNull();
  });

  it('cites a source whenever it answers', () => {
    for (const f of FUEL_IDS) {
      for (const o of OXIDISER_IDS) {
        const r = lightsOnContact(f, o);
        if (r) expect(r.source.length, `${f}/${o}`).toBeGreaterThan(8);
      }
    }
  });
});
