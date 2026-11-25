import { describe, expect, it } from 'vitest';
import { simulate } from '../physics/engine';
import { getPreset } from '../physics/presets';
import { STAND_GONE_KM } from './stand';
import { FROZEN_RUN_LINE, nextLive, readingsFor, restoreLine, spaceFires, type LiveFrame } from './runState';

const merlin = getPreset('merlin-1d')!.config;
const lit = simulate(merlin, { altitudeKm: 0, throttle: 1 });
const cold = simulate({ ...merlin, chamberPressureBar: 400 }, { altitudeKm: 0, throttle: 1 });

describe('the readings while a failure is showing', () => {
  const live: LiveFrame = { result: lit, fire: 0.62, held: true };

  it('freeze on the last live frame, at the power it had reached, and say so', () => {
    const shown = readingsFor({ result: cold, fire: 0, failure: 'burst' }, live);
    expect(shown.result).toBe(lit);
    expect(shown.fire).toBe(0.62);
    expect(shown.frozen).toBe(true);
    expect(FROZEN_RUN_LINE).toBe('Readings at the moment of failure');
  });

  it('are the engine as it stands when it never lit, so there is no live frame to keep', () => {
    const shown = readingsFor({ result: cold, fire: 0, failure: 'inert' }, null);
    expect(shown).toEqual({ result: cold, fire: 0, frozen: false });
  });

  it('are the live ones when nothing has failed', () => {
    expect(readingsFor({ result: lit, fire: 1, failure: null }, live)).toEqual({ result: lit, fire: 1, frozen: false });
  });
});

describe('the frame the readings hold at a failure', () => {
  it('is the failing engine, at the power the run had reached, held however the settings move after', () => {
    // Lit at stock, then the pressure is pushed past the walls in one move.
    let live = nextLive(null, { result: lit, fire: 0.62, firing: true, failure: null });
    expect(live).toEqual({ result: lit, fire: 0.62, held: false });
    live = nextLive(live, { result: cold, fire: 0, firing: false, failure: 'burst' });
    // The figures that broke it, not the last safe ones.
    expect(live).toEqual({ result: cold, fire: 0.62, held: true });
    // Settings moved while the notice shows do not change what it holds.
    expect(nextLive(live, { result: lit, fire: 0, firing: false, failure: 'burst' })).toBe(live);
  });

  it('is nothing for an engine that never lit, and is let go once the failure is cleared', () => {
    expect(nextLive(null, { result: cold, fire: 0, firing: false, failure: 'inert' })).toBeNull();
    const held: LiveFrame = { result: cold, fire: 0.62, held: true };
    expect(nextLive(held, { result: lit, fire: 0, firing: false, failure: null })).toBeNull();
  });
});

describe('the log line when the engine is put right after a failure', () => {
  it('says the engine was rebuilt, and is back on the stand only where there is a stand', () => {
    expect(restoreLine('burst', 0, 'combustion')).toBe('Engine rebuilt and back on the stand.');
    expect(restoreLine('burst', STAND_GONE_KM / 2, 'combustion')).toBe('Engine rebuilt and back on the stand.');
    expect(restoreLine('burst', 42.7, 'combustion')).toBe('Engine rebuilt.');
    expect(restoreLine('meltdown', 100, 'reactor')).toBe('Engine rebuilt.');
  });

  it('says an engine that only went out, or never started, is ready again', () => {
    expect(restoreLine('flameout', 0, 'combustion')).toBe('Ready to fire again.');
    expect(restoreLine('underpowered', 30, 'arcjet')).toBe('Ready to fire again.');
    expect(restoreLine('noVacuum', 100, 'ion')).toBe('Ready to switch on again.');
    expect(restoreLine('gridOverload', 100, 'ion')).toBe('Ready to switch on again.');
  });
});

describe('the Space key', () => {
  it('fires from anywhere but a control that uses Space itself', () => {
    for (const tag of ['BODY', 'DIV', 'CANVAS', 'P']) expect(spaceFires(tag), tag).toBe(true);
    // A slider, a text box, a button, a menu and a folding heading all take Space for themselves.
    for (const tag of ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'SUMMARY']) expect(spaceFires(tag), tag).toBe(false);
  });
});
