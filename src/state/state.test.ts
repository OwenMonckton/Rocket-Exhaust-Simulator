import { describe, expect, it } from 'vitest';
import { RANGES, sanitize, simulate } from '../physics/engine';
import { PRESETS, getPreset } from '../physics/presets';
import { decodeState, encodeState } from './share';
import { starterEngine } from '../physics/reshape';
import { pairRange } from '../physics/chem/pair';
import { applyScale, createStore, defaultState, isModified } from './store';

describe('share links', () => {
  it('round-trips every preset', () => {
    for (const p of PRESETS) {
      const s = { config: p.config, flight: { altitudeKm: 12.5, throttle: 0.7 } };
      expect(decodeState(encodeState(s))).toEqual(s);
      expect(decodeState('#' + encodeState(s))).toEqual(s);
    }
  });
  it('round-trips a custom engine with no preset', () => {
    const s = { config: { ...PRESETS[0].config, presetId: null, chamberPressureBar: 123 }, flight: { altitudeKm: 0, throttle: 1 } };
    expect(decodeState(encodeState(s))).toEqual(s);
  });
  it('reads links made before multi-chamber engines as single-chamber', () => {
    const old = 'v1.' + btoa(JSON.stringify(['merlin-1d', 'kerolox', 0.45, 0.38, 0.26, 1.06, 80, 0.012, 97, 2.36, 1, 0, 1]));
    expect(decodeState(old)!.config.chambers).toBe(1);
    const four = decodeState(encodeState({ config: getPreset('rd-170')!.config, flight: { altitudeKm: 0, throttle: 1 } }))!;
    expect(four.config.chambers).toBe(4);
    const silly = 'v1.' + btoa(JSON.stringify(['merlin-1d', 'kerolox', 0.45, 0.38, 0.26, 1.06, 80, 0.012, 97, 2.36, 1, 0, 1, 99.7]));
    expect(decodeState(silly)!.config.chambers).toBe(4);
    // A half-deployed nozzle extension survives a share link.
    const half = { config: { ...getPreset('rl10b-2')!.config, extDeploy: 0.5 }, flight: { altitudeKm: 100, throttle: 1 } };
    expect(decodeState(encodeState(half))).toEqual(half);
    expect(decodeState(old)!.config.extFixedDia).toBe(0);
    expect(decodeState(old)!.config.exhaust).toBe('bell');
    // Links made before aerospikes have 16 entries.
    const bellLink = 'v1.' + btoa(JSON.stringify(['rd-170', 'kerolox', 0.4, 0.4, 0.25, 1.4, 80, 0.012, 245, 2.63, 1, 0, 1, 4, 0, 1]));
    expect(decodeState(bellLink)!.config.exhaust).toBe('bell');
    const spike = decodeState(encodeState({ config: getPreset('xrs-2200')!.config, flight: { altitudeKm: 0, throttle: 1 } }))!;
    expect(spike.config.exhaust).toBe('aerospike');
    expect(spike.config.chambers).toBe(20);
    expect(decodeState(old)!.config.extDeploy).toBe(1);
  });
  it('reads old links by working the three parts out from the old propellant', () => {
    const v1 = (propellant: string, spike: number) =>
      decodeState('v1.' + btoa(JSON.stringify(['x', propellant, 0.45, 0.38, 0.26, 1.06, 80, 0.012, 97, 2400, 1, 0, 1, 1, 0, 1, spike])))!.config;
    expect(v1('nuclear', 0)).toMatchObject({ energy: 'reactor', propellant: 'ntr-hydrogen', exhaust: 'bell' });
    expect(v1('saltwater', 0)).toMatchObject({ energy: 'saltwater', propellant: 'saltwater' });
    expect(v1('solid', 0)).toMatchObject({ energy: 'solid', propellant: 'solid' });
    expect(v1('hydrolox', 1)).toMatchObject({ energy: 'combustion', propellant: 'hydrolox', exhaust: 'aerospike' });
  });
  it('writes links that carry the three parts', () => {
    const text = encodeState({ config: getPreset('nerva')!.config, flight: { altitudeKm: 100, throttle: 1 } });
    expect(text.startsWith('v3.')).toBe(true);
    const packed = JSON.parse(atob(text.slice(3).replace(/-/g, '+').replace(/_/g, '/')));
    expect(packed).toHaveLength(20);
    expect(packed.slice(0, 4)).toEqual(['nerva', 'reactor', 'bell', 'ntr-hydrogen']);
    expect(packed.slice(4, 6)).toEqual([getPreset('nerva')!.config.fuel, getPreset('nerva')!.config.oxidiser]);
  });
  it('round-trips a calculated engine with its fuel, oxidiser and mixture', () => {
    const config = sanitize({ ...PRESETS[0].config, presetId: null, propellant: 'calculated', fuel: 'b5h9', oxidiser: 'of2', mixtureRatio: 3.1 });
    expect(config).toMatchObject({ propellant: 'calculated', fuel: 'b5h9', oxidiser: 'of2', mixtureRatio: 3.1 });
    const s = { config, flight: { altitudeKm: 0, throttle: 1 } };
    expect(decodeState(encodeState(s))).toEqual(s);
  });
  it('reads v1 and v2 links exactly as before, with the tabled pair filled in (review focus 5)', () => {
    // Expected engines are what the links decoded to before Task 10 (share.ts at cb88400).
    const nums = [0.45, 0.38, 0.26, 1.06, 80, 0.012, 97, 2.36, 1, 0, 1, 1, 0, 1];
    const shape = { chamberDia: 0.45, chamberLen: 0.38, throatDia: 0.26, exitDia: 1.06, nozzleLenPct: 80, wall: 0.012, chamberPressureBar: 97, scale: 1, chambers: 1, extFixedDia: 0, extDeploy: 1 };
    const flight = { altitudeKm: 0, throttle: 1 };
    const v2 = decodeState('v2.' + btoa(JSON.stringify([null, 'combustion', 'bell', 'kerolox', ...nums])))!;
    expect(v2).toEqual({ config: { presetId: null, energy: 'combustion', exhaust: 'bell', propellant: 'kerolox', fuel: 'rp1', oxidiser: 'lox', mixtureRatio: 2.36, ...shape }, flight });
    const v1 = decodeState('v1.' + btoa(JSON.stringify(['merlin-1d', 'hydrolox', 0.45, 0.38, 0.26, 1.06, 80, 0.012, 97, 6, 1, 0, 1])))!;
    expect(v1).toEqual({ config: { presetId: 'merlin-1d', energy: 'combustion', exhaust: 'bell', propellant: 'hydrolox', fuel: 'h2', oxidiser: 'lox', mixtureRatio: 6, ...shape }, flight });
  });
  it('opens a v3 link with an unknown or malformed fuel or oxidiser, sanitised, and refuses a wrong length (review focus 5)', () => {
    const calc = sanitize({ ...PRESETS[0].config, presetId: null, propellant: 'calculated', fuel: 'b5h9', oxidiser: 'of2', mixtureRatio: 3.1 });
    const good = encodeState({ config: calc, flight: { altitudeKm: 0, throttle: 1 } });
    const packed = JSON.parse(atob(good.slice(3).replace(/-/g, '+').replace(/_/g, '/'))) as unknown[];
    expect(packed.slice(3, 6)).toEqual(['calculated', 'b5h9', 'of2']);
    const link = (a: unknown[]) => 'v3.' + btoa(JSON.stringify(a));
    const edit = (fuel: unknown, oxidiser: unknown) => {
      const e = [...packed];
      e[4] = fuel;
      e[5] = oxidiser;
      return decodeState(link(e));
    };
    expect(edit('xyz', 'abc')!.config).toMatchObject({ propellant: 'calculated', fuel: 'rp1', oxidiser: 'lox' });
    for (const bad of [7, null, {}, 'toString']) expect(edit(bad, bad)!.config, String(bad)).toMatchObject({ propellant: 'calculated', fuel: 'rp1', oxidiser: 'lox' });
    expect(decodeState(link(packed.slice(0, 18)))).toBeNull();
    expect(decodeState(link([...packed, 1]))).toBeNull();
  });
  it('opens a link whose propellant does not suit its energy source (review focus)', () => {
    const v2 = (a: unknown[]) => decodeState('v2.' + btoa(JSON.stringify(a)));
    const nums = [0.45, 0.38, 0.26, 1.06, 80, 0.012, 97, 2.36, 1, 0, 1, 1, 0, 1];
    const odd = v2([null, 'reactor', 'bell', 'kerolox', ...nums])!;
    expect(odd.config.energy).toBe('reactor');
    expect(odd.config.propellant).toBe('ntr-hydrogen');
    expect(v2([null, 'steam', 'bell', 'kerolox', ...nums])).toBeNull();
    expect(v2([null, 'combustion', 'funnel', 'kerolox', ...nums])).toBeNull();
    expect(v2([null, 'combustion', 'bell', 'jam', ...nums])).toBeNull();
    expect(v2([null, 'combustion', 'bell', 'kerolox', ...nums, 7])).toBeNull();
  });
  it('rejects garbage without throwing (review focus)', () => {
    const good = encodeState(defaultState());
    const bad = ['', '#', 'v1.', 'v1.!!!', 'v9.abc', 'hello', good.slice(0, 20), good.slice(0, -7), 'v1.' + btoa('{"a":1}'), 'v1.' + btoa('[1,2,3]')];
    for (const b of bad) expect(decodeState(b), b).toBeNull();
    expect(decodeState(undefined as never)).toBeNull();
    const pack = (a: unknown[]) => 'v1.' + btoa(JSON.stringify(a));
    expect(decodeState(pack(['merlin-1d', 'kerolox', '0.4', 1, 1, 1, 80, 0.01, 100, 2.4, 1, 0, 1]))).toBeNull();
    expect(decodeState(pack(['merlin-1d', 'plutonium', 0.4, 1, 1, 1, 80, 0.01, 100, 2.4, 1, 0, 1]))).toBeNull();
  });
  it('clamps out-of-range numbers and unknown presets', () => {
    const wild = 'v1.' + btoa(JSON.stringify(['not-a-preset', 'kerolox', 1e9, -4, 1e9, 0, 500, 0, 1e9, 99, 1e9, 1e9, -3]));
    const s = decodeState(wild)!;
    expect(s.config.presetId).toBeNull();
    expect(s.config.chamberDia).toBe(RANGES.chamberDia.max);
    expect(s.config.chamberPressureBar).toBe(RANGES.chamberPressureBar.max);
    expect(s.config.throatDia).toBeLessThan(s.config.chamberDia);
    expect(s.flight.altitudeKm).toBe(100);
    expect(s.flight.throttle).toBe(0.4);
    const r = simulate(s.config, s.flight);
    expect(Number.isFinite(r.thrust)).toBe(true);
  });
});

