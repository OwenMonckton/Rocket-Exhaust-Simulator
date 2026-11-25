import { describe, expect, it } from 'vitest';
import { sanitize, simulate } from '../physics/engine';
import { starterEngine, withEnergy } from '../physics/reshape';
import type { EngineConfig } from '../physics/types';
import type { StageLayout } from '../sim/runtime';
import { rumbleShare, simulationOffered, skyOnly } from '../sim/stageRules';
import { silhouettePath } from '../ui/picker';
import { calloutsFor } from '../ui/stand';
import { BEAM_BODY_LENGTH, beamAlpha, beamColour, beamShape } from './beamView';
import { engineProfile, viewTransform } from './geometry';

const space = { altitudeKm: 100, throttle: 1 };
const beam = (type: 'ion' | 'hall', patch: Partial<EngineConfig> = {}) => sanitize({ ...withEnergy(starterEngine(), type), ...patch });

describe('the shape of a beam thruster', () => {
  it('is a plain body as wide as its diameter, marked as a beam thruster', () => {
    for (const type of ['ion', 'hall'] as const) {
      const cfg = beam(type);
      const p = engineProfile(cfg);
      expect(p.beam).toBe(type);
      expect(p.exitX).toBeCloseTo(BEAM_BODY_LENGTH[type] * cfg.exitDia, 12);
      expect(p.throatX).toBe(p.exitX);
      expect(p.length).toBe(p.exitX);
      expect(p.maxRadius).toBeCloseTo(cfg.exitDia / 2, 12);
      expect(p.halfHeight).toBeGreaterThan(p.maxRadius);
      expect(p.offsets).toEqual([0]);
      expect(p.spike ?? p.plug ?? p.extension ?? p.kink).toBeNull();
      for (const pt of p.points) expect(Number.isFinite(pt.x) && pt.r === cfg.exitDia / 2).toBe(true);
      const v = viewTransform(p, 900, 600);
      expect(Number.isFinite(v.ppm) && v.ppm > 0).toBe(true);
    }
    expect(BEAM_BODY_LENGTH.ion).toBeGreaterThan(BEAM_BODY_LENGTH.hall);
  });

  it('leaves every other engine unmarked', () => {
    expect(engineProfile(starterEngine()).beam).toBeUndefined();
    expect(engineProfile(withEnergy(starterEngine(), 'arcjet')).beam).toBeUndefined();
  });

  it('has a card outline of its own for each type', () => {
    const ion = silhouettePath(beam('ion'));
    const hall = silhouettePath(beam('hall'));
    expect(ion.length).toBeGreaterThan(20);
    expect(hall.length).toBeGreaterThan(20);
    expect(ion).not.toBe(hall);
    expect(ion + hall).not.toMatch(/NaN|Infinity/);
  });

  it('gives the part marks somewhere to stand', () => {
    const p = engineProfile(beam('hall'));
    const v = viewTransform(p, 900, 600);
    const layout: StageLayout = {
      ppm: v.ppm, originX: v.originX, centreY: v.centreY,
      chamberEndX: v.originX + p.chamberEndX * v.ppm, throatX: v.originX + p.throatX * v.ppm, exitX: v.originX + p.exitX * v.ppm,
      halfHeight: p.halfHeight * v.ppm, frontSpace: 0, chamberRadius: p.points[0].r * v.ppm, exitRadius: p.points[1].r * v.ppm, chambersDrawn: 1,
    };
    for (const c of calloutsFor(['energy', 'propellant'], layout)) {
      for (const n of [c.x, c.y, c.toX, c.toY]) expect(Number.isFinite(n)).toBe(true);
    }
  });
});

describe('the beam', () => {
  it('is narrow from grids and wide from a Hall channel', () => {
    expect(beamShape(beam('ion')).halfAngleDeg).toBe(12);
    expect(beamShape(beam('hall')).halfAngleDeg).toBe(35);
    expect(beamShape(beam('ion', { exitDia: 0.5 })).lengthM).toBeCloseTo(6, 12);
  });

  it('takes its colour from the propellant', () => {
    const xe = beamColour(beam('ion'));
    const ar = beamColour(beam('ion', { propellant: 'argon' }));
    expect(xe).not.toEqual(ar);
    // Xenon is blue-violet: more blue than red. Argon is pink-violet: more red than green.
    expect(xe[2]).toBeGreaterThan(xe[0]);
    expect(ar[0]).toBeGreaterThan(ar[1]);
  });

  it('shows nothing unlit or in air, and more with more power, never more than fully', () => {
    for (const type of ['ion', 'hall'] as const) {
      const cfg = beam(type);
      const r = simulate(cfg, space);
      expect(beamAlpha(r, cfg, 0)).toBe(0);
      expect(beamAlpha(simulate(cfg, { altitudeKm: 0, throttle: 1 }), cfg, 1)).toBe(0);
      const lit = beamAlpha(r, cfg, 1);
      expect(lit).toBeGreaterThan(0.2);
      expect(lit).toBeLessThanOrEqual(1);
      expect(beamAlpha(r, cfg, 0.5)).toBeCloseTo(lit / 2, 12);
      const weak = sanitize({ ...cfg, powerKW: 0.05, exitDia: 1 });
      const strong = sanitize({ ...cfg, powerKW: 20, exitDia: 1 });
      expect(beamAlpha(simulate(strong, space), strong, 1)).toBeGreaterThan(beamAlpha(simulate(weak, space), weak, 1));
      const most = sanitize({ ...cfg, powerKW: 100, exitDia: 0.03 });
      expect(beamAlpha({ ...simulate(most, space), failure: null, thrust: 1 }, most, 1)).toBeLessThanOrEqual(1);
    }
  });
});

describe('what the stage does for a beam thruster', () => {
  it('draws only the sky behind it, offers no gas simulation, and makes no noise', () => {
    for (const type of ['ion', 'hall'] as const) {
      expect(skyOnly(beam(type))).toBe(true);
      expect(simulationOffered(beam(type))).toBe(false);
      expect(rumbleShare(beam(type))).toBe(0);
    }
    const arcjet = withEnergy(starterEngine(), 'arcjet');
    expect(skyOnly(arcjet)).toBe(false);
    expect(simulationOffered(arcjet)).toBe(true);
    // A quarter of a newton does not roar.
    expect(rumbleShare(arcjet)).toBeLessThan(0.3);
    expect(rumbleShare(arcjet)).toBeGreaterThan(0);
    expect(skyOnly(starterEngine())).toBe(false);
    expect(simulationOffered(starterEngine())).toBe(true);
    expect(rumbleShare(starterEngine())).toBe(1);
  });
});
