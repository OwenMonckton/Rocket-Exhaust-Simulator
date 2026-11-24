import { describe, expect, it } from 'vitest';
import { PRESETS } from '../physics/presets';
import { engineProfile } from './geometry';

const round = (v: number) => Number(v.toPrecision(10));

// The example engines' shapes, pinned. A restructuring of the contour must not move them.
describe('example engine shapes', () => {
  for (const preset of PRESETS) {
    it(`shape of ${preset.id}`, () => {
      const p = engineProfile(preset.config);
      expect({
        points: p.points.map((pt) => [round(pt.x), round(pt.r)]),
        throatX: round(p.throatX),
        exitX: round(p.exitX),
        length: round(p.length),
        maxRadius: round(p.maxRadius),
        offsets: p.offsets.map(round),
        halfHeight: round(p.halfHeight),
        frontSpace: round(p.frontSpace),
        extension: p.extension
          ? {
              seam: [round(p.extension.seam.x), round(p.extension.seam.r)],
              length: round(p.extension.length),
              seamSlope: round(p.extension.seamSlope),
            }
          : null,
      }).toMatchSnapshot();
    });
  }
});
