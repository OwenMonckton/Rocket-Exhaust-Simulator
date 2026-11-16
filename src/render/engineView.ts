import { areaRatio, machFromAreaRatio, subsonicMachFromAreaRatio } from '../physics/nozzle';
import { PROPELLANTS } from '../physics/propellants';
import type { EngineConfig, Failure, RGB, SimResult } from '../physics/types';
import { engineProfile, radiusAt, type EngineProfile, type View } from './geometry';

export type FlowOverlay = 'none' | 'mach' | 'temp';

export interface EngineAnim {
  /** 0–1 ignition ramp */
  fire: number;
  timeS: number;
  overlay: FlowOverlay;
  failure: Failure;
  /** Seconds since the failure happened */
  failT: number;
  /** Distance (m) from the injector face to where the gas leaves the engine: the fixed nozzle's exit until an extension seats */
  flowExitX: number;
}

const css = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

const lerp3 = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Blue → cyan → green → yellow → red. */
function heatMap(t: number): RGB {
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

function localMach(profile: EngineProfile, x: number, throatR: number, g: number): number {
  const ratio = (radiusAt(profile, x) / throatR) ** 2;
  return x < profile.throatX ? subsonicMachFromAreaRatio(ratio, g) : machFromAreaRatio(ratio, g);
}

function niceLength(target: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const m = target / pow;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * pow;
}

/** Deterministic pseudo-random number in 0–1. */
const rand = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

const OX_COLOUR = '#4f8fd6';
const FUEL_COLOUR = '#d6a04f';

/** The turbopump shared by a multi-chamber engine, with its feed lines to each chamber's injector. */
function drawTurbopump(
  ctx: CanvasRenderingContext2D,
  profile: EngineProfile,
  view: View,
  chamberRadiusPx: number,
  wallPx: number,
  anim: EngineAnim,
): void {
  const ppm = view.ppm;
  const cy = view.centreY;
  const pitch = (profile.offsets[profile.offsets.length - 1] - profile.offsets[0]) * ppm;
  const headW = Math.max(8, 0.16 * chamberRadiusPx + wallPx);
  const headH = chamberRadiusPx + wallPx;
  const headX = view.originX - headW;
  const pumpW = 0.42 * pitch;
  const pumpH = 0.5 * pitch;
  const pumpX = headX - 0.72 * pitch;
  const pumpRight = pumpX + pumpW;
  const lineW = Math.min(9, Math.max(3, 0.035 * pitch));
  const spinning = anim.failure ? 0 : anim.fire;

  // Feed lines: one manifold per propellant, branching to every chamber.
  const lines: { colour: string; outY: number; runX: number; inlet: number }[] = [
    { colour: OX_COLOUR, outY: cy - 0.25 * pumpH, runX: pumpRight + 0.1 * pitch, inlet: -0.45 },
    { colour: FUEL_COLOUR, outY: cy + 0.25 * pumpH, runX: pumpRight + 0.2 * pitch, inlet: 0.45 },
  ];
  ctx.lineWidth = lineW;
  ctx.lineJoin = 'round';
  for (const line of lines) {
    const targets = profile.offsets.map((o) => cy + o * ppm + line.inlet * headH);
    ctx.strokeStyle = line.colour;
    ctx.beginPath();
    // From the tanks into the pump, and out to the manifold.
    ctx.moveTo(pumpX - 0.14 * pitch, line.outY);
    ctx.lineTo(line.runX, line.outY);
    ctx.moveTo(line.runX, Math.min(...targets));
    ctx.lineTo(line.runX, Math.max(...targets));
    for (const y of targets) {
      ctx.moveTo(line.runX, y);
      ctx.lineTo(headX + 1, y);
    }
    ctx.stroke();
  }

  // Pump body.
  ctx.fillStyle = '#6f7783';
  ctx.strokeStyle = '#1b1e25';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(pumpX, cy - pumpH / 2, pumpW, pumpH, Math.min(8, pumpW * 0.2));
  ctx.fill();
  ctx.stroke();

  // Shaft joining the two pumps, with the turbine that drives them in the middle.
  const midX = pumpX + pumpW / 2;
  ctx.strokeStyle = '#2a2e37';
  ctx.lineWidth = Math.max(2, pumpW * 0.08);
  ctx.beginPath();
  ctx.moveTo(midX, cy - 0.25 * pumpH);
  ctx.lineTo(midX, cy + 0.25 * pumpH);
  ctx.stroke();
  ctx.fillStyle = spinning > 0.05 ? `rgba(240,150,60,${0.5 + 0.5 * spinning})` : '#3b404b';
  ctx.beginPath();
  ctx.arc(midX, cy, 0.09 * pumpH, 0, Math.PI * 2);
  ctx.fill();

  // Impellers, spinning while the engine runs.
  const radius = Math.min(0.19 * pumpH, 0.42 * pumpW);
  const angle = anim.timeS * 16 * spinning;
  for (const [colour, y] of [
    [OX_COLOUR, cy - 0.25 * pumpH],
    [FUEL_COLOUR, cy + 0.25 * pumpH],
  ] as const) {
    ctx.fillStyle = '#23262d';
    ctx.beginPath();
    ctx.arc(midX, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1.5, radius * 0.16);
    ctx.beginPath();
    ctx.arc(midX, y, radius, 0, Math.PI * 2);
    for (let i = 0; i < 6; i++) {
      const a = angle + (i / 6) * Math.PI * 2;
      ctx.moveTo(midX, y);
      ctx.lineTo(midX + Math.cos(a) * radius, y + Math.sin(a) * radius);
    }
    ctx.stroke();
  }

  if (pumpW > 34) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Turbopump', midX, cy + pumpH / 2 + 5);
    ctx.textAlign = 'left';
  }
}

