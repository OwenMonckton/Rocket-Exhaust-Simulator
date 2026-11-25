import { describe, expect, it } from 'vitest';
import { engineProfile, plugRadius } from '../render/geometry';
import { decodeState, encodeState } from '../state/share';
import { shapeHidden } from '../ui/controls';
import { expansionText, STATE_COPY } from '../ui/copy';
import { RANGES, edBaseDrag, edCompensation, sanitize, simulate } from './engine';
import { EXHAUSTS, EXHAUST_IDS, divergingWall, lipSlope, ringWallRadius } from './exhausts';
import { starterEngine, withExhaust } from './reshape';
import type { EngineConfig } from './types';

/** The starter engine with an expansion-deflection nozzle. */
const ed = (patch: Partial<EngineConfig> = {}): EngineConfig =>
  sanitize({ ...starterEngine(), exhaust: 'expansionDeflection', ...patch });
/** Sizes with room for any plug: a wide chamber and a wide exit. (The starter engine's chamber is only 1.7 throats wide.) */
const roomy = { chamberDia: starterEngine().throatDia * 2.5, exitDia: starterEngine().throatDia * 6 };

describe('the expansion-deflection nozzle as a part', () => {
  it('is in the menu, counts chambers, has a nozzle and takes no extension', () => {
    expect(EXHAUST_IDS).toContain('expansionDeflection');
    const type = EXHAUSTS.expansionDeflection;
    expect(type.counts).toBe('chambers');
    expect(type.hasNozzle).toBe(true);
    expect(type.extension).toBe(false);
    expect(type.sliders).toEqual({ exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: false, plugShare: true });
  });

  it('shows the plug slider for this type alone', () => {
    for (const id of EXHAUST_IDS) expect(EXHAUSTS[id].sliders.plugShare, id).toBe(id === 'expansionDeflection');
    for (const id of EXHAUST_IDS) {
      const state = { config: sanitize({ ...starterEngine(), exhaust: id }), flight: { altitudeKm: 0, throttle: 1 } };
      expect(shapeHidden('plugShare')(state), id).toBe(id !== 'expansionDeflection');
    }
  });

  it('keeps the ring the size of the throat at every plug size', () => {
    for (const plugShare of [0.4, 0.55, 0.7, 0.8]) {
      const cfg = ed({ ...roomy, plugShare });
      expect(cfg.plugShare).toBe(plugShare);
      const wall = ringWallRadius(cfg);
      const plug = wall * cfg.plugShare;
      expect(Math.PI * (wall ** 2 - plug ** 2)).toBeCloseTo(Math.PI * (cfg.throatDia / 2) ** 2, 9);
    }
  });

  it('gives every other exhaust a plain throat for its wall', () => {
    for (const id of EXHAUST_IDS) {
      if (id === 'expansionDeflection') continue;
      const cfg = sanitize({ ...starterEngine(), exhaust: id });
      expect(ringWallRadius(cfg), id).toBe(cfg.throatDia / 2);
    }
  });

  it('starts the bell at the wall of the ring and widens all the way to the mouth', () => {
    const cfg = ed();
    const { points, length } = divergingWall(cfg);
    const wall = ringWallRadius(cfg);
    // The first point is just past the ring, a little way round the throat's arc.
    expect(points[0].r).toBeGreaterThan(wall);
    expect(points[0].r).toBeLessThan(wall * 1.05);
    for (let i = 1; i < points.length; i++) expect(points[i].r).toBeGreaterThan(points[i - 1].r);
    expect(points[points.length - 1]).toEqual({ x: length, r: cfg.exitDia / 2 });
    expect(lipSlope(cfg)).toBeGreaterThan(0);
  });
});

