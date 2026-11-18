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
export const STEPS_PER_FRAME = 48;
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
  /**
   * How sharply the bell curves in upstream of the lip. The outside of the nozzle, x radii from
   * the exit plane (x is negative there), has radius 1 + divergence*x + wallCurve*x*x.
   */
  wallCurve: number;
  /** Present for an aerospike, whose gas the grid takes in and shapes quite differently */
  spike?: SimSpike;
}

/** How many points describe the surface of an aerospike's spike. */
export const SPIKE_SAMPLES = 33;

/**
 * An aerospike in the grid. Lengths are in units of the lip's radius, and the grid's origin is
 * the plane of the lip. The gas arrives through a ring between the spike and the lip, already
 * supersonic and heading inward, in the state the other inputs describe: the thrust cells' exit.
 * From there the grid works out everything itself: the expansion round the lip, the flow along
 * the spike, how the outside air shapes the jet, and the wake behind the flat base.
 */
export interface SimSpike {
  /** Radius of the spike's surface at `SPIKE_SAMPLES` evenly spaced points from the lip's plane to the base */
  radii: number[];
  /** Distance from the lip's plane to the base */
  length: number;
  /** Angle the arriving gas is heading inward at, radians */
  tilt: number;
  /**
   * Density and temperature the gas would have once the whole spike had expanded it, relative to
   * how it arrives. That is the state a bell's exhaust leaves its nozzle in, which is what the
   * plume's brightness is judged against.
   */
  designDensity: number;
  designTemp: number;
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
  /**
   * Slope (dr/dx) of the wall at its upstream end. The wall curves from that slope to meet
   * (x1, r1), as a bell does: steeper where it leaves the fixed nozzle, shallower at the exit.
   * Left out, the wall is a straight cone.
   */
  slope0?: number;
}

/**
 * The curve of an extension's wall: its slope at the upstream end and the curvature that takes
 * it from there to its downstream end. The starting slope is capped so the wall never turns
 * back inward before the exit.
 */
export function wallShape(wall: SimWall): { slope: number; curve: number } {
  const length = wall.x1 - wall.x0;
  const chord = (wall.r1 - wall.r0) / length;
  const slope = wall.slope0 === undefined ? chord : Math.min(wall.slope0, 1.8 * chord);
  return { slope, curve: (chord - slope) / length };
}

/**
 * The gas arriving at the nozzle exit, taken from the simulation of the inside of the engine
 * instead of from a formula.
 */
