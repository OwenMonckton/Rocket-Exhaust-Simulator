import { describe, expect, it } from 'vitest';
import { simulate } from '../physics/engine';
import { createStore, defaultState } from '../state/store';
import { engineAfterRebuild, latchesNow } from './rebuild';

describe('the engine after Relight or Rebuild', () => {
  it('keeps a correction made while the failure box was up', () => {
    const store = createStore(defaultState());
    const lastGood = store.get(); // RP-1 and oxygen, which runs
    store.setOxidiser('none');
    store.setFuel('ethanol');
    expect(simulate(store.get().config, store.get().flight).failure).toBe('inert');
    // As the box says: pick an oxidiser.
    store.setOxidiser('n2o4');
    const after = engineAfterRebuild(store.get(), lastGood);
    expect([after.config.fuel, after.config.oxidiser]).toEqual(['ethanol', 'n2o4']);
  });

  it('goes back to the last engine that ran when this one would still fail', () => {
    const store = createStore(defaultState());
    const lastGood = store.get();
    store.setOxidiser('none');
    store.setFuel('ethanol');
    const after = engineAfterRebuild(store.get(), lastGood);
    expect(after).toBe(lastGood);
  });
});

describe('when a failure shows', () => {
  it('at once for an engine that never lit, as Fire is pressed', () => {
    expect(latchesNow('inert', 0.01)).toBe(true);
    expect(latchesNow('unsolved', 0.01)).toBe(true);
  });
  it('once the flame is well up for one that lit and then failed', () => {
    expect(latchesNow('flameout', 0.3)).toBe(false);
    expect(latchesNow('burst', 0.3)).toBe(false);
    expect(latchesNow('burst', 0.61)).toBe(true);
    expect(latchesNow(null, 1)).toBe(false);
  });
});