describe('sanitize: the plug', () => {
  it('has the range the design gives it', () => {
    expect(RANGES.plugShare).toEqual({ min: 0.4, max: 0.8, fallback: 0.7 });
  });

  it('clamps the plug to its range, on this exhaust and on any other', () => {
    expect(ed({ ...roomy, plugShare: 0.1 }).plugShare).toBe(0.4);
    expect(ed({ ...roomy, plugShare: Number.NaN }).plugShare).toBe(0.7);
    expect(ed({ ...roomy, plugShare: 0.99 }).plugShare).toBe(0.8);
    // Another exhaust keeps the setting for a swap back, and does nothing with it.
    expect(sanitize({ ...starterEngine(), plugShare: 0.5 }).plugShare).toBe(0.5);
    expect(sanitize({ ...starterEngine(), plugShare: 7 }).plugShare).toBe(0.8);
    expect(sanitize({ ...starterEngine(), exitDia: starterEngine().throatDia * 1.05, plugShare: 0.8 }).plugShare).toBe(0.8);
  });

  it('shrinks the plug to its smallest, then widens the exit, when the exit is too small for it', () => {
    const throat = starterEngine().throatDia;
    const tight = ed({ ...roomy, plugShare: 0.8, exitDia: throat * 1.05 });
    expect(tight.plugShare).toBe(0.4);
    expect(tight.exitDia).toBeGreaterThanOrEqual(2 * ringWallRadius(tight) * 1.15 - 1e-9);
    expect(tight.exitDia).toBeGreaterThan(throat * 1.05);
  });

  it('shrinks the plug only as far as it must', () => {
    const throat = starterEngine().throatDia;
    // An exit 1.8 throats wide leaves room for a wall 1.565 throats wide at the ring: a plug of about 0.77.
    const some = ed({ ...roomy, plugShare: 0.8, exitDia: throat * 1.8 });
    expect(some.exitDia).toBeCloseTo(throat * 1.8, 9);
    expect(some.plugShare).toBeLessThan(0.8);
    expect(some.plugShare).toBeGreaterThan(0.7);
    expect(some.exitDia).toBeGreaterThanOrEqual(2 * ringWallRadius(some) * 1.15 - 1e-9);
  });

  it('keeps the wall at the ring within 95% of the chamber where the plug can shrink that far', () => {
    // The starter engine's chamber is 1.7 throats wide: room for a plug of about 0.785, not 0.8.
    const starter = ed({ plugShare: 0.8, exitDia: starterEngine().throatDia * 6 });
    expect(starter.plugShare).toBeLessThan(0.8);
    expect(starter.plugShare).toBeGreaterThan(0.75);
    expect(ringWallRadius(starter)).toBeCloseTo((0.95 * starter.chamberDia) / 2, 9);
  });

  it('holds the plug at its smallest in the narrowest chamber, where the wall still fits inside', () => {
    // A chamber only 1.11 throats wide (the narrowest sanitize allows) cannot give the wall 5% of
    // clearance even at the smallest plug. The plug stops at its smallest; the wall is still inside.
    const base = starterEngine();
    const narrow = ed({ plugShare: 0.8, chamberDia: base.throatDia / 0.9, exitDia: base.throatDia * 6 });
    expect(narrow.plugShare).toBe(0.4);
    expect(ringWallRadius(narrow)).toBeLessThan(narrow.chamberDia / 2);
  });

  it('leaves the same sizes alone on a bell', () => {
    const throat = starterEngine().throatDia;
    expect(sanitize({ ...starterEngine(), exhaust: 'bell', exitDia: throat * 1.05 }).exitDia).toBeCloseTo(throat * 1.05, 9);
  });

  it('gives back the same engine when it is sanitized twice', () => {
    for (const patch of [{}, roomy, { plugShare: 0.8, exitDia: starterEngine().throatDia * 1.05 }, { plugShare: 0.4 }]) {
      const once = ed(patch);
      expect(sanitize(once)).toEqual(once);
    }
  });
});

describe('swapping to and from an expansion-deflection nozzle', () => {
  it('keeps the throat, the sizes and the plug through an aerospike and a bell and back', () => {
    const start = ed({ ...roomy, plugShare: 0.6 });
    const back = withExhaust(withExhaust(withExhaust(start, 'aerospike'), 'bell'), 'expansionDeflection');
    expect(back.exhaust).toBe('expansionDeflection');
    expect(back.plugShare).toBe(0.6);
    expect(back.throatDia * Math.sqrt(back.chambers)).toBeCloseTo(start.throatDia * Math.sqrt(start.chambers), 6);
  });

  it('only changes the nozzle when swapped with a bell', () => {
    const bell = sanitize({ ...starterEngine(), exitDia: starterEngine().throatDia * 6 });
    const swapped = withExhaust(bell, 'expansionDeflection');
    expect({ ...swapped, exhaust: 'bell' }).toEqual(bell);
    expect(withExhaust(swapped, 'bell')).toEqual(bell);
  });
});