export function drawEngine(
  ctx: CanvasRenderingContext2D,
  cfg: EngineConfig,
  result: SimResult,
  view: View,
  anim: EngineAnim,
  widthPx: number,
  heightPx: number,
): void {
  ctx.clearRect(0, 0, widthPx, heightPx);
  const profile = engineProfile(cfg);
  const prop = PROPELLANTS[cfg.propellant];
  const isSolid = cfg.propellant === 'solid';
  const isNuclear = cfg.propellant === 'nuclear';
  const pts = profile.points;
  const rc = cfg.chamberDia / 2;
  const rt = cfg.throatDia / 2;
  const ppm = view.ppm;
  const X = (x: number) => view.originX + x * ppm;
  const cy = view.centreY;

  ctx.save();
  const shake = anim.fire * (0.35 + 3.2 * result.shudder + (result.rough ? 0.7 : 0));
  if (shake > 0.01) {
    ctx.translate(
      (rand(Math.floor(anim.timeS * 60)) - 0.5) * 2 * shake,
      (rand(Math.floor(anim.timeS * 60) + 99) - 0.5) * 2 * shake,
    );
  }

  // A multi-chamber engine draws two of its chambers, fed by one shared turbopump.
  const multi = profile.offsets.length > 1;
  const wallPx = Math.min(Math.max(cfg.wall * ppm, 3), Math.max(3, 0.3 * rc * ppm));
  if (multi) drawTurbopump(ctx, profile, view, rc * ppm, wallPx, anim);

  // Everything for one chamber, drawn about the centreline `cy`.
  const drawChamber = (index: number) => {
  const wallAt = (x: number) => {
    if (x <= profile.throatX) return wallPx;
    const t = (x - profile.throatX) / Math.max(1e-9, profile.exitX - profile.throatX);
    return wallPx * (1 - 0.6 * t);
  };

  // --- Interior cavity -----------------------------------------------------
  // With a nozzle extension, the fixed nozzle and the extension are separate parts.
  const ext = profile.extension;
  const wallPts = ext ? ext.fixedPoints : pts;
  const gasPts = ext && anim.flowExitX < profile.exitX - 1e-6 ? ext.fixedPoints : pts;
  const cavity = (clipR?: (x: number, r: number) => number) => {
    ctx.beginPath();
    gasPts.forEach((p, i) => {
      const r = clipR ? clipR(p.x, p.r) : p.r;
      if (i === 0) ctx.moveTo(X(p.x), cy - r * ppm);
      else ctx.lineTo(X(p.x), cy - r * ppm);
    });
    for (let i = gasPts.length - 1; i >= 0; i--) {
      const r = clipR ? clipR(gasPts[i].x, gasPts[i].r) : gasPts[i].r;
      ctx.lineTo(X(gasPts[i].x), cy + r * ppm);
    }
    ctx.closePath();
  };
  cavity();
  ctx.fillStyle = '#0d0f14';
  ctx.fill();

  // Solid propellant grain: fills the case, leaving a bore down the middle.
  const boreR = 0.36 * rc;
  if (isSolid) {
    const grainEnd = cfg.chamberLen * 0.97;
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.rect(X(0), sign < 0 ? cy - rc * ppm : cy + boreR * ppm, grainEnd * ppm, (rc - boreR) * ppm);
      ctx.fillStyle = '#74685a';
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(40,34,28,0.5)';
    for (let i = 0; i < 160; i++) {
      const gx = X(rand(i) * grainEnd);
      const gr = boreR + rand(i + 500) * (rc - boreR);
      ctx.fillRect(gx, cy + (i % 2 ? gr : -gr) * ppm, 1.5, 1.5);
    }
  }

  // --- Hot gas inside the engine ------------------------------------------
  if (anim.fire > 0.01 && !anim.failure) {
    const separated = result.state === 'separated';
    const rEff = result.effectiveExitDia / 2;
    const jet = (x: number, r: number) => {
      let out = r;
      if (isSolid && x < cfg.chamberLen * 0.97) out = Math.min(out, boreR);
      if (separated && x > profile.throatX && r > rEff) {
        out = rEff * (1 + 0.05 * Math.sin(x * 40 + anim.timeS * 30));
      }
      return out;
    };
    cavity(jet);
    const grad = ctx.createLinearGradient(X(0), 0, X(profile.exitX), 0);
    const look = prop.look;
    const N = 14;
    const g = result.gamma;
    const exitM = machFromAreaRatio(result.expansionRatio, g);
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      const x = f * profile.exitX;
      let c: RGB;
      let a: number;
      if (anim.overlay === 'none') {
        const t = Math.min(1, Math.max(0, (x - profile.chamberEndX) / (profile.exitX - profile.chamberEndX)));
        c = lerp3(lerp3(look.core, [1, 1, 1], 0.35), look.mid, Math.pow(t, 0.7));
        a = (0.97 - 0.25 * t) * (0.6 + 0.4 * Math.min(1, look.opacity + 0.35));
      } else {
        const m = Math.min(localMach(profile, x, rt, g), result.exitMach);
        if (anim.overlay === 'mach') c = heatMap(m / Math.max(1.5, exitM));
        else {
          const tRatio = 1 / (1 + ((g - 1) / 2) * m * m);
          const tExit = 1 / (1 + ((g - 1) / 2) * exitM * exitM);
          c = heatMap((tRatio - tExit) / Math.max(1e-6, 1 - tExit));
        }
        a = 0.95;
      }
      const flicker = anim.overlay === 'none' ? 0.94 + 0.06 * Math.sin(anim.timeS * 47 + i * 1.7) : 1;
      grad.addColorStop(f, css(c, a * anim.fire * flicker));
    }
    ctx.fillStyle = grad;
    ctx.fill();

    if (anim.overlay === 'none') {
      // Darker boundary layer along the walls makes the gas read as a volume.
      cavity(jet);
      const edge = ctx.createLinearGradient(0, cy - profile.maxRadius * ppm, 0, cy + profile.maxRadius * ppm);
      edge.addColorStop(0, 'rgba(0,0,0,0.5)');
      edge.addColorStop(0.5, 'rgba(0,0,0,0)');
      edge.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = edge;
      ctx.globalAlpha = 0.5 * anim.fire;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // --- Reactor core (nuclear thermal) --------------------------------------
  // Hydrogen flows through channels in the reactor's fuel and comes out hot.
  if (isNuclear) {
    const x0 = X(cfg.chamberLen * 0.12);
    const x1 = X(cfg.chamberLen * 0.88);
    const outer = rc * ppm;
    const half = outer * 0.86;
    const hot = anim.failure ? 0 : anim.fire;
    const warmth = Math.min(1, Math.max(0, (result.tc - 1500) / 1700));
    // Reflector ring around the fuel.
    ctx.fillStyle = '#434955';
    ctx.fillRect(x0, cy - outer, x1 - x0, 2 * outer);
    ctx.fillStyle = css(lerp3([0.13, 0.14, 0.17], lerp3([0.45, 0.13, 0.06], [0.8, 0.4, 0.15], warmth), hot));
    ctx.fillRect(x0, cy - half, x1 - x0, 2 * half);
    const channels = Math.max(4, Math.min(14, Math.round(half / 6)));
    for (let i = 0; i < channels; i++) {
      const y = cy - half + ((i + 0.5) / channels) * 2 * half;
      if (hot > 0.01) {
        const flow = ctx.createLinearGradient(x0, 0, x1, 0);
        flow.addColorStop(0, css([0.45, 0.62, 1.0], 0.7 * hot));
        flow.addColorStop(1, css(lerp3([1.0, 0.5, 0.2], [1.0, 0.96, 0.85], warmth), hot));
        ctx.fillStyle = flow;
      } else {
        ctx.fillStyle = '#0c0d11';
      }
      ctx.fillRect(x0, y - 1, x1 - x0, 2);
    }
    ctx.strokeStyle = '#1b1e25';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, cy - outer, x1 - x0, 2 * outer);
  }

  // --- Walls ---------------------------------------------------------------
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    wallPts.forEach((p, i) => {
      const y = cy + sign * p.r * ppm;
      if (i === 0) ctx.moveTo(X(p.x), y);
      else ctx.lineTo(X(p.x), y);
    });
    for (let i = wallPts.length - 1; i >= 0; i--) {
      ctx.lineTo(X(wallPts[i].x), cy + sign * (wallPts[i].r * ppm + wallAt(wallPts[i].x)));
    }
    ctx.closePath();
    const top = cy + sign * (profile.maxRadius * ppm + wallPx);
    const metal = ctx.createLinearGradient(0, cy, 0, top);
    metal.addColorStop(0, '#565d69');
    metal.addColorStop(1, '#a9b1bd');
    ctx.fillStyle = metal;
    ctx.fill();
    ctx.strokeStyle = '#1b1e25';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Wall glows where it is being cooked.
    const heat = Math.max(result.limits.heating, result.limits.structural * 0.6);
    if (anim.fire > 0.05 && heat > 0.6) {
      const tx = X(profile.throatX);
      const glow = ctx.createRadialGradient(tx, cy + sign * rt * ppm, 0, tx, cy + sign * rt * ppm, 6 * wallPx + 0.6 * rt * ppm);
      glow.addColorStop(0, `rgba(255,120,30,${Math.min(0.9, (heat - 0.6) * 2) * anim.fire})`);
      glow.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.save();
      ctx.clip();
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, widthPx, heightPx);
      ctx.restore();
    }
  }

  // --- Deployable nozzle extension -----------------------------------------
  // A separate carbon cone. Stowed, it sits forward around the engine; to deploy it travels
  // aft along its rails and seats on the end of the fixed nozzle.
  if (ext) {
    const shiftPx = ext.shift * ppm;
    const seamX = X(ext.seam.x);
    const seamR = ext.seam.r * ppm;
    for (const sign of [-1, 1]) {
      // Rail the extension slides along.
      const railY = cy + sign * (seamR + wallAt(ext.seam.x) + 5);
      ctx.strokeStyle = 'rgba(190,196,208,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(seamX - ext.length * ppm, railY);
      ctx.lineTo(seamX, railY);
      ctx.stroke();

      ctx.beginPath();
      ext.points.forEach((p, i) => {
        const y = cy + sign * p.r * ppm;
        if (i === 0) ctx.moveTo(X(p.x) - shiftPx, y);
        else ctx.lineTo(X(p.x) - shiftPx, y);
      });
      for (let i = ext.points.length - 1; i >= 0; i--) {
        const p = ext.points[i];
        ctx.lineTo(X(p.x) - shiftPx, cy + sign * (p.r * ppm + wallAt(p.x)));
      }
      ctx.closePath();
      ctx.fillStyle = '#4b505c';
      ctx.fill();
      // A pale outline so the dark carbon cone still reads against the black of space.
      ctx.strokeStyle = '#9aa2b1';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Mating rings: one on the end of the fixed nozzle, one on the front of the extension.
      ctx.strokeStyle = '#c9ced8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(seamX, cy + sign * seamR);
      ctx.lineTo(seamX, cy + sign * (seamR + wallAt(ext.seam.x) + 3));
      ctx.moveTo(seamX - shiftPx, cy + sign * seamR);
      ctx.lineTo(seamX - shiftPx, cy + sign * (seamR + wallAt(ext.seam.x) + 7));
      ctx.stroke();
    }
  }
  // --- Injector head / forward dome ---------------------------------------
  const headW =Math.max(8, 0.16 * rc * ppm + wallPx);
  const headH = rc * ppm + wallPx;
  ctx.fillStyle = '#7b838f';
  ctx.strokeStyle = '#1b1e25';
  ctx.beginPath();
  if (isSolid) {
    ctx.ellipse(X(0), cy, headW * 1.6, headH, 0, Math.PI / 2, (3 * Math.PI) / 2);
  } else {
    ctx.roundRect(X(0) - headW, cy - headH, headW, 2 * headH, [headW * 0.45, 0, 0, headW * 0.45]);
  }
  ctx.fill();
  ctx.stroke();
  if (!isSolid) {
    // Injector orifices and the two propellant feed lines.
    const holes = Math.max(3, Math.min(11, Math.round((rc * ppm) / 9)));
    for (let i = 0; i < holes; i++) {
      const hy = cy + ((i + 0.5) / holes - 0.5) * 2 * rc * ppm * 0.9;
      ctx.fillStyle = i % 2 || isNuclear ? '#4f8fd6' : '#d6a04f';
      ctx.fillRect(X(0) - headW * 0.55, hy - 1, headW * 0.55, 2);
    }
    const pipe = Math.max(4, 0.22 * rc * ppm);
    ctx.fillStyle = '#4f8fd6';
    if (multi) {
      // Fed from the shared turbopump instead.
    } else if (isNuclear) {
      // One propellant only: a single hydrogen feed line.
      ctx.fillRect(X(0) - headW - pipe * 1.6, cy - pipe / 2, pipe * 1.6, pipe);
    } else {
      ctx.fillRect(X(0) - headW - pipe * 1.6, cy - headH * 0.55 - pipe / 2, pipe * 1.6, pipe);
      ctx.fillStyle = '#d6a04f';
      ctx.fillRect(X(0) - headW - pipe * 1.6, cy + headH * 0.55 - pipe / 2, pipe * 1.6, pipe);
    }
  }

  // Centreline.
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.setLineDash([10, 5, 2, 5]);
  ctx.beginPath();
  ctx.moveTo(X(0) - headW * 2.5, cy);
  ctx.lineTo(X(profile.exitX) + 14, cy);
  ctx.stroke();
  ctx.setLineDash([]);

  // --- Failure -------------------------------------------------------------
  // One chamber failing is enough to end the run, so only the first one is shown torn open.
  if (anim.failure && index === 0) {
    const fx = X(anim.failure === 'burnthrough' ? profile.throatX : cfg.chamberLen * 0.55);
    const fr = (anim.failure === 'burnthrough' ? rt : rc) * ppm;
    const size = Math.max(40, profile.maxRadius * ppm);
    for (const sign of anim.failure === 'burnthrough' ? [-1] : [-1, 1]) {
      const fy = cy + sign * fr;
      // Jagged hole torn in the wall.
      ctx.beginPath();
      const spikes = 11;
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2;
        const rad = (0.22 + 0.2 * rand(i + (sign > 0 ? 40 : 0))) * size * (i % 2 ? 0.55 : 1);
        ctx.lineTo(fx + Math.cos(a) * rad, fy + Math.sin(a) * rad * 0.7);
      }
      ctx.closePath();
      ctx.fillStyle = '#090a0d';
      ctx.fill();
      const scorch = ctx.createRadialGradient(fx, fy, 0, fx, fy, size * 0.9);
      scorch.addColorStop(0, 'rgba(0,0,0,0.75)');
      scorch.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = scorch;
      ctx.fillRect(fx - size, fy - size, 2 * size, 2 * size);
    }
    // Fireball and debris.
    const t = anim.failT;
    if (t < 1.6) {
      const grow = 1 - Math.exp(-t * 4);
      const fade = Math.max(0, 1 - t / 1.6);
      const ball = ctx.createRadialGradient(fx, cy, 0, fx, cy, size * (0.6 + 3.2 * grow));
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
        ctx.translate(fx + Math.cos(a) * speed * t, cy + Math.sin(a) * speed * t + 60 * t * t);
        ctx.rotate(t * 9 * (rand(i) - 0.5));
        ctx.fillRect(-4, -2, 5 + 7 * rand(i + 3), 3 + 3 * rand(i + 5));
        ctx.restore();
      }
    }
  }
  };

  profile.offsets.forEach((offset, index) => {
    ctx.save();
    ctx.translate(0, offset * ppm);
    drawChamber(index);
    ctx.restore();
  });
  ctx.restore();

  // --- Scale bar and overlay legend (not shaken) ---------------------------
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
  ctx.fillText(barM >= 1 ? `${barM} m` : `${Math.round(barM * 100)} cm`, bx + barPx + 8, by + 4);

  if (anim.overlay !== 'none') {
    const lx = 18;
    const ly = 18;
    const lw = 150;
    const legend = ctx.createLinearGradient(lx, 0, lx + lw, 0);
    for (let i = 0; i <= 8; i++) legend.addColorStop(i / 8, css(heatMap(i / 8)));
    ctx.fillStyle = legend;
    ctx.fillRect(lx, ly, lw, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textBaseline = 'top';
    const exitM = machFromAreaRatio(Math.max(1.0001, areaRatio(result.exitMach, result.gamma)), result.gamma);
    if (anim.overlay === 'mach') {
      ctx.fillText('Gas speed: slow', lx, ly + 14);
      ctx.fillText(`Mach ${exitM.toFixed(1)}`, lx + lw + 8, ly - 2);
    } else {
      ctx.fillText('Gas temperature: cooler', lx, ly + 14);
      ctx.fillText(`${Math.round(result.tc)} K`, lx + lw + 8, ly - 2);
    }
  }
}
