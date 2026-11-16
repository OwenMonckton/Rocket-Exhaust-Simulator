// PROTOTYPE: a primitive compressible-gas solver for the plume, run on the GPU.
//
// Axisymmetric Euler equations on a uniform grid covering the region downstream
// of the nozzle exit. Second order in space (MUSCL with a minmod limiter, HLL
// fluxes) and in time (two-stage Runge-Kutta). Everything is in units of the
// nozzle exit state: length in exit radii, density and pressure relative to the
// exhaust at the exit. The nozzle exit is a fixed supersonic inflow on the left
// edge; the surrounding air is held at ambient on the far edges.

export const SIM_NX = 256;
export const SIM_NY = 108;
const STEPS_PER_FRAME = 40;
const CFL = 0.3;

export interface SimInputs {
  gamma: number;
  /** Exit velocity in solver units: exit Mach × sqrt(gamma) */
  uExit: number;
  /** Ambient pressure over exit pressure (floored: the solver cannot reach a true vacuum) */
  pAmb: number;
  /** Ambient density over exhaust density at the exit */
  rhoAmb: number;
  /** 0–1 ignition ramp */
  fire: number;
  /** Stagnation temperature over exit temperature */
  t0: number;
}

export interface FluidSim {
  readonly texture: WebGLTexture;
  /** Advance the simulation one display frame. `lengthRadii` is how many exit radii the grid spans downstream. */
  step(inputs: SimInputs, lengthRadii: number): void;
  reset(): void;
}

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uPrev;   // state at the start of the time step
uniform sampler2D uCur;    // state this stage advances
uniform int uStage;
uniform ivec2 uGrid;
uniform float uDx;
uniform float uDt;
uniform float uGamma;
uniform float uRelax;
uniform float uFire;
uniform float uDiverge;
uniform vec3 uInflow;      // density, velocity, pressure
uniform vec2 uAmb;         // density, pressure

out vec4 outU;

const float RHO_MIN = 1e-4;
const float P_MIN = 1e-5;

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

// Primitive state of a cell, including the cells just outside the grid.
vec4 cell(ivec2 c) {
  if (c.y >= uGrid.y) return ambient();
  bool mirrored = false;
  if (c.y < 0) {          // centreline: mirror image
    c.y = -1 - c.y;
    mirrored = true;
  }
  vec4 w;
  if (c.x < 0) {
    float r = (float(c.y) + 0.5) * uDx;
    if (r < 1.0 && uFire > 0.02) {
      // The nozzle exit: supersonic exhaust, fanning out slightly toward the lip.
      w = vec4(uInflow.x * uFire, uInflow.y, uInflow.y * uDiverge * r, uInflow.z * uFire);
    } else {
      w = ambient();
    }
  } else {
    c.x = min(c.x, uGrid.x - 1);   // far end: let the flow leave freely
    w = toPrim(texelFetch(uCur, c, 0));
  }
  if (mirrored) w.z = -w.z;
  return w;
}

vec4 minmod(vec4 a, vec4 b) {
  return 0.5 * (sign(a) + sign(b)) * min(abs(a), abs(b));
}

vec4 floorState(vec4 w) {
  w.x = max(w.x, RHO_MIN);
  w.w = max(w.w, P_MIN);
  return w;
}

// HLL flux along the direction of the state's second component.
vec4 hll(vec4 L, vec4 R) {
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
  return (sR * FL - sL * FR + sL * sR * (UR - UL)) / (sR - sL);
}

