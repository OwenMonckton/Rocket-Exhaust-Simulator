import { ENGINE_NX, ENGINE_NY, createEngineSim, engineStableStep, type EngineSim, type EngineSimInputs } from './engineSim';
import { SIM_NX, SIM_NY, STEPS_PER_FRAME, createFluidSim, wallShape, type FluidSim, type SimInputs, type SimWall } from './fluidSim';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './plume.frag';
import { VACUUM_FLOOR, type PlumeParams } from './plumeParams';

export interface PlumeTarget {
  /** Device pixels, origin bottom-left as WebGL expects */
  exitX: number;
  exitY: number;
  radiusPx: number;
  /** Vertical offsets (device pixels) of each nozzle exit that gets a plume; one entry for a single-chamber engine */
  offsetsPx: number[];
  /** A nozzle extension standing in the plume, in exit radii from the plume's origin; the plume cannot pass through it */
  wall?: SimWall | null;
}

/** The gas inside the engine, from its own simulation, and where and how to draw it. */
export interface EngineGas {
  inputs: EngineSimInputs;
  /** Device pixel x of the injector face */
  originX: number;
  /** Device pixels per metre */
  scale: number;
  /** What to colour the gas by */
  mode: 'flame' | 'mach' | 'temp';
  /** Temperature at the nozzle exit over chamber temperature: the cold end of the colour scales */
  exitTemp: number;
  /** Mach number at the top of the speed scale */
  machMax: number;
  /**
   * Mach number the plume simulation takes its units from, when the plume should start from
   * the gas this simulation delivers to the nozzle exit. Left out, the plume starts from a formula.
   */
  feedsPlumeAtMach?: number;
}

export interface PlumeRenderer {
  /** Pass `sim` to draw the plume from the gas simulation instead of the hand-shaped model. */
  draw(p: PlumeParams, target: PlumeTarget, timeS: number, sim?: SimInputs | null, engine?: EngineGas | null): void;
  resize(widthPx: number, heightPx: number): void;
  /** Start the gas simulation again from still air. */
  resetSim(): void;
  /** Start the simulation of the gas inside the engine again. */
  resetEngineSim(): void;
  /** False when this browser cannot run the gas simulation */
  readonly simAvailable: boolean;
  /** False when this browser cannot run the simulation of the gas inside the engine */
  readonly engineSimAvailable: boolean;
}

const UNIFORMS = [
  'uRes', 'uExit', 'uRadius', 'uTime', 'uIntensity', 'uSettle', 'uBloom', 'uSpacing', 'uDiamond',
  'uPhase', 'uTurb', 'uLen', 'uOpacity', 'uSoot', 'uSmoke', 'uStars', 'uCore', 'uMid', 'uEdge',
  'uSkyTop', 'uSkyBottom', 'uUseSim', 'uSim', 'uSimGrid', 'uSimCell', 'uSimGamma', 'uSimAmbT', 'uSimT0', 'uSimAmbP', 'uSimS', 'uAfter', 'uAfterCol', 'uParticles', 'uExitCount', 'uExitOffsets', 'uWallOn', 'uWall', 'uWallShape', 'uSimUp', 'uSimLip', 'uSimCurve', 'uSimFade', 'uSimFloor',
  'uInOn', 'uIn', 'uInRad', 'uInStations', 'uInOrigin', 'uInScale', 'uInLen', 'uInMode', 'uInGamma', 'uInExitT', 'uInMachMax', 'uInRestT', 'uInOpacity',
] as const;

/**
 * The engine's cells are much smaller than the plume's, so it needs several steps of its own
 * for each of the plume's. This caps how many: beyond it the smallest cells (across the throat)
 * fall behind true time instead, which only shows while the flow is still changing.
 */
const MAX_ENGINE_SUBSTEPS = 2;

/** Longest stretch of plume the gas simulation covers, in exit radii. */
export const SIM_MAX_LENGTH = 24;

/**
 * How long to make the simulation grid (in exit radii) to cover at least `needed`.
 * The length only comes in steps about 9% apart: every change means carrying the gas over
 * to the new grid, which blurs it slightly, so it should not happen on every frame of a zoom.
 */
