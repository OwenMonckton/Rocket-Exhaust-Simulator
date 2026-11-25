import { describe, expect, it } from 'vitest';
import { simulate } from '../physics/engine';
import { pairRange, solveFluid, solvePair } from '../physics/chem/pair';
import { PROPELLANTS } from '../physics/propellants';
import { FUEL_IDS, FUELS, NO_OXIDISER, OXIDISER_IDS, OXIDISERS, reactantOf } from '../physics/chem/ingredients';
import { SPECIES } from '../physics/chem/thermo';
import { starterEngine } from '../physics/reshape';
import type { Failure } from '../physics/types';
import { EXHAUSTS, EXHAUST_IDS } from '../physics/exhausts';
import { colourNote, familyOf } from '../physics/plumeLook';
import { COUNT_COPY, SPECIES_NAMES, STATE_COPY, TIPS, expansionText, exhaustLine, failureCopy, limitNote, showsFigures, speciesName } from './copy';

// Every gas met by sweeps of every pair across its slider (13 mixtures, five engines) and of every
// fuel with a spread of oxidisers around its best and balanced mixtures; BeOH from a review's sweep.
const SWEPT_GASES = [
  'AL', 'AL2O', 'ALCL', 'ALCL3', 'ALF', 'ALF2CL', 'ALF3', 'ALFCL2', 'B2O2', 'B2O3', 'B3O3F3', 'BF',
  'BF2', 'BF2CL', 'BF2OH', 'BF3', 'BFCL2', 'BHF2', 'BO', 'BO2', 'BOF', 'Be', 'Be(OH)2', 'Be2O',
  'Be2OF2', 'Be3O3', 'Be4O4', 'BeCL', 'BeCL2', 'BeF', 'BeF2', 'BeO', 'BeOH', 'C2F2',
  'C2H2,acetylene', 'C3', 'CF', 'CF2', 'CF3', 'CF3CL', 'CF4', 'CH4', 'CL', 'CL2', 'CLF', 'CLF3',
  'CN', 'CO', 'CO2', 'COF2', 'F', 'F2', 'H', 'H2', 'H2F2', 'H2O', 'H3B3O6', 'H6F6', 'HBO', 'HBO2',
  'HCL', 'HCN', 'HF', 'Li', 'Li2', 'Li2CL2', 'Li2F2', 'Li2O', 'Li2O2H2', 'Li3F3', 'LiCL', 'LiF',
  'LiH', 'LiO', 'LiOH', 'N2', 'NF3', 'NH3', 'NO', 'NO2F', 'NOF', 'NOF3', 'O', 'O2', 'OH',
];

describe('failure copy for the chemistry failures', () => {
  for (const kind of ['flameout', 'inert', 'detonation', 'unsolved'] as const) {
    it(`has a title and text for ${kind}`, () => {
      const copy = failureCopy(kind, 'combustion');
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.text.length).toBeGreaterThan(20);
    });
  }
  it('says that relighting unchanged goes back to the last setup that ran', () => {
    for (const kind of ['flameout', 'inert', 'unsolved'] as const) {
      for (const energy of ['combustion', 'reactor'] as const) {
        expect(failureCopy(kind, energy).text, `${kind} ${energy}`).toMatch(/last setup that ran/);
      }
    }
  });
  it('says restarting, not relighting, for a reactor, whose button reads Restart engine', () => {
    expect(failureCopy('unsolved', 'reactor').text).toMatch(/Restarting with nothing changed/);
    expect(failureCopy('unsolved', 'reactor').text).not.toMatch(/Relighting/);
  });
  it('uses the final titles', () => {
    expect(failureCopy('flameout', 'combustion').title).toBe('Flame-out');
    expect(failureCopy('inert', 'combustion').title).toBe('Nothing to burn it with');
    expect(failureCopy('detonation', 'combustion').title).toBe('Detonation');
    expect(failureCopy('unsolved', 'combustion').title).toBe('No answer');
  });
});

