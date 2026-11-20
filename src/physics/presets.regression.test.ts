import { describe, expect, it } from 'vitest';
import { simulate } from './engine';
import { PRESETS } from './presets';

const round = (v: number) => Number(v.toPrecision(10));

// The example engines' figures, pinned. A restructuring of the engine's parts must not move them.
describe('example engines', () => {
  for (const preset of PRESETS) {
    it(`figures for ${preset.id}`, () => {
      const at = (altitudeKm: number) => {
        const r = simulate(preset.config, { altitudeKm, throttle: 1 });
        return {
          thrust: round(r.thrust),
          isp: round(r.isp),
          ispSeaLevel: round(r.ispSeaLevel),
          ispVacuum: round(r.ispVacuum),
          massFlow: round(r.massFlow),
          tc: round(r.tc),
          exitMach: round(r.exitMach),
          pe: round(r.pe),
          structural: round(r.limits.structural),
          heating: round(r.limits.heating),
          instability: round(r.limits.instability),
          state: r.state,
          failure: r.failure,
        };
      };
      expect({ seaLevel: at(0), vacuum: at(100) }).toMatchSnapshot();
    });
  }
});