export function gridLength(needed: number): number {
  const steps = Math.ceil(8 * Math.log2(Math.max(4, needed) / 4) - 1e-9);
  return Math.min(SIM_MAX_LENGTH, 4 * 2 ** (steps / 8));
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

/** Returns null when WebGL2 is unavailable or the shader cannot be built. */
export function createPlumeRenderer(canvas: HTMLCanvasElement): PlumeRenderer | null {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) return null;

  let u: Record<string, WebGLUniformLocation | null> = {};
  let program: WebGLProgram | null = null;
  let sim: FluidSim | null = null;
  let engineSim: EngineSim | null = null;

  const build = (): boolean => {
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
      }
      // One full-screen triangle at attribute 0, shared by the plume and the simulation.
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      u = {};
      for (const name of UNIFORMS) u[name] = gl.getUniformLocation(program, name);
      sim = createFluidSim(gl);
      engineSim = sim ? createEngineSim(gl) : null;
      return true;
    } catch (err) {
      console.error('Plume shader failed to build', err);
      return false;
    }
  };
  if (!build()) return null;

  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = !build();
  });

  return {
    get simAvailable() {
      return sim !== null;
    },
    get engineSimAvailable() {
      return engineSim !== null;
    },
    resetSim() {
      sim?.reset();
    },
    resetEngineSim() {
      engineSim?.reset();
    },
    resize(widthPx, heightPx) {
      if (canvas.width !== widthPx || canvas.height !== heightPx) {
        canvas.width = widthPx;
        canvas.height = heightPx;
      }
    },
    draw(p, target, timeS, simInputs, engine) {
      if (lost) return;
      const useEngine = !!engine && engineSim !== null && engine.scale > 0 && engine.inputs.length > 0;
      // With both simulated and the jet filling the nozzle, the two solvers run as one: stepped
      // together on the same clock, each reading the other across the nozzle exit. Otherwise
      // the engine runs on its own.
      const linked = useEngine && !!simInputs && sim !== null && target.radiusPx > 0.5 && engine!.feedsPlumeAtMach !== undefined;
      if (useEngine && !linked) engineSim!.step(engine!.inputs);
      const useSim = !!simInputs && sim !== null && target.radiusPx > 0.5;
      let cell = 1;
      let upstream = 0;
      let fadeX = 1.1;
      let fadeY = 0.45;
      if (useSim) {
        // Size the grid to cover the visible plume, whatever the zoom.
        const across = (canvas.width - target.exitX) / target.radiusPx;
        const up = (0.5 * canvas.height + Math.max(...target.offsetsPx.map(Math.abs))) / target.radiusPx;
        const length = gridLength(Math.max(across * 1.05, (up * 1.05 * SIM_NX) / SIM_NY));
        // A strip beside the nozzle, upstream of its exit, for exhaust that curls back around the lip.
        upstream = Math.min(2, 0.15 * length);
        cell = (length + upstream) / SIM_NX;
        // Zoomed out far enough, the grid ends on screen. A plume that fills it (as one does in
        // a vacuum) would stop there in a hard straight line, so let it thin out gradually instead.
        const height = SIM_NY * cell;
        fadeX = Math.min(0.3 * length, 1.1 + 1.5 * Math.max(0, across - length));
        fadeY = Math.min(0.3 * height, 0.45 + 1.5 * Math.max(0, up - height));
        // The plume solver measures the gas against its state at the nozzle exit; the engine
        // solver against its state at rest in the chamber. These factors convert one to the other.
        let inlet = null;
        if (linked) {
          const g = simInputs!.gamma;
          const temp = 1 / (1 + ((g - 1) / 2) * engine!.feedsPlumeAtMach! ** 2);
          const pressure = Math.pow(temp, g / (g - 1));
          const density = pressure / temp;
          inlet = {
            texture: engineSim!.texture,
            columns: ENGINE_NX,
            rows: ENGINE_NY,
            density: 1 / density,
            speed: Math.sqrt(density / pressure),
            pressure: 1 / pressure,
            coldTemp: engine!.inputs.restTemp / temp,
          };
        }
        const dt = sim!.begin(simInputs!, length + upstream, target.wall, upstream, inlet);
        if (inlet) {
          const exitRadius = target.radiusPx / engine!.scale;
          engineSim!.begin(engine!.inputs, {
            columns: SIM_NX,
            rows: SIM_NY,
            cell,
            upstream,
            exitRadius,
            density: 1 / inlet.density,
            speed: 1 / inlet.speed,
            pressure: 1 / inlet.pressure,
          });
          // The same stretch of time, in the engine solver's units.
          const engineDt = dt * exitRadius * inlet.speed;
          const substeps = Math.min(MAX_ENGINE_SUBSTEPS, Math.max(1, Math.ceil(engineDt / engineStableStep(engine!.inputs))));
          for (let n = 0; n < STEPS_PER_FRAME; n++) {
            engineSim!.advance(engineDt / substeps, substeps, sim!.texture);
            sim!.advance(1, engineSim!.texture);
          }
          engineSim!.finish();
        } else {
          sim!.advance(STEPS_PER_FRAME, null);
        }
        sim!.finish();
      }

      gl.useProgram(program);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform2f(u.uExit, target.exitX, target.exitY);
      gl.uniform1f(u.uRadius, target.radiusPx);
      gl.uniform1i(u.uExitCount, Math.min(2, target.offsetsPx.length));
      gl.uniform1fv(u.uExitOffsets, [target.offsetsPx[0] ?? 0, target.offsetsPx[1] ?? 0]);
      // Keep time small so the noise stays precise on long sessions.
      gl.uniform1f(u.uTime, timeS % 600);
      gl.uniform1f(u.uIntensity, p.intensity);
      gl.uniform1f(u.uSettle, p.settleRadius);
      gl.uniform1f(u.uBloom, p.bloom);
      gl.uniform1f(u.uSpacing, p.diamondSpacing);
      gl.uniform1f(u.uDiamond, p.diamondStrength);
      gl.uniform1f(u.uPhase, p.diamondPhase);
      gl.uniform1f(u.uTurb, p.turbulence);
      gl.uniform1f(u.uLen, Math.max(0.5, p.length));
      gl.uniform1f(u.uOpacity, p.opacity);
      gl.uniform1f(u.uSoot, p.soot);
      gl.uniform1f(u.uSmoke, p.smoke);
      gl.uniform1f(u.uStars, p.stars);
      gl.uniform3fv(u.uCore, p.core);
      gl.uniform3fv(u.uMid, p.mid);
      gl.uniform3fv(u.uEdge, p.edge);
      gl.uniform3fv(u.uSkyTop, p.skyTop);
      gl.uniform3fv(u.uSkyBottom, p.skyBottom);

      const wall = target.wall;
      const hasWall = !!wall && wall.x1 > 0 && wall.x1 > wall.x0;
      gl.uniform1f(u.uWallOn, hasWall ? 1 : 0);
      if (hasWall) {
        gl.uniform4f(u.uWall, wall!.x0, wall!.r0, wall!.x1, wall!.r1);
        const shape = wallShape(wall!);
        gl.uniform2f(u.uWallShape, shape.slope, shape.curve);
      }

      gl.uniform1f(u.uUseSim, useSim ? 1 : 0);
      gl.uniform1i(u.uSim, 0);
      gl.uniform1i(u.uSimS, 1);
      gl.uniform1f(u.uAfter, p.afterburn);
      gl.uniform3fv(u.uAfterCol, p.afterburnColor);
      gl.uniform1f(u.uParticles, p.particles);
      if (useSim) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, sim!.scalarTexture);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sim!.texture);
        gl.uniform2f(u.uSimGrid, SIM_NX, SIM_NY);
        gl.uniform1f(u.uSimCell, cell);
        gl.uniform1f(u.uSimUp, upstream);
        gl.uniform2f(u.uSimFade, fadeX, fadeY);
        gl.uniform1f(u.uSimLip, simInputs!.divergence);
        gl.uniform1f(u.uSimCurve, simInputs!.wallCurve);
        gl.uniform1f(u.uSimGamma, simInputs!.gamma);
        gl.uniform1f(u.uSimAmbT, simInputs!.pAmb / simInputs!.rhoAmb);
        gl.uniform1f(u.uSimT0, simInputs!.t0);
        gl.uniform1f(u.uSimAmbP, simInputs!.pAmb);
        gl.uniform1f(u.uSimFloor, VACUUM_FLOOR);
      }
      gl.uniform1f(u.uInOn, useEngine ? 1 : 0);
      gl.uniform1i(u.uIn, 2);
      gl.uniform1i(u.uInRad, 3);
      if (useEngine) {
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, engineSim!.radiusTexture);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, engineSim!.texture);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1f(u.uInStations, ENGINE_NX);
        gl.uniform1f(u.uInOrigin, engine!.originX);
        gl.uniform1f(u.uInScale, engine!.scale);
        gl.uniform1f(u.uInLen, engine!.inputs.length);
        gl.uniform1i(u.uInMode, engine!.mode === 'mach' ? 1 : engine!.mode === 'temp' ? 2 : 0);
        gl.uniform1f(u.uInGamma, engine!.inputs.gamma);
        gl.uniform1f(u.uInExitT, engine!.exitTemp);
        gl.uniform1f(u.uInMachMax, engine!.machMax);
        gl.uniform1f(u.uInRestT, engine!.inputs.restTemp);
        gl.uniform1f(u.uInOpacity, p.opacity);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
