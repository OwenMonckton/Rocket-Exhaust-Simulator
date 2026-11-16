// PROTOTYPE: a primitive compressible-gas solver for the plume, run on the GPU.
//
// Axisymmetric Euler equations on a uniform grid covering the region downstream
// of the nozzle exit, in finite-volume form (fluxes weighted by radius, so the
// centreline needs no special treatment). Second order in space (MUSCL with a
// van Leer limiter, HLLC fluxes) and in time (two-stage Runge-Kutta). A second
// field tracks how much of the gas in each cell is exhaust rather than air.
//
// Everything is in units of the nozzle exit state: length in exit radii, density
// and pressure relative to the average exhaust at the exit. The nozzle exit is a
// fixed supersonic inflow on the left edge; the air is held at ambient.

export const SIM_NX = 384;
export const SIM_NY = 162;
const STEPS_PER_FRAME = 48;
const CFL = 0.3;

export interface SimInputs {
  gamma: number;
  /** Exit velocity in solver units: exit Mach × sqrt(gamma) */
  uExit: number;
  /** Ambient pressure over exit pressure (floored at VACUUM_FLOOR: the solver cannot reach a true vacuum) */
  pAmb: number;
  /** Ambient density over exhaust density at the exit */
  rhoAmb: number;
  /** 0–1 ignition ramp */
  fire: number;
  /** Stagnation temperature over exit temperature */
  t0: number;
  /** Tangent of the flow angle at the nozzle lip: bell nozzles release the gas fanning slightly outward */
  divergence: number;
  /** How much the exit pressure rises from centreline to wall (0 = uniform), as bell nozzles do */
  profile: number;
}

/**
 * The inner surface of a solid cone standing in the flow (a nozzle extension), in exit radii
 * measured from where the gas enters the grid. Only the part inside the grid matters.
 */
export interface SimWall {
  x0: number;
  r0: number;
  x1: number;
  r1: number;
}