describe('exhaust species names', () => {
  it('gives plain names and falls back to the formula', () => {
    expect(speciesName('H2O')).toBe('Steam');
    expect(speciesName('XyZ')).toBe('XyZ');
  });
  it('tidies the formula where there is no name, so a miss reads as a formula', () => {
    expect(speciesName('ALCLF9')).toBe('AlClF9');
    expect(speciesName('C9H7,indenyl')).toBe('C9H7');
  });

  // The five test pairs, at their own mixtures in the starter engine's chamber and nozzle.
  const cfg = starterEngine();
  const eps = (cfg.exitDia / cfg.throatDia) ** 2;
  const pairs = [
    ['rp1', 'lox'],
    ['h2', 'lf2'],
    ['b5h9', 'of2'],
    ['mmh', 'n2o4'],
    ['al-slurry', 'lox'],
  ] as const;
  for (const [fuel, oxidiser] of pairs) {
    it(`names everything in the ${fuel} and ${oxidiser} exhaust`, () => {
      const gas = solvePair(fuel, oxidiser, pairRange(fuel, oxidiser).ofDefault, cfg.chamberPressureBar, eps);
      expect(gas.ok).toBe(true);
      expect(gas.exhaust.length).toBeGreaterThan(0);
      for (const { name } of gas.exhaust) expect(SPECIES_NAMES, name).toHaveProperty([name]);
    });
  }

  // Every fuel with a spread of oxidisers, and every oxidiser with a spread of fuels, around the
  // balanced mixture worked out from the ingredients' valences (at 0.3, 0.6, 1 and 1.8 times it), in a
  // small hot nozzle and a large cold one; each fuel alone too. A sample, as any sweep is: the list
  // below is what makes the guarantee for gases.
  const VALENCE: Record<string, number> = { C: 4, H: 1, B: 3, Al: 3, Be: 2, Li: 1, O: -2, F: -1, Cl: -1, N: 0 };
  const valence = (parts: { reactant: string; share: number }[]) => parts.reduce((sum, p) => {
    const r = reactantOf(p.reactant);
    return sum + (p.share / r.molarMass) * Object.entries(r.elements).reduce((v, [e, k]) => v + (VALENCE[e] ?? 0) * k, 0);
  }, 0);
  const balanced = (f: string, o: string) => {
    const vf = valence(FUELS[f].parts), vo = valence(OXIDISERS[o].parts);
    return vf > 0 && vo < 0 ? -vf / vo : 1;
  };
  it('names everything any pair is likely to put in its exhaust', () => {
    const OX = ['lox', 'lf2', 'n2o4', 'clf3', 'htp98', 'nf3'];
    const FU = ['h2', 'rp1', 'b2h6', 'al-slurry', 'be', 'li', 'nh3'];
    const pairs = new Set<string>();
    for (const f of FUEL_IDS) for (const o of [...OX, NO_OXIDISER]) pairs.add(`${f}|${o}`);
    for (const o of OXIDISER_IDS) if (o !== NO_OXIDISER) for (const f of FU) pairs.add(`${f}|${o}`);
    const unnamed = new Map<string, string>();
    for (const pair of pairs) {
      const [f, o] = pair.split('|');
      const s = o === NO_OXIDISER ? 0 : balanced(f, o);
      for (const m of o === NO_OXIDISER ? [1] : [0.3, 0.6, 1, 1.8]) {
        for (const [pc, area] of [[10, 3], [30, 150]]) {
          const gas = solvePair(f, o, s * m, pc, area);
          for (const { name } of gas.exhaust) if (!Object.hasOwn(SPECIES_NAMES, name)) unnamed.set(name, `${f}/${o} at ${(s * m).toFixed(2)}`);
        }
      }
    }
    expect(Object.fromEntries(unnamed)).toEqual({});
  }, 60_000);

  it('names every liquid and solid in the data, and every gas a sweep of the sliders has met', () => {
    const condensed = SPECIES.filter((sp) => sp.phase !== 0).map((sp) => sp.name);
    expect(condensed.length).toBeGreaterThan(0);
    for (const name of condensed) expect(SPECIES_NAMES, name).toHaveProperty([name]);
    // Naming all 427 gases would be most of them never met; these are the ones sweeps of every pair
    // across its slider in five engines, and of every fuel with a spread of oxidisers around its
    // best and balanced mixtures, have reported. A gas met nowhere here is still caught by the sweep
    // above if it is common, and otherwise reads as a tidied formula.
    for (const name of SWEPT_GASES) {
      expect(SPECIES.find((sp) => sp.name === name)?.phase, name).toBe(0);
      expect(SPECIES_NAMES, name).toHaveProperty([name]);
    }
  });

  // The five reactor fluids the solver works out, across their core temperatures, pressures and nozzles.
  const FLUIDS = ['ntr-ammonia', 'ntr-methane', 'ntr-water', 'ntr-co2', 'ntr-helium'] as const;
  for (const id of FLUIDS) {
    it(`names everything in the ${id} exhaust`, () => {
      const p = PROPELLANTS[id];
      expect(p.fluid, id).toBeTruthy();
      const unnamed = new Set<string>();
      let solves = 0;
      for (const tK of [p.ofMin, p.ofDefault, p.ofMax]) {
        for (const [pcBar, area] of [[40, 100], [70, 16]]) {
          const gas = solveFluid(p.fluid!, tK, pcBar, area);
          if (!gas.ok) continue;
          solves++;
          for (const { name } of gas.exhaust) if (!Object.hasOwn(SPECIES_NAMES, name)) unnamed.add(name);
        }
      }
      expect(solves, id).toBeGreaterThan(0);
      expect([...unnamed], id).toEqual([]);
    });
  }

  it('writes the exhaust as plain names with shares, without touching the list', () => {
    const exhaust = Object.freeze([
      Object.freeze({ name: 'H2O', share: 0.634 }),
      Object.freeze({ name: 'H2', share: 0.291 }),
      Object.freeze({ name: 'OH', share: 0.004 }),
    ]) as { name: string; share: number }[];
    expect(exhaustLine(exhaust)).toBe('Steam 63% · Hydrogen 29% · Hydroxyl (OH) <1% · …');
    expect(exhaustLine([])).toBe('');
  });

  it('adds up species that share a plain name, without touching the list', () => {
    const exhaust = Object.freeze([
      Object.freeze({ name: 'BeO(a)', share: 0.3 }),
      Object.freeze({ name: 'H2', share: 0.25 }),
      Object.freeze({ name: 'BeO(b)', share: 0.2 }),
      Object.freeze({ name: 'H2O', share: 0.248 }),
    ]) as { name: string; share: number }[];
    expect(exhaustLine(exhaust)).toBe('Solid beryllium oxide 50% · Hydrogen 25% · Steam 25%');
    expect(exhaust.map((e) => e.name)).toEqual(['BeO(a)', 'H2', 'BeO(b)', 'H2O']);
  });
});

