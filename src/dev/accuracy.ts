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
//   console.table(acc.exhaustTable());   // each energy source with each new exhaust type, lit from cold
//   console.table(acc.lightUp(acc.built('reactor', 'none')));   // frame by frame as it lights
//   acc.fingerprints();                  // the plume grid's whole state for four fixed cases, to show a change left them alone
//
// Anywhere it takes an engine, it takes an example engine's id or a whole configuration (see `built`).
//
// docs/future-work.md records what it measured.

import { simulate } from '../physics/engine';
import { EXHAUSTS, jetLeftWall } from '../physics/exhausts';
import { machFromAreaRatio } from '../physics/nozzle';
import { getPreset } from '../physics/presets';
import { starterEngine, withEnergy, withExhaust } from '../physics/reshape';
import type { EnergyId, EngineConfig, ExhaustId, SimResult } from '../physics/types';
import { ENGINE_NX, ENGINE_NY, createEngineSim, type EngineSim, type EngineSimInputs } from '../render/engineSim';
import { SIM_NX, SIM_NY, createFluidSim, type FluidSim, type SimInputs, type SimWall } from '../render/fluidSim';
import { stepGas } from '../render/gasSim';
import { GRAIN_END, engineProfile, grainBore, radiusAt } from '../render/geometry';
import { gridLength } from '../render/plume';
import { engineRestPressure, fixedExitFlow, simInputs, spikeSimInputs, wholeNozzleFlow } from '../render/plumeParams';

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

/**
 * Wait for the graphics card every few frames. The app gives it a frame at a time; run flat out,
 * hundreds of frames of work pile up before anything is read back, and on a slow card the
 * browser takes that for a hung card and resets it (every cell then reads as zero).
 */
function pace(frame: number) {
  if (frame % 5 === 4) context().gl.finish();
}