export interface FluidSim {
  /** Gas state: density, momentum (x, r), energy */
  readonly texture: WebGLTexture;
  /** Exhaust density (density × exhaust fraction) */
  readonly scalarTexture: WebGLTexture;
  /** Advance the simulation one display frame. */
  /**
   * `lengthRadii` is the whole span of the grid in exit radii, of which the first `upstreamRadii`
   * lie beside the nozzle, upstream of its exit plane.
   */
  step(inputs: SimInputs, lengthRadii: number, wall?: SimWall | null, upstreamRadii?: number): void;
  reset(): void;
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
uniform sampler2D uPrevS;   // exhaust density, same two roles
uniform sampler2D uCurS;
uniform int uStage;
uniform ivec2 uGrid;
uniform float uDx;
uniform float uDt;
uniform float uGamma;
uniform float uRelax;
uniform float uFire;
uniform float uDiverge;
uniform float uProfile;
uniform float uExitSpeed;
uniform vec2 uAmb;          // density, pressure
uniform float uWallOn;      // 1 when a solid cone (a nozzle extension) stands in the flow
uniform vec4 uWall;         // its inner surface: (x, r) at the upstream end, (x, r) at the downstream end
uniform float uWallThick;
uniform float uUpstream;    // how far the grid reaches upstream of the nozzle exit, in exit radii

layout(location = 0) out vec4 outU;
layout(location = 1) out vec4 outS;

const float RHO_MIN = 1e-6;
const float P_MIN = 1e-8;

// Conserved (rho, rho*u, rho*v, E) <-> primitive (rho, u, v, p).
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

vec4 ambient() {
  return vec4(uAmb.x, 0.0, 0.0, uAmb.y);
}

// Where a cell is: distance downstream of the nozzle exit plane (negative means beside
// the nozzle, upstream of its exit) and distance from the centreline.
vec2 position(ivec2 c) {
  return vec2((float(c.x) + 0.5) * uDx - uUpstream, (float(c.y) + 0.5) * uDx);
}

// Inner radius of the nozzle wall upstream of the exit: the bell narrows going forward.
float nozzleRadius(float x) {
  return max(0.3, 1.0 + uDiverge * x);
}

// Inside the nozzle itself. These cells are not simulated: they hold the exhaust as it arrives.
bool inNozzle(ivec2 c) {
  if (c.x < 0 || c.y < 0) return false;
  vec2 p = position(c);
  return p.x < 0.0 && p.y < nozzleRadius(p.x);
}

// The exhaust arriving at the nozzle exit, at radius r (as a fraction of the nozzle's radius).
// A bell nozzle delivers higher pressure near its wall than on the centreline, with the gas
// fanning slightly outward toward the lip. Every streamline has the same stagnation state,
// so speed follows pressure.
vec4 exhaustState(float r) {
  float f = 1.0 + uProfile * (r * r - 0.5);
  float temp = pow(f, (uGamma - 1.0) / uGamma);
  float speed = sqrt(max(0.0, uExitSpeed * uExitSpeed + 2.0 * uGamma / (uGamma - 1.0) * (1.0 - temp)));
  float angle = uDiverge * r;
  return vec4(uFire * pow(f, 1.0 / uGamma), speed / sqrt(1.0 + angle * angle),
              speed * angle / sqrt(1.0 + angle * angle), uFire * f);
}

// Primitive state of a cell, including the cells just outside the grid.
// Also returns the exhaust fraction (0 = air, 1 = exhaust).
vec4 cell(ivec2 c, out float frac) {
  frac = 0.0;
  if (c.y >= uGrid.y || c.x < 0) return ambient();
  bool mirrored = false;
  if (c.y < 0) {          // centreline: mirror image
    c.y = -1 - c.y;
    mirrored = true;
  }
  vec4 w;
  if (inNozzle(c)) {
    if (uFire > 0.02) {
      vec2 p = position(c);
      w = exhaustState(p.y / nozzleRadius(p.x));
      frac = 1.0;
    } else {
      w = ambient();
    }
  } else {
    c.x = min(c.x, uGrid.x - 1);   // far end: let the flow leave freely
    w = toPrim(texelFetch(uCur, c, 0));
    frac = clamp(texelFetch(uCurS, c, 0).x / w.x, 0.0, 1.0);
  }
  if (mirrored) w.z = -w.z;
  return w;
}

// Van Leer slope limiter: sharper than minmod, still free of overshoots.
vec4 limited(vec4 a, vec4 b) {
  vec4 ab = a * b;
  vec4 same = step(vec4(1e-30), ab);   // 1 where both slopes point the same way
  return same * 2.0 * ab / mix(vec4(1.0), a + b, same);
}

float limited1(float a, float b) {
  float ab = a * b;
  return ab > 1e-30 ? 2.0 * ab / (a + b) : 0.0;
}

vec4 floorState(vec4 w) {
  w.x = max(w.x, RHO_MIN);
  w.w = max(w.w, P_MIN);
  return w;
}

// Flux along the direction of the state's second component.
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

  // HLLC: also tracks the contact between the two gases, which keeps the edge
  // of the jet sharp. That edge is what bounces the shocks back to make diamonds.
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
  // Across a strong shock the sharp flux can go unstable, so fall back to the smeared one there.
  float jump = abs(R.w - L.w) / min(L.w, R.w);
  return mix(sharp, smeared, smoothstep(0.5, 2.5, jump));
}

// Flux through the face between cells b and c, given their outer neighbours a and d.
// fa..fd are the exhaust fractions of the same cells; exhaustFlux is the exhaust carried across.
vec4 faceFlux(vec4 a, vec4 b, vec4 c, vec4 d, float fa, float fb, float fc, float fd, out float exhaustFlux) {
  vec4 L = floorState(b + 0.5 * limited(b - a, c - b));
  vec4 R = floorState(c - 0.5 * limited(c - b, d - c));
  vec4 F = riemann(L, R);
  float fracL = fb + 0.5 * limited1(fb - fa, fc - fb);
  float fracR = fc - 0.5 * limited1(fc - fb, fd - fc);
  exhaustFlux = F.x * (F.x > 0.0 ? fracL : fracR);
  return F;
}

// The nozzle's own wall, beside the exit plane. Exhaust that spreads sideways hard enough
// curls back around the lip and along the outside of it.
bool solidNozzle(ivec2 c) {
  if (c.x < 0 || c.y < 0) return false;
  vec2 p = position(c);
  if (p.x >= 0.0) return false;
  float inner = nozzleRadius(p.x);
  return p.y >= inner && p.y <= inner + uWallThick;
}

