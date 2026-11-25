import { describe, expect, it } from 'vitest';
import { sanitize } from './engine';
import { EXHAUSTS, EXHAUST_IDS, defaultInnerExitDia, divergingWall, jetLeftWall, lipSlope } from './exhausts';
import type { WallPoint } from './exhausts';
import { starterEngine } from './reshape';
import type { ExpansionState } from './types';

describe('exhaust records', () => {
  it('has a record for every exhaust id, with a name and a tip', () => {
    expect(EXHAUST_IDS).toEqual(['bell', 'cone', 'dualBell', 'aerospike', 'expansionDeflection', 'none']);
    for (const id of EXHAUST_IDS) {
      expect(EXHAUSTS[id].id).toBe(id);
      expect(EXHAUSTS[id].name.length).toBeGreaterThan(0);
      expect(EXHAUSTS[id].tip.length).toBeGreaterThan(0);
    }
  });
  it('only a bell takes an extension, only an aerospike counts cells, only no-nozzle has no nozzle', () => {
    expect(EXHAUST_IDS.filter((id) => EXHAUSTS[id].extension)).toEqual(['bell']);
    expect(EXHAUST_IDS.filter((id) => EXHAUSTS[id].counts === 'cells')).toEqual(['aerospike']);
    expect(EXHAUST_IDS.filter((id) => !EXHAUSTS[id].hasNozzle)).toEqual(['none']);
  });
  it('shows each type its own sliders', () => {
    expect(EXHAUSTS.cone.sliders).toEqual({ exitDia: true, nozzleLenPct: false, coneAngleDeg: true, innerExitDia: false, plugShare: false });
    expect(EXHAUSTS.dualBell.sliders).toEqual({ exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: true, plugShare: false });
    expect(EXHAUSTS.none.sliders).toEqual({ exitDia: false, nozzleLenPct: false, coneAngleDeg: false, innerExitDia: false, plugShare: false });
    expect(EXHAUSTS.bell.sliders).toEqual({ exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: false, plugShare: false });
    expect(EXHAUSTS.aerospike.sliders).toEqual({ exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: false, plugShare: false });
  });
  it('opens a dual bell with the square root of the area ratio in its inner bell', () => {
    expect(defaultInnerExitDia(0.2, 2.0)).toBeCloseTo(0.2 * Math.sqrt(10), 12);
  });
  it('counts a held jet and a torn-off jet as having left the wall', () => {
    expect(['ideal', 'over', 'under', 'separated', 'compensating', 'held'].filter((s) => jetLeftWall(s as ExpansionState)))
      .toEqual(['separated', 'held']);
  });
});

describe('diverging walls', () => {
  const base = starterEngine();
  const rising = (pts: WallPoint[]) => pts.every((p, i) => i === 0 || (p.x > pts[i - 1].x && p.r >= pts[i - 1].r));

  it('ends a cone at the exit radius along its half-angle', () => {
    const cfg = sanitize({ ...base, exhaust: 'cone', coneAngleDeg: 20 });
    const wall = divergingWall(cfg);
    const [a, b] = wall.points.slice(-2);
    expect(wall.points.at(-1)!.r).toBeCloseTo(cfg.exitDia / 2, 9);
    expect((b.r - a.r) / (b.x - a.x)).toBeCloseTo(Math.tan((20 * Math.PI) / 180), 6);
    expect(lipSlope(cfg)).toBeCloseTo(Math.tan((20 * Math.PI) / 180), 12);
    expect(rising(wall.points)).toBe(true);
  });
  it('makes a wide cone shorter than a narrow one', () => {
    const at = (deg: number) => divergingWall(sanitize({ ...base, exhaust: 'cone', coneAngleDeg: deg })).length;
    expect(at(30)).toBeLessThan(0.5 * at(8));
  });
  it('kinks a dual bell outwards at the inner exit', () => {
    const cfg = sanitize({ ...base, exhaust: 'dualBell', exitDia: 10 * base.throatDia });
    const wall = divergingWall(cfg);
    const i = wall.points.findIndex((p) => p === wall.kink || (p.x === wall.kink!.x && p.r === wall.kink!.r));
    const slope = (j: number) => (wall.points[j + 1].r - wall.points[j].r) / (wall.points[j + 1].x - wall.points[j].x);
    expect(wall.kink!.r).toBeCloseTo(cfg.innerExitDia / 2, 9);
    expect(slope(i)).toBeGreaterThan(slope(i - 1) + Math.tan((5 * Math.PI) / 180));
    expect(wall.points.at(-1)!.r).toBeCloseTo(cfg.exitDia / 2, 9);
    expect(rising(wall.points)).toBe(true);
  });
  it('gives a finite rising dual bell with the kink at either extreme', () => {
    for (const inner of [0.0001, 99]) {
      const cfg = sanitize({ ...base, exhaust: 'dualBell', exitDia: 10 * base.throatDia, innerExitDia: inner });
      const wall = divergingWall(cfg);
      expect(wall.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.r))).toBe(true);
      expect(rising(wall.points)).toBe(true);
    }
    const tight = divergingWall(sanitize({ ...base, exhaust: 'dualBell', exitDia: 1.05 * base.throatDia }));
    expect(rising(tight.points)).toBe(true);
  });
  it('gives no wall at all with no nozzle', () => {
    const wall = divergingWall(sanitize({ ...base, exhaust: 'none' }));
    expect(wall.points).toEqual([]);
    expect(wall.length).toBe(0);
    expect(wall.kink).toBeNull();
  });
  it('fits a 30 degree cone to the smallest nozzle there can be', () => {
    const wall = divergingWall(sanitize({ ...base, exhaust: 'cone', coneAngleDeg: 30, exitDia: 1.05 * base.throatDia }));
    expect(rising(wall.points)).toBe(true);
    expect(wall.points.at(-1)!.r).toBeCloseTo((1.05 * base.throatDia) / 2, 9);
  });
});