/** The context for a new run: a fresh one if the graphics card was reset during the last. */
function begin(): Context {
  if (shared?.gl.isContextLost()) shared = null;
  return context();
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

/** An example engine's id, or a whole configuration with a name to report it by. */
type EngineSpec = string | { name: string; cfg: EngineConfig };

/** The engine the app opens on, given an energy source and an exhaust the way the menus give them. */
export function built(energy: EnergyId, exhaust: ExhaustId, change: Partial<EngineConfig> = {}): { name: string; cfg: EngineConfig } {
  const cfg = withExhaust(withEnergy({ ...starterEngine(), ...change }, energy), exhaust);
  return { name: `${energy} ${exhaust}`, cfg };
}

interface Case {
  name: string;
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
function makeCase(spec: EngineSpec, altitudeKm: number): Case {
  let name: string;
  let cfg: EngineConfig;
  if (typeof spec === 'string') {
    const preset = getPreset(spec);
    if (!preset) throw new Error(`No preset called ${spec}`);
    name = spec;
    cfg = preset.config;
  } else {
    ({ name, cfg } = spec);
  }
  const result = simulate(cfg, { altitudeKm, throttle: 1 });
  const profile = engineProfile(cfg);
  const g = result.gamma;
  // A solid motor's gas runs down the bore of a freshly cast grain and comes off its surface, as
  // in the app (runtime.ts).
  const solid = cfg.energy === 'solid';
  const at = (i: number) => (i / ENGINE_NX) * profile.exitX;
  const radii = new Float32Array(ENGINE_NX + 1);
  for (let i = 0; i <= ENGINE_NX; i++) {
    radii[i] = solid ? Math.min(radiusAt(profile, at(i)), grainBore(cfg, at(i))) : radiusAt(profile, at(i));
  }
  let burnTo = 0;
  if (solid) {
    for (let i = 0; at(i) < cfg.chamberLen * GRAIN_END; i++) {
      if (grainBore(cfg, at(i + 0.5)) < 0.999 * (cfg.chamberDia / 2)) burnTo = i + 1;
    }
  }
  const exitMach = machFromAreaRatio(result.expansionRatio, g);
  const exitTemp = 1 / (1 + ((g - 1) / 2) * exitMach * exitMach);
  const exitPressure = Math.pow(exitTemp, g / (g - 1));
  return {
    name,
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
      restPressure: engineRestPressure(exitPressure, result.pa, result.pc),
      restTemp: Math.min(0.1, 0.2 * exitTemp),
      exitPressure,
      burn: solid ? { from: 0, to: burnTo } : undefined,
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
export function engineAlone(spec: EngineSpec, altitudeKm = 0, frames = 500) {
  const { engine } = begin();
  const c = makeCase(spec, altitudeKm);
  engine.reset();
  for (let n = 0; n < frames; n++) {
    engine.step(c.inputs);
    pace(n);
  }
  const state = read(engine.texture, ENGINE_NX, ENGINE_NY);

  const g = c.g;
  const columns = Array.from({ length: ENGINE_NX }, (_, i) => engineColumn(c, state, i));
  const exit = columns[ENGINE_NX - 1];
  // Along a solid motor's grain the flow grows as the bore gives off gas; it is measured past it.
  const flows = columns.slice(c.inputs.burn?.to ?? 0).map((k) => k.flow);
  const meanFlow = flows.reduce((a, b) => a + b, 0) / flows.length;
  // The narrowest point past a solid motor's grain, whose bore can be narrower still.
  let throat = c.inputs.burn?.to ?? 0;
  for (let i = throat + 1; i <= ENGINE_NX; i++) if (c.inputs.radii[i] < c.inputs.radii[throat]) throat = i;

  // One-dimensional theory, in the grid's units. With no nozzle the gas leaves at the throat.
  const exitArea = Math.PI * (c.result.flowExitDia / 2) ** 2;
  const throatArea = Math.PI * (c.cfg.throatDia / 2) ** 2;
  const idealFlow = throatArea * Math.sqrt(g) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
  const exitSpeed = c.exitMach * Math.sqrt(g * c.exitTemp);
  const idealThrust = idealFlow * exitSpeed + c.exitPressure * exitArea;
  // What the readouts show, which come from the formula model.
  const formulaThrust = c.result.thrust / c.cfg.chambers / c.result.pc;
  const thrustHere = exit.thrustVac - (c.result.pa / c.result.pc) * exitArea;
  // A dual bell's kink: the share of the gas's total pressure lost across its sharp corner,
  // from two columns before it to four after, and from there to the exit (the corner sends a
  // shock down the outer bell).
  const kink = engineProfile(c.cfg).kink;
  let kinkLoss: number | string = '';
  let kinkToExit: number | string = '';
  if (kink) {
    const k = Math.round((kink.x / c.inputs.length) * ENGINE_NX);
    const before = columns[Math.max(0, k - 2)].totalPressure;
    const after = columns[Math.min(ENGINE_NX - 1, k + 4)].totalPressure;
    kinkLoss = pct(1 - after / before);
    kinkToExit = pct(1 - exit.totalPressure / before);
  }

  return {
    engine: `${c.name} at ${altitudeKm} km`,
    state: c.result.state,
    'flow vs ideal': pct(meanFlow / idealFlow),
    'flow varies along engine': pct((Math.max(...flows) - Math.min(...flows)) / meanFlow),
    'sonic point, columns past throat': columns.findIndex((k) => k.mach >= 1) - throat,
    'throat Mach': +columns[Math.min(throat, ENGINE_NX - 1)].mach.toFixed(3),
    'exit Mach vs theory': pct(exit.mach / c.exitMach),
    'exit Mach axis / wall': `${exit.machAxis.toFixed(2)} / ${exit.machWall.toFixed(2)}`,
    'exit pressure vs theory': pct(exit.pressure / c.exitPressure),
    'Isp vs ideal': pct(exit.thrustVac / idealThrust / (meanFlow / idealFlow)),
    // The engine's grid on its own knows nothing of a jet that has left the wall.
    'thrust vs readout': jetLeftWall(c.result.state) ? c.result.state : pct(thrustHere / formulaThrust),
    'worst total enthalpy error': pct(Math.max(...columns.map((k) => k.worstEnthalpy))),
    'worst entropy rise': pct(Math.max(...columns.map((k) => k.worstEntropy))),
    'total pressure kept at exit': pct(exit.totalPressure),
    'total pressure lost at kink': kinkLoss,
    'total pressure lost, kink to exit': kinkToExit,
  };
}

/** An engine set up for both grids joined, as the app sets them up. */
function joinedCase(spec: EngineSpec, altitudeKm: number, across: number) {
  const c = makeCase(spec, altitudeKm);
  const profile = engineProfile(c.cfg);
  const flow = wholeNozzleFlow(c.result);
  const sim = simInputs(c.cfg, c.result, 1, { flow });
  // The curve of the bell just inside its lip, as the app fits it: with no nozzle, along the
  // chamber narrowing to the throat.
  const fitFrom = EXHAUSTS[c.cfg.exhaust].hasNozzle ? profile.throatX : 0;
  const back = Math.min(2 * flow.radiusM, profile.exitX - fitFrom);
  const u = back / flow.radiusM;
  if (u > 0.05) {
    const radiusBack = radiusAt(profile, profile.exitX - back) / flow.radiusM;
    sim.wallCurve = Math.min(0.2, Math.max(-0.5, (radiusBack - 1 + sim.divergence * u) / (u * u)));
  }
  const length = gridLength(across * 1.05);
  const upstream = Math.min(2, 0.15 * length);
  const cell = (length + upstream) / SIM_NX;
  const plumeStep = { inputs: sim, span: cell * SIM_NX, upstream, wall: null };
  // Where a jet that has left the wall leaves it, as the app tells the engine's grid. (The app
  // runs a very light exhaust's separated jet another way; see runtime.ts.)
  if (jetLeftWall(c.result.state)) {
    const jetRadius = c.result.effectiveExitDia / 2;
    for (let i = 0; i < ENGINE_NX; i++) {
      if ((i / ENGINE_NX) * profile.exitX > profile.throatX && c.inputs.radii[i] >= jetRadius) {
        c.inputs.separatesAt = i;
        break;
      }
    }
  }
  const engineStep = { inputs: c.inputs, link: { mach: flow.mach, unitRadius: flow.radiusM, exitX: 0, exitRadius: 1 } };
  return { c, flow, sim, cell, upstream, plumeStep, engineStep };
}

/** One frame of both grids, `frame` frames after lighting up from cold over `ramp` frames (0: already running). */
function joinedFrame(j: ReturnType<typeof joinedCase>, frame: number, ramp: number) {
  const { engine, plume } = context();
  const fire = frame < ramp ? (frame + 1) / ramp : 1;
  if (fire < 1) {
    stepGas(plume, engine, { ...j.plumeStep, inputs: { ...j.sim, fire } }, { ...j.engineStep, inputs: { ...j.c.inputs, fire } });
  } else {
    stepGas(plume, engine, j.plumeStep, j.engineStep);
  }
  pace(frame);
}

/**
 * Cells of each grid holding nonsense: a solver that has gone unstable somewhere. In the engine's
 * grid that includes gas squeezed past ten times the chamber's density, which a solver running
 * away reaches first; but the cold gas left in an unlit engine can be squeezed that far for a while
 * as it lights (seen with no nozzle), so cells that are not numbers at all are counted apart.
 */
function wildCells(g: number) {
  const { engine, plume } = context();
  const state = read(engine.texture, ENGINE_NX, ENGINE_NY);
  let engineWild = 0;
  let notNumbers = 0;
  // The first and last columns of the engine's grid holding any.
  let from = -1;
  let to = -1;
  for (let n = 0; n < ENGINE_NX * ENGINE_NY; n++) {
    const rho = state[n * 4];
    if (!(rho > 0 && rho < 10) || !(Math.abs(state[n * 4 + 3]) < 100)) {
      engineWild++;
      if (!Number.isFinite(rho) || !Number.isFinite(state[n * 4 + 3])) notNumbers++;
      const i = n % ENGINE_NX;
      if (from < 0 || i < from) from = i;
      to = Math.max(to, i);
    }
  }
  // In the plume grid, a density or pressure that is not a sensible positive number.
  const U = read(plume.texture, SIM_NX, SIM_NY);
  let plumeWild = 0;
  for (let n = 0; n < SIM_NX * SIM_NY; n++) {
    const rho = U[n * 4];
    const ux = U[n * 4 + 1] / rho;
    const vr = U[n * 4 + 2] / rho;
    const p = (g - 1) * (U[n * 4 + 3] - 0.5 * rho * (ux * ux + vr * vr));
    if (!(rho > 0 && rho < 1e6) || !(p > 0 && p < 1e6)) plumeWild++;
  }
  return { engineWild, notNumbers, plumeWild, columns: engineWild ? `${from}-${to} of ${ENGINE_NX}` : '' };
}

/**
 * Both grids lit from cold, as in `joined`, with the cells gone wild counted every `every` frames,
 * and the Mach number on the centreline and at the wall where the gas leaves the engine's grid.
 */
export function lightUp(spec: EngineSpec, altitudeKm = 0, frames = 600, ramp = 60, every = 25) {
  const { engine, plume } = begin();
  const j = joinedCase(spec, altitudeKm, 10);
  engine.reset();
  plume.reset();
  const rows: (string | number)[][] = [];
  for (let n = 0; n < frames; n++) {
    joinedFrame(j, n, ramp);
    if ((n + 1) % every === 0) {
      const { engineWild, notNumbers, plumeWild, columns } = wildCells(j.c.g);
      const exit = engineColumn(j.c, read(engine.texture, ENGINE_NX, ENGINE_NY), ENGINE_NX - 1);
      rows.push([n + 1, engineWild, notNumbers, plumeWild, columns, `${exit.machAxis.toFixed(2)} / ${exit.machWall.toFixed(2)}`]);
    }
  }
  return rows;
}

/**
 * Both grids joined, as the app runs them. Reports the exhaust and the thrust the plume grid
 * carries at a few distances from the nozzle exit (in exit radii), as percentages of what
 * leaves the engine grid. Steady flow conserves both, so every figure should be 100.
 * `across` is how many exit radii of plume the grid covers: fewer means finer cells. `ramp` is
 * how many frames the engine takes to light up from cold first, as it does in the app (60);
 * left at 0 it starts already running, from the one-dimensional solution.
 */
export function joined(spec: EngineSpec, altitudeKm = 0, across = 10, settle = 350, samples = 4, ramp = 0) {
  const { engine, plume } = begin();
  const j = joinedCase(spec, altitudeKm, across);
  const { c, flow, sim, cell, upstream, plumeStep, engineStep } = j;

  engine.reset();
  plume.reset();
  // `ramp` frames of lighting up from cold, as the app does, then `settle` at full power.
  for (let n = 0; n < ramp + settle; n++) joinedFrame(j, n, ramp);

  const g = c.g;
  const stations = [0.1, 1, 2, 4];
  const exhaust = stations.map(() => 0);
  const thrust = stations.map(() => 0);
  // The plume never quite settles, so average a few moments.
  for (let k = 0; k < samples; k++) {
    for (let n = 0; n < 50; n++) {
      stepGas(plume, engine, plumeStep, engineStep);
      pace(n);
    }
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
    engine: `${c.name} at ${altitudeKm} km`,
    state: c.result.state,
    'cells across exit radius': +(1 / cell).toFixed(1),
  };
  stations.forEach((x, s) => (row[`exhaust at ${x}`] = pct(exhaust[s])));
  stations.forEach((x, s) => (row[`thrust at ${x}`] = pct(thrust[s])));
  const { engineWild, notNumbers, plumeWild } = wildCells(g);
  row['engine cells gone wild'] = engineWild;
  row['engine cells not numbers'] = notNumbers;
  row['plume cells gone wild'] = plumeWild;
  // A graphics card that took too long over a frame is reset, and everything read back after
  // that is zeros: every cell "gone wild". The next run starts on a fresh context.
  if (context().gl.isContextLost()) row['context lost'] = 'yes';
  return row;
}

const ENERGIES: EnergyId[] = ['combustion', 'solid', 'reactor', 'saltwater'];
const NEW_EXHAUSTS: ExhaustId[] = ['cone', 'dualBell', 'none'];

/**
 * Each energy source with each of the cone, the dual bell and no nozzle, on the engine the app
 * opens on, at sea level and in vacuum: the engine's grid on its own against one-dimensional
 * theory, then both grids joined and lit from cold over 60 frames, as in the app.
 */
export function exhaustTable(energies = ENERGIES, exhausts = NEW_EXHAUSTS) {
  const rows: Record<string, string | number>[] = [];
  for (const energy of energies) for (const exhaust of exhausts) for (const km of [0, 100]) {
    const spec = built(energy, exhaust);
    rows.push({ ...engineAlone(spec, km), ...joined(spec, km, 10, 350, 4, 60) });
  }
  return rows;
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

// ---- Fingerprints of the plume grid ----
//
// For showing that a change to the plume solver left the engines it was not meant for exactly as
// they were. Each case runs the plume grid alone, from cold, with inputs that depend on nothing but
// the engine, and sums every number in the grid. The same build on the same graphics card gives the
// same sums every time; a change that reaches a case moves them.

export type FingerprintCase = 'bell' | 'aerospike' | 'extensionSeated' | 'extensionHalf';

const FINGERPRINT_FRAMES = 240;
const FINGERPRINT_RAMP = 60;

/** What the plume grid is given for a case at full fire: inputs, any wall, and the grid's size. */
function fingerprintSetup(name: FingerprintCase): { inputs: SimInputs; wall: SimWall | null; length: number; upstream: number } {
  const size = (across: number) => {
    const length = gridLength(across * 1.05);
    return { length, upstream: Math.min(2, 0.15 * length) };
  };
  if (name === 'bell') {
    // Merlin 1D at sea level, the jet as it leaves the whole nozzle.
    const cfg = getPreset('merlin-1d')!.config;
    const r = simulate(cfg, { altitudeKm: 0, throttle: 1 });
    return { inputs: simInputs(cfg, r, 1, { flow: wholeNozzleFlow(r) }), wall: null, ...size(10) };
  }
  if (name === 'aerospike') {
    // The XRS-2200 at sea level: a ring of gas at the lip of a solid spike.
    const cfg = getPreset('xrs-2200')!.config;
    const r = simulate(cfg, { altitudeKm: 0, throttle: 1 });
    return { inputs: spikeSimInputs(cfg, r, 1, engineProfile(cfg).spike!), wall: null, ...size(10) };
  }
  // The RL10B-2 at 60 km, its extension seated or halfway along its travel: a solid curved wall
  // standing in the plume grid, as the app builds it (runtime.ts).
  const cfg = { ...getPreset('rl10b-2')!.config, extDeploy: name === 'extensionSeated' ? 1 : 0.5 };
  const r = simulate(cfg, { altitudeKm: 60, throttle: 1 });
  const ext = engineProfile(cfg).extension!;
  const flow = fixedExitFlow(cfg, r, true)!;
  const wall: SimWall = {
    x0: -ext.shift / flow.radiusM,
    r0: ext.seam.r / flow.radiusM,
    x1: (ext.length - ext.shift) / flow.radiusM,
    r1: cfg.exitDia / 2 / flow.radiusM,
    slope0: ext.seamSlope,
  };
  return { inputs: simInputs(cfg, r, 1, { flow, wallSlope: ext.seamSlope }), wall, ...size(10) };
}

/**
 * The plume grid's state after a case has run from cold: the sum of all its numbers and the sum
 * of their squares, to 17 figures, and how many cells hold something that is not a number.
 */
export function fingerprint(name: FingerprintCase): string {
  const { plume } = begin();
  const { inputs, wall, length, upstream } = fingerprintSetup(name);
  plume.reset();
  for (let frame = 0; frame < FINGERPRINT_FRAMES; frame++) {
    const fire = frame < FINGERPRINT_RAMP ? (frame + 1) / FINGERPRINT_RAMP : 1;
    plume.step({ ...inputs, fire }, length + upstream, wall, upstream);
    pace(frame);
  }
  let sum = 0;
  let squares = 0;
  let bad = 0;
  for (const texture of [plume.texture, plume.scalarTexture]) {
    const cells = read(texture, SIM_NX, SIM_NY);
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (!Number.isFinite(v)) {
        bad++;
        continue;
      }
      sum += v;
      squares += v * v;
    }
  }
  return `${sum.toPrecision(17)} ${squares.toPrecision(17)} bad=${bad}`;
}

/** Every case's fingerprint, run twice, with whether the two runs agreed. */
export function fingerprints() {
  const cases: FingerprintCase[] = ['bell', 'aerospike', 'extensionSeated', 'extensionHalf'];
  return cases.map((name) => {
    const first = fingerprint(name);
    const second = fingerprint(name);
    return { case: name, fingerprint: first, repeats: first === second };
  });
}
