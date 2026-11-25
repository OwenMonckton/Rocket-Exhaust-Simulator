// The picture of a beam thruster: a gridded ion thruster or a Hall-effect thruster, cut away, and
// the beam of charged atoms it throws out. Drawn on the 2D canvas; the gas simulation has no part
// in it, because a beam of charged atoms in a vacuum is not a gas it can follow.
import { BEAM_PROPELLANTS, isBeamPropellant, type BeamType } from '../physics/electric';
import type { EngineConfig, RGB, SimResult } from '../physics/types';
import { css, drawScaleBar } from './drawUtil';
import { engineProfile, type View } from './geometry';

/** How far each side of straight back a thruster's beam spreads, degrees: grids aim it, a Hall channel does not. */
const HALF_ANGLE: Record<BeamType, number> = { ion: 12, hall: 35 };
/** How far the beam is drawn, in thruster diameters, before it has faded from sight. */
const BEAM_DIAMETERS = 12;
/** Power per square metre of the thruster's face at which the beam is as bright as it is drawn. */
const BRIGHT_W_PER_M2 = 1e5;

/** A thruster's body as a share of its diameter, as the layout has it (geometry.ts). */
export const BEAM_BODY_LENGTH: Record<BeamType, number> = { ion: 0.6, hall: 0.35 };
/** A Hall thruster's channel runs from this share of its radius out to its edge. */
export const HALL_CHANNEL_INNER = 0.6;

/** How strongly the middle of the beam shows at its brightest, where it leaves the thruster. */
const BEAM_PEAK = 0.7;

/**
 * How dense the beam is across its width: `t` runs from one edge (0) to the other (1). Nothing at
 * either edge, everything down the middle, and smooth between.
 */
export function beamAcross(t: number): number {
  const u = 1 - (2 * t - 1) ** 2;
  return u <= 0 ? 0 : u ** 1.5;
}

/** The shape of the beam: how wide it spreads and how far it is drawn. */
export function beamShape(cfg: EngineConfig): { halfAngleDeg: number; lengthM: number } {
  return { halfAngleDeg: HALF_ANGLE[cfg.energy as BeamType] ?? HALF_ANGLE.ion, lengthM: BEAM_DIAMETERS * cfg.exitDia };
}

/** The beam's colour: its propellant's own glow. */
export function beamColour(cfg: EngineConfig): RGB {
  return BEAM_PROPELLANTS[isBeamPropellant(cfg.propellant) ? cfg.propellant : 'xenon'].colour;
}

/**
 * How strongly the beam shows, 0 to 1: nothing unlit or in air, then brighter with the power
 * passing through each square metre of the thruster's face. Always faint: a real beam is.
 */
export function beamAlpha(result: SimResult, cfg: EngineConfig, fire: number): number {
  if (!(fire > 0) || result.failure === 'noVacuum' || !result.electric || !(result.thrust > 0)) return 0;
  const density = result.electric.power / ((Math.PI / 4) * cfg.exitDia ** 2);
  return Math.min(1, fire) * Math.min(1, 0.45 + 0.55 * Math.min(1, density / BRIGHT_W_PER_M2));
}

const METAL = '#5b6670';
const METAL_DARK = '#39424a';
const EDGE = 'rgba(255,255,255,0.55)';

export interface BeamAnim {
  /** 0 to 1: how far the thruster has run up */
  fire: number;
}

