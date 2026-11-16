import { FRAGMENT_SHADER, VERTEX_SHADER } from './plume.frag';
import type { PlumeParams } from './plumeParams';

export interface PlumeTarget {
  /** Device pixels, origin bottom-left as WebGL expects */
  exitX: number;
  exitY: number;
  radiusPx: number;
}

export interface PlumeRenderer {
  draw(p: PlumeParams, target: PlumeTarget, timeS: number): void;
  resize(widthPx: number, heightPx: number): void;
}

const UNIFORMS = [
  'uRes', 'uExit', 'uRadius', 'uTime', 'uIntensity', 'uSettle', 'uBloom', 'uSpacing', 'uDiamond',
  'uPhase', 'uTurb', 'uLen', 'uOpacity', 'uSoot', 'uSmoke', 'uStars', 'uCore', 'uMid', 'uEdge',
  'uSkyTop', 'uSkyBottom',
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
  const build = (): boolean => {
    try {
      const program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
      }
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      u = {};
      for (const name of UNIFORMS) u[name] = gl.getUniformLocation(program, name);
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
    resize(widthPx, heightPx) {
      if (canvas.width !== widthPx || canvas.height !== heightPx) {
        canvas.width = widthPx;
        canvas.height = heightPx;
      }
    },
    draw(p, target, timeS) {
      if (lost) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform2f(u.uExit, target.exitX, target.exitY);
      gl.uniform1f(u.uRadius, target.radiusPx);
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
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
