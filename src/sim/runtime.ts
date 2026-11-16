import { createRumble } from '../audio/rumble';
import { SEA_LEVEL_PRESSURE } from '../physics/atmosphere';
import { simulate } from '../physics/engine';
import { getPreset } from '../physics/presets';
import { PROPELLANTS } from '../physics/propellants';
import type { Failure, SimResult } from '../physics/types';
import { drawEngine, type FlowOverlay } from '../render/engineView';
import { engineProfile, viewTransform, type View } from '../render/geometry';
import { createPlumeRenderer } from '../render/plume';
import { plumeParams, simInputs } from '../render/plumeParams';
import { isModified, type AppState, type Store } from '../state/store';

export interface FrameInfo {
  result: SimResult;
  stock: SimResult | null;
  stockName: string | null;
  firing: boolean;
  ascent: boolean;
  failure: Failure;
}

export interface Runtime {
  toggleFire(): void;
  toggleAscent(): void;
  rebuild(): void;
  setOverlay(o: FlowOverlay): void;
  setMuted(m: boolean): void;
  /** Prototype: draw the plume from the gas simulation instead of the hand-shaped model. */
  setPlumeMode(mode: PlumeMode): void;
  /** False when this browser cannot run the gas simulation */
  readonly hasSim: boolean;
  /** False when WebGL2 is unavailable */
  readonly hasPlume: boolean;
}

export type PlumeMode = 'drawn' | 'sim';

const RAMP_UP_S = 1.0;
const RAMP_DOWN_S = 0.6;
const ASCENT_S = 30;

export function createRuntime(
  store: Store,
  stage: HTMLElement,
  glCanvas: HTMLCanvasElement,
  overlayCanvas: HTMLCanvasElement,
  onFrame: (info: FrameInfo) => void,
): Runtime {
  const plume = createPlumeRenderer(glCanvas);
  const ctx = overlayCanvas.getContext('2d')!;
  const rumble = createRumble();

  let firing = false;
  let fire = 0;
  let ascent = false;
  let failure: Failure = null;
  let failT = 0;
  let overlay: FlowOverlay = 'none';
  let plumeMode: PlumeMode = 'drawn';
  let lastGood: AppState = store.get();
  // Remember the most recent engine that would survive firing, for the Rebuild button.
  store.subscribe((s) => {
    if (!failure && !simulate(s.config, s.flight).failure) lastGood = s;
  });
  let view: View | null = null;
  let last = performance.now();
  let frameCount = 0;

  const frame = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const timeS = now / 1000;

    if (ascent && firing) {
      const alt = store.get().flight.altitudeKm + (dt * 100) / ASCENT_S;
      if (alt >= 100) ascent = false;
      store.set({ flight: { altitudeKm: Math.min(100, alt) } });
    }

    const state = store.get();
    const result = simulate(state.config, state.flight);

    if (failure) {
      failT += dt;
    } else {
      fire = firing ? Math.min(1, fire + dt / RAMP_UP_S) : Math.max(0, fire - dt / RAMP_DOWN_S);
      if (firing && fire > 0.6 && result.failure) {
        failure = result.failure;
        failT = 0;
        firing = false;
        ascent = false;
        fire = 0;
      }
    }

    // Size both canvases to the stage.
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (overlayCanvas.width !== pw || overlayCanvas.height !== ph) {
      overlayCanvas.width = pw;
      overlayCanvas.height = ph;
    }
    plume?.resize(pw, ph);

    // Ease the zoom so resizing the engine doesn't make the view jump.
    const profile = engineProfile(state.config);
    const target = viewTransform(profile, w, h);
    if (!view) view = target;
    else {
      const k = Math.min(1, dt * 9);
      view = {
        ppm: view.ppm + (target.ppm - view.ppm) * k,
        originX: view.originX + (target.originX - view.originX) * k,
        centreY: target.centreY,
      };
    }

    const params = plumeParams(state.config, result, state.flight, fire);
    plume?.draw(
      params,
      {
        exitX: (view.originX + profile.exitX * view.ppm) * dpr,
        exitY: (h - view.centreY) * dpr,
        radiusPx: params.exitRadiusM * view.ppm * dpr,
      },
      timeS,
      plumeMode === 'sim' ? simInputs(state.config, result, fire) : null,
    );

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawEngine(ctx, state.config, result, view, { fire, timeS, overlay, failure, failT }, w, h);

    const throttle = PROPELLANTS[state.config.propellant].throttleable ? state.flight.throttle : 1;
    rumble.setLevel(fire * (0.45 + 0.55 * throttle), result.pa / SEA_LEVEL_PRESSURE);

    // The readouts don't need to update every frame.
    if (frameCount++ % 4 === 0) {
      const preset = getPreset(state.config.presetId);
      const modified = preset ? isModified(state.config) : false;
      onFrame({
        result,
        stock: preset && modified ? simulate(preset.config, state.flight) : null,
        stockName: preset?.name ?? null,
        firing,
        ascent,
        failure,
      });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    hasPlume: plume !== null,
    hasSim: plume?.simAvailable ?? false,
    setPlumeMode(mode) {
      if (mode === 'sim' && plumeMode !== 'sim') plume?.resetSim();
      plumeMode = mode;
    },
    toggleFire() {
      if (failure) return;
      firing = !firing;
      if (!firing) ascent = false;
    },
    toggleAscent() {
      if (failure) return;
      if (ascent) {
        ascent = false;
        return;
      }
      if (store.get().flight.altitudeKm >= 99.9 || !firing) store.set({ flight: { altitudeKm: 0 } });
      firing = true;
      ascent = true;
    },
    rebuild() {
      failure = null;
      failT = 0;
      fire = 0;
      firing = false;
      store.replace(lastGood);
    },
    setOverlay(o) {
      overlay = o;
    },
    setMuted(m) {
      rumble.setMuted(m);
    },
  };
}
