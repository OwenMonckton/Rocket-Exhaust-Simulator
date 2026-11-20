import { machFromAreaRatio, subsonicMachFromAreaRatio } from '../physics/nozzle';
import { staticLook } from '../physics/gasSource';
import type { EngineConfig, RGB, SimResult } from '../physics/types';
import { FUEL_COLOUR, OX_COLOUR, css, drawFailure, heatMap, lerp3 } from './drawUtil';
import type { EngineAnim } from './engineView';
import { spikeJetRadius, type ProfilePoint, type SpikeGeometry, type View } from './geometry';

interface Pt {
  x: number;
  y: number;
}

/**
 * Cross-section through an aerospike: a thrust cell above and below the axis, each firing in
 * along the central spike. The gas on the spike is normally simulated, by the plume's solver,
 * and shows through from the layer underneath (`anim.simGas`). With the plume drawn instead,
 * this draws the gas too, from a formula: a band over the spike, as wide as the surrounding air
 * lets the jet be.
 */
export function drawAerospike(
  ctx: CanvasRenderingContext2D,
  cfg: EngineConfig,
  result: SimResult,
  view: View,
  anim: EngineAnim,
  spike: SpikeGeometry,
  widthPx: number,
  heightPx: number,
): void {
  const ppm = view.ppm;
  const cy = view.centreY;
  const cell = spike.cell;
  const look = staticLook(cfg);
  const g = result.gamma;
  const cellPts = cell.points;
  const chamberR = cellPts[0].r;
  const throatR = cell.throatR;
  const wall = Math.min(Math.max(cfg.wall, 2 / ppm), Math.max(2 / ppm, 0.45 * chamberR));
  const cos = Math.cos(cell.tilt);
  const sin = Math.sin(cell.tilt);
  const firing = anim.fire > 0.01 && !anim.failure;

  /** Screen point for engine coordinates, on the top (side 1) or bottom (side -1) of the axis. */
  const S = (p: ProfilePoint, side: number): Pt => ({ x: view.originX + p.x * ppm, y: cy - side * p.r * ppm });
  /** Engine coordinates of a point in a cell's own frame: `s` along its axis, `h` outward from it. */
  const C = (s: number, h: number): ProfilePoint => ({
    x: cell.origin.x + s * cos + h * sin,
    r: cell.origin.r - s * sin + h * cos,
  });
  const path = (pts: Pt[]) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  };
  const metal = (side: number) => {
    const m = ctx.createLinearGradient(0, cy, 0, cy - side * spike.lip.r * ppm);
    m.addColorStop(0, '#565d69');
    m.addColorStop(1, '#a9b1bd');
    return m;
  };

  // Mach number and colour of the gas at a point on its way through the engine.
  const exitMach = Math.max(1.01, result.exitMach);
  const gasColour = (mach: number, along: number): { c: RGB; a: number } => {
    if (anim.overlay === 'mach') return { c: heatMap(mach / Math.max(1.5, exitMach)), a: 0.95 };
    if (anim.overlay === 'temp') {
      const tRatio = 1 / (1 + ((g - 1) / 2) * mach * mach);
      const tExit = 1 / (1 + ((g - 1) / 2) * exitMach * exitMach);
      return { c: heatMap((tRatio - tExit) / Math.max(1e-6, 1 - tExit)), a: 0.95 };
    }
    return {
      c: lerp3(lerp3(look.core, [1, 1, 1], 0.35), look.mid, Math.pow(along, 0.7)),
      a: (0.97 - 0.3 * along) * (0.6 + 0.4 * Math.min(1, look.opacity + 0.35)),
    };
  };
  const flicker = (i: number) => (anim.overlay === 'none' ? 0.94 + 0.06 * Math.sin(anim.timeS * 47 + i * 1.7) : 1);
  // Round up to the throat. Past it the nozzle flattens into a slot, and its area grows steadily
  // to the exit whatever its height from the side.
  const cellMach = (s: number, r: number) => {
    if (s < cell.throatS) return subsonicMachFromAreaRatio((r / throatR) ** 2, g);
    const t = Math.min(1, (s - cell.throatS) / Math.max(1e-9, cell.exitS - cell.throatS));
    return machFromAreaRatio(1 + (cell.exitAreaRatio - 1) * t, g);
  };

  // --- Spike ---------------------------------------------------------------
  // The central body: behind each cell's inner wall, then the spike's curved surface to its base.
  const innerWall = cellPts.map((p) => C(p.x, -(p.r + wall)));
  const half = [{ x: innerWall[0].x, r: 0 }, ...innerWall, ...spike.contour, { x: spike.base.x, r: 0 }];
  for (const side of [1, -1]) {
    path(half.map((p) => S(p, side)));
    ctx.fillStyle = metal(side);
    ctx.fill();
    ctx.strokeStyle = '#1b1e25';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // Cooling channels show as faint lines along the spike surface.
  ctx.strokeStyle = 'rgba(30,34,42,0.35)';
  for (const side of [1, -1]) {
    ctx.beginPath();
    spike.contour.forEach((p, i) => {
      const q = S({ x: p.x, r: Math.max(0, p.r - 0.06 * spike.lip.r) }, side);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.stroke();
  }

  // --- Gas expanding over the spike ----------------------------------------
  // Only when it is not being simulated: simulated gas is drawn on the layer underneath.
  if (firing && !anim.simGas) {
    // The jet's free outer edge: it leaves the lip and settles to the width the air allows.
    const x0 = spike.lip.x;
    const settle = 0.25 * (spike.base.x - x0);
    const outer = (p: ProfilePoint) => {
      const u = Math.min(1, Math.max(0, (p.x - x0) / Math.max(1e-9, settle)));
      const free = spikeJetRadius(cfg, result.effectiveExitDia, p.r);
      return spike.lip.r + (free - spike.lip.r) * u * u * (3 - 2 * u);
    };
    const top = [spike.lip, ...spike.contour.slice(1).map((p) => ({ x: p.x, r: Math.max(p.r, outer(p)) }))];
    const band = [...top, ...[...spike.contour].reverse()];
    for (const side of [1, -1]) {
      const pts = band.map((p) => S(p, side));
      const grad = ctx.createLinearGradient(pts[0].x, 0, S(spike.base, side).x, 0);
      const N = 10;
      for (let i = 0; i <= N; i++) {
        const f = i / N;
        const mach = spike.contour[0].mach + (exitMach - spike.contour[0].mach) * f;
        const { c, a } = gasColour(mach, 0.45 + 0.55 * f);
        grad.addColorStop(f, css(c, a * (anim.overlay === 'none' ? 1 - 0.35 * f : 1) * anim.fire * flicker(i)));
      }
      path(pts);
      ctx.fillStyle = grad;
      ctx.fill();
    }
    // The pocket of hot, slow gas trapped behind the flat base.
    if (anim.overlay === 'none') {
      const bx = S(spike.base, 1).x;
      const br = spike.base.r * ppm;
      const pocket = ctx.createRadialGradient(bx, cy, 0, bx, cy, 1.1 * br);
      pocket.addColorStop(0, css(look.mid, 0.55 * anim.fire));
      pocket.addColorStop(1, css(look.mid, 0));
      ctx.fillStyle = pocket;
      ctx.beginPath();
      ctx.ellipse(bx, cy, 0.5 * br, br, 0, -Math.PI / 2, Math.PI / 2);
      ctx.fill();
    }
  }

  // --- Thrust cells --------------------------------------------------------
  const cavity = cellPts.map((p) => C(p.x, p.r)).concat([...cellPts].reverse().map((p) => C(p.x, -p.r)));
  const heat = Math.max(result.limits.heating, result.limits.structural * 0.6);
  for (const side of [1, -1]) {
    path(cavity.map((p) => S(p, side)));
    ctx.fillStyle = '#0d0f14';
    ctx.fill();

    if (firing) {
      const a0 = S(C(0, 0), side);
      const a1 = S(C(cell.exitS, 0), side);
      const grad = ctx.createLinearGradient(a0.x, a0.y, a1.x, a1.y);
      const N = 12;
      for (let i = 0; i <= N; i++) {
        const f = i / N;
        const s = f * cell.exitS;
        const r = cellPts.find((p) => p.x >= s)?.r ?? throatR;
        const along = Math.max(0, (s - cell.chamberEndS) / (cell.exitS - cell.chamberEndS)) * 0.45;
        const { c, a } = gasColour(cellMach(s, r), along);
        grad.addColorStop(f, css(c, a * anim.fire * flicker(i)));
      }
      path(cavity.map((p) => S(p, side)));
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Walls, outer and inner.
    for (const h of [1, -1]) {
      const wallPts = cellPts.map((p) => C(p.x, h * p.r)).concat([...cellPts].reverse().map((p) => C(p.x, h * (p.r + wall))));
      path(wallPts.map((p) => S(p, side)));
      ctx.fillStyle = metal(side);
      ctx.fill();
      ctx.strokeStyle = '#1b1e25';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // The throats glow where they are being cooked.
    if (anim.fire > 0.05 && heat > 0.6) {
      const t = S(C(cell.throatS, 0), side);
      const radius = 6 * wall * ppm + 2 * throatR * ppm;
      const glow = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, radius);
      glow.addColorStop(0, `rgba(255,120,30,${Math.min(0.9, (heat - 0.6) * 2) * anim.fire})`);
      glow.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(t.x - radius, t.y - radius, 2 * radius, 2 * radius);
    }

    // Injector head with its two feed lines.
    const headLen = Math.max(0.18 * chamberR, 6 / ppm);
    const head = [C(-headLen, chamberR + wall), C(0, chamberR + wall), C(0, -chamberR - wall), C(-headLen, -chamberR - wall)];
    path(head.map((p) => S(p, side)));
    ctx.fillStyle = '#7b838f';
    ctx.fill();
    ctx.strokeStyle = '#1b1e25';
    ctx.stroke();
    const pipe = Math.max(3, 0.3 * chamberR * ppm);
    ctx.lineWidth = pipe;
    for (const [colour, h] of [
      [OX_COLOUR, 0.5],
      [FUEL_COLOUR, -0.5],
    ] as const) {
      const from = S(C(-headLen, h * chamberR), side);
      const to = S(C(-headLen - 3.2 * chamberR, h * chamberR), side);
      ctx.strokeStyle = colour;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  // Centreline.
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.setLineDash([10, 5, 2, 5]);
  ctx.beginPath();
  ctx.moveTo(view.originX - 0.2 * spike.lip.r * ppm, cy);
  ctx.lineTo(view.originX + spike.base.x * ppm + 14, cy);
  ctx.stroke();
  ctx.setLineDash([]);

  // --- Failure -------------------------------------------------------------
  // The top cell gives way: through its throat if it overheated, through its chamber otherwise.
  if (anim.failure) {
    const at = anim.failure === 'burnthrough' ? cell.throatS : 0.55 * cell.chamberEndS;
    const centre = S(C(at, 0), 1);
    const size = Math.max(30, 2.5 * chamberR * ppm);
    const holes = (anim.failure === 'burnthrough' ? [1] : [1, -1]).map((h) => ({
      ...S(C(at, h * chamberR), 1),
      seed: h > 0 ? 0 : 40,
    }));
    drawFailure(ctx, anim, centre.x, centre.y, holes, size, widthPx, heightPx);
  }
}
