import { describe, expect, it } from 'vitest';
import { decodeState, encodeState } from '../state/share';
import { shapeHidden } from '../ui/controls';
import { RANGES, sanitize } from './engine';
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