describe('showsFigures', () => {
  const sl = { altitudeKm: 0, throttle: 1 };
  const base = simulate(starterEngine(), sl);
  const as = (failure: Failure, settled: boolean) => ({ ...base, failure, settled });
  it('shows the figures exactly when the gas settled, whatever the failure', () => {
    expect(showsFigures(as('unsolved', false))).toBe(false);
    expect(showsFigures(as('detonation', false))).toBe(false);
    expect(showsFigures(as('inert', false))).toBe(false);
    expect(showsFigures(as('detonation', true))).toBe(true);
    expect(showsFigures(as('flameout', true))).toBe(true);
    expect(showsFigures(as('burst', true))).toBe(true);
    expect(showsFigures(as(null, true))).toBe(true);
  });
  it('hides them for RP-1 with nothing to burn it', () => {
    expect(showsFigures(simulate({ ...starterEngine(), oxidiser: 'none' }, sl))).toBe(false);
  });
});

describe('the line under the limit bars', () => {
  const base = simulate(starterEngine(), { altitudeKm: 0, throttle: 1 });
  const as = (failure: Failure, settled: boolean) => limitNote({ ...base, failure, settled });
  it('names the failure the engine actually has', () => {
    expect(as(null, true)).toBe('');
    expect(as('flameout', true)).toBe('This mixture will not keep burning.');
    expect(as('inert', false)).toBe('Nothing here will burn.');
    expect(as('unsolved', false)).toBe('No figures: the chemistry would not settle.');
    expect(as('burst', true)).toBe('Past a limit: this engine will fail when fired.');
    expect(as('detonation', true)).toBe('A propellant here would explode in the engine.');
  });
  it('says a detonation is one, settled or not', () => {
    expect(as('detonation', false)).toBe('A propellant here would explode in the engine.');
  });
});

