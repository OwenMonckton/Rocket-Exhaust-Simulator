import { createRumble } from '../audio/rumble';
import { SEA_LEVEL_PRESSURE } from '../physics/atmosphere';
import { simulate } from '../physics/engine';
import { getPreset } from '../physics/presets';
import { PROPELLANTS } from '../physics/propellants';
import type { Failure, SimResult } from '../physics/types';
import { machFromAreaRatio } from '../physics/nozzle';
import { BORE_FRACTION, GRAIN_END, drawEngine, type FlowOverlay } from '../render/engineView';
import { ENGINE_NX } from '../render/engineSim';
import { engineProfile, radiusAt, viewTransform, type View } from '../render/geometry';
import { createPlumeRenderer, type EngineGas } from '../render/plume';
import { fixedExitFlow, plumeParams, simInputs } from '../render/plumeParams';
import { isModified, type AppState, type Store } from '../state/store';

export interface FrameInfo {
  result: SimResult;
  stock: SimResult | null;
  stockName: string | null;
  firing: boolean;
  /** Altitude sweep in progress: 1 climbing, -1 descending, 0 none */
  sweep: Sweep;
  failure: Failure;
}

export interface Runtime {
  toggleFire(): void;
  /** Start an altitude sweep in a direction (1 up, -1 down), or pause it if already running that way. */
  toggleSweep(direction: 1 | -1): void;
  rebuild(): void;
  setOverlay(o: FlowOverlay): void;
  setMuted(m: boolean): void;
  /** Prototype: draw the plume from the gas simulation instead of the hand-shaped model. */
  setPlumeMode(mode: PlumeMode): void;
  /** False when this browser cannot run the gas simulation */
  readonly hasSim: boolean;
  /** False when this browser cannot run the simulation of the gas inside the engine */
  readonly hasEngineSim: boolean;
  /** Show the gas inside the engine from a gas simulation instead of painting it on. */
  setEngineGas(mode: PlumeMode): void;
  /** 1 is the default framing; smaller values shrink the engine to show more of the plume. Returns the zoom actually applied. */
  setZoom(z: number): number;
  getZoom(): number;
  /** False when WebGL2 is unavailable */
  readonly hasPlume: boolean;
}

export type PlumeMode = 'drawn' | 'sim';
export type Sweep = 0 | 1 | -1;

