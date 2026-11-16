import { describe, expect, it } from 'vitest';
import { PRESETS } from '../physics/presets';
import { engineProfile, radiusAt, viewTransform } from './geometry';

describe('engine profile', () => {
  for (const p of PRESETS) {
    it(`${p.name} has a sane contour`, () => {
      const cfg = p.config;
      const prof = engineProfile(cfg);
      expect(prof.points[0]).toEqual({ x: 0, r: cfg.chamberDia / 2 });
      expect(prof.points.at(-1)!.r).toBeCloseTo(cfg.exitDia / 2, 9);
      const min = prof.points.reduce((a, b) => (b.r < a.r ? b : a));
      expect(min.r).toBeCloseTo(cfg.throatDia / 2, 9);
      expect(min.x).toBeCloseTo(prof.throatX, 9);
      for (let i = 1; i < prof.points.length; i++) {
        if (i > 1) expect(prof.points[i].x).toBeGreaterThan(prof.points[i - 1].x);
        expect(Number.isFinite(prof.points[i].r)).toBe(true);
      }
      // The bell only ever widens after the throat.
      const bell = prof.points.filter((q) => q.x >= prof.throatX);
      for (let i = 1; i < bell.length; i++) expect(bell[i].r).toBeGreaterThanOrEqual(bell[i - 1].r);
      expect(radiusAt(prof, prof.throatX)).toBeCloseTo(cfg.throatDia / 2, 9);
      expect(radiusAt(prof, 1e9)).toBeCloseTo(cfg.exitDia / 2, 9);
    });
  }
  it('makes a longer bell at 100% than at 60%', () => {
    const cfg = PRESETS[0].config;
    const short = engineProfile({ ...cfg, nozzleLenPct: 60 });
    const long = engineProfile({ ...cfg, nozzleLenPct: 100 });
    expect(long.length).toBeGreaterThan(short.length);
  });
  it('keeps a small nozzle big enough to see, cropping the front of a long engine', () => {
    const solid = PRESETS.find((p) => p.id === 'solid-booster')!;
    const prof = engineProfile(solid.config);
    for (const zoom of [1, 0.5, 0.3]) {
      const v = viewTransform(prof, 1200, 600, zoom);
      expect((solid.config.exitDia / 2) * v.ppm).toBeGreaterThanOrEqual(600 * 0.03);
      expect(v.originX + prof.length * v.ppm).toBeLessThan(0.5 * 1200);
    }
    // Ordinary engines are unaffected and stay fully on screen.
    const merlin = engineProfile(PRESETS[0].config);
    expect(viewTransform(merlin, 1200, 600).originX).toBeGreaterThan(0);
  });
  it('draws two chambers side by side for a multi-chamber engine, with room for the pump', () => {
    const rd170 = PRESETS.find((p) => p.id === 'rd-170')!.config;
    const prof = engineProfile(rd170);
    expect(prof.offsets).toHaveLength(2);
    expect(prof.offsets[0]).toBeCloseTo(-prof.offsets[1], 9);
    // Nozzles clear each other.
    expect(prof.offsets[1] - prof.offsets[0]).toBeGreaterThan(rd170.exitDia);
    expect(prof.frontSpace).toBeGreaterThan(0);
    const v = viewTransform(prof, 1200, 600);
    expect(2 * prof.halfHeight * v.ppm).toBeLessThanOrEqual(0.55 * 600 + 1e-6);
    expect(v.originX - prof.frontSpace * v.ppm).toBeGreaterThan(0);
    const single = engineProfile(PRESETS[0].config);
    expect(single.offsets).toEqual([0]);
    expect(single.frontSpace).toBe(0);
  });
  it('splits a nozzle with an extension, and slides the extension forward to stow it', () => {
    const rl10 = PRESETS.find((p) => p.id === 'rl10b-2')!.config;
    const seated = engineProfile(rl10).extension!;
    expect(seated).not.toBeNull();
    expect(seated.shift).toBe(0);
    expect(seated.seam.r).toBeCloseTo(rl10.extFixedDia / 2, 9);
    expect(seated.fixedPoints.at(-1)).toEqual(seated.seam);
    expect(seated.points[0]).toEqual(seated.seam);
    expect(seated.points.at(-1)!.r).toBeCloseTo(rl10.exitDia / 2, 9);
    expect(seated.seamSlope).toBeGreaterThan(0);
    const stowed = engineProfile({ ...rl10, extDeploy: 0 });
    expect(stowed.extension!.shift).toBeCloseTo(seated.length, 9);
    expect(engineProfile({ ...rl10, extDeploy: 0.5 }).extension!.shift).toBeCloseTo(seated.length / 2, 9);
    // The view does not move as it deploys, and leaves room in front for the stowed extension.
    expect(stowed.length).toBe(engineProfile(rl10).length);
    expect(stowed.frontSpace).toBe(engineProfile(rl10).frontSpace);
    const v = viewTransform(stowed, 1200, 600);
    expect(v.originX + (seated.seam.x - seated.length) * v.ppm).toBeGreaterThan(0);
    expect(engineProfile(PRESETS[0].config).extension).toBeNull();
  });
  it('fits the engine in the left of the stage', () => {
    for (const p of PRESETS) {
      const prof = engineProfile(p.config);
      const v = viewTransform(prof, 1200, 600);
      expect(v.originX + prof.length * v.ppm).toBeLessThan(0.5 * 1200);
      expect(2 * prof.maxRadius * v.ppm).toBeLessThanOrEqual(0.55 * 600 + 1e-6);
    }
  });
});
