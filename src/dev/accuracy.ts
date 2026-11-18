// A measuring tool for the gas solvers. Not part of the app: nothing imports it.
//
// It runs the real solvers on the GPU, reads the gas state back, and compares it with what
// one-dimensional nozzle theory predicts and with what should be conserved. That theory uses
// the same idealised gas the solvers do, so agreement shows the equations are being solved
// correctly, not that they describe a real engine.
//
// To use it, start the dev server, open the page's console and run:
//
//   const acc = await import('/src/dev/accuracy.ts');
//   console.table(acc.engineTable());
//   console.table(acc.joinTable());
//
// docs/future-work.md records what it measured.

import { simulate } from '../physics/engine';
import { machFromAreaRatio } from '../physics/nozzle';
import { getPreset } from '../physics/presets';
import type { EngineConfig, SimResult } from '../physics/types';
import { ENGINE_NX, ENGINE_NY, createEngineSim, type EngineSim, type EngineSimInputs } from '../render/engineSim';
import { SIM_NX, SIM_NY, createFluidSim, type FluidSim } from '../render/fluidSim';
import { stepGas } from '../render/gasSim';
import { engineProfile, radiusAt } from '../render/geometry';
import { gridLength } from '../render/plume';
import { simInputs, wholeNozzleFlow } from '../render/plumeParams';

interface Context {
  gl: WebGL2RenderingContext;
  engine: EngineSim;
  plume: FluidSim;
  fbo: WebGLFramebuffer;
}
let shared: Context | null = null;

function context(): Context {
  if (shared) return shared;
  const gl = document.createElement('canvas').getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) throw new Error('WebGL2 is not available');
  // The solvers expect a full-screen triangle at vertex attribute 0.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const plume = createFluidSim(gl);
  const engine = createEngineSim(gl);
  if (!plume || !engine) throw new Error('This browser cannot run the gas simulation');
  return (shared = { gl, engine, plume, fbo: gl.createFramebuffer()! });
}

/** A solver's gas state, four numbers a cell: density, momentum (x, r), energy. */
function read(texture: WebGLTexture, width: number, height: number): Float32Array {
  const { gl, fbo } = context();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  const out = new Float32Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, out);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return out;
}

interface Case {
  cfg: EngineConfig;
  result: SimResult;
  inputs: EngineSimInputs;
  g: number;
  /** Design exit Mach number, and the temperature and pressure there over the chamber's */
  exitMach: number;
  exitTemp: number;
  exitPressure: number;
}

/** An engine at an altitude, set up for the engine grid the way the app sets it up. */
function makeCase(presetId: string, altitudeKm: number): Case {
  const preset = getPreset(presetId);
  if (!preset) throw new Error(`No preset called ${presetId}`);
  const cfg = preset.config;
  const result = simulate(cfg, { altitudeKm, throttle: 1 });
  const profile = engineProfile(cfg);
  const g = result.gamma;
  const radii = new Float32Array(ENGINE_NX + 1);
  for (let i = 0; i <= ENGINE_NX; i++) radii[i] = radiusAt(profile, (i / ENGINE_NX) * profile.exitX);
  const exitMach = machFromAreaRatio(result.expansionRatio, g);
  const exitTemp = 1 / (1 + ((g - 1) / 2) * exitMach * exitMach);
  const exitPressure = Math.pow(exitTemp, g / (g - 1));
  return {
    cfg,
    result,
    g,
    exitMach,
    exitTemp,
    exitPressure,
    inputs: {
      gamma: g,
      fire: 1,
      length: profile.exitX,
      radii,
      restPressure: Math.min(0.3, Math.max(0.3 * exitPressure, result.pa / result.pc)),
      restTemp: Math.min(0.1, 0.2 * exitTemp),
      exitPressure,
    },
  };
}

