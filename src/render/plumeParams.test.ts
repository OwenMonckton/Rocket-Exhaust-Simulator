import { describe, expect, it } from 'vitest';
import { simulate } from '../physics/engine';
import { PRESETS, getPreset } from '../physics/presets';
import { plumeParams } from './plumeParams';

const at = (id: string, altitudeKm: number, patch = {}, fire = 1) => {
  const cfg = { ...getPreset(id)!.config, ...patch };
  const flight = { altitudeKm, throttle: 1 };
  return plumeParams(cfg, simulate(cfg, flight), flight, fire);
};

describe('plume parameters', () => {
  it('shows diamonds only where the air can push back', () => {
    expect(at('merlin-1d', 0).diamondStrength).toBeGreaterThan(0.2);
    expect(at('merlin-1d', 100).diamondStrength).toBe(0);
    // Find the altitude where Merlin is ideally expanded: no diamonds there.
    let ideal = 0;
    for (let h = 0; h < 20; h += 0.05) {
      const cfg = getPreset('merlin-1d')!.config;
      if (simulate(cfg, { altitudeKm: h, throttle: 1 }).state === 'ideal') {
        ideal = h;
        break;
      }
    }
    expect(ideal).toBeGreaterThan(0);
    expect(at('merlin-1d', ideal + 0.3).diamondStrength).toBe(0);
  });
  it('flares steadily wider with altitude', () => {
    let prevBloom = -1;
    let prevRadius = 0;
    for (let h = 0; h <= 100; h += 2) {
      const p = at('merlin-1d', h);
      expect(p.bloom).toBeGreaterThanOrEqual(prevBloom);
      expect(p.settleRadius).toBeGreaterThanOrEqual(prevRadius);
      prevBloom = p.bloom;
      prevRadius = p.settleRadius;
    }
    expect(prevBloom).toBe(1);
    expect(at('merlin-1d', 0).settleRadius).toBeLessThan(1);
  });
  it('gets sootier when fuel-rich and cleaner when oxidiser-rich', () => {
    const rich = at('merlin-1d', 0, { mixtureRatio: 1.9 });
    const lean = at('merlin-1d', 0, { mixtureRatio: 3.3 });
    expect(rich.soot).toBeGreaterThan(lean.soot);
    expect(lean.soot).toBe(0);
  });
  it('is dark when not firing and gives every propellant a different colour', () => {
    expect(at('merlin-1d', 0, {}, 0).intensity).toBe(0);
    const mids = ['merlin-1d', 'rs-25', 'raptor-2', 'solid-booster'].map((id) => at(id, 0).mid.join(','));
    expect(new Set(mids).size).toBe(4);
  });
  it('stays finite for every preset from ground to vacuum', () => {
    for (const p of PRESETS) {
      for (const h of [0, 10, 40, 85.9, 86, 100]) {
        for (const v of Object.values(at(p.id, h))) {
          if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  });
});
