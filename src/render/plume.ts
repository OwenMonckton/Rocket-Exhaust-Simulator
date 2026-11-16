import { SIM_NX, SIM_NY, createFluidSim, type FluidSim, type SimInputs, type SimWall } from './fluidSim';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './plume.frag';
import type { PlumeParams } from './plumeParams';

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

export interface PlumeRenderer {
  /** Pass `sim` to draw the plume from the gas simulation instead of the hand-shaped model. */
  draw(p: PlumeParams, target: PlumeTarget, timeS: number, sim?: SimInputs | null): void;
  resize(widthPx: number, heightPx: number): void;
  /** Start the gas simulation again from still air. */
  resetSim(): void;
  /** False when this browser cannot run the gas simulation */
  readonly simAvailable: boolean;
}

const UNIFORMS = [
  'uRes', 'uExit', 'uRadius', 'uTime', 'uIntensity', 'uSettle', 'uBloom', 'uSpacing', 'uDiamond',
  'uPhase', 'uTurb', 'uLen', 'uOpacity', 'uSoot', 'uSmoke', 'uStars', 'uCore', 'uMid', 'uEdge',
  'uSkyTop', 'uSkyBottom', 'uUseSim', 'uSim', 'uSimGrid', 'uSimCell', 'uSimGamma', 'uSimAmbT', 'uSimT0', 'uSimAmbP', 'uSimS', 'uAfter', 'uAfterCol', 'uParticles', 'uExitCount', 'uExitOffsets', 'uWallOn', 'uWall',
] as const;

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
    resetSim() {
      sim?.reset();
    },
    resize(widthPx, heightPx) {
      if (canvas.width !== widthPx || canvas.height !== heightPx) {
        canvas.width = widthPx;
        canvas.height = heightPx;
      }
    },
    draw(p, target, timeS, simInputs) {
      if (lost) return;
      const useSim = !!simInputs && sim !== null && target.radiusPx > 0.5;
      let cell = 1;
      if (useSim) {
        // Size the grid to cover the visible plume, whatever the zoom.
        const across = (canvas.width - target.exitX) / target.radiusPx;
        const up = (0.5 * canvas.height + Math.max(...target.offsetsPx.map(Math.abs))) / target.radiusPx;
        const length = Math.min(24, Math.max(4, across * 1.05, (up * 1.05 * SIM_NX) / SIM_NY));
        cell = length / SIM_NX;
        sim!.step(simInputs!, length, target.wall);
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
      if (hasWall) gl.uniform4f(u.uWall, wall!.x0, wall!.r0, wall!.x1, wall!.r1);

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
        gl.uniform1f(u.uSimGamma, simInputs!.gamma);
        gl.uniform1f(u.uSimAmbT, simInputs!.pAmb / simInputs!.rhoAmb);
        gl.uniform1f(u.uSimT0, simInputs!.t0);
        gl.uniform1f(u.uSimAmbP, simInputs!.pAmb);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