const RAMP_UP_S = 1.0;
const RAMP_DOWN_S = 0.6;
const SWEEP_S = 30;
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 1.4;

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
  let sweep: Sweep = 0;
  let failure: Failure = null;
  let failT = 0;
  let overlay: FlowOverlay = 'none';
  let plumeMode: PlumeMode = 'drawn';
  let engineGas: PlumeMode = 'drawn';
  // The engine the gas inside was last simulated for: a different engine starts afresh.
  let simulatedEngine = '';
  const radii = new Float32Array(ENGINE_NX + 1);
  let zoom = 1;
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

    if (sweep !== 0 && firing) {
      const alt = store.get().flight.altitudeKm + (sweep * dt * 100) / SWEEP_S;
      if (alt >= 100 || alt <= 0) sweep = 0;
      store.set({ flight: { altitudeKm: Math.min(100, Math.max(0, alt)) } });
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
        sweep = 0;
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
    const target = viewTransform(profile, w, h, zoom);
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
    const pixelsPerMetre = view.ppm * dpr;
    const useSim = plumeMode === 'sim' && (plume?.simAvailable ?? false);

    // A nozzle extension is a separate part. Until it seats, the gas leaves the engine at the end
    // of the fixed nozzle and the extension is just a wall in its way. The simulated plume always
    // starts at the fixed nozzle, and works out the flow inside the extension itself.
    const ext = profile.extension;
    const fixedFlow = ext ? fixedExitFlow(state.config, result) : null;
    const fromFixed = ext && fixedFlow && (useSim || state.config.extDeploy < 0.98) ? { ext, flow: fixedFlow } : null;
    const flowExitX = fromFixed ? fromFixed.ext.seam.x : profile.exitX;
    const plumeRadiusM = fromFixed
      ? useSim
        ? fromFixed.flow.radiusM
        : Math.min(params.exitRadiusM, fromFixed.ext.seam.r)
      : params.exitRadiusM;
    const wall = fromFixed
      ? {
          x0: -fromFixed.ext.shift / plumeRadiusM,
          r0: fromFixed.ext.seam.r / plumeRadiusM,
          x1: (fromFixed.ext.length - fromFixed.ext.shift) / plumeRadiusM,
          r1: state.config.exitDia / 2 / plumeRadiusM,
          // The extension continues the bell's curve from where the fixed nozzle leaves off.
          slope0: fromFixed.ext.seamSlope,
        }
      : null;

    const sim = useSim
      ? simInputs(
          state.config,
          result,
          fire,
          fromFixed ? { flow: fromFixed.flow, wallSlope: fromFixed.ext.seamSlope } : undefined,
        )
      : null;
    if (sim && result.state !== 'separated') {
      // Tell the solver how the bell curves in upstream of its lip, so its idea of where the
      // nozzle wall is matches the nozzle that is drawn. Fitted two exit radii back.
      const back = Math.min(2 * plumeRadiusM, flowExitX - profile.throatX);
      const u = back / plumeRadiusM;
      if (u > 0.05) {
        const radiusBack = radiusAt(profile, flowExitX - back) / plumeRadiusM;
        sim.wallCurve = Math.min(0.2, Math.max(-0.5, (radiusBack - 1 + sim.divergence * u) / (u * u)));
      }
    }

    // The gas inside the engine, simulated from the injector face to where it leaves the nozzle.
    let gas: EngineGas | null = null;
    // A jet that has torn off the wall leaves the nozzle narrower than the nozzle is, which the
    // engine simulation (it always fills the nozzle) knows nothing about.
    const jetFillsNozzle = fromFixed ? !fromFixed.flow.separated : result.state !== 'separated';
    if (engineGas === 'sim' && (plume?.engineSimAvailable ?? false) && !failure) {
      const cfg = state.config;
      const rc = cfg.chamberDia / 2;
      // A solid motor's gas runs down the bore of its grain, which opens out where the grain ends.
      const grainEnd = cfg.chamberLen * GRAIN_END;
      const taper = Math.min(0.6 * rc, 0.4 * cfg.chamberLen);
      for (let i = 0; i <= ENGINE_NX; i++) {
        const x = (i / ENGINE_NX) * flowExitX;
        let r = radiusAt(profile, x);
        if (cfg.propellant === 'solid' && x < grainEnd) {
          const t = Math.min(1, Math.max(0, (x - (grainEnd - taper)) / taper));
          r = Math.min(r, rc * (BORE_FRACTION + (1 - BORE_FRACTION) * t * t * (3 - 2 * t)));
        }
        radii[i] = r;
      }
      const g = result.gamma;
      const exitMach = machFromAreaRatio(result.expansionRatio, g);
      const exitTemp = 1 / (1 + ((g - 1) / 2) * exitMach * exitMach);
      const exitPressure = Math.pow(exitTemp, g / (g - 1));
      const engine = `${cfg.presetId}|${cfg.propellant}`;
      if (engine !== simulatedEngine) plume?.resetEngineSim();
      simulatedEngine = engine;
      gas = {
        inputs: {
          gamma: g,
          fire,
          length: flowExitX,
          radii,
          // Never a true vacuum, which the solver cannot hold: a fraction of the exit pressure at least.
          restPressure: Math.min(0.3, Math.max(0.3 * exitPressure, result.pa / result.pc)),
          // Well below anything the exhaust reaches, even down the centreline of a big nozzle
          // where it runs colder than average, so cold still gas can be told apart from it.
          restTemp: Math.min(0.1, 0.2 * exitTemp),
          exitPressure,
        },
        originX: view.originX * dpr,
        scale: pixelsPerMetre,
        mode: overlay === 'none' ? 'flame' : overlay,
        exitTemp,
        machMax: Math.max(1.5, exitMach),
        // The simulated plume carries on from the gas this simulation delivers to the exit.
        feedsPlumeAtMach: useSim && jetFillsNozzle ? (fromFixed ? fromFixed.flow.mach : result.exitMach) : undefined,
      };
    }

    plume?.draw(
      params,
      {
        exitX: (view.originX + flowExitX * view.ppm) * dpr,
        exitY: (h - view.centreY) * dpr,
        radiusPx: plumeRadiusM * view.ppm * dpr,
        offsetsPx: profile.offsets.map((o) => o * pixelsPerMetre),
        wall,
      },
      timeS,
      sim,
      gas,
    );

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawEngine(ctx, state.config, result, view, { fire, timeS, overlay, failure, failT, flowExitX, simGas: gas !== null }, w, h);
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
        sweep,
        failure,
      });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    hasPlume: plume !== null,
    hasSim: plume?.simAvailable ?? false,
    hasEngineSim: plume?.engineSimAvailable ?? false,
    setPlumeMode(mode) {
      if (mode === 'sim' && plumeMode !== 'sim') plume?.resetSim();
      plumeMode = mode;
    },
    setEngineGas(mode) {
      if (mode === 'sim' && engineGas !== 'sim') plume?.resetEngineSim();
      engineGas = mode;
    },
    toggleFire() {
      if (failure) return;
      firing = !firing;
      if (!firing) sweep = 0;
    },
    toggleSweep(direction) {
      if (failure) return;
      if (sweep === direction) {
        sweep = 0;
        return;
      }
      // Start from the far end if the engine is off, or if it is already where it is headed.
      const alt = store.get().flight.altitudeKm;
      if (direction === 1 && (alt >= 99.9 || !firing)) store.set({ flight: { altitudeKm: 0 } });
      if (direction === -1 && (alt <= 0.1 || !firing)) store.set({ flight: { altitudeKm: 100 } });
      firing = true;
      sweep = direction;
    },
    rebuild() {
      failure = null;
      failT = 0;
      fire = 0;
      firing = false;
      store.replace(lastGood);
    },
    setZoom(z) {
      zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
      return zoom;
    },
    getZoom: () => zoom,
    setOverlay(o) {
      overlay = o;
    },
    setMuted(m) {
      rumble.setMuted(m);
    },
  };
}
