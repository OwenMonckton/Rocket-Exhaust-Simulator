import { describe, expect, it } from 'vitest';
import { simulate } from '../physics/engine';
import { createStore, defaultState } from '../state/store';
import { engineAfterRebuild } from './rebuild';

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