describe('links', () => {
  const flight = { altitudeKm: 12, throttle: 0.8 };

  it('carry an expansion-deflection nozzle and its plug', () => {
    const state = { config: ed({ ...roomy, plugShare: 0.55 }), flight };
    const link = encodeState(state);
    expect(link.startsWith('v5.')).toBe(true);
    const opened = decodeState(link)!;
    expect(opened.config.exhaust).toBe('expansionDeflection');
    expect(opened.config.plugShare).toBeCloseTo(0.55, 9);
    expect(opened).toEqual(state);
  });

  /** A link's payload, and a link rebuilt from an edited payload under any version. */
  const payload = (link: string): unknown[] => JSON.parse(atob(link.slice(3).replace(/-/g, '+').replace(/_/g, '/')));
  const relink = (version: string, a: unknown[]) => `${version}.${btoa(JSON.stringify(a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

  it('still open when made before the plug existed, with the default plug', () => {
    const state = { config: sanitize({ ...starterEngine(), exhaust: 'cone', coneAngleDeg: 22 }), flight };
    const now = payload(encodeState(state));
    expect(now).toHaveLength(23);
    const old = decodeState(relink('v4', now.slice(0, 22)))!;
    expect(old).toEqual(state);
    expect(old.config.plugShare).toBe(0.7);
  });

  it('open as a bell when they name an exhaust this build does not know', () => {
    const a = payload(encodeState({ config: ed(), flight }));
    a[2] = 'warpNacelle';
    expect(decodeState(relink('v5', a))!.config.exhaust).toBe('bell');
  });

  it('are refused when a v5 link is the wrong length', () => {
    const a = payload(encodeState({ config: ed(), flight }));
    expect(decodeState(relink('v5', a.slice(0, 22)))).toBeNull();
  });
});

describe('an expansion-deflection nozzle’s thrust', () => {
  /** A nozzle big enough to be over-expanded at sea level: an area ratio of 36. */
  const big = (patch: Partial<EngineConfig> = {}) => ed({ ...roomy, ...patch });
  const at = (cfg: EngineConfig, altitudeKm: number, throttle = 1) => simulate(cfg, { altitudeKm, throttle });

  it('has the stated constants', () => {
    expect(edBaseDrag(0.7)).toBeCloseTo(1 - 0.02 * 0.49, 12);
    expect(edCompensation(0.7)).toBeCloseTo(0.59, 12);
    expect(edCompensation(0.8)).toBeLessThan(0.7); // always short of an aerospike's
  });

  it('compensates near the ground and runs as a bell once the air is thin', () => {
    expect(at(big(), 0).state).toBe('compensating');
    expect(['ideal', 'under']).toContain(at(big(), 100).state);
  });

  it('never separates, at any altitude or throttle', () => {
    for (let km = 0; km <= 100; km += 2) {
      for (const throttle of [0.4, 1]) expect(at(big(), km, throttle).state, `${km} km at ${throttle}`).not.toBe('separated');
    }
  });

  it('gains thrust steadily as it climbs, with no step where the wake closes', () => {
    let last = 0;
    let biggestGain = 0;
    for (let km = 0; km <= 100; km += 0.25) {
      const t = at(big(), km).thrust;
      expect(t, `${km} km`).toBeGreaterThanOrEqual(last * (1 - 1e-9));
      biggestGain = Math.max(biggestGain, last > 0 ? t / last - 1 : 0);
      last = t;
    }
    // No quarter-kilometre adds more than 2%: nothing jumps.
    expect(biggestGain).toBeLessThan(0.02);
  });

  it('beats the same bell near the ground and loses a little to it in vacuum', () => {
    const bell = sanitize({ ...big(), exhaust: 'bell' });
    expect(at(big(), 0).thrust).toBeGreaterThan(at(bell, 0).thrust * 1.02);
    const ratio = at(big(), 100).thrust / at(bell, 100).thrust;
    expect(ratio).toBeLessThan(1);
    expect(ratio).toBeGreaterThan(0.96);
  });

  it('never beats an aerospike of the same throat and exit, at any plug size', () => {
    for (const plugShare of [0.4, 0.7, 0.8]) {
      const nozzle = big({ plugShare });
      const spike = withExhaust(nozzle, 'aerospike');
      // The swap keeps the total throat and exit areas; check that it did before comparing.
      expect(spike.chambers * spike.throatDia ** 2).toBeCloseTo(nozzle.throatDia ** 2, 6);
      expect(spike.chambers * spike.exitDia ** 2).toBeCloseTo(nozzle.exitDia ** 2, 6);
      for (let km = 0; km <= 100; km += 5) {
        expect(at(nozzle, km).isp, `plug ${plugShare} at ${km} km`).toBeLessThanOrEqual(at(spike, km).isp * 1.0005);
      }
    }
  });

  it('compensates better near the ground with a bigger plug, and drags more in vacuum', () => {
    expect(at(big({ plugShare: 0.8 }), 0).thrust).toBeGreaterThan(at(big({ plugShare: 0.4 }), 0).thrust);
    expect(at(big({ plugShare: 0.8 }), 100).thrust).toBeLessThan(at(big({ plugShare: 0.4 }), 100).thrust);
  });

  it('leaves the same engine with a bell, and an aerospike, exactly as they were', () => {
    // The rule is for this exhaust only: a plug setting on another exhaust changes nothing.
    for (const exhaust of ['bell', 'cone', 'dualBell', 'aerospike', 'none'] as const) {
      const a = sanitize({ ...starterEngine(), exhaust, plugShare: 0.4 });
      const b = sanitize({ ...starterEngine(), exhaust, plugShare: 0.8 });
      for (const km of [0, 20, 100]) expect(at(a, km).thrust, `${exhaust} at ${km} km`).toBe(at(b, km).thrust);
    }
  });

  it('says what the air does behind the plug, and leaves the aerospike its own words', () => {
    const r = at(big(), 0);
    expect(expansionText(r, 'expansionDeflection')).toMatch(/plug/);
    expect(expansionText(r, 'expansionDeflection')).not.toMatch(/spike/);
    expect(expansionText(r, 'aerospike')).toBe(STATE_COPY.compensating.text);
  });
});

describe('the plug in the picture', () => {
  it('gives an expansion-deflection nozzle a plug at its throat, and no other type one', () => {
    const cfg = ed({ ...roomy, plugShare: 0.6 });
    const p = engineProfile(cfg);
    expect(p.plug).not.toBeNull();
    const plug = p.plug!;
    expect(plug.baseX).toBeCloseTo(p.throatX, 9);
    expect(plug.rimR).toBeCloseTo(0.6 * ringWallRadius(cfg), 9);
    expect(plug.stalkR).toBeLessThan(plug.rimR);
    expect(plug.stalkR).toBeGreaterThan(0);
    expect(plug.stalkX).toBeGreaterThanOrEqual(0);
    expect(plug.stalkX).toBeLessThan(plug.flareX);
    expect(plug.flareX).toBeLessThan(plug.baseX);
    for (const id of EXHAUST_IDS) {
      if (id !== 'expansionDeflection') expect(engineProfile(sanitize({ ...starterEngine(), exhaust: id })).plug, id).toBeNull();
    }
  });

  it('is the stalk’s width along the stalk, widens over the flare, and is gone past its base', () => {
    const plug = engineProfile(ed({ ...roomy, plugShare: 0.7 })).plug!;
    expect(plugRadius(plug, plug.stalkX - 0.01)).toBe(0);
    expect(plugRadius(plug, (plug.stalkX + plug.flareX) / 2)).toBe(plug.stalkR);
    const mid = plugRadius(plug, (plug.flareX + plug.baseX) / 2);
    expect(mid).toBeGreaterThan(plug.stalkR);
    expect(mid).toBeLessThan(plug.rimR);
    expect(plugRadius(plug, plug.baseX)).toBeCloseTo(plug.rimR, 12);
    expect(plugRadius(plug, plug.baseX + 1e-6)).toBe(0);
  });

  it('leaves the passage round the plug no narrower than the ring anywhere', () => {
    for (const patch of [{ ...roomy, plugShare: 0.4 }, { ...roomy, plugShare: 0.7 }, { ...roomy, plugShare: 0.8 }, { plugShare: 0.8 }, { plugShare: 0.4, chamberDia: starterEngine().throatDia / 0.9 }]) {
      const cfg = ed(patch);
      const p = engineProfile(cfg);
      const throatArea = Math.PI * (cfg.throatDia / 2) ** 2;
      for (const point of p.points) {
        if (point.x > p.plug!.baseX) break;
        const inner = plugRadius(p.plug!, point.x);
        expect(point.r, `plug ${cfg.plugShare} at x ${point.x}`).toBeGreaterThan(inner);
        expect(Math.PI * (point.r ** 2 - inner ** 2), `plug ${cfg.plugShare} at x ${point.x}`).toBeGreaterThanOrEqual(throatArea * (1 - 1e-9));
      }
    }
  });
});
