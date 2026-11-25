import { createRumble } from '../audio/rumble';
import { SEA_LEVEL_PRESSURE } from '../physics/atmosphere';
import { simulate } from '../physics/engine';
import { EXHAUSTS, jetLeftWall, ringWallRadius } from '../physics/exhausts';
import { getPreset } from '../physics/presets';
import { ENERGY_SOURCES } from '../physics/parts';
import { resolveGas } from '../physics/gasSource';
import type { EnergyId, ExhaustId, Failure, SimResult } from '../physics/types';
import { machFromAreaRatio } from '../physics/nozzle';
import { drawEngine, type FlowOverlay } from '../render/engineView';
import { ENGINE_NX, type ColumnReading } from '../render/engineSim';
import { GRAIN_END, engineProfile, grainBore, radiusAt, viewTransform, type View } from '../render/geometry';
import { createPlumeRenderer, type EngineGas } from '../render/plume';
import { edSimInputs, engineRestPressure, fixedExitFlow, plumeParams, simInputs, spikeSimInputs, wholeNozzleFlow } from '../render/plumeParams';
import { simulatedFigures, type SimulatedFigures } from '../render/simFigures';
import { isModified, type AppState, type Store } from '../state/store';
import { engineAfterRebuild, latchesNow } from './rebuild';

export interface FrameInfo {
  result: SimResult;
  /** The engine's exhaust type */
  exhaust: ExhaustId;
  /** The engine's energy source */
  energy: EnergyId;
  stock: SimResult | null;
  stockName: string | null;
  firing: boolean;
  /** How far the engine has run up: 0 unlit, 1 at full power */
  fire: number;
  /** Altitude sweep in progress: 1 climbing, -1 descending, 0 none */
  sweep: Sweep;
  failure: Failure;
  /** Where the engine sits in the picture, in CSS pixels, for anything drawn over it */
  layout: StageLayout;
  /** Thrust, flow and efficiency worked out from the simulated gas; null when there are none to show */
  simulated: SimulatedFigures | null;
  /** Why there are none, in a few words; empty when there are, or when there is nothing to say */
  simulatedNote: string;
}

/** The engine's place in the picture: x of its injector face, its centreline, and its main stations. */
export interface StageLayout {
  /** Pixels per metre */
  ppm: number;
  /** x of the injector face */
  originX: number;
  centreY: number;
  /** x of the end of the chamber, the throat and the exit */
  chamberEndX: number;
  throatX: number;
  exitX: number;
  /** Half the height of everything drawn, and the length ahead of the injector face, px */
  halfHeight: number;
  frontSpace: number;
  /** Radius of the wall at the injector face and at the exit, px */
  chamberRadius: number;
  exitRadius: number;
  /** How many chambers are drawn side by side */
  chambersDrawn: number;
}

export interface Runtime {
  toggleFire(): void;
  /** Start an altitude sweep in a direction (1 up, -1 down), or pause it if already running that way. */
  toggleSweep(direction: 1 | -1): void;
  rebuild(): void;
  /** Clear away a failure and a part-burnt grain, for an engine chosen whole (a new engine or an example) rather than rebuilt. */
  clearFailure(): void;
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
/** Frames at full power before figures are taken from the simulated gas: about a second, for it to settle. */
const SETTLE_FRAMES = 60;
/** Seconds between readings of the simulated gas for those figures. */
const READ_EVERY_S = 1;
/** How long a solid motor's grain lasts at full burn. Longer than an altitude sweep, so one motor can fly it. */
const SOLID_BURN_S = 60;
/**
 * Exhaust lighter than this (kg/kmol) is too light for the engine's grid to carry a separated jet
 * of: hot hydrogen (2), helium (4) and a salt-water engine's gas (6). No flame is this light.
 */
const LIGHT_EXHAUST_MOLAR_MASS = 7;
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
  // How far a solid motor's grain has burned (0 fresh, 1 gone), and the motor it belongs to.
  let burnt = 0;
  let burningMotor = '';
  const radii = new Float32Array(ENGINE_NX + 1);
  // Thrust and efficiency worked out from the simulated gas: how many frames it has had to
  // settle at full power, and the figures themselves, smoothed.
  let settledFrames = 0;
  let latestReading: ColumnReading | null = null;
  let lastAskedS = -Infinity;
  let simulated: SimulatedFigures | null = null;
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

