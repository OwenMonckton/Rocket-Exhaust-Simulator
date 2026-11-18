// A second gas solver, for the inside of the engine: from the injector face, through the
// throat, to where the gas leaves the nozzle.
//
// Same method as the plume solver (axisymmetric Euler, finite volume, MUSCL + HLLC, two-stage
// Runge-Kutta), but on a grid that is fitted to the engine: every column of cells runs from
// the centreline to the wall, so the wall is exactly the edge of the grid however the engine
// is shaped, and the narrow throat gets as many cells across it as the wide nozzle exit.
//
// Units: density and pressure relative to the gas at rest in the chamber, lengths in metres.
// Each cell advances at its own pace (the largest time step it can take). That reaches the
// steady flow many times faster than marching every cell at the pace of the smallest, at the
// price of the start-up not playing out at true speed.

import { machFromAreaRatio, subsonicMachFromAreaRatio } from '../physics/nozzle';

export const ENGINE_NX = 384;
export const ENGINE_NY = 48;
const STEPS_PER_FRAME = 60;
const CFL = 0.35;

export interface EngineSimInputs {
  gamma: number;
  /** 0–1 ignition ramp */
  fire: number;
  /** Length of the simulated stretch of engine, m */
  length: number;
  /** Radius of the gas passage at ENGINE_NX + 1 evenly spaced stations along that length, m */
  radii: Float32Array;
  /** Pressure of the still gas in the engine before it fires, over chamber pressure */
  restPressure: number;
  /** Its temperature, over the chamber temperature */
  restTemp: number;
  /** Roughly the pressure the gas leaves the nozzle at, over chamber pressure */
  exitPressure: number;
  /**
   * For a solid motor: the stretch of wall (in stations) that is burning propellant. The gas
   * comes off that surface, and the head of the motor is closed. Left out, the gas comes in
   * through the injector face.
   */
  burn?: { from: number; to: number };
  /**
   * For an over-expanded nozzle: the station where the jet tears off the wall. A solver with no
   * friction cannot find that for itself (nothing makes the gas let go of the wall), so it is
   * told. From there on the wall no longer confines the gas: the space between jet and wall
   * is open to the outside air, as it is in a real separated nozzle.
   */
  separatesAt?: number;
}

/**
 * The plume solver's grid, for when the two solvers run as one: the cells just beyond the
 * nozzle exit then hold whatever the plume solver has there, so the outside can reach back
 * into the engine wherever the gas is not leaving faster than sound.
 */
export interface EngineLink {
  columns: number;
  rows: number;
  /** Size of a plume cell, in exit radii */
  cell: number;
  /** How far the plume grid reaches upstream of the nozzle exit, in exit radii */
  upstream: number;
  /** One of the plume grid's radii, m */
  unitRadius: number;
  /** Where this grid's nozzle exit is, in plume radii from the plume grid's origin, and its radius there */
  exitX: number;
  exitRadius: number;
  /** Factors that turn the plume solver's density, speed and pressure into this solver's units */
  density: number;
  speed: number;
  pressure: number;
}

export interface EngineSim {
  /** Gas state: density, momentum (x, r), energy. One column per station, one row per step from centreline to wall. */
  readonly texture: WebGLTexture;
  /** Radius of the passage at each station (ENGINE_NX + 1 texels wide) */
  readonly radiusTexture: WebGLTexture;
  /** Advance on its own for one display frame, every cell at its own pace: quick to settle. */
  step(inputs: EngineSimInputs): void;
  /**
   * Run in step with the plume solver instead: `begin` once a frame, then `advance` by the
   * plume solver's time step each time that solver takes one, then `finish`.
   */
  begin(inputs: EngineSimInputs, link: EngineLink | null): void;
  /** `dt` is in this solver's units (0: every cell at its own pace); `plume` is the plume solver's current gas state. */
  advance(dt: number, substeps: number, plume: WebGLTexture | null): void;
  finish(): void;
  reset(): void;
  /**
   * The gas in two columns of the grid: the last (the end of the simulated stretch of engine)
   * and column `station`. Each is four numbers a cell from the centreline to the wall: density,
   * momentum (x, r), energy. It is the state of a few frames ago, or null before the first
   * reading has come back: the graphics card is asked, and answers when it is ready, so that
   * nothing waits on it. Each call picks up an answer if there is one; with `ask`, and nothing
   * already asked for, it asks again. `stamp` and `station` are handed back with the reading
   * asked for in that call, so the caller can tell how old a reading is and where it was taken.
   *
   * Asking is not free. Measured, each reading makes about one frame arrive late, so ask about
   * once a second, not every frame.
   */
  readColumns(stamp: number, station: number, ask: boolean): ColumnReading | null;
}