describe('unsolved wording', () => {
  it('speaks of the core temperature, not a mixture ratio, for a reactor', () => {
    for (const energy of ['reactor', 'saltwater'] as const) {
      const copy = failureCopy('unsolved', energy);
      expect(copy.title).toBe('No answer');
      expect(copy.text).not.toMatch(/mixture ratio/);
      expect(copy.text).toMatch(/temperature/);
    }
    expect(failureCopy('unsolved', 'combustion').text).toMatch(/mixture ratio/);
  });
});

describe('copy for the new exhausts', () => {
  it('has a tip for each new slider and words for a held jet', () => {
    expect(TIPS.coneAngleDeg.length).toBeGreaterThan(20);
    expect(TIPS.innerExitDia.length).toBeGreaterThan(20);
    expect(STATE_COPY.held.label.length).toBeGreaterThan(0);
    expect(STATE_COPY.held.text).toMatch(/kink/i);
  });
  it('says which mode a dual bell is in', () => {
    const big = { ...starterEngine(), chamberPressureBar: 60, exitDia: 10 * starterEngine().throatDia, exhaust: 'dualBell' as const };
    const low = simulate(big, { altitudeKm: 0, throttle: 1 });
    const high = simulate(big, { altitudeKm: 100, throttle: 1 });
    expect(expansionText(low, 'dualBell')).toBe(STATE_COPY.held.text);
    expect(expansionText(high, 'dualBell')).toMatch(/outer bell/i);
    expect(expansionText(simulate(starterEngine(), { altitudeKm: 0, throttle: 1 }), 'bell')).not.toMatch(/outer bell/i);
  });
  it('does not say the jet fills the outer bell when it has torn away', () => {
    const t = starterEngine().throatDia;
    const cfg = { ...starterEngine(), chamberPressureBar: 12, exitDia: 10 * t, innerExitDia: 8 * t, exhaust: 'dualBell' as const };
    const r = simulate(cfg, { altitudeKm: 0, throttle: 1 });
    expect(r.state).toBe('separated');
    expect(expansionText(r, 'dualBell')).toBe(STATE_COPY.separated.text);
  });
  it('does not talk about the nozzle of an engine with no nozzle', () => {
    const cfg = { ...starterEngine(), exhaust: 'none' as const };
    const r = simulate(cfg, { altitudeKm: 0, throttle: 1 });
    expect(r.state).toBe('under');
    for (const state of ['under', 'ideal', 'over'] as const) {
      const text = expansionText({ ...r, state }, 'none');
      expect(text, state).toMatch(/no nozzle/i);
      expect(text, state).not.toMatch(/(the|this) nozzle/i);
    }
    expect(TIPS.exhaust).not.toMatch(/as powerful/i);
  });
  it('names what the count slider counts for every exhaust', () => {
    for (const id of EXHAUST_IDS) expect(COUNT_COPY[EXHAUSTS[id].counts].label.length).toBeGreaterThan(0);
  });
});

