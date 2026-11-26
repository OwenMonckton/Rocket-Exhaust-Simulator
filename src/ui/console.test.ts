import { describe, expect, it } from 'vitest';
import { RANGES } from '../physics/engine';
import { PRESETS } from '../physics/presets';
import type { StageLayout } from '../sim/runtime';
import { curvePosition, curveValue } from './controls';
import { silhouettePath } from './picker';
import { ALTITUDE_MARKS, STAND_GONE_KM, altitudeScaleFits, altitudeY, calloutsFor, standShare } from './stand';
import { stamp } from './testlog';

describe('the altitude scale', () => {
  const range = RANGES.altitudeKm;

  it('gives the thick air most of the travel', () => {
    // Ten kilometres is a tenth of the range but sits about a third of the way along.
    expect(curvePosition(10, range, 2)).toBeCloseTo(Math.sqrt(0.1), 6);
    expect(curvePosition(10, range, 2)).toBeGreaterThan(0.3);
  });

  it('reaches both ends of the range', () => {
    expect(curveValue(0, range, 2)).toBe(range.min);
    expect(curveValue(1, range, 2)).toBe(range.max);
  });

  it('gives back the altitude a position stands for', () => {
    for (const km of [0, 0.5, 10, 40, 86, 100]) {
      expect(curveValue(curvePosition(km, range, 2), range, 2)).toBeCloseTo(km, 9);
    }
  });

  it('holds a value outside the range at the end of the track', () => {
    expect(curvePosition(-5, range, 2)).toBe(0);
    expect(curvePosition(500, range, 2)).toBe(1);
  });
});

describe('the test stand', () => {
  it('is all there on the ground and gone once the engine has climbed away', () => {
    expect(standShare(0)).toBe(1);
    expect(standShare(STAND_GONE_KM / 2)).toBeCloseTo(0.5, 9);
    expect(standShare(STAND_GONE_KM)).toBe(0);
    expect(standShare(100)).toBe(0);
  });
});

describe('the numbered marks on the engine', () => {
  const layout: StageLayout = {
    ppm: 100,
    originX: 200,
    centreY: 300,
    chamberEndX: 280,
    throatX: 320,
    exitX: 460,
    halfHeight: 70,
    frontSpace: 10,
    chamberRadius: 40,
    exitRadius: 70,
    chambersDrawn: 1,
  };

  it('puts one mark per part picker, in the order given', () => {
    const marks = calloutsFor(['energy', 'exhaust', 'fuel', 'oxidiser'], layout);
    expect(marks.map((m) => m.id)).toEqual(['energy', 'exhaust', 'fuel', 'oxidiser']);
  });

  it('points the energy source at the chamber and the exhaust at the nozzle', () => {
    const [energy, exhaust] = calloutsFor(['energy', 'exhaust'], layout);
    expect(energy.toX).toBeGreaterThan(layout.originX);
    expect(energy.toX).toBeLessThan(layout.chamberEndX);
    expect(energy.toY).toBe(layout.centreY - layout.chamberRadius);
    expect(exhaust.toX).toBeGreaterThan(layout.throatX);
    expect(exhaust.toX).toBeLessThan(layout.exitX);
  });

  it('stands the fuel and oxidiser marks ahead of the injector, one above the centreline and one below', () => {
    const [, , fuel, oxidiser] = calloutsFor(['energy', 'exhaust', 'fuel', 'oxidiser'], layout);
    expect(fuel.x).toBeLessThan(layout.originX);
    expect(oxidiser.x).toBe(fuel.x);
    expect(fuel.y).toBeLessThan(layout.centreY);
    expect(oxidiser.y).toBeGreaterThan(layout.centreY);
  });

  it('puts a single feed, a reactor propellant, on the centreline', () => {
    const [, , propellant] = calloutsFor(['energy', 'exhaust', 'propellant'], layout);
    expect(propellant.y).toBe(layout.centreY);
  });

  it('keeps every mark clear of its neighbours', () => {
    const marks = calloutsFor(['energy', 'exhaust', 'fuel', 'oxidiser'], layout);
    for (const a of marks) {
      for (const b of marks) {
        if (a === b) continue;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(24);
      }
    }
  });

  it('keeps the feed marks in the picture when the engine sits hard against the left edge', () => {
    const [, , fuel] = calloutsFor(['energy', 'exhaust', 'fuel'], { ...layout, originX: 20 });
    expect(fuel.x).toBeGreaterThanOrEqual(16);
  });
});

describe('the test log clock', () => {
  it('has no time before the first ignition', () => {
    expect(stamp(null)).toBe('STANDBY');
  });

  it('counts whole seconds since ignition', () => {
    expect(stamp(0)).toBe('T+00:00');
    expect(stamp(7.9)).toBe('T+00:07');
    expect(stamp(125)).toBe('T+02:05');
  });
});

describe('the engine outlines in the picker', () => {
  it('draws every example as a closed outline that fits its card', () => {
    for (const p of PRESETS) {
      const path = silhouettePath(p.config);
      expect(path.startsWith('M'), p.name).toBe(true);
      expect(path.endsWith('Z'), p.name).toBe(true);
      const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
      expect(numbers.every(Number.isFinite), p.name).toBe(true);
      for (let i = 0; i < numbers.length; i += 2) {
        expect(numbers[i], p.name).toBeGreaterThanOrEqual(0);
        expect(numbers[i], p.name).toBeLessThanOrEqual(132);
        expect(numbers[i + 1], p.name).toBeGreaterThanOrEqual(0);
        expect(numbers[i + 1], p.name).toBeLessThanOrEqual(56);
      }
    }
  });
});

describe('the altitude scale in the picture (design review)', () => {
  const top = 72;
  const bottom = 472;

  it('runs from the ground at its foot to the top of the range, spread as the altitude slider is', () => {
    expect(altitudeY(0, top, bottom)).toBe(bottom);
    expect(altitudeY(100, top, bottom)).toBe(top);
    // Ten kilometres sits a third of the way up, as on the slider.
    expect(altitudeY(10, top, bottom)).toBeCloseTo(bottom - Math.sqrt(0.1) * (bottom - top), 9);
    expect(altitudeY(-5, top, bottom)).toBe(bottom);
    expect(altitudeY(500, top, bottom)).toBe(top);
  });

  it('marks the same heights as the slider', () => {
    expect(ALTITUDE_MARKS.map((m) => m.at)).toEqual([0, 10, 40, 86]);
    expect(ALTITUDE_MARKS.map((m) => m.label)).toEqual(['Sea level', '10 km', '40 km', 'Vacuum']);
  });

  it('is left out of a picture too short to read it', () => {
    expect(altitudeScaleFits(600)).toBe(true);
    expect(altitudeScaleFits(260)).toBe(false);
  });
});