export interface ColumnReading {
  exit: Float32Array;
  at: Float32Array;
  station: number;
  stamp: number;
}

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uPrev;    // gas state at the start of the time step
uniform sampler2D uCur;     // gas state this stage advances
uniform sampler2D uRad;     // radius of the passage at each station
uniform int uStage;
uniform ivec2 uGrid;
uniform float uDx;
uniform float uCfl;
uniform float uGamma;
uniform float uFire;
uniform vec2 uChamber;      // total pressure and temperature of the gas supplied at the injector
uniform vec2 uRest;         // density and pressure of still gas
uniform float uBack;        // pressure outside the nozzle exit
uniform float uDt;          // time step shared with the plume solver (0: every cell takes the largest step it can)
uniform float uLinkOn;      // 1 when the cells beyond the exit come from the plume solver
uniform sampler2D uPlume;   // the plume solver's gas state
uniform ivec2 uPlumeGrid;
uniform vec3 uPlumeGeom;    // plume cell size and upstream reach in plume radii, and one plume radius in metres
uniform vec2 uPlumeExit;    // where this grid's exit is on the plume grid, and its radius, in plume radii
uniform vec3 uPlumeScale;   // the plume solver's density, speed and pressure in this solver's units
uniform vec2 uBurn;         // stations between which the wall is burning propellant (a solid motor)
uniform float uSeparates;   // station where the jet tears off the wall (beyond the grid: it does not)
uniform float uHeadOpen;    // 1 when the gas comes in through the injector face, 0 when the head is a closed wall

out vec4 outU;

const float RHO_MIN = 1e-7;
const float P_MIN = 1e-9;

vec4 toPrim(vec4 U) {
  float rho = max(U.x, RHO_MIN);
  float u = U.y / rho;
  float v = U.z / rho;
  float p = max((uGamma - 1.0) * (U.w - 0.5 * rho * (u * u + v * v)), P_MIN);
  return vec4(rho, u, v, p);
}

vec4 toCons(vec4 W) {
  return vec4(W.x, W.x * W.y, W.x * W.z, W.w / (uGamma - 1.0) + 0.5 * W.x * (W.y * W.y + W.z * W.z));
}

float radius(int i) {
  return texelFetch(uRad, ivec2(clamp(i, 0, uGrid.x), 0), 0).x;
}

// Unit normal of the wall over column i, pointing out of the gas.
vec2 wallNormal(int i) {
  i = clamp(i, 0, uGrid.x - 1);
  return normalize(vec2(radius(i) - radius(i + 1), uDx));
}

// Gas arriving from the chamber's supply. How fast it comes in depends on the pressure it
// meets: the lower the pressure just inside, the faster it flows.
vec4 inflow(vec4 inside) {
  float pr = clamp(inside.w / uChamber.x, 0.05, 1.0);
  float k = (uGamma - 1.0) / uGamma;
  float temp = uChamber.y * pow(pr, k);
  float mach2 = min(1.0, 2.0 / (uGamma - 1.0) * (pow(pr, -k) - 1.0));
  float p = pr * uChamber.x;
  return vec4(p / temp, sqrt(mach2 * uGamma * temp), 0.0, p);
}

