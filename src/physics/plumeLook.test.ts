import { describe, expect, it } from 'vitest';
import { FUEL_IDS, NO_OXIDISER, OXIDISER_IDS } from './chem/ingredients';
import { pairRange, solveFluid, solvePair } from './chem/pair';
import { SPECIES } from './chem/thermo';
import { FAMILIES, colourNote, familyOf, lookFromExhaust } from './plumeLook';
import { PROPELLANTS } from './propellants';
import type { PlumeLook, RGB } from './types';

/** The look of a pair at its usual mixture (or at `of`), 70 bar and area ratio 16. */
const solve = (fuel: string, ox: string, of?: number): PlumeLook => {
  const g = solvePair(fuel, ox, of ?? pairRange(fuel, ox).ofDefault, 70, 16);
  expect(g.ok, `${fuel} + ${ox}`).toBe(true);
  return lookFromExhaust({ exhaust: g.exhaust, tc: g.tc, condensedShare: g.condensedShare });
};
const greenness = (c: RGB) => c[1] - (c[0] + c[2]) / 2;
const redness = (c: RGB) => c[0] - (c[1] + c[2]) / 2;
const whiteness = (c: RGB) => Math.min(c[0], c[1], c[2]);

/** Every number in a look, by name. */
const numbers = (look: PlumeLook): [string, number][] => [
  ...(['core', 'mid', 'edge', 'richTint', 'afterburn'] as const).flatMap((k) =>
    look[k].map((v, i): [string, number] => [`${k}[${i}]`, v]),
  ),
  ['opacity', look.opacity],
  ['soot', look.soot],
  ['smoke', look.smoke],
  ['afterburnStrength', look.afterburnStrength],
  ['particles', look.particles],
];

describe('the families of exhaust', () => {
  it('gives every species the solver knows a family', () => {
    for (const s of SPECIES) expect(Object.keys(FAMILIES), s.name).toContain(familyOf(s.name));
  });

  it('lets only helium, nitrogen and nitrogen bound to hydrogen show nothing', () => {
    const none = SPECIES.filter((s) => familyOf(s.name) === 'none').map((s) => s.name).sort();
    expect(none).toEqual(['He', 'N', 'N2', 'N2H2', 'N2H4', 'N3', 'N3H', 'NH', 'NH2', 'NH3']);
  });

  it('puts the species it is tuned on in the families a reader would expect', () => {
    const expected: Record<string, string> = {
      H2O: 'steam', H2: 'steam', OH: 'steam', O2: 'steam', 'H2O(L)': 'steam',
      CO: 'carbonOxide', CO2: 'carbonOxide',
      'C(gr)': 'soot', 'C2H2,acetylene': 'soot',
      CH4: 'hydrocarbon', C2H5OH: 'hydrocarbon',
      HBO2: 'boron', B2O3: 'boron', BOF: 'boron', BF3: 'boron',
      LiF: 'lithium', 'LiALO2(L)': 'lithium',
      'AL2O3(L)': 'aluminium', ALCL3: 'aluminium',
      'BeO(L)': 'beryllium', BeF2: 'beryllium',
      HF: 'halide', HCL: 'halide', F2: 'halide', CF4: 'halide', 'NH4CL(II)': 'halide',
      CL2: 'chlorine', CLF3: 'chlorine',
      CN: 'cyanogen', HCN: 'cyanogen',
      NO: 'nitrogenOxide', NOF: 'nitrogenOxide', HNO3: 'nitrogenOxide',
    };
    for (const [name, id] of Object.entries(expected)) expect(familyOf(name), name).toBe(id);
  });

  it('shows nothing for a species it has never heard of', () => {
    expect(familyOf('Xe')).toBe('none');
  });
});

