import { describe, expect, it } from 'vitest';
import { SIM_NX, SIM_NY, SPIKE_SAMPLES, wallShape } from '../render/fluidSim';
import { engineProfile, plugRadius, radiusAt } from '../render/geometry';
import { ED_ENTRY_MACH, edGrid, edSimInputs } from '../render/plumeParams';
import { areaRatio } from './nozzle';
import { decodeState, encodeState } from '../state/share';
import { shapeHidden } from '../ui/controls';
import { expansionText, STATE_COPY } from '../ui/copy';
import { RANGES, edBaseDrag, edCompensation, sanitize, simulate } from './engine';
import { ED_CAP_RADII, EXHAUSTS, EXHAUST_IDS, divergingWall, edCapTilt, lipSlope, ringWallRadius } from './exhausts';
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
    for (const plugShare of [0.5, 0.55, 0.7, 0.8]) {
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
    expect(RANGES.plugShare).toEqual({ min: 0.5, max: 0.8, fallback: 0.7 });
  });

  it('clamps the plug to its range, on this exhaust and on any other', () => {
    expect(ed({ ...roomy, plugShare: 0.1 }).plugShare).toBe(0.5);
    expect(ed({ ...roomy, plugShare: Number.NaN }).plugShare).toBe(0.7);
    expect(ed({ ...roomy, plugShare: 0.99 }).plugShare).toBe(0.8);
    // Another exhaust keeps the setting for a swap back, and does nothing with it.
    expect(sanitize({ ...starterEngine(), plugShare: 0.6 }).plugShare).toBe(0.6);
    expect(sanitize({ ...starterEngine(), plugShare: 7 }).plugShare).toBe(0.8);
    expect(sanitize({ ...starterEngine(), exitDia: starterEngine().throatDia * 1.05, plugShare: 0.8 }).plugShare).toBe(0.8);
  });

  it('shrinks the plug to its smallest, then widens the exit, when the exit is too small for it', () => {
    const throat = starterEngine().throatDia;
    const tight = ed({ ...roomy, plugShare: 0.8, exitDia: throat * 1.05 });
    expect(tight.plugShare).toBe(0.5);
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
    // clearance even at the smallest plug. The plug stops at its smallest, where the wall at the
    // ring is 1.155 throats wide: a shade wider than the chamber, which then opens out to meet it.
    const base = starterEngine();
    const narrow = ed({ plugShare: 0.8, chamberDia: base.throatDia / 0.9, exitDia: base.throatDia * 6 });
    expect(narrow.plugShare).toBe(0.5);
    expect(ringWallRadius(narrow)).toBeLessThan(1.05 * (narrow.chamberDia / 2));
  });

  it('leaves the same sizes alone on a bell', () => {
    const throat = starterEngine().throatDia;
    expect(sanitize({ ...starterEngine(), exhaust: 'bell', exitDia: throat * 1.05 }).exitDia).toBeCloseTo(throat * 1.05, 9);
  });

  it('gives back the same engine when it is sanitized twice', () => {
    for (const patch of [{}, roomy, { plugShare: 0.8, exitDia: starterEngine().throatDia * 1.05 }, { plugShare: 0.5 }]) {
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
    for (const plugShare of [0.5, 0.7, 0.8]) {
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
    expect(at(big({ plugShare: 0.8 }), 0).thrust).toBeGreaterThan(at(big({ plugShare: 0.5 }), 0).thrust);
    expect(at(big({ plugShare: 0.8 }), 100).thrust).toBeLessThan(at(big({ plugShare: 0.5 }), 100).thrust);
  });

  it('leaves the same engine with a bell, and an aerospike, exactly as they were', () => {
    // The rule is for this exhaust only: a plug setting on another exhaust changes nothing.
    for (const exhaust of ['bell', 'cone', 'dualBell', 'aerospike', 'none'] as const) {
      const a = sanitize({ ...starterEngine(), exhaust, plugShare: 0.5 });
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

  it('is the stalk’s width along the stalk, widens over the flare and the cap, and is gone past the back of the cap', () => {
    const plug = engineProfile(ed({ ...roomy, plugShare: 0.7 })).plug!;
    expect(plugRadius(plug, plug.stalkX - 0.01)).toBe(0);
    expect(plugRadius(plug, (plug.stalkX + plug.flareX) / 2)).toBe(plug.stalkR);
    const mid = plugRadius(plug, (plug.flareX + plug.baseX) / 2);
    expect(mid).toBeGreaterThan(plug.stalkR);
    expect(mid).toBeLessThan(plug.rimR);
    expect(plugRadius(plug, plug.baseX)).toBeCloseTo(plug.rimR, 12);
    // Past the ring the cap flares on outward, and ends in a flat back.
    expect(plug.capX).toBeGreaterThan(plug.baseX);
    expect(plug.capR).toBeGreaterThan(plug.rimR);
    const onCap = plugRadius(plug, (plug.baseX + plug.capX) / 2);
    expect(onCap).toBeGreaterThan(plug.rimR);
    expect(onCap).toBeLessThan(plug.capR);
    expect(plugRadius(plug, plug.capX)).toBeCloseTo(plug.capR, 12);
    expect(plugRadius(plug, plug.capX + 1e-6)).toBe(0);
  });

  it('leaves the passage round the plug no narrower than the ring anywhere', () => {
    for (const patch of [{ ...roomy, plugShare: 0.5 }, { ...roomy, plugShare: 0.7 }, { ...roomy, plugShare: 0.8 }, { plugShare: 0.8 }]) {
      const cfg = ed(patch);
      const p = engineProfile(cfg);
      const throatArea = Math.PI * (cfg.throatDia / 2) ** 2;
      for (const point of p.points) {
        if (point.x > p.plug!.capX) break;
        const inner = plugRadius(p.plug!, point.x);
        expect(point.r, `plug ${cfg.plugShare} at x ${point.x}`).toBeGreaterThan(inner);
        // Beside the cap the passage is checked between the cap's own points, hence the one percent.
        const least = point.x <= p.plug!.baseX ? 1 - 1e-9 : 0.99;
        expect(Math.PI * (point.r ** 2 - inner ** 2), `plug ${cfg.plugShare} at x ${point.x}`).toBeGreaterThanOrEqual(throatArea * least);
      }
    }
  });
});

describe('the whole nozzle in the plume grid', () => {
  /** An area ratio of 16: a bell short enough to simulate whole. */
  const small = (patch: Partial<EngineConfig> = {}) => ed({ chamberDia: starterEngine().throatDia * 2.5, exitDia: starterEngine().throatDia * 4, ...patch });
  const sea = { altitudeKm: 0, throttle: 1 };
  const cellOf = (lengthRadii: number) => (lengthRadii + Math.min(2, 0.15 * lengthRadii)) / SIM_NX;

  it('sizes the grid by the bell: 2.2 bell lengths, and tall enough for 1.25 mouth radii', () => {
    const cfg = small();
    const p = engineProfile(cfg);
    const rw = ringWallRadius(cfg);
    const g = edGrid(p, rw);
    expect(g.fits).toBe(true);
    expect(g.bellRadii).toBeCloseTo((p.exitX - p.throatX) / rw, 9);
    expect(g.mouthRadii).toBeCloseTo(cfg.exitDia / 2 / rw, 9);
    expect(g.lengthRadii).toBeGreaterThanOrEqual(2.2 * g.bellRadii - 1e-9);
    expect(SIM_NY * cellOf(g.lengthRadii)).toBeGreaterThanOrEqual(1.25 * g.mouthRadii - 1e-9);
    expect(g.lengthRadii).toBeLessThanOrEqual(24);
  });

  it('makes a short, wide bell\u2019s grid tall enough for its mouth', () => {
    // 60% nozzle length: 2.2 bell lengths is not long enough for a grid 1.25 mouths tall, so the height decides.
    const cfg = small({ nozzleLenPct: 60, exitDia: starterEngine().throatDia * 5 });
    const g = edGrid(engineProfile(cfg), ringWallRadius(cfg));
    expect(SIM_NY * cellOf(g.lengthRadii)).toBeGreaterThanOrEqual(1.25 * g.mouthRadii - 1e-9);
  });

  it('keeps the ring at least five cells wide at any plug size', () => {
    for (const plugShare of [0.5, 0.7, 0.8]) {
      const cfg = small({ plugShare });
      const g = edGrid(engineProfile(cfg), ringWallRadius(cfg));
      expect((1 - cfg.plugShare) / cellOf(g.lengthRadii), `plug ${plugShare}`).toBeGreaterThanOrEqual(5);
    }
  });

  it('does not simulate whole a nozzle too long for the grid', () => {
    const big = ed({ ...roomy, exitDia: starterEngine().throatDia * 12 });
    expect(edGrid(engineProfile(big), ringWallRadius(big)).fits).toBe(false);
    expect(edSimInputs(big, simulate(big, sea), 1, engineProfile(big))).toBeNull();
  });

  it('gives no inputs for any other exhaust', () => {
    const bell = sanitize({ ...small(), exhaust: 'bell' });
    expect(edSimInputs(bell, simulate(bell, sea), 1, engineProfile(bell))).toBeNull();
  });

  it('sends the gas out through the ring past the speed of sound and heading outward along the wall', () => {
    expect(ED_ENTRY_MACH).toBe(1.3);
    const cfg = small();
    const r = simulate(cfg, sea);
    const { inputs, grid } = edSimInputs(cfg, r, 1, engineProfile(cfg))!;
    expect(inputs.uExit).toBeCloseTo(1.3 * Math.sqrt(r.gamma), 9);
    const spike = inputs.spike!;
    // Outward is a negative tilt (an aerospike's cells fire inward), and no steeper than 30 degrees.
    expect(spike.tilt).toBeCloseTo(-edCapTilt(cfg), 12);
    expect(-spike.tilt).toBeGreaterThan((15 * Math.PI) / 180);
    expect(-spike.tilt).toBeLessThanOrEqual((30 * Math.PI) / 180 + 1e-12);
    // Its speed along the grid's axis is still past the speed of sound, so nothing downstream reaches back.
    expect(1.3 * Math.cos(spike.tilt)).toBeGreaterThan(1.05);
    expect(inputs.ed).toEqual({ ringInner: spike.radii[0], lengthRadii: grid.lengthRadii });
  });

  it('makes the ring wide enough to carry the throat\u2019s flow at that speed and heading, at any plug size', () => {
    for (const plugShare of [0.5, 0.7, 0.8]) {
      for (const nozzleLenPct of [60, 80, 100]) {
        const cfg = small({ plugShare, nozzleLenPct });
        const r = simulate(cfg, sea);
        const { inputs } = edSimInputs(cfg, r, 1, engineProfile(cfg))!;
        const spike = inputs.spike!;
        const ringArea = 1 - spike.radii[0] ** 2;          // in units of pi x (ring wall radius)^2
        const throatArea = (cfg.throatDia / 2 / ringWallRadius(cfg)) ** 2;
        // Mass flow through the ring's plane is density x speed along the axis x area.
        expect((ringArea * Math.cos(spike.tilt)) / throatArea, `plug ${plugShare}, length ${nozzleLenPct}`).toBeCloseTo(areaRatio(1.3, r.gamma), 9);
        expect(spike.radii[0], `plug ${plugShare}, length ${nozzleLenPct}`).toBeGreaterThan(0.1);
        expect(spike.radii[0]).toBeLessThan(cfg.plugShare);
      }
    }
  });

  it('stands the plug\u2019s cap in the grid, flaring outward beside the wall to a flat back', () => {
    const cfg = small();
    const { inputs, wall } = edSimInputs(cfg, simulate(cfg, sea), 1, engineProfile(cfg))!;
    const spike = inputs.spike!;
    expect(spike.radii).toHaveLength(SPIKE_SAMPLES);
    expect(spike.length).toBe(ED_CAP_RADII);
    for (let i = 1; i < SPIKE_SAMPLES; i++) expect(spike.radii[i]).toBeGreaterThan(spike.radii[i - 1]);
    const last = spike.radii[SPIKE_SAMPLES - 1];
    expect(last).toBeCloseTo(spike.radii[0] + Math.tan(-spike.tilt) * ED_CAP_RADII, 12);
    // The passage between cap and wall never narrows: the gas is not squeezed again past the ring.
    const { slope, curve } = wallShape(wall);
    let area = 1 - spike.radii[0] ** 2;
    for (let i = 1; i < SPIKE_SAMPLES; i++) {
      const x = (i / (SPIKE_SAMPLES - 1)) * ED_CAP_RADII;
      const next = (1 + slope * x + curve * x * x) ** 2 - spike.radii[i] ** 2;
      expect(next, `sample ${i}`).toBeGreaterThanOrEqual(area * (1 - 1e-9));
      area = next;
    }
  });

  it('starts the wall at the ring and ends it at the mouth, close to the bell that is drawn', () => {
    const cfg = small();
    const p = engineProfile(cfg);
    const rw = ringWallRadius(cfg);
    const { wall, grid } = edSimInputs(cfg, simulate(cfg, sea), 1, p)!;
    expect([wall.x0, wall.r0]).toEqual([0, 1]);
    expect(wall.x1).toBeCloseTo(grid.bellRadii, 9);
    expect(wall.r1).toBeCloseTo(grid.mouthRadii, 9);
    const { slope, curve } = wallShape(wall);
    for (let i = 1; i <= 10; i++) {
      const x = (i / 10) * wall.x1;
      const fitted = 1 + slope * x + curve * x * x;
      const drawn = radiusAt(p, p.throatX + x * rw) / rw;
      expect(Math.abs(fitted / drawn - 1), `at ${i}/10 of the bell`).toBeLessThan(0.05);
    }
  });

  it('brings the gas in at full strength only once the engine is lit', () => {
    const cfg = small();
    const r = simulate(cfg, sea);
    expect(edSimInputs(cfg, r, 0.25, engineProfile(cfg))!.inputs.fire).toBe(0.25);
  });
});