// Flux through the face between cells b and c, given their outer neighbours a and d.
vec4 faceFlux(vec4 a, vec4 b, vec4 c, vec4 d) {
  vec4 L = floorState(b + 0.5 * minmod(b - a, c - b));
  vec4 R = floorState(c - 0.5 * minmod(c - b, d - c));
  return hll(L, R);
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 w0 = cell(c);
  vec4 xm2 = cell(c + ivec2(-2, 0));
  vec4 xm1 = cell(c + ivec2(-1, 0));
  vec4 xp1 = cell(c + ivec2(1, 0));
  vec4 xp2 = cell(c + ivec2(2, 0));
  vec4 ym2 = cell(c + ivec2(0, -2));
  vec4 ym1 = cell(c + ivec2(0, -1));
  vec4 yp1 = cell(c + ivec2(0, 1));
  vec4 yp2 = cell(c + ivec2(0, 2));

  vec4 fxL = faceFlux(xm2, xm1, w0, xp1);
  vec4 fxR = faceFlux(xm1, w0, xp1, xp2);
  // Radial direction: swap the velocity components, reuse the same flux, swap back.
  vec4 fyL = faceFlux(ym2.xzyw, ym1.xzyw, w0.xzyw, yp1.xzyw).xzyw;
  vec4 fyR = faceFlux(ym1.xzyw, w0.xzyw, yp1.xzyw, yp2.xzyw).xzyw;

  vec4 U0 = toCons(w0);
  // Axisymmetric geometry: gas moving outward has more room to spread into.
  float r = (float(c.y) + 0.5) * uDx;
  vec4 H = vec4(w0.x * w0.z, w0.x * w0.y * w0.z, w0.x * w0.z * w0.z, w0.z * (U0.w + w0.w));

  vec4 U1 = U0 - (uDt / uDx) * (fxR - fxL + fyR - fyL) - uDt * H / r;
  if (uStage == 1) U1 = 0.5 * texelFetch(uPrev, c, 0) + 0.5 * U1;

  // Hold the surrounding air at ambient. Cold gas is air, hot gas is exhaust.
  vec4 w = toPrim(U1);
  float tAmb = uAmb.y / uAmb.x;
  float cold = 1.0 - smoothstep(1.6 * tAmb, 3.0 * tAmb, w.w / w.x);
  float k = uFire > 0.02 ? uRelax * cold : 0.05;
  w.x = mix(w.x, uAmb.x, k);
  w.w = mix(w.w, uAmb.y, k);
  if (uFire <= 0.02) w.yz *= 0.96;   // engine off: let everything settle
  U1 = toCons(w);

  if (any(isnan(U1)) || any(isinf(U1))) U1 = toCons(ambient());
  outU = U1;
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
    prev: u('uPrev'), cur: u('uCur'), stage: u('uStage'), grid: u('uGrid'), dx: u('uDx'), dt: u('uDt'),
    gamma: u('uGamma'), relax: u('uRelax'), fire: u('uFire'), diverge: u('uDiverge'),
    inflow: u('uInflow'), amb: u('uAmb'),
  };

  // Three states: start of step, after stage one, end of step.
  const targets = [0, 1, 2].map(() => {
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, SIM_NX, SIM_NY);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return { texture, fbo };
  });
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return null;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  let needsReset = true;
  let current = 0;

  const fillAmbient = (inputs: SimInputs, lengthRadii: number) => {
    const data = new Float32Array(SIM_NX * SIM_NY * 4);
    const energy = inputs.pAmb / (inputs.gamma - 1);
    // If the engine is already burning, start with a column of exhaust so the plume forms quickly.
    const burning = inputs.fire > 0.5;
    const jetRows = Math.floor(SIM_NX / lengthRadii);
    const jetEnergy = 1 / (inputs.gamma - 1) + 0.5 * inputs.uExit * inputs.uExit;
    for (let j = 0; j < SIM_NY; j++) {
      const inJet = burning && j < jetRows;
      for (let i = 0; i < SIM_NX; i++) {
        const k = (j * SIM_NX + i) * 4;
        data[k] = inJet ? 1 : inputs.rhoAmb;
        data[k + 1] = inJet ? inputs.uExit : 0;
        data[k + 3] = inJet ? jetEnergy : energy;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, targets[current].texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SIM_NX, SIM_NY, gl.RGBA, gl.FLOAT, data);
  };

  const sim = {
    texture: targets[0].texture,
    reset() {
      needsReset = true;
    },
    step(inputs: SimInputs, lengthRadii: number) {
      if (needsReset) {
        fillAmbient(inputs, lengthRadii);
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
      gl.uniform1f(loc.relax, 0.012);
      gl.uniform1f(loc.fire, inputs.fire);
      gl.uniform1f(loc.diverge, 0.12);
      gl.uniform3f(loc.inflow, 1, inputs.uExit, 1);
      gl.uniform2f(loc.amb, inputs.rhoAmb, inputs.pAmb);
      gl.uniform1i(loc.prev, 0);
      gl.uniform1i(loc.cur, 1);

      for (let n = 0; n < STEPS_PER_FRAME; n++) {
        const a = targets[current];
        const b = targets[(current + 1) % 3];
        const c = targets[(current + 2) % 3];
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, a.texture);
        // Stage one: a -> b
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, a.texture);
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
        gl.uniform1i(loc.stage, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        // Stage two: (a, b) -> c
        gl.bindTexture(gl.TEXTURE_2D, b.texture);
        gl.bindFramebuffer(gl.FRAMEBUFFER, c.fbo);
        gl.uniform1i(loc.stage, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        current = (current + 2) % 3;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      sim.texture = targets[current].texture;
    },
  };
  return sim;
}
