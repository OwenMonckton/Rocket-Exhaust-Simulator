import { describe, expect, it } from 'vitest';
import { EXHAUSTS, EXHAUST_IDS, defaultInnerExitDia, jetLeftWall } from './exhausts';
import type { ExpansionState } from './types';

describe('exhaust records', () => {
  it('has a record for every exhaust id, with a name and a tip', () => {
    expect(EXHAUST_IDS).toEqual(['bell', 'cone', 'dualBell', 'aerospike', 'none']);
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
    expect(EXHAUSTS.cone.sliders).toEqual({ exitDia: true, nozzleLenPct: false, coneAngleDeg: true, innerExitDia: false });
    expect(EXHAUSTS.dualBell.sliders).toEqual({ exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: true });
    expect(EXHAUSTS.none.sliders).toEqual({ exitDia: false, nozzleLenPct: false, coneAngleDeg: false, innerExitDia: false });
    expect(EXHAUSTS.bell.sliders).toEqual({ exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: false });
    expect(EXHAUSTS.aerospike.sliders).toEqual({ exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: false });
  });
  it('opens a dual bell with the square root of the area ratio in its inner bell', () => {
    expect(defaultInnerExitDia(0.2, 2.0)).toBeCloseTo(0.2 * Math.sqrt(10), 12);
  });
  it('counts a held jet and a torn-off jet as having left the wall', () => {
    expect(['ideal', 'over', 'under', 'separated', 'compensating', 'held'].filter((s) => jetLeftWall(s as ExpansionState)))
      .toEqual(['separated', 'held']);
  });
});