    // A solid motor burns its grain away while it fires, and goes out when there is none left.
    // Choosing a different engine casts a fresh grain.
    const isSolid = state.config.energy === 'solid';
    const motor = `${state.config.presetId}|${state.config.energy}|${state.config.exhaust}|${state.config.propellant}|${state.config.fuel}|${state.config.oxidiser}`;
    if (motor !== burningMotor) burnt = 0;
    burningMotor = motor;
    if (isSolid && !failure && fire > 0.5) {
      burnt = Math.min(1, burnt + dt / SOLID_BURN_S);
      if (burnt >= 1) {
        firing = false;
        sweep = 0;
      }
    }

    if (failure) {
      failT += dt;
    } else {
      fire = firing ? Math.min(1, fire + dt / RAMP_UP_S) : Math.max(0, fire - dt / RAMP_DOWN_S);
      if (firing && latchesNow(result.failure, fire)) {
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
    // With the gas inside the engine and the plume both simulated, the two solvers run as one
    // and work out for themselves what an over-expanded nozzle does: where the shock stands,
    // whether outside air gets in. Nothing is taken from the formula that says where the jet
    // tears off the wall, so everything is laid out as if the gas filled the whole nozzle.
    //
    // One exception: a separated jet of very light exhaust (hot hydrogen or helium from a nuclear
    // engine, or a salt-water engine's far hotter gas). Beside outside air dozens of times denser, such
    // a jet gives up its momentum within a few diameters in the engine's grid and dies inside
    // the bell. Those keep the simpler treatment: the engine's gas runs on its own, the view is
    // clipped to where the formula puts the jet, and the plume starts from the formula.
    // It is the gas that decides, not the engine: a reactor heating water or carbon dioxide has
    // exhaust as heavy as a flame's.
    const lightExhaust =
      resolveGas(state.config, result.pc / 1e5, result.expansionRatio).gas.molarMass < LIGHT_EXHAUST_MOLAR_MASS;
    // The engine's gas simulation follows the wall of a bell from the injector to the exit. An
    // aerospike has no such wall: its gas runs along the outside of a spike, with open air on the
    // other side. That is the plume grid's kind of flow, so with the plume simulated the spike
    // stands in the plume's grid as a solid body, the gas enters as a ring at the lip, and the
    // grid works out the flow along the spike along with the plume. (With the plume drawn, the
    // aerospike's own view draws the gas on the spike from a formula.)
    const engineSimOn = engineGas === 'sim' && (plume?.engineSimAvailable ?? false) && !failure && !profile.spike && !profile.plug;
    // A dual bell's jet held at its kink has left the wall as surely as a torn-off one has.
    const leftWall = jetLeftWall(result.state);
    const wholeNozzle = useSim && engineSimOn && !(lightExhaust && leftWall);
    const spikeSim = useSim && profile.spike ? profile.spike : null;
    // An expansion-deflection nozzle is the plume grid's kind of flow too: a plug on the
    // centreline, gas arriving as a ring, and a hollow behind the plug that the outside air may
    // or may not reach. The grid takes the whole nozzle, from the ring to the mouth and beyond.
    // (Null where the bell is too long for the grid: the plume is then simulated from the mouth.)
    const edSim = useSim && profile.plug ? edSimInputs(state.config, result, fire, profile) : null;
    const ext = profile.extension;
    const fixedFlow = ext ? fixedExitFlow(state.config, result, wholeNozzle) : null;
    const fromFixed = ext && fixedFlow && (useSim || state.config.extDeploy < 0.98) ? { ext, flow: fixedFlow } : null;
    const flowExitX = edSim ? profile.throatX : spikeSim ? spikeSim.lip.x : fromFixed ? fromFixed.ext.seam.x : profile.exitX;
    const wholeFlow = wholeNozzle && !fromFixed ? wholeNozzleFlow(result) : null;
    const plumeRadiusM = edSim
      ? ringWallRadius(state.config)
      : spikeSim
      ? spikeSim.lip.r
      : fromFixed
        ? useSim
          ? fromFixed.flow.radiusM
          : Math.min(params.exitRadiusM, fromFixed.ext.seam.r)
        : wholeFlow
          ? wholeFlow.radiusM
          : params.exitRadiusM;
    const wall = edSim
      ? edSim.wall
      : fromFixed
      ? {
          x0: -fromFixed.ext.shift / plumeRadiusM,
          r0: fromFixed.ext.seam.r / plumeRadiusM,
          x1: (fromFixed.ext.length - fromFixed.ext.shift) / plumeRadiusM,
          r1: state.config.exitDia / 2 / plumeRadiusM,
          // The extension continues the bell's curve from where the fixed nozzle leaves off.
          slope0: fromFixed.ext.seamSlope,
        }
      : null;

    const sim = edSim
      ? edSim.inputs
      : spikeSim
      ? spikeSimInputs(state.config, result, fire, spikeSim)
      : useSim
        ? simInputs(
            state.config,
            result,
            fire,
            fromFixed
              ? { flow: fromFixed.flow, wallSlope: fromFixed.ext.seamSlope }
              : wholeFlow
                ? { flow: wholeFlow }
                : undefined,
          )
        : null;
    // An aerospike has no bell for the jet to follow.
    if (sim && !profile.spike && !edSim && (wholeNozzle || !leftWall)) {
      // Tell the solver how the bell curves in upstream of its lip, so its idea of where the
      // nozzle wall is matches the nozzle that is drawn. Fitted two exit radii back: inside the
      // nozzle, or with no nozzle, along the chamber narrowing to the throat.
      const fitFrom = EXHAUSTS[state.config.exhaust].hasNozzle ? profile.throatX : 0;
      const back = Math.min(2 * plumeRadiusM, flowExitX - fitFrom);
      const u = back / plumeRadiusM;
      if (u > 0.05) {
        const radiusBack = radiusAt(profile, flowExitX - back) / plumeRadiusM;
        sim.wallCurve = Math.min(0.2, Math.max(-0.5, (radiusBack - 1 + sim.divergence * u) / (u * u)));
      }
    }

    // The gas inside the engine, simulated from the injector face to where it leaves the nozzle.
    // A seated nozzle extension is part of the nozzle, so the engine's grid carries on through
    // it to the true exit. (Sliding or stowed, it is a loose cone standing in the plume, which
    // only the plume's grid can hold.) The plume's grid stays where it is either way, so
    // nothing jumps as the extension seats.
    // Not while the jet is separated, though: torn off the wall near the throat, it would have
    // the whole length of a very large bell to cross as a free jet, and in the engine's grid
    // it breaks up on the way and never settles. Ending the engine's grid at the fixed nozzle,
    // as for a sliding extension, gives a clean jet.
    const extensionInEngine =
      wholeNozzle && !!fromFixed && state.config.extDeploy > 0.995 && !leftWall;
    const engineExitX = extensionInEngine ? profile.exitX : flowExitX;
    let gas: EngineGas | null = null;
    if (engineSimOn) {
      const cfg = state.config;
      // A solid motor's gas runs down the bore of its grain, and comes off the bore's surface
      // all the way along it, not in through the head of the motor.
      const solid = cfg.energy === 'solid';
      for (let i = 0; i <= ENGINE_NX; i++) {
        const x = (i / ENGINE_NX) * engineExitX;
        radii[i] = solid ? Math.min(radiusAt(profile, x), grainBore(cfg, x, burnt)) : radiusAt(profile, x);
      }
      // Only the part of the bore that still has grain around it burns.
      let burnTo = 0;
      if (solid) {
        const grainStations = ((cfg.chamberLen * GRAIN_END) / engineExitX) * ENGINE_NX;
        for (let i = 0; i < grainStations; i++) {
          if (grainBore(cfg, ((i + 0.5) / ENGINE_NX) * engineExitX, burnt) < 0.999 * (cfg.chamberDia / 2)) burnTo = i + 1;
        }
      }
      const burn = solid ? { from: 0, to: burnTo } : undefined;
      // Where the jet tears off the wall of an over-expanded nozzle, or a dual bell's kink holds
      // it, if that is inside the stretch of engine being simulated.
      let separatesAt: number | undefined;
      if (wholeNozzle && leftWall) {
        const jetRadius = result.effectiveExitDia / 2;
        for (let i = 0; i <= ENGINE_NX; i++) {
          const x = (i / ENGINE_NX) * engineExitX;
          if (x > profile.throatX && radii[i] >= jetRadius) {
            if (i < ENGINE_NX) separatesAt = i;
            break;
          }
        }
      }
      const g = result.gamma;
      const exitMach = machFromAreaRatio(result.expansionRatio, g);
      const exitTemp = 1 / (1 + ((g - 1) / 2) * exitMach * exitMach);
      const exitPressure = Math.pow(exitTemp, g / (g - 1));
      // A different stretch of engine starts afresh, as a different engine does.
      const engine = (extensionInEngine ? 'whole|' : '') + `${cfg.presetId}|${cfg.energy}|${cfg.exhaust}|${cfg.propellant}|${cfg.fuel}|${cfg.oxidiser}`;
      if (engine !== simulatedEngine) {
        plume?.resetEngineSim();
        settledFrames = 0;
        latestReading = null;
      }
      simulatedEngine = engine;
      gas = {
        inputs: {
          gamma: g,
          fire,
          length: engineExitX,
          radii,
          restPressure: engineRestPressure(exitPressure, result.pa, result.pc),
          // Well below anything the exhaust reaches, even down the centreline of a big nozzle
          // where it runs colder than average, so cold still gas can be told apart from it.
          restTemp: Math.min(0.1, 0.2 * exitTemp),
          exitPressure,
          burn,
          separatesAt,
        },
        originX: view.originX * dpr,
        scale: pixelsPerMetre,
        mode: overlay === 'none' ? 'flame' : overlay,
        exitTemp,
        machMax: Math.max(1.5, exitMach),
        // The simulated plume carries on from the gas this simulation delivers to the exit.
        feedsPlumeAtMach: wholeNozzle ? (fromFixed ? fromFixed.flow.mach : wholeFlow!.mach) : undefined,
        exit: extensionInEngine
          ? { x: (engineExitX - flowExitX) / plumeRadiusM, radius: cfg.exitDia / 2 / plumeRadiusM }
          : undefined,
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
        // The same scales the aerospike's own view colours its thrust cells by.
        spikeView:
          (spikeSim || edSim) && overlay !== 'none' && !failure
            ? {
                mode: overlay,
                machMax: Math.max(1.5, result.exitMach),
                exitTemp: 1 / (1 + ((result.gamma - 1) / 2) * Math.max(1.01, result.exitMach) ** 2),
              }
            : null,
      },
      timeS,
      sim,
      gas,
    );

    // Thrust and efficiency from the simulated gas where it leaves the engine's grid, to set
    // beside the formula's. Only where that says what the formula's figures say: the grid has to
    // end where the gas really leaves the engine, and to be simulating the flow the engine has.
    // The notes are kept to a few words so they fit on one line; SIMULATED_TIP spells them out.
    let simulatedNote = '';
    if (!gas) {
      simulatedNote = failure
        ? ''
        : profile.spike
          ? 'not for aerospikes'
          : profile.plug
            ? edSim || !useSim
              ? 'not for expansion-deflection nozzles'
              : 'this nozzle is too long to simulate whole'
            : 'engine gas is drawn';
      settledFrames = 0;
      latestReading = null;
      simulated = null;
    } else {
      // Reading the grid back is not free. Measured on a 144 Hz display, each reading makes one
      // frame arrive late: asked for every frame, 7 frames in a hundred were late and the frame
      // rate fell from 141 to 124. So it is asked for only once the engine has settled, and only
      // once a second, which is all the readouts need. Each reading comes back marked with how
      // settled the engine was when it was asked for; one from before it restarted does not count.
      settledFrames = fire >= 1 ? settledFrames + 1 : 0;
      if (settledFrames === 0) latestReading = null;
      if (settledFrames >= SETTLE_FRAMES) {
        const ask = timeS - lastAskedS >= READ_EVERY_S;
        if (ask) lastAskedS = timeS;
        latestReading = plume!.engineColumns(settledFrames, (profile.throatX / engineExitX) * ENGINE_NX, ask);
      }
      const latest = latestReading;
      const reading = latest && latest.stamp >= SETTLE_FRAMES && latest.stamp <= settledFrames ? latest : null;
      if (fire < 1) {
        simulatedNote = firing ? 'starting up' : 'fire the engine';
      } else if (leftWall && !wholeNozzle) {
        // On its own the engine's grid knows nothing of the jet leaving the wall.
        simulatedNote = lightExhaust && useSim ? 'not for this jet' : 'plume is drawn';
      } else if (Math.abs(radii[ENGINE_NX] / (result.flowExitDia / 2) - 1) > 0.01) {
        simulatedNote = 'not for this nozzle';
      } else if (settledFrames < SETTLE_FRAMES || !reading) {
        simulatedNote = 'settling';
      }
      if (simulatedNote === '' && reading) {
        // Each column's wall radius is that of the middle of its cells.
        const wall = (i: number) => 0.5 * (radii[i] + radii[i + 1]);
        const exit = { gas: reading.exit, radius: wall(ENGINE_NX - 1) };
        const throat = { gas: reading.at, radius: wall(reading.station) };
        const now = simulatedFigures(exit, throat, {
          gamma: result.gamma,
          pc: result.pc,
          pa: result.pa,
          tc: result.tc,
          gasR: resolveGas(state.config, result.pc / 1e5, result.expansionRatio).gas.R,
          combustionEff: result.combustionEff,
          chambers: state.config.chambers,
        });
        // The flow never sits perfectly still; a little smoothing keeps the last digit readable.
        const k = simulated ? 0.15 : 1;
        simulated = {
          thrust: (simulated?.thrust ?? 0) * (1 - k) + now.thrust * k,
          massFlow: (simulated?.massFlow ?? 0) * (1 - k) + now.massFlow * k,
          isp: (simulated?.isp ?? 0) * (1 - k) + now.isp * k,
        };
      } else {
        simulated = null;
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawEngine(ctx, state.config, result, view, { fire, timeS, overlay, failure, failT, flowExitX: gas ? engineExitX : flowExitX, simGas: gas !== null || spikeSim !== null || edSim !== null, wholeNozzle, burnt }, w, h);
    const throttle = ENERGY_SOURCES[state.config.energy].throttleable ? state.flight.throttle : 1;
    rumble.setLevel(fire * (0.45 + 0.55 * throttle), result.pa / SEA_LEVEL_PRESSURE);

    // The readouts don't need to update every frame.
    if (frameCount++ % 4 === 0) {
      const preset = getPreset(state.config.presetId);
      const modified = preset ? isModified(state.config) : false;
      onFrame({
        result,
        exhaust: state.config.exhaust,
        energy: state.config.energy,
        stock: preset && modified ? simulate(preset.config, state.flight) : null,
        stockName: preset?.name ?? null,
        firing,
        fire,
        sweep,
        failure,
        simulated,
        simulatedNote,
        layout: {
          ppm: view.ppm,
          originX: view.originX,
          centreY: view.centreY,
          chamberEndX: view.originX + profile.chamberEndX * view.ppm,
          throatX: view.originX + profile.throatX * view.ppm,
          exitX: view.originX + profile.exitX * view.ppm,
          halfHeight: profile.halfHeight * view.ppm,
          frontSpace: profile.frontSpace * view.ppm,
          chamberRadius: profile.points[0].r * view.ppm,
          exitRadius: profile.points[profile.points.length - 1].r * view.ppm,
          chambersDrawn: profile.offsets.length,
        },
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
      // Firing a burnt-out solid motor loads a fresh one.
      if (!firing && burnt >= 1) burnt = 0;
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
      if (burnt >= 1) burnt = 0;
      firing = true;
      sweep = direction;
    },
    rebuild() {
      burnt = 0;
      failure = null;
      failT = 0;
      fire = 0;
      firing = false;
      const current = store.get();
      const next = engineAfterRebuild(current, lastGood);
      if (next === current) lastGood = current; // kept: nothing changes, so the subscriber will not see it
      else store.replace(next);
    },
    clearFailure() {
      // A whole engine comes with a fresh grain, even where the last one had not failed.
      burnt = 0;
      if (!failure) return;
      failure = null;
      failT = 0;
      fire = 0;
      firing = false;
      // The engine chosen next becomes the one to rebuild when the store announces it.
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
