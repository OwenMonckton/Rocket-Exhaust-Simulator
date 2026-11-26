import { describe, expect, it } from 'vitest';
import { simulate } from '../physics/engine';
import { PRESETS } from '../physics/presets';
import { engineProfile, viewTransform } from '../render/geometry';
import type { StageLayout } from '../sim/runtime';
import { cardFigure, firstSentence, pickerGroups } from './picker';
import { fmtThrust, glanceFor } from './readouts';
import { calloutsFor } from './stand';

describe('the engine picker, grouped (critique P2)', () => {
  it('sorts every example into one group by what drives it, in a fixed order', () => {
    const groups = pickerGroups();
    expect(groups.map((g) => g.title)).toEqual(['Liquid-fuelled', 'Solid', 'Nuclear', 'Electric']);
    const ids = groups.flatMap((g) => g.presets.map((p) => p.id));
    expect([...ids].sort()).toEqual(PRESETS.map((p) => p.id).sort());
    expect(groups[0].presets[0].id).toBe('merlin-1d');
    expect(groups.find((g) => g.title === 'Nuclear')!.presets.map((p) => p.id)).toEqual(['nerva', 'nswr']);
    expect(groups.find((g) => g.title === 'Electric')!.presets.map((p) => p.id)).toEqual(['mr-510', 'nstar', 'next', 'spt-100', 'xr-5']);
    for (const g of groups) expect(g.presets.length, g.title).toBeGreaterThan(0);
  });

  it('gives each card a whole first sentence, never one cut off mid-word', () => {
    expect(firstSentence('SpaceX Falcon 9 first-stage engine. A simple, sturdy kerolox workhorse.')).toBe('SpaceX Falcon 9 first-stage engine.');
    expect(firstSentence('Robert Zubrin’s 1991 concept, never built: uranium salt water fissions.')).toBe('Robert Zubrin’s 1991 concept, never built: uranium salt water fissions.');
    // A full stop inside a figure or a name is not the end of the sentence.
    expect(firstSentence('Runs at 2.3 kW. Flew on Dawn.')).toBe('Runs at 2.3 kW.');
    for (const p of PRESETS) {
      const line = firstSentence(p.blurb);
      expect(line.length, p.id).toBeGreaterThan(10);
      expect(line.length, p.id).toBeLessThanOrEqual(p.blurb.length);
      expect(p.blurb.startsWith(line), p.id).toBe(true);
    }
  });

  it('gives each card its thrust and efficiency from the physics, where the engine is meant to run', () => {
    const merlin = PRESETS.find((p) => p.id === 'merlin-1d')!;
    const r = simulate(merlin.config, { altitudeKm: 0, throttle: 1 });
    expect(cardFigure(merlin)).toBe(`${Math.round(r.thrust / 1000)} kN, ${Math.round(r.isp)} s at sea level`);
    expect(cardFigure(PRESETS.find((p) => p.id === 'merlin-vac')!)).toMatch(/^\d+ kN, \d+ s in vacuum$/);
    expect(cardFigure(PRESETS.find((p) => p.id === 'nstar')!)).toMatch(/^\d+(\.\d)? mN, 3,\d{3} s in vacuum$/);
    for (const p of PRESETS) expect(cardFigure(p), p.id).not.toMatch(/NaN|Infinity|undefined/);
  });
});

describe('the glance line pinned on a phone (critique P2)', () => {
  const merlin = PRESETS.find((p) => p.id === 'merlin-1d')!.config;
  const r = simulate(merlin, { altitudeKm: 0, throttle: 1 });

  it('gives thrust and efficiency as the readings column does, run up with the engine', () => {
    expect(glanceFor(r, 1)).toEqual({ thrust: '845 kN', isp: '283 s' });
    expect(glanceFor(r, 0.5).thrust).toBe(fmtThrust(r.thrust * 0.5));
  });

  it('shows dashes where the figures would be made up', () => {
    expect(glanceFor({ ...r, settled: false }, 1)).toEqual({ thrust: '—', isp: '—' });
  });
});

describe('the engine framed clear of the thrust wall (critique P2)', () => {
  /** The stage's numbered marks for an example at a stage size, as the page lays them out. */
  const marks = (config: (typeof PRESETS)[number]['config'], w: number, h: number) => {
    const p = engineProfile(config);
    const v = viewTransform(p, w, h);
    const layout: StageLayout = {
      ppm: v.ppm, originX: v.originX, centreY: v.centreY,
      chamberEndX: v.originX + p.chamberEndX * v.ppm, throatX: v.originX + p.throatX * v.ppm, exitX: v.originX + p.exitX * v.ppm,
      halfHeight: p.halfHeight * v.ppm, frontSpace: p.frontSpace * v.ppm,
      chamberRadius: p.points[0].r * v.ppm, exitRadius: p.points[p.points.length - 1].r * v.ppm, chambersDrawn: p.offsets.length,
    };
    return calloutsFor(['energy', 'exhaust', 'fuel', 'oxidiser'], layout);
  };

  it('keeps every numbered mark wholly in the picture and off the 16px thrust wall, phone to desktop', () => {
    for (const [w, h] of [[375, 300], [480, 320], [830, 580], [1150, 700]]) {
      for (const p of PRESETS) {
        for (const c of marks(p.config, w, h)) {
          // A mark is a 24px disc centred on its point.
          expect(c.x - 12, `${p.id} at ${w}: mark ${c.id}`).toBeGreaterThanOrEqual(16 + 4);
        }
      }
    }
  });
});