// Beyond the nozzle exit. Run together with the plume solver, the cells there are that
// solver's: whatever is really outside the nozzle. The flux between them and the last cells
// in here then sorts itself out: supersonic gas leaves without noticing, slower gas feels the
// outside, and air can come back in.
// On its own, supersonic gas leaves freely and slower gas feels a set outside pressure.
vec4 outflow(vec4 inside, ivec2 c) {
  // Gas leaving faster than sound cannot be reached from outside, so it is simply let go.
  // Leaving that to the flux between the two grids' cells is right in principle, but the plume
  // grid's cells just outside can briefly hold far more pressure than the air does (the front
  // of the jet as it starts), enough to stand a shock in the nozzle mouth that the two grids
  // then hold in place between them.
  float a = sqrt(uGamma * inside.w / inside.x);
  if (inside.y >= a) return inside;
  if (uLinkOn > 0.5) {
    float x = uPlumeExit.x + (float(c.x - uGrid.x) + 0.5) * uDx / uPlumeGeom.z;
    float r = uPlumeExit.y * (float(c.y) + 0.5) / float(uGrid.y);
    // The first plume column whose centre is downstream of the exit plane, or further.
    int first = int(floor((uPlumeExit.x + uPlumeGeom.y) / uPlumeGeom.x - 0.5)) + 1;
    int column = clamp(int(floor((x + uPlumeGeom.y) / uPlumeGeom.x)), first, uPlumeGrid.x - 1);
    int row = clamp(int(floor(r / uPlumeGeom.x)), 0, uPlumeGrid.y - 1);
    vec4 U = texelFetch(uPlume, ivec2(column, row), 0);
    float rho = max(U.x, 1e-9);
    vec2 vel = U.yz / rho;
    float p = max((uGamma - 1.0) * (U.w - 0.5 * rho * dot(vel, vel)), 1e-12);
    vec4 w = vec4(rho * uPlumeScale.x, vel * uPlumeScale.y, p * uPlumeScale.z);
    if (!(any(isnan(w)) || any(isinf(w)))) {
      // The outside can press back with about the pressure of the still air, and no more. The
      // plume grid can show far higher just beyond the exit: the front of a light jet ramming
      // into dense air as the engine starts. In a real engine that front moves off downstream.
      // Here the plume grid is slow to let it, and passed on in full it stands a shock inside
      // the nozzle that then never leaves.
      w.w = min(w.w, max(2.0 * uRest.y, inside.w));
      return vec4(max(w.x, RHO_MIN), w.yz, max(w.w, P_MIN));
    }
  }
  if (inside.y < 0.0) return vec4(uRest.x * uBack / uRest.y, 0.0, 0.0, uBack);
  return vec4(inside.xyz, uBack);
}

// Primitive state of a cell, including the cells just outside the grid.
vec4 cell(ivec2 c) {
  bool mirrored = false;
  bool walled = false;
  if (c.y < 0) {                    // centreline: mirror image
    c.y = -1 - c.y;
    mirrored = true;
  } else if (c.y >= uGrid.y) {      // wall: mirror image, bounced off the wall
    c.y = 2 * uGrid.y - 1 - c.y;
    walled = true;
  }
  int column = c.x;
  vec4 w = toPrim(texelFetch(uCur, ivec2(clamp(c.x, 0, uGrid.x - 1), c.y), 0));
  if (c.x < 0) w = uHeadOpen > 0.5 ? inflow(w) : vec4(w.x, -w.y, w.z, w.w);
  else if (c.x >= uGrid.x) w = outflow(w, c);
  if (mirrored) w.z = -w.z;
  if (walled) {
    vec2 n = wallNormal(column);
    float station = float(column) + 0.5;
    if (station > uSeparates) {
      // Past where the jet has torn off the wall, still outside air lies beside it.
      w = vec4(uRest.x, 0.0, 0.0, uRest.y);
    } else if (station > uBurn.x && station < uBurn.y) {
      // Burning propellant: gas comes off the wall, straight out from its surface.
      vec4 fresh = inflow(w);
      w = vec4(fresh.x, -n * fresh.y, fresh.w);
    } else {
      w.yz -= 2.0 * dot(w.yz, n) * n;
    }
  }
  return w;
}