describe('store', () => {
  it('scales the whole engine and back again', () => {
    const cfg = getPreset('merlin-1d')!.config;
    const back = applyScale(applyScale(cfg, 2), 1);
    for (const k of ['chamberDia', 'chamberLen', 'throatDia', 'exitDia', 'wall'] as const) {
      expect(back[k]).toBeCloseTo(cfg[k], 9);
    }
    expect(applyScale(cfg, 2).throatDia).toBeCloseTo(cfg.throatDia * 2, 9);
    expect(applyScale(cfg, 99).scale).toBe(5);
  });
  it('tracks modification against the stock preset', () => {
    const store = createStore(defaultState());
    store.loadPreset('merlin-1d');
    expect(isModified(store.get().config)).toBe(false);
    store.set({ config: { chamberPressureBar: 120 } });
    expect(isModified(store.get().config)).toBe(true);
    store.loadPreset('rs-25');
    expect(isModified(store.get().config)).toBe(false);
    expect(store.get().config.propellant).toBe('hydrolox');
    store.setScale(2);
    expect(isModified(store.get().config)).toBe(true);
    store.setScale(1);
    expect(isModified(store.get().config)).toBe(false);
  });
  it('calculates from a chosen fuel or oxidiser and resets to stock', () => {
    const store = createStore(defaultState());
    store.loadPreset('merlin-1d');
    store.setFuel('ch4');
    expect(store.get().config).toMatchObject({ propellant: 'calculated', fuel: 'ch4', oxidiser: 'lox' });
    expect(store.get().config.mixtureRatio).toBe(pairRange('ch4', 'lox').ofDefault);
    expect(isModified(store.get().config)).toBe(true);
    store.setFuel('rp1');
    expect(store.get().config.propellant).toBe('calculated');
    expect(isModified(store.get().config)).toBe(true);
    store.setOxidiser('of2');
    expect(store.get().config).toMatchObject({ oxidiser: 'of2', mixtureRatio: pairRange('rp1', 'of2').ofDefault });
    store.loadPreset('merlin-1d');
    expect(store.get().config.propellant).toBe('kerolox');
    expect(isModified(store.get().config)).toBe(false);
  });
  it('turns the chamber pressure down when a hotter fuel and oxidiser would burn through', () => {
    const sl = { altitudeKm: 0, throttle: 1 };
    const starter = starterEngine();
    // The same engine at twice the pressure, with a wall to match: fine on RP-1 and oxygen.
    const config = sanitize({ ...starter, chamberPressureBar: 200, wall: starter.wall * 2 });
    expect(simulate(config, sl).failure).toBeNull();
    // Beryllium with fluorine, set straight into it, burns through.
    const forced = sanitize({ ...config, fuel: 'be', oxidiser: 'lf2', mixtureRatio: pairRange('be', 'lf2').ofDefault });
    expect(simulate(forced, sl).failure).toBe('burnthrough');
    // Picked through the store, the engine is turned down instead of being destroyed by the swap.
    const store = createStore({ config, flight: sl });
    store.setFuel('be');
    store.setOxidiser('lf2');
    const picked = store.get().config;
    expect(picked).toMatchObject({ fuel: 'be', oxidiser: 'lf2', propellant: 'calculated' });
    expect(picked.mixtureRatio).toBeCloseTo(pairRange('be', 'lf2').ofDefault, 6);
    expect(picked.chamberPressureBar).toBeLessThan(200);
    expect(simulate(picked, sl).failure).toBeNull();
  });

  it('leaves a reactor or solid engine alone when a fuel or oxidiser is picked', () => {
    const store = createStore(defaultState());
    store.loadPreset('nerva');
    store.set({ config: { propellant: 'ntr-ammonia', mixtureRatio: 2600 } });
    const before = store.get().config;
    expect(before.propellant).toBe('ntr-ammonia');
    store.setFuel('ch4');
    store.setOxidiser('of2');
    expect(store.get().config).toEqual(before);
    store.loadPreset('solid-booster');
    const solid = store.get().config;
    store.setFuel('ch4');
    store.setOxidiser('of2');
    expect(store.get().config).toEqual(solid);
  });
  it('opens on a blank engine tied to no example', () => {
    expect(defaultState().config).toEqual(starterEngine());
    expect(defaultState().config.presetId).toBeNull();
    expect(isModified(defaultState().config)).toBe(false);
  });
  it('swaps parts on an example and still knows which example it was', () => {
    const store = createStore(defaultState());
    let calls = 0;
    store.subscribe(() => calls++);
    store.loadPreset('merlin-1d');
    store.setEnergy('reactor');
    expect(store.get().config).toMatchObject({ presetId: 'merlin-1d', energy: 'reactor', propellant: 'ntr-hydrogen' });
    expect(isModified(store.get().config)).toBe(true);
    store.setExhaust('aerospike');
    expect(store.get().config).toMatchObject({ exhaust: 'aerospike', chambers: 20 });
    store.set({ flight: { altitudeKm: 40 } });
    store.newEngine();
    expect(store.get().config).toEqual(starterEngine());
    expect(store.get().flight.altitudeKm).toBe(40);
    expect(calls).toBe(5);
  });
  it('resets mixture ratio when the propellant changes and notifies subscribers', () => {
    const store = createStore(defaultState());
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.set({ config: { propellant: 'hydrolox' } });
    expect(store.get().config.mixtureRatio).toBe(6);
    store.set({ flight: { altitudeKm: 500 } });
    expect(store.get().flight.altitudeKm).toBe(100);
    expect(calls).toBe(2);
    off();
    store.set({ flight: { throttle: 0.5 } });
    expect(calls).toBe(2);
  });
});

