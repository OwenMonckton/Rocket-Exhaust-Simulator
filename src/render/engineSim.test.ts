import { describe, expect, it } from 'vitest';
import { PRESETS } from '../physics/presets';
import { ENGINE_NX, ENGINE_NY, initialEngineState, type EngineSimInputs } from './engineSim';
import { engineProfile, grainBore, grainLeft, radiusAt } from './geometry';

function inputsFor(presetId: string, fire: number): EngineSimInputs {
  const cfg = PRESETS.find((p) => p.id === presetId)!.config;
  const profile = engineProfile(cfg);
  const radii = new Float32Array(ENGINE_NX + 1);
  for (let i = 0; i <= ENGINE_NX; i++) radii[i] = radiusAt(profile, (i / ENGINE_NX) * profile.exitX);
  return { gamma: 1.2, fire, length: profile.exitX, radii, restPressure: 0.01, restTemp: 0.1, exitPressure: 0.005 };
}

describe('initialEngineState', () => {
  it('starts an unlit engine full of still gas', () => {
    const inputs = inputsFor('merlin-1d', 0);
    const state = initialEngineState(inputs);
    for (let n = 0; n < state.length; n += 4) {
      expect(state[n]).toBeCloseTo(0.1, 6);
      expect(state[n + 1]).toBeCloseTo(0, 12);
      expect(state[n + 2]).toBeCloseTo(0, 12);
    }
  });

  it('starts a burning engine with every value finite and the same flow at every station', () => {
    for (const id of ['merlin-1d', 'rl10b-2', 'solid-booster']) {
      const inputs = inputsFor(id, 1);
      const state = initialEngineState(inputs);
      expect(state.every(Number.isFinite)).toBe(true);
      // Mass flow through a station: density x speed x area, taken along the centreline.
      const flow = (i: number) => {
        const r = 0.5 * (inputs.radii[i] + inputs.radii[i + 1]);
        return state[i * 4 + 1] * r * r;
      };
      const reference = flow(ENGINE_NX - 1);
      for (const i of [0, 60, 150, 250, 350]) expect(flow(i) / reference).toBeCloseTo(1, 1);
    }
  });

  it('goes from subsonic in the chamber to supersonic at the exit', () => {
    const inputs = inputsFor('merlin-1d', 1);
    const state = initialEngineState(inputs);
    const mach = (i: number) => {
      const n = (Math.floor(ENGINE_NY / 2) * ENGINE_NX + i) * 4;
      const [rho, mx, my, e] = [state[n], state[n + 1], state[n + 2], state[n + 3]];
      const speed2 = (mx * mx + my * my) / (rho * rho);
      const p = (inputs.gamma - 1) * (e - 0.5 * rho * speed2);
      return Math.sqrt(speed2 / ((inputs.gamma * p) / rho));
    };
    expect(mach(0)).toBeLessThan(0.5);
    expect(mach(ENGINE_NX - 1)).toBeGreaterThan(2.5);
  });
});

describe('solid grain', () => {
  const cfg = PRESETS.find((p) => p.id === 'solid-booster')!.config;
  const rc = cfg.chamberDia / 2;

  it('has a bore that opens out toward the nozzle', () => {
    expect(grainBore(cfg, 0)).toBeLessThan(0.2 * rc);
    expect(grainBore(cfg, 0.5 * cfg.chamberLen)).toBeGreaterThan(grainBore(cfg, 0.1 * cfg.chamberLen));
    expect(grainBore(cfg, cfg.chamberLen)).toBe(Infinity);
  });

  it('burns back evenly, reaching the case at the nozzle end first', () => {
    const x = 0.3 * cfg.chamberLen;
    expect(grainBore(cfg, x, 0.5) - grainBore(cfg, x, 0)).toBeCloseTo(grainBore(cfg, 0, 0.5) - grainBore(cfg, 0, 0), 9);
    expect(grainBore(cfg, 0.9 * cfg.chamberLen, 0.75)).toBeGreaterThanOrEqual(rc);
    expect(grainBore(cfg, 0, 0.75)).toBeLessThan(rc);
  });

  it('runs from a full grain to nothing', () => {
    expect(grainLeft(cfg, 0)).toBeCloseTo(1, 9);
    expect(grainLeft(cfg, 0.5)).toBeGreaterThan(0);
    expect(grainLeft(cfg, 0.5)).toBeLessThan(grainLeft(cfg, 0.25));
    expect(grainLeft(cfg, 1)).toBe(0);
  });
});