// Van Leer slope limiter (see the plume solver).
// Worked out one component at a time. Blending between 1 and the sum of the slopes to avoid a
// division by zero looks neater, but when the slopes are tiny that blend rounds to exactly
// zero, and the division it was there to protect blows up.
float limited1(float a, float b) {
  float ab = a * b;
  return ab > 1e-30 ? 2.0 * ab / (a + b) : 0.0;
}

vec4 limited(vec4 a, vec4 b) {
  return vec4(limited1(a.x, b.x), limited1(a.y, b.y), limited1(a.z, b.z), limited1(a.w, b.w));
}

vec4 floorState(vec4 w) {
  w.x = max(w.x, RHO_MIN);
  w.w = max(w.w, P_MIN);
  return w;
}

// Flux along the direction of the state's second component (see the plume solver).
vec4 riemann(vec4 L, vec4 R) {
  float aL = sqrt(uGamma * L.w / L.x);
  float aR = sqrt(uGamma * R.w / R.x);
  float sL = min(L.y - aL, R.y - aR);
  float sR = max(L.y + aL, R.y + aR);
  vec4 UL = toCons(L);
  vec4 UR = toCons(R);
  vec4 FL = vec4(UL.y, UL.y * L.y + L.w, UL.z * L.y, (UL.w + L.w) * L.y);
  vec4 FR = vec4(UR.y, UR.y * R.y + R.w, UR.z * R.y, (UR.w + R.w) * R.y);
  if (sL >= 0.0) return FL;
  if (sR <= 0.0) return FR;
  vec4 smeared = (sR * FL - sL * FR + sL * sR * (UR - UL)) / (sR - sL);
  float mL = L.x * (sL - L.y);
  float mR = R.x * (sR - R.y);
  float sM = (R.w - L.w + mL * L.y - mR * R.y) / (mL - mR);
  vec4 sharp;
  if (sM >= 0.0) {
    vec4 Us = (mL / (sL - sM)) * vec4(1.0, sM, L.z, UL.w / L.x + (sM - L.y) * (sM + L.w / mL));
    sharp = FL + sL * (Us - UL);
  } else {
    vec4 Us = (mR / (sR - sM)) * vec4(1.0, sM, R.z, UR.w / R.x + (sM - R.y) * (sM + R.w / mR));
    sharp = FR + sR * (Us - UR);
  }
  float jump = abs(R.w - L.w) / min(L.w, R.w);
  return mix(sharp, smeared, smoothstep(0.5, 2.5, jump));
}

// Flux through the face between cells b and c, given their outer neighbours a and d.
vec4 faceFlux(vec4 a, vec4 b, vec4 c, vec4 d) {
  vec4 L = floorState(b + 0.5 * limited(b - a, c - b));
  vec4 R = floorState(c - 0.5 * limited(c - b, d - c));
  return riemann(L, R);
}

// The same through a sloping face with unit normal n: turn the velocities to face it,
// work out the flux, and turn the momentum back.
vec4 turned(vec4 w, vec2 n) {
  return vec4(w.x, dot(w.yz, n), dot(w.yz, vec2(-n.y, n.x)), w.w);
}

vec4 slopedFlux(vec4 a, vec4 b, vec4 c, vec4 d, vec2 n) {
  vec4 F = faceFlux(turned(a, n), turned(b, n), turned(c, n), turned(d, n));
  return vec4(F.x, F.y * n + F.z * vec2(-n.y, n.x), F.w);
}