describe('part swaps through the store (code review)', () => {
  it('does not lower the pressure again each time a throttled engine goes to a solid and back', () => {
    const store = createStore(defaultState());
    store.set({ flight: { throttle: 0.4 } });
    const running = (s = store.get()) => simulate(s.config, s.flight).limits.structural;
    const before = running();
    store.setEnergy('solid');
    expect(store.get().config.chamberPressureBar).toBe(40);
    // The throttle it was at is now its pressure, so the throttle goes back to full.
    expect(store.get().flight.throttle).toBe(1);
    store.setEnergy('combustion');
    expect(store.get().config.chamberPressureBar).toBe(40);
    expect(running()).toBeCloseTo(before, 2);
    store.setEnergy('solid');
    expect(store.get().config.chamberPressureBar).toBe(40);
  });

  it('checks the heat when the propellant is changed', () => {
    const store = createStore(defaultState());
    store.setEnergy('reactor');
    store.set({ config: { throatDia: 0.02, chamberDia: 0.12, exitDia: 0.08, wall: 0.016, chamberPressureBar: 400, mixtureRatio: 1500 } });
    expect(simulate(store.get().config, store.get().flight).failure).toBeNull();
    store.set({ config: { propellant: 'ntr-ammonia' } });
    expect(store.get().config.propellant).toBe('ntr-ammonia');
    expect(simulate(store.get().config, store.get().flight).failure).toBeNull();
  });
});