export interface SimInlet {
  /** That simulation's gas state (see engineSim) and the size of its grid */
  texture: WebGLTexture;
  columns: number;
  rows: number;
  /** Factors that turn its density, speed and pressure into this solver's units */
  density: number;
  speed: number;
  pressure: number;
  /** Temperature of the still gas in an unlit engine, in this solver's units: colder gas than about twice this is not exhaust */
  coldTemp: number;
  /**
   * Where that simulation's grid ends, in this solver's radii from its origin: 0 normally, the
   * length of a seated nozzle extension when its grid carries on through one. Cells of this
   * grid that lie inside the extension then hold that simulation's gas.
   */
  exitX: number;
  /** How many of that simulation's columns span one of this solver's radii */
  columnsPerRadius: number;
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
  step(inputs: SimInputs, lengthRadii: number, wall?: SimWall | null, upstreamRadii?: number, inlet?: SimInlet | null): void;
  /**
   * The same in pieces, for running in step with the engine solver: egin once a frame
   * (it returns the time step, in this solver's units), dvance a number of steps at a time,
   * then inish. inlet is the engine solver's current gas state.
   */
  begin(inputs: SimInputs, lengthRadii: number, wall?: SimWall | null, upstreamRadii?: number, inlet?: SimInlet | null): number;
  advance(steps: number, inlet?: WebGLTexture | null): void;
  finish(): void;
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
uniform vec2 uWallShape;    // the extension's slope at its upstream end, and its curvature
uniform float uUpstream;    // how far the grid reaches upstream of the nozzle exit, in exit radii
uniform float uWallCurve;   // curvature of the nozzle wall upstream of the lip
uniform float uInletOn;     // 1 when the exhaust arriving comes from the simulation of the inside of the engine
uniform sampler2D uInlet;   // that simulation's gas state
uniform ivec2 uInletGrid;
uniform vec3 uInletScale;   // its density, speed and pressure in this solver's units
uniform float uInletCold;   // temperature of the still gas in an unlit engine
uniform vec2 uInletGeom;    // where its grid ends (0: at this grid's origin), and its columns per radius
uniform float uSpikeOn;     // 1 for an aerospike: a solid spike stands in the grid, and the gas arrives as a ring round it
uniform float uSpike[${SPIKE_SAMPLES}];     // radius of the spike's surface, at evenly spaced points from the lip's plane to its base
uniform float uSpikeLen;    // distance from the lip's plane to the base
uniform vec2 uSpikeDir;     // direction the gas arrives in

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

// Radius of the nozzle wall upstream of the exit: the bell narrows going forward, following
// the same curve the engine is drawn with.
float nozzleRadius(float x) {
  return max(0.3, 1.0 + uDiverge * x + uWallCurve * x * x);
}

float extensionRadius(float x);

// Inside a seated nozzle extension that the engine's own grid covers.
bool inEngineExtension(vec2 p) {
  return uInletOn > 0.5 && uWallOn > 0.5 && p.x >= 0.0 && p.x < uInletGeom.x && p.y < extensionRadius(p.x);
}

// Radius and slope of an aerospike's surface at x. Forward of the lip's plane it carries on at
// the radius it has there; that part only marks the inner edge of the ring the gas arrives through.
float spikeRadius(float x) {
  float f = clamp(x / uSpikeLen, 0.0, 1.0) * float(${SPIKE_SAMPLES - 1});
  int i = min(int(f), ${SPIKE_SAMPLES - 2});
  return mix(uSpike[i], uSpike[i + 1], f - float(i));
}

float spikeSlope(float x) {
  float f = clamp(x / uSpikeLen, 0.0, 1.0) * float(${SPIKE_SAMPLES - 1});
  int i = min(int(f), ${SPIKE_SAMPLES - 2});
  return (uSpike[i + 1] - uSpike[i]) * float(${SPIKE_SAMPLES - 1}) / uSpikeLen;
}

// The body of an aerospike: the spike itself, and the engine in front of it inside the ring
// of thrust cells.
bool solidSpike(ivec2 c) {
  if (uSpikeOn < 0.5 || c.x < 0 || c.y < 0) return false;
  vec2 p = position(c);
  if (p.x > uSpikeLen) return false;
  // Forward of the lip, a cell is solid only if none of it reaches into the ring.
  if (p.x < 0.0) return p.y + 0.5 * uDx <= uSpike[0];
  return p.y < spikeRadius(p.x);
}

// Inside the nozzle itself. These cells are not simulated: they hold the exhaust as it arrives.
bool inNozzle(ivec2 c) {
  if (c.x < 0 || c.y < 0) return false;
  vec2 p = position(c);
  // An aerospike: everything forward of the lip's plane, out to the lip. Any cell the lip cuts
  // through counts, so the ring delivers exactly the flow it should however coarse the grid.
  if (uSpikeOn > 0.5) return p.x < 0.0 && p.y - 0.5 * uDx < 1.0;
  // A bell: out to its wall, counting the cell the wall cuts through (see nozzleCover).
  return (p.x < 0.0 && p.y - 0.5 * uDx < nozzleRadius(p.x)) || inEngineExtension(p);
}

// How much of a cell forward of the exit plane lies inside the nozzle: all of it for most, a
// share for the one the wall cuts through. Without this the exit would be a whole number of
// cells across, and the plume would get up to a cell's width too much or too little gas
// depending on how the grid happens to fall, which changes with the zoom.
float nozzleCover(vec2 p) {
  return clamp((nozzleRadius(p.x) - (p.y - 0.5 * uDx)) / uDx, 0.0, 1.0);
}

// The gas a cell in the nozzle delivers, given the gas arriving there and how much of the cell
// is inside the wall.
vec4 covered(vec4 w, float cover, inout float frac) {
  if (cover >= 1.0) return w;
  if (w.y > sqrt(uGamma * w.w / w.x)) {
    // Faster than sound, what crosses into the plume is set by this cell alone, so thinning the
    // gas (at the same speed and temperature) delivers exactly its share.
    w.x *= cover;
    w.w *= cover;
    return w;
  }
  // Slower gas also feels the plume's pressure, which thinning would upset. The rest of such a
  // cell is the still air outside the wall, so it holds a blend of the two.
  frac *= cover;
  return mix(ambient(), w, cover);
}

// The exhaust arriving from an aerospike's thrust cells: uniform, heading inward, through the
// ring between the spike and the lip. A cell only partly inside the ring delivers that share.
vec4 ringState(vec2 p) {
  float cover = clamp((min(p.y + 0.5 * uDx, 1.0) - max(p.y - 0.5 * uDx, uSpike[0])) / uDx, 0.0, 1.0);
  return vec4(uFire * cover, uExitSpeed * uSpikeDir, uFire * cover);
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

// The same, read from the last column of the simulation of the inside of the engine: what
// that simulation says is leaving the nozzle at this radius, right now. Also returns how much
// of it is exhaust: before the flow has reached the exit there is only cold still gas there.
vec4 inletState(vec2 at, out float exhaust) {
  float r = at.y / (at.x < 0.0 ? nozzleRadius(at.x) : extensionRadius(at.x));
  float f = clamp(r, 0.0, 1.0) * float(uInletGrid.y) - 0.5;
  int j = int(floor(f));
  int j0 = clamp(j, 0, uInletGrid.y - 1);
  int j1 = clamp(j + 1, 0, uInletGrid.y - 1);
  // Normally the engine's grid ends at this grid's origin and its last column is what arrives.
  // Where it carries on through a seated extension, each cell here takes the column it lies in.
  int i = uInletGrid.x - 1;
  if (uInletGeom.x > 0.0) {
    i = clamp(int(floor(float(uInletGrid.x) - (uInletGeom.x - at.x) * uInletGeom.y)), 0, uInletGrid.x - 1);
  }
  vec4 U = mix(texelFetch(uInlet, ivec2(i, j0), 0), texelFetch(uInlet, ivec2(i, j1), 0), f - float(j));
  float rho = max(U.x, 1e-7);
  vec2 vel = U.yz / rho;
  float p = max((uGamma - 1.0) * (U.w - 0.5 * rho * dot(vel, vel)), 1e-9);
  vec4 w = vec4(rho * uInletScale.x, vel * uInletScale.y, p * uInletScale.z);
  // No upper limit: gas that has come through a shock inside the nozzle arrives at many times
  // the pressure it would have had leaving freely.
  w.x = max(w.x, RHO_MIN);
  w.w = max(w.w, P_MIN);
  exhaust = smoothstep(1.3 * uInletCold, 2.2 * uInletCold, w.w / w.x);
  if (any(isnan(w)) || any(isinf(w))) {
    w = exhaustState(r);
    exhaust = 1.0;
  }
  return w;
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
      float r = p.y / nozzleRadius(p.x);
      if (uSpikeOn > 0.5) {
        w = ringState(p);
        frac = 1.0;
      } else {
        if (uInletOn > 0.5) {
          w = inletState(p, frac);
        } else {
          w = exhaustState(r);
          frac = 1.0;
        }
        if (p.x < 0.0) w = covered(w, nozzleCover(p), frac);
      }
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

// Inner radius of a nozzle extension at x. It is curved like the bell it is part of.
float extensionRadius(float x) {
  float t = x - uWall.x;
  return uWall.y + uWallShape.x * t + uWallShape.y * t * t;
}

// The wall of a nozzle extension, wherever it currently is.
bool solidExtension(ivec2 c) {
  if (uWallOn < 0.5 || c.x < 0 || c.y < 0) return false;
  vec2 p = position(c);
  if (p.x < uWall.x || p.x > uWall.z) return false;
  float inner = extensionRadius(p.x);
  return p.y >= inner && p.y <= inner + uWallThick;
}

// Is the way from cell c into its neighbour blocked by a wall?
// Gas beside the nozzle, upstream of its exit, meets the outside of the nozzle wall: from
// there the nozzle is a solid surface with no thickness. Gas downstream of the exit sees
// the same cells as the exhaust arriving.
bool blocked(ivec2 c, ivec2 neighbour) {
  return solidExtension(neighbour) || solidSpike(neighbour) || (position(c).x < 0.0 && inNozzle(neighbour));
}

// Gas bounces off a wall: the part of its velocity pointing into the surface is reversed.
// Using the wall's true slope here, not the grid's stair-steps, keeps the flow along it smooth.
// from is the cell the gas is in.
vec4 bounce(vec4 w, ivec2 wallCell, ivec2 from) {
  vec2 n;
  if (solidSpike(wallCell)) {
    // Behind the spike is its flat base; everywhere else, its sloping surface.
    n = position(from).x > uSpikeLen
      ? vec2(1.0, 0.0)
      : normalize(vec2(spikeSlope(max(position(wallCell).x, 0.0)), -1.0));
  } else if (inNozzle(wallCell)) {
    n = normalize(vec2(uDiverge + 2.0 * uWallCurve * position(wallCell).x, -1.0));
  } else {
    n = normalize(vec2(uWallShape.x + 2.0 * uWallShape.y * (position(wallCell).x - uWall.x), -1.0));
  }
  w.yz -= 2.0 * dot(w.yz, n) * n;
  return w;
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  if (solidExtension(c) || solidSpike(c)) {
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
  if (blocked(c, n1)) { xm1 = bounce(w0, n1, c); fxm1 = f0; xm2 = bounce(xp1, n1, c); fxm2 = fxp1; }
  else if (blocked(c, n2)) { xm2 = bounce(xm1, n2, c); fxm2 = fxm1; }
  n1 = c + ivec2(1, 0);
  n2 = c + ivec2(2, 0);
  if (blocked(c, n1)) { xp1 = bounce(w0, n1, c); fxp1 = f0; xp2 = bounce(xm1, n1, c); fxp2 = fxm1; }
  else if (blocked(c, n2)) { xp2 = bounce(xp1, n2, c); fxp2 = fxp1; }
  n1 = c + ivec2(0, -1);
  n2 = c + ivec2(0, -2);
  if (blocked(c, n1)) { ym1 = bounce(w0, n1, c); fym1 = f0; ym2 = bounce(yp1, n1, c); fym2 = fyp1; }
  else if (blocked(c, n2)) { ym2 = bounce(ym1, n2, c); fym2 = fym1; }
  n1 = c + ivec2(0, 1);
  n2 = c + ivec2(0, 2);
  if (blocked(c, n1)) { yp1 = bounce(w0, n1, c); fyp1 = f0; yp2 = bounce(ym1, n1, c); fyp2 = fym1; }
  else if (blocked(c, n2)) { yp2 = bounce(yp1, n2, c); fyp2 = fyp1; }

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
    // Only exhaust beside air counts, so a lingering cloud wears away from its edges. Slow gas
    // inside the jet (behind a shock in its core) is left alone: turned into air there, it would
    // be pulled up to the density of the air outside and sit in the jet's path as a dense plug,
    // and every plug the jet pushed out of the way would run down it as a shock front.
    float slow = 1.0 - smoothstep(0.05, 0.2, length(w.yz) / uExitSpeed);
    float besideAir = 1.0 - smoothstep(0.3, 0.7, min(min(fxm1, fxp1), min(fym1, fyp1)));
    frac *= 1.0 - 0.02 * slow * besideAir;
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

// Carries the gas over to a grid of a different size. The grid is measured in exit radii,
// so when the view zooms and the grid grows or shrinks, the gas has to be moved to where it
// physically is on the new grid; leaving it in the same cells would stretch the whole plume
// out of shape, and it would shudder as it settled back.
const RESAMPLE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uSrcU;
uniform sampler2D uSrcS;
uniform ivec2 uGrid;
uniform float uDxOld;
uniform float uUpOld;
uniform float uDxNew;
uniform float uUpNew;

layout(location = 0) out vec4 outU;
layout(location = 1) out vec4 outS;

ivec2 clampCell(ivec2 c) {
  return clamp(c, ivec2(0), uGrid - 1);
}

void main() {
  vec2 c = gl_FragCoord.xy;   // cell centre on the new grid (already offset by half a cell)
  vec2 p = vec2(c.x * uDxNew - uUpNew, c.y * uDxNew);
  // The same point on the old grid, in cells. Beyond the old grid the edge cells carry on.
  vec2 f = vec2((p.x + uUpOld) / uDxOld, p.y / uDxOld) - 0.5;
  ivec2 i = ivec2(floor(f));
  vec2 t = f - vec2(i);
  ivec2 a = clampCell(i);
  ivec2 b = clampCell(i + ivec2(1, 0));
  ivec2 d = clampCell(i + ivec2(0, 1));
  ivec2 e = clampCell(i + ivec2(1, 1));
  outU = mix(mix(texelFetch(uSrcU, a, 0), texelFetch(uSrcU, b, 0), t.x),
             mix(texelFetch(uSrcU, d, 0), texelFetch(uSrcU, e, 0), t.x), t.y);
  float s = mix(mix(texelFetch(uSrcS, a, 0).x, texelFetch(uSrcS, b, 0).x, t.x),
                mix(texelFetch(uSrcS, d, 0).x, texelFetch(uSrcS, e, 0).x, t.x), t.y);
  outS = vec4(s, 0.0, 0.0, 1.0);
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

  const link = (fragment: string): WebGLProgram => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) ?? 'program link failed');
    }
    return p;
  };
  let program: WebGLProgram;
  let resampler: WebGLProgram;
  try {
    program = link(FRAG);
    resampler = link(RESAMPLE);
  } catch (err) {
    console.error('Fluid simulation shader failed to build', err);
    return null;
  }
  const u = (name: string) => gl.getUniformLocation(program, name);
  const loc = {
    prev: u('uPrev'), cur: u('uCur'), prevS: u('uPrevS'), curS: u('uCurS'), stage: u('uStage'),
    grid: u('uGrid'), dx: u('uDx'), dt: u('uDt'), gamma: u('uGamma'), relax: u('uRelax'), fire: u('uFire'),
    diverge: u('uDiverge'), profile: u('uProfile'), exitSpeed: u('uExitSpeed'), amb: u('uAmb'),
    wallOn: u('uWallOn'), wall: u('uWall'), wallThick: u('uWallThick'), upstream: u('uUpstream'), wallCurve: u('uWallCurve'), wallShape: u('uWallShape'),
    inletOn: u('uInletOn'), inlet: u('uInlet'), inletGrid: u('uInletGrid'), inletScale: u('uInletScale'), inletCold: u('uInletCold'), inletGeom: u('uInletGeom'),
    spikeOn: u('uSpikeOn'), spike: u('uSpike[0]'), spikeLen: u('uSpikeLen'), spikeDir: u('uSpikeDir'),
  };
  const r = (name: string) => gl.getUniformLocation(resampler, name);
  const rloc = {
    srcU: r('uSrcU'), srcS: r('uSrcS'), grid: r('uGrid'),
    dxOld: r('uDxOld'), upOld: r('uUpOld'), dxNew: r('uDxNew'), upNew: r('uUpNew'),
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
    // Not for an aerospike, whose gas arrives as a ring heading inward, not as a column.
    const burning = inputs.fire > 0.5 && !inputs.spike;
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

  // The size the gas currently in the textures was simulated at.
  let simulatedSpan = 0;
  let simulatedUpstream = 0;

  const resample = (dxOld: number, upOld: number, dxNew: number, upNew: number) => {
    const from = targets[current];
    const to = targets[(current + 1) % 3];
    gl.useProgram(resampler);
    gl.viewport(0, 0, SIM_NX, SIM_NY);
    bind(0, from.state);
    bind(1, from.scalar);
    gl.uniform1i(rloc.srcU, 0);
    gl.uniform1i(rloc.srcS, 1);
    gl.uniform2i(rloc.grid, SIM_NX, SIM_NY);
    gl.uniform1f(rloc.dxOld, dxOld);
    gl.uniform1f(rloc.upOld, upOld);
    gl.uniform1f(rloc.dxNew, dxNew);
    gl.uniform1f(rloc.upNew, upNew);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    current = (current + 1) % 3;
  };

  const sim = {
    texture: targets[0].state,
    scalarTexture: targets[0].scalar,
    reset() {
      needsReset = true;
    },
    step(inputs: SimInputs, lengthRadii: number, wall?: SimWall | null, upstreamRadii = 0, inlet?: SimInlet | null) {
      sim.begin(inputs, lengthRadii, wall, upstreamRadii, inlet);
      sim.advance(STEPS_PER_FRAME, inlet?.texture);
      sim.finish();
    },
    begin(inputs: SimInputs, lengthRadii: number, wall?: SimWall | null, upstreamRadii = 0, inlet?: SimInlet | null) {
      if (needsReset) {
        fill(inputs, lengthRadii);
        needsReset = false;
      } else if (lengthRadii !== simulatedSpan || upstreamRadii !== simulatedUpstream) {
        resample(simulatedSpan / SIM_NX, simulatedUpstream, lengthRadii / SIM_NX, upstreamRadii);
      }
      simulatedSpan = lengthRadii;
      simulatedUpstream = upstreamRadii;
      const g = inputs.gamma;
      const dx = lengthRadii / SIM_NX;
      // Fastest the gas can ever go: all of its heat turned into speed.
      const a0 = Math.sqrt(g * inputs.t0);
      const maxSpeed = 1.25 * Math.max(inputs.uExit + Math.sqrt(g), a0 * Math.sqrt(2 / (g - 1)));
      const dt = (CFL * dx) / maxSpeed;

      gl.useProgram(program);
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
      if (hasWall) {
        gl.uniform4f(loc.wall, wall!.x0, wall!.r0, wall!.x1, wall!.r1);
        const shape = wallShape(wall!);
        gl.uniform2f(loc.wallShape, shape.slope, shape.curve);
      }
      // Walls are thick enough that gas cannot leak through between neighbouring cells.
      gl.uniform1f(loc.wallThick, Math.max(3 * dx, 0.05));
      gl.uniform1f(loc.upstream, upstreamRadii);
      gl.uniform1f(loc.wallCurve, inputs.wallCurve);
      gl.uniform1i(loc.prev, 0);
      gl.uniform1i(loc.cur, 1);
      gl.uniform1i(loc.prevS, 2);
      gl.uniform1i(loc.curS, 3);
      gl.uniform1i(loc.inlet, 4);
      gl.uniform1f(loc.inletOn, inlet ? 1 : 0);
      if (inlet) {
        gl.uniform2i(loc.inletGrid, inlet.columns, inlet.rows);
        gl.uniform3f(loc.inletScale, inlet.density, inlet.speed, inlet.pressure);
        gl.uniform1f(loc.inletCold, inlet.coldTemp);
        gl.uniform2f(loc.inletGeom, inlet.exitX, inlet.columnsPerRadius);
      }
      const spike = inputs.spike;
      gl.uniform1f(loc.spikeOn, spike ? 1 : 0);
      if (spike) {
        gl.uniform1fv(loc.spike, spike.radii.slice(0, SPIKE_SAMPLES));
        gl.uniform1f(loc.spikeLen, Math.max(1e-3, spike.length));
        gl.uniform2f(loc.spikeDir, Math.cos(spike.tilt), -Math.sin(spike.tilt));
      }
      return dt;
    },
    advance(steps: number, inlet?: WebGLTexture | null) {
      gl.useProgram(program);
      gl.viewport(0, 0, SIM_NX, SIM_NY);
      bind(4, inlet ?? null);
      for (let n = 0; n < steps; n++) {
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
      sim.texture = targets[current].state;
      sim.scalarTexture = targets[current].scalar;
    },
    finish() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (const unit of [4, 3, 2, 1, 0]) bind(unit, null);
    },
  };
  return sim;
}
