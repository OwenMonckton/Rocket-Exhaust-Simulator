import type { RGB } from '../physics/types';
import type { EngineAnim } from './engineView';

export const css = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

export const lerp3 = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** What the scale bar under the engine reads for a length in metres. */
export function scaleBarLabel(m: number): string {
  if (m >= 1) return `${m} m`;
  if (m >= 0.01) return `${Math.round(m * 100)} cm`;
  return `${Number((m * 1000).toPrecision(2))} mm`;
}

/** A round length (1, 2 or 5 times a power of ten) no longer than `target`. */
export function niceLength(target: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const m = target / pow;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * pow;
}

/** The scale bar at the foot of the picture. */
export function drawScaleBar(ctx: CanvasRenderingContext2D, ppm: number, heightPx: number): void {
  const barM = niceLength(110 / ppm);
  const barPx = barM * ppm;
  const bx = 18;
  const by = heightPx - 20;
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx, by - 5);
  ctx.lineTo(bx, by);
  ctx.lineTo(bx + barPx, by);
  ctx.lineTo(bx + barPx, by - 5);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText(scaleBarLabel(barM), bx + barPx + 8, by + 4);
}

/** Blue → cyan → green → yellow → red. */
export function heatMap(t: number): RGB {
  const stops: RGB[] = [
    [0.1, 0.2, 0.75],
    [0.1, 0.7, 0.9],
    [0.2, 0.8, 0.3],
    [0.98, 0.85, 0.2],
    [0.92, 0.2, 0.15],
  ];
  const v = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(v);
  return lerp3(stops[i], stops[i + 1], v - i);
}

/** Deterministic pseudo-random number in 0–1. */
export const rand = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

export const OX_COLOUR = '#4f8fd6';
export const FUEL_COLOUR = '#d6a04f';

/**
 * A wall torn open: a jagged hole at each of `holes` (screen points), and a fireball with
 * debris centred on (`fx`, `fy`) for the first moments after the failure.
 */
export function drawFailure(
  ctx: CanvasRenderingContext2D,
  anim: EngineAnim,
  fx: number,
  fy: number,
  holes: { x: number; y: number; seed: number }[],
  size: number,
  widthPx: number,
  heightPx: number,
): void {
  for (const hole of holes) {
    ctx.beginPath();
    const spikes = 11;
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      const rad = (0.22 + 0.2 * rand(i + hole.seed)) * size * (i % 2 ? 0.55 : 1);
      ctx.lineTo(hole.x + Math.cos(a) * rad, hole.y + Math.sin(a) * rad * 0.7);
    }
    ctx.closePath();
    ctx.fillStyle = '#090a0d';
    ctx.fill();
    const scorch = ctx.createRadialGradient(hole.x, hole.y, 0, hole.x, hole.y, size * 0.9);
    scorch.addColorStop(0, 'rgba(0,0,0,0.75)');
    scorch.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = scorch;
    ctx.fillRect(hole.x - size, hole.y - size, 2 * size, 2 * size);
  }
  const t = anim.failT;
  if (t >= 1.6) return;
  const grow = 1 - Math.exp(-t * 4);
  const fade = Math.max(0, 1 - t / 1.6);
  const ball = ctx.createRadialGradient(fx, fy, 0, fx, fy, size * (0.6 + 3.2 * grow));
  ball.addColorStop(0, `rgba(255,255,235,${fade})`);
  ball.addColorStop(0.35, `rgba(255,190,70,${0.85 * fade})`);
  ball.addColorStop(0.7, `rgba(230,80,20,${0.45 * fade})`);
  ball.addColorStop(1, 'rgba(120,30,10,0)');
  ctx.fillStyle = ball;
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = `rgba(40,40,45,${fade})`;
  for (let i = 0; i < 26; i++) {
    const a = rand(i + 7) * Math.PI * 2;
    const speed = (0.6 + rand(i + 31)) * size * 3.2;
    ctx.save();
    ctx.translate(fx + Math.cos(a) * speed * t, fy + Math.sin(a) * speed * t + 60 * t * t);
    ctx.rotate(t * 9 * (rand(i) - 0.5));
    ctx.fillRect(-4, -2, 5 + 7 * rand(i + 3), 3 + 3 * rand(i + 5));
    ctx.restore();
  }
}