// Rate of change of a cell's contents.
vec4 rate(ivec2 c, vec4 w0) {
  vec4 xm2 = cell(c + ivec2(-2, 0));
  vec4 xm1 = cell(c + ivec2(-1, 0));
  vec4 xp1 = cell(c + ivec2(1, 0));
  vec4 xp2 = cell(c + ivec2(2, 0));
  vec4 ym2 = cell(c + ivec2(0, -2));
  vec4 ym1 = cell(c + ivec2(0, -1));
  vec4 yp1 = cell(c + ivec2(0, 1));
  vec4 yp2 = cell(c + ivec2(0, 2));

  // The cell is a ring whose cross-section is a four-sided shape: upright faces up- and
  // downstream, and sloping faces below and above that follow the wall's shape.
  float rw = radius(c.x);
  float re = radius(c.x + 1);
  float rc = 0.5 * (rw + re);
  float d = 1.0 / float(uGrid.y);
  float e0 = float(c.y) * d;
  float e1 = e0 + d;
  float ec = e0 + 0.5 * d;

  vec4 fW = faceFlux(xm2, xm1, w0, xp1);
  vec4 fE = faceFlux(xm1, w0, xp1, xp2);
  float sW = ec * d * rw * rw;
  float sE = ec * d * re * re;

  vec2 tS = vec2(uDx, e0 * (re - rw));
  vec2 tN = vec2(uDx, e1 * (re - rw));
  float lS = length(tS);
  float lN = length(tN);
  vec4 fS = slopedFlux(ym2, ym1, w0, yp1, vec2(-tS.y, tS.x) / lS);
  vec4 fN = slopedFlux(ym1, w0, yp1, yp2, vec2(-tN.y, tN.x) / lN);
  float sS = e0 * rc * lS;
  float sN = e1 * rc * lN;

  float volume = 0.5 * (e1 * e1 - e0 * e0) * uDx * (rw * rw + rw * re + re * re) / 3.0;
  float area = d * rc * uDx;
  return (-(fE * sE - fW * sW) - (fN * sN - fS * sS) + vec4(0.0, 0.0, w0.w * area, 0.0)) / volume;
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 w0 = toPrim(texelFetch(uCur, c, 0));

  // The largest step this cell can take, from its state at the start of the step.
  vec4 wp = toPrim(texelFetch(uPrev, c, 0));
  float a = sqrt(uGamma * wp.w / wp.x);
  float dr = min(radius(c.x), radius(c.x + 1)) / float(uGrid.y);
  float dt = uCfl / ((abs(wp.y) + a) / uDx + (abs(wp.z) + a) / dr);
  // In step with the plume solver, every cell takes the shared step, unless that is more than
  // it can take: then it falls behind true time instead of going unstable.
  if (uDt > 0.0) dt = min(dt, uDt);

  vec4 U1 = toCons(w0) + dt * rate(c, w0);
  if (uStage == 1) U1 = 0.5 * texelFetch(uPrev, c, 0) + 0.5 * U1;

  vec4 w = toPrim(U1);
  if (uFire < 0.02) {
    // Engine off: let everything settle back to still gas.
    w.x = mix(w.x, uRest.x, 0.02);
    w.w = mix(w.w, uRest.y, 0.02);
    w.yz *= 0.97;
  }
  float here = float(c.x) + 0.5;
  if (uFire >= 0.02 && here > uBurn.x && here < uBurn.y) {
    // Inside a burning grain everything is soon as hot as the flame. Without this, the cold
    // gas that was in the bore before ignition lingers in its closed, pointed end and trails
    // out down the centreline for a long time.
    float temp = mix(w.w / w.x, uChamber.y, 0.02);
    w.x = w.w / temp;
  }
  U1 = toCons(w);
  if (any(isnan(U1)) || any(isinf(U1))) U1 = toCons(vec4(uRest.x, 0.0, 0.0, uRest.y));
  outU = U1;
}
`;

/**
 * The largest time step (in this solver's units) that every cell of the engine can take, give
 * or take: set by the small cells across the throat. Used to decide how many of its own steps
 * the engine solver needs for each step of the plume solver.
 */
export function engineStableStep(inputs: EngineSimInputs): number {
  const g = inputs.gamma;
  const sound = Math.sqrt(g);
  const fastest = Math.sqrt((2 * g) / (g - 1));
  const dx = inputs.length / ENGINE_NX;
  let smallest = Infinity;
  for (let i = 0; i <= ENGINE_NX; i++) smallest = Math.min(smallest, inputs.radii[i]);
  // At the throat the gas moves at about the speed of sound, nearly straight along the engine.
  return CFL / ((2.1 * sound) / dx + (1.2 * sound + 0.1 * fastest) / (smallest / ENGINE_NY));
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
  }
  return shader;
}

/**
 * The steady flow a simple one-dimensional model predicts, used as the starting point so the
 * solver only has to work out what that model leaves out. Returns the gas state for every
 * cell: density, momentum (x, r), energy.
 */
export function initialEngineState(inputs: EngineSimInputs): Float32Array {
  const g = inputs.gamma;
  const state = new Float32Array(ENGINE_NX * ENGINE_NY * 4);
  const burning = inputs.fire > 0.5;
  const dx = inputs.length / ENGINE_NX;
  let throat = 0;
  for (let i = 1; i <= ENGINE_NX; i++) if (inputs.radii[i] < inputs.radii[throat]) throat = i;
  const throatR = inputs.radii[throat];
  // A burning grain feeds gas in all along its bore, so the flow builds up from nothing at the
  // head of the motor to the full flow where the grain ends.
  const burnTo = inputs.burn ? Math.min(ENGINE_NX, Math.floor(inputs.burn.to)) : 0;
  const burnt = new Float64Array(ENGINE_NX + 1);
  for (let i = 0; i < burnTo; i++) burnt[i + 1] = burnt[i] + 0.5 * (inputs.radii[i] + inputs.radii[i + 1]);
  const inBoreP = (lit: boolean, i: number) => lit && i < burnTo;
  const throatTemp = 2 / (g + 1);
  const throatFlow = Math.pow(throatTemp, 1 / (g - 1)) * Math.sqrt(g * throatTemp) * throatR * throatR;  for (let i = 0; i < ENGINE_NX; i++) {
    const r = 0.5 * (inputs.radii[i] + inputs.radii[i + 1]);
    const slope = (inputs.radii[i + 1] - inputs.radii[i]) / dx;
    const ratio = Math.max(1, (r / throatR) ** 2);
    const mach = i + 0.5 < throat ? subsonicMachFromAreaRatio(ratio, g) : machFromAreaRatio(ratio, g);
    const temp = 1 / (1 + ((g - 1) / 2) * mach * mach);
    const p = inBoreP(burning, i) ? 1 : burning ? Math.pow(temp, g / (g - 1)) : inputs.restPressure;
    const rho = inBoreP(burning, i) ? 1 : burning ? p / temp : inputs.restPressure / inputs.restTemp;
    let speed = burning ? mach * Math.sqrt(g * temp) : 0;
    if (burning && i < burnTo) {
      // Slow, at close to chamber pressure: only part of the flow has joined yet.
      speed = Math.min(0.5, ((burnt[i] + burnt[i + 1]) / (2 * burnt[burnTo])) * throatFlow / (r * r));
    }
    for (let j = 0; j < ENGINE_NY; j++) {
      // The gas follows the wall at the wall and runs straight along the centreline.
      const angle = slope * ((j + 0.5) / ENGINE_NY);
      const u = speed / Math.sqrt(1 + angle * angle);
      const v = u * angle;
      const n = (j * ENGINE_NX + i) * 4;
      state[n] = rho;
      state[n + 1] = rho * u;
      state[n + 2] = rho * v;
      state[n + 3] = p / (g - 1) + 0.5 * rho * (u * u + v * v);
    }
  }
  return state;
}

/**
 * Returns null when the browser cannot render to floating-point textures.
 * Expects a full-screen triangle to be bound at vertex attribute 0.
 */
export function createEngineSim(gl: WebGL2RenderingContext): EngineSim | null {
  if (!gl.getExtension('EXT_color_buffer_float')) return null;
  const smooth = gl.getExtension('OES_texture_float_linear') !== null;

  let program: WebGLProgram;
  try {
    program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
    }
  } catch (err) {
    console.error('Engine gas simulation shader failed to build', err);
    return null;
  }
  const u = (name: string) => gl.getUniformLocation(program, name);
  const loc = {
    prev: u('uPrev'), cur: u('uCur'), rad: u('uRad'), stage: u('uStage'), grid: u('uGrid'), dx: u('uDx'),
    cfl: u('uCfl'), burn: u('uBurn'), separates: u('uSeparates'), headOpen: u('uHeadOpen'), gamma: u('uGamma'), fire: u('uFire'), chamber: u('uChamber'), rest: u('uRest'), back: u('uBack'),
    dt: u('uDt'), linkOn: u('uLinkOn'), plume: u('uPlume'), plumeGrid: u('uPlumeGrid'), plumeGeom: u('uPlumeGeom'), plumeExit: u('uPlumeExit'), plumeScale: u('uPlumeScale'),
  };

  const makeTexture = (format: number, width: number, height: number, filter: number) => {
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  };

  let complete = true;
  const targets = [0, 1, 2].map(() => {
    const state = makeTexture(gl.RGBA32F, ENGINE_NX, ENGINE_NY, smooth ? gl.LINEAR : gl.NEAREST);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) complete = false;
    return { state, fbo };
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!complete) return null;
  const radiusTexture = makeTexture(gl.R32F, ENGINE_NX + 1, 1, gl.NEAREST);

  let needsReset = true;
  let current = 0;

  // Reading columns back: into a buffer on the graphics card first, then across once a marker
  // placed after it says the card has got that far.
  const COLUMN_BYTES = ENGINE_NY * 16;
  const readBuffer = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, readBuffer);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, 2 * COLUMN_BYTES, gl.STREAM_READ);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const both = new Float32Array(2 * ENGINE_NY * 4);
  const reading: ColumnReading = {
    exit: both.subarray(0, ENGINE_NY * 4),
    at: both.subarray(ENGINE_NY * 4),
    station: 0,
    stamp: 0,
  };
  let readingReady = false;
  let pending: { sync: WebGLSync; stamp: number; station: number } | null = null;

  const bind = (unit: number, texture: WebGLTexture | null) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };

  const sim = {
    texture: targets[0].state,
    radiusTexture,
    reset() {
      needsReset = true;
      // Whatever comes back next is the engine as it was before.
      readingReady = false;
    },
    readColumns(stamp: number, station: number, ask: boolean) {
      if (pending) {
        const status = gl.clientWaitSync(pending.sync, 0, 0);
        if (status === gl.TIMEOUT_EXPIRED) return readingReady ? reading : null;
        gl.deleteSync(pending.sync);
        if (status !== gl.WAIT_FAILED && !needsReset) {
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, readBuffer);
          gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, both);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          reading.stamp = pending.stamp;
          reading.station = pending.station;
          readingReady = true;
        }
        pending = null;
      }
      if (ask && !needsReset) {
        const column = Math.min(ENGINE_NX - 1, Math.max(0, Math.round(station)));
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets[current].fbo);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, readBuffer);
        gl.readPixels(ENGINE_NX - 1, 0, 1, ENGINE_NY, gl.RGBA, gl.FLOAT, 0);
        gl.readPixels(column, 0, 1, ENGINE_NY, gl.RGBA, gl.FLOAT, COLUMN_BYTES);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (sync) pending = { sync, stamp, station: column };
        gl.flush();
      }
      return readingReady ? reading : null;
    },
    begin(inputs: EngineSimInputs, link: EngineLink | null) {
      bind(0, radiusTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ENGINE_NX + 1, 1, gl.RED, gl.FLOAT, inputs.radii);
      if (needsReset) {
        bind(0, targets[current].state);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ENGINE_NX, ENGINE_NY, gl.RGBA, gl.FLOAT, initialEngineState(inputs));
        needsReset = false;
      }

      const fire = Math.min(1, Math.max(0, inputs.fire));
      const rest = inputs.restPressure;
      gl.useProgram(program);
      gl.uniform2i(loc.grid, ENGINE_NX, ENGINE_NY);
      gl.uniform1f(loc.dx, inputs.length / ENGINE_NX);
      gl.uniform1f(loc.cfl, CFL);
      gl.uniform1f(loc.gamma, inputs.gamma);
      gl.uniform1f(loc.fire, fire);
      // The supply builds from the still gas up to full chamber conditions as the engine lights.
      gl.uniform2f(loc.chamber, rest + fire * (1 - rest), inputs.restTemp + fire * (1 - inputs.restTemp));
      gl.uniform2f(loc.rest, rest / inputs.restTemp, rest);
      // Once the engine is running the gas leaves supersonic and the outside cannot reach in.
      // Dropping the outside pressure away as it lights makes sure the flow gets there.
      // It stops a little below the pressure the gas leaves at: a true vacuum outside is more
      // than the solver can take, and the gas never feels the difference.
      gl.uniform1f(loc.back, Math.max(0.1 * inputs.exitPressure, rest * (1 - fire) ** 2));
      gl.uniform2f(loc.burn, inputs.burn ? inputs.burn.from : -1, inputs.burn ? inputs.burn.to : -1);
      gl.uniform1f(loc.headOpen, inputs.burn ? 0 : 1);
      gl.uniform1f(loc.separates, inputs.separatesAt ?? 1e9);
      gl.uniform1f(loc.linkOn, link ? 1 : 0);
      if (link) {
        gl.uniform2i(loc.plumeGrid, link.columns, link.rows);
        gl.uniform3f(loc.plumeGeom, link.cell, link.upstream, link.unitRadius);
        gl.uniform2f(loc.plumeExit, link.exitX, link.exitRadius);
        gl.uniform3f(loc.plumeScale, link.density, link.speed, link.pressure);
      }
      gl.uniform1i(loc.prev, 0);
      gl.uniform1i(loc.cur, 1);
      gl.uniform1i(loc.rad, 2);
      gl.uniform1i(loc.plume, 3);
    },
    advance(dt: number, substeps: number, plume: WebGLTexture | null) {
      gl.useProgram(program);
      gl.viewport(0, 0, ENGINE_NX, ENGINE_NY);
      gl.uniform1f(loc.dt, dt);
      bind(2, radiusTexture);
      bind(3, plume);
      for (let n = 0; n < substeps; n++) {
        const a = targets[current];
        const b = targets[(current + 1) % 3];
        const c = targets[(current + 2) % 3];
        bind(0, a.state);
        bind(1, a.state);
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
        gl.uniform1i(loc.stage, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        bind(1, b.state);
        gl.bindFramebuffer(gl.FRAMEBUFFER, c.fbo);
        gl.uniform1i(loc.stage, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        current = (current + 2) % 3;
      }
      sim.texture = targets[current].state;
    },
    finish() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (const unit of [3, 2, 1, 0]) bind(unit, null);
    },
    step(inputs: EngineSimInputs) {
      sim.begin(inputs, null);
      sim.advance(0, STEPS_PER_FRAME, null);
      sim.finish();
    },
  };
  return sim;
}