// The wall of a nozzle extension, wherever it currently is.
bool solidExtension(ivec2 c) {
  if (uWallOn < 0.5 || c.x < 0 || c.y < 0) return false;
  vec2 p = position(c);
  if (p.x < uWall.x || p.x > uWall.z) return false;
  float inner = mix(uWall.y, uWall.w, (p.x - uWall.x) / max(1e-6, uWall.z - uWall.x));
  return p.y >= inner && p.y <= inner + uWallThick;
}

bool solid(ivec2 c) {
  return solidNozzle(c) || solidExtension(c);
}

// Gas bounces off a wall: the part of its velocity pointing into the surface is reversed.
// Using the wall's true slope here, not the grid's stair-steps, keeps the flow along it smooth.
vec4 bounce(vec4 w, ivec2 wallCell) {
  vec2 n = solidNozzle(wallCell)
    ? normalize(vec2(uDiverge, -1.0))
    : normalize(vec2(uWall.w - uWall.y, uWall.x - uWall.z));
  w.yz -= 2.0 * dot(w.yz, n) * n;
  return w;
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  if (solid(c)) {
    outU = toCons(ambient());
    outS = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float f0, fxm2, fxm1, fxp1, fxp2, fym2, fym1, fyp1, fyp2;
  vec4 w0 = cell(c, f0);
  if (inNozzle(c)) {
    outU = toCons(w0);
    outS = vec4(w0.x * f0, 0.0, 0.0, 1.0);
    return;
  }
  vec4 xm2 = cell(c + ivec2(-2, 0), fxm2);
  vec4 xm1 = cell(c + ivec2(-1, 0), fxm1);
  vec4 xp1 = cell(c + ivec2(1, 0), fxp1);
  vec4 xp2 = cell(c + ivec2(2, 0), fxp2);
  vec4 ym2 = cell(c + ivec2(0, -2), fym2);
  vec4 ym1 = cell(c + ivec2(0, -1), fym1);
  vec4 yp1 = cell(c + ivec2(0, 1), fyp1);
  vec4 yp2 = cell(c + ivec2(0, 2), fyp2);

  // Where a neighbour is solid wall, replace it (and whatever lies beyond) with mirror images.
  ivec2 n1 = c + ivec2(-1, 0);
  ivec2 n2 = c + ivec2(-2, 0);
  if (solid(n1)) { xm1 = bounce(w0, n1); fxm1 = f0; xm2 = bounce(xp1, n1); fxm2 = fxp1; }
  else if (solid(n2)) { xm2 = bounce(xm1, n2); fxm2 = fxm1; }
  n1 = c + ivec2(1, 0);
  n2 = c + ivec2(2, 0);
  if (solid(n1)) { xp1 = bounce(w0, n1); fxp1 = f0; xp2 = bounce(xm1, n1); fxp2 = fxm1; }
  else if (solid(n2)) { xp2 = bounce(xp1, n2); fxp2 = fxp1; }
  n1 = c + ivec2(0, -1);
  n2 = c + ivec2(0, -2);
  if (solid(n1)) { ym1 = bounce(w0, n1); fym1 = f0; ym2 = bounce(yp1, n1); fym2 = fyp1; }
  else if (solid(n2)) { ym2 = bounce(ym1, n2); fym2 = fym1; }
  n1 = c + ivec2(0, 1);
  n2 = c + ivec2(0, 2);
  if (solid(n1)) { yp1 = bounce(w0, n1); fyp1 = f0; yp2 = bounce(ym1, n1); fyp2 = fym1; }
  else if (solid(n2)) { yp2 = bounce(yp1, n2); fyp2 = fyp1; }

  float sxL, sxR, syB, syT;
  vec4 fxL = faceFlux(xm2, xm1, w0, xp1, fxm2, fxm1, f0, fxp1, sxL);
  vec4 fxR = faceFlux(xm1, w0, xp1, xp2, fxm1, f0, fxp1, fxp2, sxR);
  // Radial direction: swap the velocity components, reuse the same flux, swap back.
  vec4 fyB = faceFlux(ym2.xzyw, ym1.xzyw, w0.xzyw, yp1.xzyw, fym2, fym1, f0, fyp1, syB).xzyw;
  vec4 fyT = faceFlux(ym1.xzyw, w0.xzyw, yp1.xzyw, yp2.xzyw, fym1, f0, fyp1, fyp2, syT).xzyw;

  // Each cell is a ring around the centreline. Its outer face is larger than its
  // inner one, and the pressure on its sloping sides pushes it outward.
  float rB = float(c.y) * uDx;
  float rT = rB + uDx;
  float rC = rB + 0.5 * uDx;
  float k1 = uDt / uDx;
  float k2 = uDt / (rC * uDx);

  vec4 U1 = toCons(w0) - k1 * (fxR - fxL) - k2 * (rT * fyT - rB * fyB) + vec4(0.0, 0.0, uDt * w0.w / rC, 0.0);
  float S1 = w0.x * f0 - k1 * (sxR - sxL) - k2 * (rT * syT - rB * syB);
  if (uStage == 1) {
    U1 = 0.5 * texelFetch(uPrev, c, 0) + 0.5 * U1;
    S1 = 0.5 * texelFetch(uPrevS, c, 0).x + 0.5 * S1;
  }

  vec4 w = toPrim(U1);
  S1 = clamp(S1, 0.0, w.x);
  float frac = S1 / w.x;
  if (uFire > 0.02) {
    // Hold the surrounding air at ambient, leaving anything containing exhaust alone.
    float k = uRelax * (1.0 - smoothstep(0.01, 0.08, frac));
    w.x = mix(w.x, uAmb.x, k);
    w.w = mix(w.w, uAmb.y, k);
    // Wisps of exhaust left drifting in still air disperse (the grid has no wind to carry them off).
    float drifting = 1.0 - smoothstep(0.05, 0.2, length(w.yz) / uExitSpeed);
    frac *= 1.0 - 0.02 * drifting;
  } else {
    // Engine off: let everything settle back to still air.
    w.x = mix(w.x, uAmb.x, 0.05);
    w.w = mix(w.w, uAmb.y, 0.05);
    w.yz *= 0.96;
    frac *= 0.95;
  }
  U1 = toCons(w);
  S1 = w.x * frac;

  if (any(isnan(U1)) || any(isinf(U1)) || isnan(S1)) {
    U1 = toCons(ambient());
    S1 = 0.0;
  }
  outU = U1;
  outS = vec4(S1, 0.0, 0.0, 1.0);
}
`;

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
 * Returns null when the browser cannot render to floating-point textures.
 * Expects a full-screen triangle to be bound at vertex attribute 0.
 */
export function createFluidSim(gl: WebGL2RenderingContext): FluidSim | null {
  if (!gl.getExtension('EXT_color_buffer_float')) return null;
  // Smooth sampling when the plume is drawn; without it the plume just looks blockier.
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
    console.error('Fluid simulation shader failed to build', err);
    return null;
  }
  const u = (name: string) => gl.getUniformLocation(program, name);
  const loc = {
    prev: u('uPrev'), cur: u('uCur'), prevS: u('uPrevS'), curS: u('uCurS'), stage: u('uStage'),
    grid: u('uGrid'), dx: u('uDx'), dt: u('uDt'), gamma: u('uGamma'), relax: u('uRelax'), fire: u('uFire'),
    diverge: u('uDiverge'), profile: u('uProfile'), exitSpeed: u('uExitSpeed'), amb: u('uAmb'),
    wallOn: u('uWallOn'), wall: u('uWall'), wallThick: u('uWallThick'), upstream: u('uUpstream'),
  };

  const makeTexture = (format: number) => {
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, SIM_NX, SIM_NY);
    const filter = smooth ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  };

  // Three states: start of step, after stage one, end of step.
  let complete = true;
  const targets = [0, 1, 2].map(() => {
    const state = makeTexture(gl.RGBA32F);
    const scalar = makeTexture(gl.R32F);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, scalar, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) complete = false;
    return { state, scalar, fbo };
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!complete) return null;

  let needsReset = true;
  let current = 0;

  const fill = (inputs: SimInputs, lengthRadii: number) => {
    const state = new Float32Array(SIM_NX * SIM_NY * 4);
    const scalar = new Float32Array(SIM_NX * SIM_NY);
    const energy = inputs.pAmb / (inputs.gamma - 1);
    // If the engine is already burning, start with a column of exhaust so the plume forms quickly.
    const burning = inputs.fire > 0.5;
    const jetRows = Math.floor(SIM_NX / lengthRadii);
    const jetEnergy = 1 / (inputs.gamma - 1) + 0.5 * inputs.uExit * inputs.uExit;
    for (let j = 0; j < SIM_NY; j++) {
      const inJet = burning && j < jetRows;
      for (let i = 0; i < SIM_NX; i++) {
        const n = j * SIM_NX + i;
        state[n * 4] = inJet ? 1 : inputs.rhoAmb;
        state[n * 4 + 1] = inJet ? inputs.uExit : 0;
        state[n * 4 + 3] = inJet ? jetEnergy : energy;
        scalar[n] = inJet ? 1 : 0;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, targets[current].state);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SIM_NX, SIM_NY, gl.RGBA, gl.FLOAT, state);
    gl.bindTexture(gl.TEXTURE_2D, targets[current].scalar);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SIM_NX, SIM_NY, gl.RED, gl.FLOAT, scalar);
  };

  const bind = (unit: number, texture: WebGLTexture | null) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };

  const sim = {
    texture: targets[0].state,
    scalarTexture: targets[0].scalar,
    reset() {
      needsReset = true;
    },
    step(inputs: SimInputs, lengthRadii: number, wall?: SimWall | null, upstreamRadii = 0) {
      if (needsReset) {
        fill(inputs, lengthRadii);
        needsReset = false;
      }
      const g = inputs.gamma;
      const dx = lengthRadii / SIM_NX;
      // Fastest the gas can ever go: all of its heat turned into speed.
      const a0 = Math.sqrt(g * inputs.t0);
      const maxSpeed = 1.25 * Math.max(inputs.uExit + Math.sqrt(g), a0 * Math.sqrt(2 / (g - 1)));
      const dt = (CFL * dx) / maxSpeed;

      gl.useProgram(program);
      gl.viewport(0, 0, SIM_NX, SIM_NY);
      gl.uniform2i(loc.grid, SIM_NX, SIM_NY);
      gl.uniform1f(loc.dx, dx);
      gl.uniform1f(loc.dt, dt);
      gl.uniform1f(loc.gamma, g);
      gl.uniform1f(loc.relax, 0.02);
      gl.uniform1f(loc.fire, inputs.fire);
      gl.uniform1f(loc.diverge, inputs.divergence);
      gl.uniform1f(loc.profile, inputs.profile);
      gl.uniform1f(loc.exitSpeed, inputs.uExit);
      gl.uniform2f(loc.amb, inputs.rhoAmb, inputs.pAmb);
      const hasWall = !!wall && wall.x1 > -upstreamRadii && wall.x1 > wall.x0;
      gl.uniform1f(loc.wallOn, hasWall ? 1 : 0);
      if (hasWall) gl.uniform4f(loc.wall, wall!.x0, wall!.r0, wall!.x1, wall!.r1);
      // Walls are thick enough that gas cannot leak through between neighbouring cells.
      gl.uniform1f(loc.wallThick, Math.max(3 * dx, 0.05));
      gl.uniform1f(loc.upstream, upstreamRadii);
      gl.uniform1i(loc.prev, 0);
      gl.uniform1i(loc.cur, 1);
      gl.uniform1i(loc.prevS, 2);
      gl.uniform1i(loc.curS, 3);

      for (let n = 0; n < STEPS_PER_FRAME; n++) {
        const a = targets[current];
        const b = targets[(current + 1) % 3];
        const c = targets[(current + 2) % 3];
        bind(0, a.state);
        bind(2, a.scalar);
        // Stage one: a -> b
        bind(1, a.state);
        bind(3, a.scalar);
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
        gl.uniform1i(loc.stage, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        // Stage two: (a, b) -> c
        bind(1, b.state);
        bind(3, b.scalar);
        gl.bindFramebuffer(gl.FRAMEBUFFER, c.fbo);
        gl.uniform1i(loc.stage, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        current = (current + 2) % 3;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (const unit of [3, 2, 1, 0]) bind(unit, null);
      sim.texture = targets[current].state;
      sim.scalarTexture = targets[current].scalar;
    },
  };
  return sim;
}