/** What crosses one column of the engine grid, in that grid's units (chamber state, metres). */
function engineColumn(c: Case, state: Float32Array, i: number) {
  const g = c.g;
  const R = 0.5 * (c.inputs.radii[i] + c.inputs.radii[i + 1]);
  let flow = 0;
  let thrustVac = 0;
  let pressure = 0;
  let mach = 0;
  let area = 0;
  let totalPressure = 0;
  let worstEnthalpy = 0;
  let worstEntropy = 0;
  let machAxis = 0;
  let machWall = 0;
  for (let j = 0; j < ENGINE_NY; j++) {
    const n = (j * ENGINE_NX + i) * 4;
    const rho = state[n];
    const u = state[n + 1] / rho;
    const v = state[n + 2] / rho;
    const p = (g - 1) * (state[n + 3] - 0.5 * rho * (u * u + v * v));
    // Each row is a ring; rows are evenly spaced from the centreline to the wall.
    const a = (2 * Math.PI * (j + 0.5) * R * R) / (ENGINE_NY * ENGINE_NY);
    const m = Math.hypot(u, v) / Math.sqrt((g * p) / rho);
    flow += rho * u * a;
    thrustVac += (rho * u * u + p) * a;
    pressure += p * a;
    mach += m * a;
    area += a;
    // Total enthalpy and entropy never change along a streamline of steady, shock-free flow.
    const enthalpy = (g / (g - 1)) * (p / rho) + 0.5 * (u * u + v * v);
    worstEnthalpy = Math.max(worstEnthalpy, Math.abs(enthalpy / (g / (g - 1)) - 1));
    const entropy = p / Math.pow(rho, g);
    worstEntropy = Math.max(worstEntropy, entropy - 1);
    totalPressure += Math.pow(entropy, -1 / (g - 1)) * rho * u * a;
    if (j === 0) machAxis = m;
    if (j === ENGINE_NY - 1) machWall = m;
  }
  return {
    flow,
    thrustVac,
    pressure: pressure / area,
    mach: mach / area,
    machAxis,
    machWall,
    totalPressure: totalPressure / flow,
    worstEnthalpy,
    worstEntropy,
  };
}

const pct = (v: number) => +(100 * v).toFixed(2);

/**
 * The engine grid on its own, run to a steady state and compared with one-dimensional theory.
 * Every figure is a percentage unless it says otherwise.
 */
export function engineAlone(presetId: string, altitudeKm = 0, frames = 500) {
  const { engine } = context();
  const c = makeCase(presetId, altitudeKm);
  engine.reset();
  for (let n = 0; n < frames; n++) engine.step(c.inputs);
  const state = read(engine.texture, ENGINE_NX, ENGINE_NY);

  const g = c.g;
  const columns = Array.from({ length: ENGINE_NX }, (_, i) => engineColumn(c, state, i));
  const exit = columns[ENGINE_NX - 1];
  const flows = columns.map((k) => k.flow);
  const meanFlow = flows.reduce((a, b) => a + b, 0) / flows.length;
  let throat = 0;
  for (let i = 1; i <= ENGINE_NX; i++) if (c.inputs.radii[i] < c.inputs.radii[throat]) throat = i;

  // One-dimensional theory, in the grid's units.
  const throatArea = Math.PI * (c.cfg.throatDia / 2) ** 2;
  const idealFlow = throatArea * Math.sqrt(g) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
  const exitSpeed = c.exitMach * Math.sqrt(g * c.exitTemp);
  const idealThrust = idealFlow * exitSpeed + c.exitPressure * Math.PI * (c.cfg.exitDia / 2) ** 2;
  // What the readouts show, which come from the formula model.
  const formulaThrust = c.result.thrust / c.cfg.chambers / c.result.pc;
  const thrustHere = exit.thrustVac - (c.result.pa / c.result.pc) * Math.PI * (c.cfg.exitDia / 2) ** 2;

  return {
    engine: `${presetId} at ${altitudeKm} km`,
    'flow vs ideal': pct(meanFlow / idealFlow),
    'flow varies along engine': pct((Math.max(...flows) - Math.min(...flows)) / meanFlow),
    'sonic point, columns past throat': columns.findIndex((k) => k.mach >= 1) - throat,
    'exit Mach vs theory': pct(exit.mach / c.exitMach),
    'exit Mach axis / wall': `${exit.machAxis.toFixed(2)} / ${exit.machWall.toFixed(2)}`,
    'exit pressure vs theory': pct(exit.pressure / c.exitPressure),
    'Isp vs ideal': pct(exit.thrustVac / idealThrust / (meanFlow / idealFlow)),
    'thrust vs readout': c.result.state === 'separated' ? 'separated' : pct(thrustHere / formulaThrust),
    'worst total enthalpy error': pct(Math.max(...columns.map((k) => k.worstEnthalpy))),
    'worst entropy rise': pct(Math.max(...columns.map((k) => k.worstEntropy))),
    'total pressure kept at exit': pct(exit.totalPressure),
  };
}

/**
 * Both grids joined, as the app runs them. Reports the exhaust and the thrust the plume grid
 * carries at a few distances from the nozzle exit (in exit radii), as percentages of what
 * leaves the engine grid. Steady flow conserves both, so every figure should be 100.
 * `across` is how many exit radii of plume the grid covers: fewer means finer cells. `ramp` is
 * how many frames the engine takes to light up from cold first, as it does in the app (60);
 * left at 0 it starts already running, from the one-dimensional solution.
 */