describe('a look worked out from the exhaust', () => {
  it('burns boron green', () => {
    expect(greenness(solve('b5h9', 'lox').mid)).toBeGreaterThan(greenness(solve('rp1', 'lox').mid) + 0.15);
    expect(greenness(solve('b5h9', 'lox').mid)).toBeGreaterThan(0);
  });

  it('burns lithium red', () => {
    expect(redness(solve('li', 'lf2').mid)).toBeGreaterThan(0.15);
  });

  it('makes aluminium whiter and smokier than kerosene', () => {
    const al = solve('al-slurry', 'lox');
    const rp1 = solve('rp1', 'lox');
    expect(whiteness(al.core)).toBeGreaterThan(whiteness(rp1.core));
    expect(al.smoke).toBeGreaterThan(rp1.smoke + 0.2);
    expect(al.particles).toBeGreaterThan(rp1.particles);
  });

  it('makes hydrogen with fluorine fainter than kerosene with oxygen, but still there', () => {
    expect(solve('h2', 'lf2').opacity).toBeLessThan(solve('rp1', 'lox').opacity - 0.2);
    expect(solve('h2', 'lf2').opacity).toBeGreaterThanOrEqual(0.15);
  });

  it('makes richer kerosene sootier than lean', () => {
    // Either side of the usual mixture. (The slider's whole range runs far out on the lean side,
    // so a tenth of the way along it is already lean.)
    const usual = pairRange('rp1', 'lox').ofDefault;
    const rich = solve('rp1', 'lox', usual * 0.65);
    const lean = solve('rp1', 'lox', usual * 1.3);
    expect(rich.soot).toBeGreaterThan(lean.soot + 0.2);
    expect(lean.soot).toBeLessThan(0.1);
  });

  it('leaves helium from a reactor nearly invisible but not gone', () => {
    const g = solveFluid(PROPELLANTS['ntr-helium'].fluid!, 2500, 40, 100);
    expect(g.ok).toBe(true);
    const look = lookFromExhaust({ exhaust: g.exhaust, tc: g.tc, condensedShare: g.condensedShare });
    expect(look.opacity).toBeLessThanOrEqual(0.3);
    expect(look.opacity).toBeGreaterThanOrEqual(0.15);
  });

  it('gives a look within range for every fuel with oxygen and hydrogen with every oxidiser', () => {
    const pairs: [string, string][] = [
      ...FUEL_IDS.map((f): [string, string] => [f, 'lox']),
      ...OXIDISER_IDS.filter((o) => o !== NO_OXIDISER).map((o): [string, string] => ['h2', o]),
    ];
    let checked = 0;
    for (const [fuel, ox] of pairs) {
      const g = solvePair(fuel, ox, pairRange(fuel, ox).ofDefault, 70, 16);
      if (!g.ok) continue;
      checked++;
      const look = lookFromExhaust({ exhaust: g.exhaust, tc: g.tc, condensedShare: g.condensedShare });
      for (const [name, v] of numbers(look)) {
        expect(Number.isFinite(v), `${fuel} + ${ox}: ${name}`).toBe(true);
        expect(v, `${fuel} + ${ox}: ${name}`).toBeGreaterThanOrEqual(0);
        expect(v, `${fuel} + ${ox}: ${name}`).toBeLessThanOrEqual(1);
      }
      expect(look.opacity, `${fuel} + ${ox}: opacity`).toBeGreaterThanOrEqual(0.15);
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('comes out recognisably like the hand-picked looks for the three everyday pairs', () => {
    const near = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    for (const [fuel, id] of [['rp1', 'kerolox'], ['ch4', 'methalox'], ['h2', 'hydrolox']] as const) {
      const made = solve(fuel, 'lox');
      const picked = PROPELLANTS[id].look;
      expect(near(made.core, picked.core), `${id} core`).toBeLessThan(0.35);
      expect(near(made.mid, picked.mid), `${id} mid`).toBeLessThan(0.35);
      expect(near(made.edge, picked.edge), `${id} edge`).toBeLessThan(0.45);
      expect(Math.abs(made.opacity - picked.opacity), `${id} opacity`).toBeLessThan(0.3);
      expect(Math.abs(made.soot - picked.soot), `${id} soot`).toBeLessThan(0.25);
    }
  });

  it('changes smoothly as a species comes and goes from the list', () => {
    const base = [{ name: 'H2O', share: 0.6 }, { name: 'CO2', share: 0.395 }];
    const a = lookFromExhaust({ exhaust: base, tc: 3400, condensedShare: 0 });
    const b = lookFromExhaust({ exhaust: [...base, { name: 'BO2', share: 0.005 }], tc: 3400, condensedShare: 0 });
    const before = numbers(a);
    const after = numbers(b);
    before.forEach(([name, v], i) => expect(Math.abs(v - after[i][1]), name).toBeLessThan(0.03));
  });

  it('gives a faint look, not a broken one, for an exhaust with nothing listed', () => {
    const look = lookFromExhaust({ exhaust: [], tc: 0, condensedShare: 0 });
    for (const [name, v] of numbers(look)) expect(Number.isFinite(v), name).toBe(true);
    expect(look.opacity).toBeGreaterThanOrEqual(0.15);
  });
});

describe('the line that says what is colouring the plume', () => {
  it('names the families that are there', () => {
    const g = solvePair('b5h9', 'lox', pairRange('b5h9', 'lox').ofDefault, 70, 16);
    expect(colourNote(g.exhaust)).toMatch(/^Colour: /);
    expect(colourNote(g.exhaust)).toMatch(/boron/);
  });

  it('says nothing when there is no make-up', () => {
    expect(colourNote([])).toBe('');
  });

  it('says so when the exhaust barely glows', () => {
    expect(colourNote([{ name: 'He', share: 1 }])).toBe('Colour: almost none. This exhaust barely glows.');
  });
});