export function drawBeamThruster(
  ctx: CanvasRenderingContext2D,
  cfg: EngineConfig,
  result: SimResult,
  view: View,
  anim: BeamAnim,
  widthPx: number,
  heightPx: number,
): void {
  const type: BeamType = cfg.energy === 'hall' ? 'hall' : 'ion';
  const r = (cfg.exitDia / 2) * view.ppm;
  const len = engineProfile(cfg).length * view.ppm;
  const x0 = view.originX;
  const x1 = x0 + len;
  const cy = view.centreY;
  const colour = beamColour(cfg);
  const alpha = beamAlpha(result, cfg, anim.fire);
  const { halfAngleDeg, lengthM } = beamShape(cfg);

  // --- The beam: a faint steady glow widening from the face. No flicker, no shocks.
  if (alpha > 0) {
    const reach = Math.min(lengthM * view.ppm, widthPx - x1 + 40);
    const theta = (halfAngleDeg * Math.PI) / 180;
    // A Hall thruster's beam leaves a ring near its rim; the grids' beam leaves the whole face.
    const start = r * (type === 'hall' ? 0.95 : 0.92);
    const spread = Math.tan(theta) * reach;
    // Where the beam's two edges would meet if they ran back through the thruster.
    const apexX = x1 - start / Math.tan(theta);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x1, cy - start);
    ctx.lineTo(x1 + reach, cy - start - spread);
    ctx.lineTo(x1 + reach, cy + start + spread);
    ctx.lineTo(x1, cy + start);
    ctx.closePath();
    ctx.clip();
    // Across the beam: one gradient swept round that meeting point, densest down the middle. It
    // is painted once at its full strength. (Many faint layers laid over one another round to
    // steps, which showed as bands and a hard end.)
    const share = theta / Math.PI;
    const across = ctx.createConicGradient(-theta, apexX, cy);
    const STOPS = 16;
    for (let k = 0; k <= STOPS; k++) across.addColorStop((k / STOPS) * share, css(colour, BEAM_PEAK * alpha * beamAcross(k / STOPS)));
    across.addColorStop(Math.min(1, share + 1e-4), css(colour, 0));
    ctx.fillStyle = across;
    ctx.fillRect(x1, cy - start - spread, reach, 2 * (start + spread));
    // Along the beam: thin it out with distance, down to nothing where it is last drawn.
    ctx.globalCompositeOperation = 'destination-out';
    const d0 = x1 - apexX;
    const along = ctx.createRadialGradient(apexX, cy, d0, apexX, cy, d0 + reach);
    along.addColorStop(0, 'rgba(0,0,0,0)');
    along.addColorStop(0.3, 'rgba(0,0,0,0.5)');
    along.addColorStop(0.7, 'rgba(0,0,0,0.85)');
    along.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = along;
    ctx.fillRect(x1, cy - start - spread, reach, 2 * (start + spread));
    ctx.restore();
  }

  // --- The body, cut away.
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = EDGE;
  if (type === 'ion') {
    // A can: the discharge chamber, where the propellant is ionised.
    const wall = Math.max(2, 0.04 * r);
    ctx.fillStyle = METAL;
    ctx.fillRect(x0, cy - r, len, 2 * r);
    ctx.fillStyle = '#10151a';
    ctx.fillRect(x0 + wall, cy - r + wall, len - wall, 2 * (r - wall));
    if (alpha > 0) {
      const glow = ctx.createLinearGradient(x0, 0, x1, 0);
      glow.addColorStop(0, css(colour, 0.15 * alpha));
      glow.addColorStop(1, css(colour, 0.7 * alpha));
      ctx.fillStyle = glow;
      ctx.fillRect(x0 + wall, cy - r + wall, len - wall, 2 * (r - wall));
    }
    ctx.strokeRect(x0, cy - r, len, 2 * r);
    // The cathode that feeds the discharge, on the back wall.
    ctx.fillStyle = METAL_DARK;
    ctx.fillRect(x0 + wall, cy - 0.08 * r, 0.22 * len, 0.16 * r);
    // Two grids across the mouth, close together: the screen grid and the accelerator grid.
    const gap = Math.max(3, 0.05 * r);
    ctx.setLineDash([Math.max(2, 0.06 * r), Math.max(2, 0.04 * r)]);
    ctx.lineWidth = Math.max(1.5, 0.02 * r);
    for (const [gx, tone] of [[x1, 'rgba(235,240,245,0.9)'], [x1 + gap, 'rgba(170,180,190,0.9)']] as const) {
      ctx.strokeStyle = tone;
      ctx.beginPath();
      ctx.moveTo(gx, cy - r);
      ctx.lineTo(gx, cy + r);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  } else {
    // A disc with a ring-shaped channel in its face, round a centre pole.
    const inner = HALL_CHANNEL_INNER * r;
    const depth = 0.55 * len;
    ctx.fillStyle = METAL;
    ctx.fillRect(x0, cy - r, len, 2 * r);
    ctx.strokeRect(x0, cy - r, len, 2 * r);
    for (const side of [-1, 1]) {
      const top = side < 0 ? cy - 0.94 * r : cy + inner;
      const height = 0.94 * r - inner;
      // The channel, lined with ceramic, and the glow of the gas being ionised in it.
      ctx.fillStyle = '#d9d2c4';
      ctx.fillRect(x1 - depth, top, depth, height);
      ctx.fillStyle = '#10151a';
      const lining = Math.max(1.5, 0.12 * height);
      ctx.fillRect(x1 - depth + lining, top + lining, depth - lining, height - 2 * lining);
      if (alpha > 0) {
        const glow = ctx.createLinearGradient(x1 - depth, 0, x1, 0);
        glow.addColorStop(0, css(colour, 0.1 * alpha));
        glow.addColorStop(1, css(colour, 0.85 * alpha));
        ctx.fillStyle = glow;
        ctx.fillRect(x1 - depth + lining, top + lining, depth - lining, height - 2 * lining);
      }
      // The magnet coil behind the channel.
      ctx.fillStyle = '#a0683a';
      ctx.fillRect(x0 + 0.12 * len, top + 0.15 * height, 0.22 * len, 0.7 * height);
    }
    // The centre pole's coil.
    ctx.fillStyle = '#a0683a';
    ctx.fillRect(x0 + 0.12 * len, cy - 0.35 * inner, 0.5 * len, 0.7 * inner);
  }

  // --- The neutraliser: a small cathode beside the thruster that feeds electrons into the beam,
  // so the spacecraft does not charge up.
  const nLen = Math.max(10, 0.5 * len);
  const nR = Math.max(3, 0.07 * r);
  const nx = x1 - 0.7 * nLen;
  const ny = cy - r - nR - Math.max(4, 0.08 * r);
  ctx.fillStyle = METAL_DARK;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1;
  ctx.fillRect(nx, ny - nR, nLen, 2 * nR);
  ctx.strokeRect(nx, ny - nR, nLen, 2 * nR);
  if (alpha > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const tip = ctx.createRadialGradient(nx + nLen, ny, 0, nx + nLen, ny, 6 * nR);
    tip.addColorStop(0, css([0.75, 0.85, 1], 0.6 * alpha));
    tip.addColorStop(1, css([0.75, 0.85, 1], 0));
    ctx.fillStyle = tip;
    ctx.beginPath();
    ctx.arc(nx + nLen, ny, 6 * nR, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  }

  drawScaleBar(ctx, view.ppm, heightPx);
}