describe('the colour line beside the exhaust\u2019s make-up', () => {
  type Listed = readonly { name: string; share: number }[];
  /** What each thing the line can name must find in the make-up beside it, by the solver's species names. */
  const NAMED: [RegExp, (e: Listed) => boolean][] = [
    [/steam/, (e) => e.some((x) => x.name.startsWith('H2O'))],
    [/carbon monoxide|unburnt carbon/, (e) => e.some((x) => x.name === 'CO')],
    [/carbon dioxide/, (e) => e.some((x) => x.name === 'CO2')],
    [/hydrogen fluoride/, (e) => e.some((x) => x.name === 'HF')],
    [/chloride/, (e) => e.some((x) => x.name === 'HCL')],
    [/hydrogen(?! fluoride| chloride)/, (e) => e.some((x) => x.name === 'H2' || x.name === 'H')],
    [/oxygen/, (e) => e.some((x) => ['O2', 'O', 'OH'].includes(x.name))],
    [/soot/, (e) => e.some((x) => familyOf(x.name) === 'soot')],
    [/boron/, (e) => e.some((x) => familyOf(x.name) === 'boron')],
    [/lithium/, (e) => e.some((x) => familyOf(x.name) === 'lithium')],
    [/aluminium oxide/, (e) => e.some((x) => x.name.startsWith('AL2O'))],
    [/aluminium/, (e) => e.some((x) => familyOf(x.name) === 'aluminium')],
    [/beryllium oxide/, (e) => e.some((x) => x.name.startsWith('BeO') || x.name.startsWith('Be2O') || x.name.startsWith('Be3O') || x.name.startsWith('Be4O'))],
    [/beryllium/, (e) => e.some((x) => familyOf(x.name) === 'beryllium')],
    [/chlorine/, (e) => e.some((x) => familyOf(x.name) === 'chlorine')],
    [/halogen/, (e) => e.some((x) => familyOf(x.name) === 'halide')],
    [/nitrogen oxide/, (e) => e.some((x) => familyOf(x.name) === 'nitrogenOxide')],
    [/carbon and nitrogen/, (e) => e.some((x) => familyOf(x.name) === 'cyanogen')],
  ];
  const holds = (note: string, exhaust: Listed, label: string) => {
    expect(note, label).toMatch(/^Colour: [^.]+\.( This exhaust barely glows\.)?$/);
    let matched = 0;
    for (const [word, held] of NAMED) {
      if (!word.test(note)) continue;
      matched++;
      expect(held(exhaust), `${label}: "${note}" names ${word}`).toBe(true);
    }
    if (!/almost none/.test(note)) expect(matched, `${label}: "${note}" names nothing known`).toBeGreaterThan(0);
  };

  it('never names a thing the make-up beside it does not hold, for pairs that burn', () => {
    const pairs = [['rp1', 'lox'], ['ch4', 'lox'], ['h2', 'lox'], ['b5h9', 'lox'], ['li', 'lf2'], ['al-slurry', 'lox'],
      ['h2', 'lf2'], ['n2h4', 'n2o4'], ['nh3', 'clf3'], ['c2n2', 'lox'], ['be', 'lox'], ['b2h6', 'of2']] as const;
    for (const [fuel, ox] of pairs) {
      const usual = pairRange(fuel, ox).ofDefault;
      // Rich, usual and lean: what is listed changes with the mixture.
      for (const k of [0.6, 1, 1.8]) {
        const g = solvePair(fuel, ox, usual * k, 70, 16);
        if (!g.ok) continue;
        holds(colourNote(g.exhaust), g.exhaust, `${fuel} + ${ox} at ${k}x`);
      }
    }
  });

  it('never names a thing the make-up beside it does not hold, for a reactor\u2019s fluids', () => {
    for (const id of ['ntr-ammonia', 'ntr-methane', 'ntr-water', 'ntr-co2', 'ntr-helium'] as const) {
      const g = solveFluid(PROPELLANTS[id].fluid!, 2500, 40, 100);
      expect(g.ok, id).toBe(true);
      holds(colourNote(g.exhaust), g.exhaust, id);
    }
  });

  it('says carbon dioxide, not carbon monoxide, where carbon dioxide is all there is', () => {
    expect(colourNote([{ name: 'CO2', share: 1 }])).toBe('Colour: the blue-violet glow of hot carbon dioxide.');
  });

  it('says hydrogen, not steam, where there is no steam', () => {
    const note = colourNote([{ name: 'H2', share: 0.74 }, { name: 'N2', share: 0.25 }]);
    expect(note).toMatch(/hydrogen/);
    expect(note).not.toMatch(/steam/);
  });

  it('names only the halide that is listed', () => {
    const note = colourNote([{ name: 'HF', share: 0.76 }, { name: 'H2', share: 0.24 }]);
    expect(note).toMatch(/hydrogen fluoride/);
    expect(note).not.toMatch(/chloride/);
  });

  it('calls implied soot unburnt carbon, and listed soot soot', () => {
    const kerosene = solvePair('rp1', 'lox', pairRange('rp1', 'lox').ofDefault, 70, 16).exhaust;
    expect(kerosene.some((e) => e.name === 'C(gr)')).toBe(false);
    expect(colourNote(kerosene)).toMatch(/unburnt carbon/);
    expect(colourNote(kerosene)).not.toMatch(/soot/);
    expect(colourNote([{ name: 'H2', share: 0.6 }, { name: 'C(gr)', share: 0.4 }])).toMatch(/soot glowing orange/);
  });
});