export function joined(presetId: string, altitudeKm = 0, across = 10, settle = 350, samples = 4, ramp = 0) {
  const { engine, plume } = context();
  const c = makeCase(presetId, altitudeKm);
  const profile = engineProfile(c.cfg);
  const flow = wholeNozzleFlow(c.cfg, c.result);
  const sim = simInputs(c.cfg, c.result, 1, { flow });
  // The curve of the bell just inside its lip, as the app fits it.
  const back = Math.min(2 * flow.radiusM, profile.exitX - profile.throatX);
  const u = back / flow.radiusM;
  if (u > 0.05) {
    const radiusBack = radiusAt(profile, profile.exitX - back) / flow.radiusM;
    sim.wallCurve = Math.min(0.2, Math.max(-0.5, (radiusBack - 1 + sim.divergence * u) / (u * u)));
  }
  const length = gridLength(across * 1.05);
  const upstream = Math.min(2, 0.15 * length);
  const cell = (length + upstream) / SIM_NX;
  const plumeStep = { inputs: sim, span: cell * SIM_NX, upstream, wall: null };
  const engineStep = { inputs: c.inputs, link: { mach: flow.mach, unitRadius: flow.radiusM, exitX: 0, exitRadius: 1 } };

  engine.reset();
  plume.reset();
  // `ramp` frames of lighting up from cold, as the app does, before running at full power.
  for (let n = 0; n < ramp; n++) {
    const fire = (n + 1) / ramp;
    stepGas(plume, engine, { ...plumeStep, inputs: { ...sim, fire } }, { ...engineStep, inputs: { ...c.inputs, fire } });
  }
  for (let n = 0; n < settle; n++) stepGas(plume, engine, plumeStep, engineStep);

  const g = c.g;
  const stations = [0.1, 1, 2, 4];
  const exhaust = stations.map(() => 0);
  const thrust = stations.map(() => 0);
  // The plume never quite settles, so average a few moments.
  for (let k = 0; k < samples; k++) {
    for (let n = 0; n < 50; n++) stepGas(plume, engine, plumeStep, engineStep);
    const exit = engineColumn(c, read(engine.texture, ENGINE_NX, ENGINE_NY), ENGINE_NX - 1);
    // The engine grid's figures, turned into the plume grid's units (exit state, exit radii).
    const density = c.exitPressure / c.exitTemp;
    const R2 = flow.radiusM ** 2;
    const engineFlow = (exit.flow / density) * Math.sqrt(density / c.exitPressure) / R2;
    const engineThrust = (exit.thrustVac - (c.result.pa / c.result.pc) * Math.PI * R2) / c.exitPressure / R2;

    const U = read(plume.texture, SIM_NX, SIM_NY);
    const S = read(plume.scalarTexture, SIM_NX, SIM_NY);
    stations.forEach((x, s) => {
      const i = Math.min(SIM_NX - 1, Math.floor((x + upstream) / cell));
      let m = 0;
      let f = 0;
      for (let j = 0; j < SIM_NY; j++) {
        const n = (j * SIM_NX + i) * 4;
        const rho = U[n];
        const ux = U[n + 1] / rho;
        const vr = U[n + 2] / rho;
        const p = (g - 1) * (U[n + 3] - 0.5 * rho * (ux * ux + vr * vr));
        const a = 2 * Math.PI * (j + 0.5) * cell * cell;
        m += S[n] * ux * a;
        f += (rho * ux * ux + p - sim.pAmb) * a;
      }
      exhaust[s] += m / engineFlow / samples;
      thrust[s] += f / engineThrust / samples;
    });
  }
  const row: Record<string, string | number> = {
    engine: `${presetId} at ${altitudeKm} km`,
    'cells across exit radius': +(1 / cell).toFixed(1),
  };
  stations.forEach((x, s) => (row[`exhaust at ${x}`] = pct(exhaust[s])));
  stations.forEach((x, s) => (row[`thrust at ${x}`] = pct(thrust[s])));
  // Cells of the engine grid holding nonsense: a solver that has gone unstable somewhere.
  const state = read(engine.texture, ENGINE_NX, ENGINE_NY);
  let wild = 0;
  for (let n = 0; n < ENGINE_NX * ENGINE_NY; n++) {
    const rho = state[n * 4];
    if (!(rho > 0 && rho < 10) || !(Math.abs(state[n * 4 + 3]) < 100)) wild++;
  }
  row['engine cells gone wild'] = wild;
  return row;
}

/** The engine grid against theory, for a spread of engines. */
export function engineTable() {
  return [
    engineAlone('merlin-1d', 0),
    engineAlone('raptor-2', 0),
    engineAlone('f-1', 0),
    engineAlone('rs-25', 100),
    engineAlone('merlin-vac', 100),
    engineAlone('rl10b-2', 100),
  ];
}

/** What the plume grid carries against what the engine grid delivers, at three zooms and a spread of engines. */
export function joinTable() {
  return [
    joined('merlin-1d', 0, 5),
    joined('merlin-1d', 0, 10),
    joined('merlin-1d', 0, 22),
    joined('raptor-2', 0, 10),
    joined('rs-25', 0, 14),
    joined('rs-25', 30, 10),
  ];
}
