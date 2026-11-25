import { areaRatio, machFromAreaRatio, subsonicMachFromAreaRatio } from '../physics/nozzle';
import { staticLook } from '../physics/gasSource';
import { jetLeftWall } from '../physics/exhausts';
import { destroys } from '../physics/limits';
import type { EngineConfig, Failure, RGB, SimResult } from '../physics/types';
import { drawAerospike } from './aerospikeView';
import { FUEL_COLOUR, OX_COLOUR, css, drawFailure, heatMap, lerp3, rand, scaleBarLabel } from './drawUtil';
import { GRAIN_END, engineProfile, grainBore, grainLabel, radiusAt, type EngineProfile, type View } from './geometry';

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
  /** True when the gas inside the engine comes from the gas simulation, drawn underneath this view */
  simGas?: boolean;
  /** True when the gas simulation is working out a jet that has left the wall (torn off, or held at a dual bell's kink) for itself, so the view is not clipped to where a formula says the jet is */
  wholeNozzle?: boolean;
  /** How far a solid motor's grain has burned: 0 fresh, 1 nothing left */
  burnt?: number;
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

/** Unreacted nuclear salt water. */
const SALT_WATER: RGB = [0.1, 0.58, 0.62];

/** The bundle of thin tubes a nuclear salt-water rocket keeps its fuel in. */
function drawTubeBundle(ctx: CanvasRenderingContext2D, x0: number, x1: number, top: number, height: number): void {
  ctx.fillStyle = '#161d3a';
  ctx.fillRect(x0, top, x1 - x0, height);
  const tubes = Math.max(5, Math.min(24, Math.round(height / 5)));
  ctx.fillStyle = 'rgba(120,100,200,0.85)';
  for (let i = 0; i < tubes; i++) {
    ctx.fillRect(x0, top + ((i + 0.5) / tubes) * height - 0.5, x1 - x0, 1);
  }
}

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
  const isSolid = cfg.energy === 'solid';
  const isNuclear = cfg.energy === 'reactor';
  // Engines fed a single propellant: hydrogen for nuclear thermal, uranium salt water otherwise.
  const isSaltwater = cfg.energy === 'saltwater';
  const singleFeed = isNuclear || isSaltwater;
  const feedColour = isSaltwater ? '#9ad64f' : OX_COLOUR;
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
  let gasPts = ext && anim.flowExitX < profile.exitX - 1e-6 ? ext.fixedPoints : pts;
  if (isSolid) {
    // The bore through the grain changes all the way along the case, so the gas outline
    // needs more points there than the case's straight wall has.
    const N = 40;
    const along = Array.from({ length: N - 1 }, (_, i) => ({ x: ((i + 1) / N) * cfg.chamberLen, r: rc }));
    gasPts = [gasPts[0], ...along, ...gasPts.slice(1)];
  }
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

  // Where the gas goes: the whole passage, less a solid motor's grain and the part of the
  // nozzle the jet has left: torn off and ragged, or held steady at a dual bell's kink.
  const jet = (x: number, r: number) => {
    let out = r;
    if (isSolid) out = Math.min(out, grainBore(cfg, x, anim.burnt ?? 0));
    if (jetLeftWall(result.state) && !anim.wholeNozzle && x > profile.throatX && r > result.effectiveExitDia / 2) {
      const ragged = result.state === 'separated' ? 0.05 * Math.sin(x * 40 + anim.timeS * 30) : 0;
      out = (result.effectiveExitDia / 2) * (1 + ragged);
    }
    return out;
  };
  // Simulated gas is drawn on the layer underneath, so open a window onto it.
  const simGas = !!anim.simGas && !anim.failure;
  if (simGas) {
    ctx.save();
    // An expansion-deflection nozzle is simulated from its ring onward: the window opens onto
    // the bell, and the chamber ahead of the ring is painted in below.
    if (profile.plug) {
      ctx.beginPath();
      ctx.rect(X(profile.throatX), 0, widthPx, heightPx);
      ctx.clip();
    }
    cavity(jet);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
    if (profile.plug && anim.fire > 0.01) {
      // The gas in the chamber, which no grid holds for this nozzle: a plain glow in the flame's colour.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, X(profile.throatX), heightPx);
      ctx.clip();
      cavity();
      ctx.fillStyle = css(lerp3(staticLook(cfg).core, [1, 1, 1], 0.35), 0.9 * anim.fire);
      ctx.fill();
      ctx.restore();
    }
  }

  // Nuclear salt water: the fuel waits in a bundle of thin neutron-absorbing tubes, so it
  // cannot start reacting early, then runs down a single pipe that opens into the nozzle.
  if (isSaltwater) {
    const top = cy - rc * ppm;
    const height = 2 * rc * ppm;
    const bundleEnd = X(cfg.chamberLen * 0.45);
    ctx.save();
    cavity();
    ctx.clip();
    ctx.fillStyle = css(SALT_WATER, 0.92);
    ctx.fillRect(X(0), top, X(profile.throatX) - X(0), height);
    drawTubeBundle(ctx, X(0), bundleEnd, top, height);
    ctx.restore();
  }

  // Solid propellant grain: fills the case, leaving a cone-shaped bore down the middle.
  if (isSolid) {
    const grainEnd = cfg.chamberLen * GRAIN_END;
    const burnt = anim.burnt ?? 0;
    const N = 48;
    const station = (i: number) => Math.min((i / N) * grainEnd, grainEnd * 0.99999);
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(X(0), cy + sign * rc * ppm);
      ctx.lineTo(X(grainEnd), cy + sign * rc * ppm);
      for (let i = N; i >= 0; i--) ctx.lineTo(X(station(i)), cy + sign * Math.min(rc, grainBore(cfg, station(i), burnt)) * ppm);
      ctx.closePath();
      ctx.fillStyle = '#74685a';
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(40,34,28,0.5)';
    for (let i = 0; i < 220; i++) {
      const x = rand(i) * grainEnd * 0.999;
      const r = rand(i + 500) * rc;
      if (r > grainBore(cfg, x, burnt)) ctx.fillRect(X(x), cy + (i % 2 ? r : -r) * ppm, 1.5, 1.5);
    }
    // The flame front: the grain burns on the surface of the bore.
    if (anim.fire > 0.01 && !anim.failure) {
      ctx.strokeStyle = `rgba(255,214,64,${0.95 * anim.fire})`;
      ctx.lineWidth = Math.max(1.5, 0.03 * rc * ppm);
      for (const sign of [-1, 1]) {
        ctx.beginPath();
        let drawing = false;
        for (let i = 0; i <= N; i++) {
          const bore = grainBore(cfg, station(i), burnt);
          // No flame where the grain has burned through to the case.
          if (bore >= rc) {
            drawing = false;
            continue;
          }
          if (drawing) ctx.lineTo(X(station(i)), cy + sign * bore * ppm);
          else ctx.moveTo(X(station(i)), cy + sign * bore * ppm);
          drawing = true;
        }
        ctx.stroke();
      }
    }
  }

  // How much propellant is left, under the case.
  if (isSolid && !anim.failure) {
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(232,238,246,0.9)';
    const labelX = Math.max(70, (Math.max(X(0), 0) + X(cfg.chamberLen)) / 2);
    ctx.fillText(
      grainLabel(cfg, anim.burnt ?? 0),
      labelX,
      cy + rc * ppm + wallPx + 6,
    );
  }

  // --- Hot gas inside the engine ------------------------------------------
  if (anim.fire > 0.01 && !anim.failure) {
    if (!simGas) {
    cavity(jet);
    const grad = ctx.createLinearGradient(X(0), 0, X(profile.exitX), 0);
    const look = staticLook(cfg);
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
        if (isSaltwater) {
          // Unreacted fuel is teal in the pipe. Past the pipe's mouth it turns into exhaust
          // as it reacts, over the first half of the bell.
          const along = (x - profile.throatX) / Math.max(1e-9, profile.exitX - profile.throatX);
          const reacted = Math.min(1, Math.max(0, along / 0.7));
          c = lerp3(SALT_WATER, lerp3(look.core, look.mid, 0.3), reacted * reacted * (3 - 2 * reacted));
          // Nothing glows in the pipe itself: the fuel and its tubes are already drawn there.
          a = 0.95 * Math.min(1, Math.max(0, along / 0.06));
        }
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

    if (isSaltwater && anim.overlay === 'none') {
      // The reaction zone: fission takes off just past the mouth of the pipe, on the centreline.
      const length = 0.44 * (profile.exitX - profile.throatX) * ppm;
      const half = 1.6 * rt * ppm;
      const pulse = 0.92 + 0.08 * Math.sin(anim.timeS * 31) + 0.05 * Math.sin(anim.timeS * 77);
      ctx.save();
      cavity(jet);
      ctx.clip();
      ctx.translate(X(profile.throatX) + length * 0.5, cy);
      ctx.scale(length / (2 * half), 1);
      const zone = ctx.createRadialGradient(0, 0, 0, 0, 0, half * 1.25 * pulse);
      zone.addColorStop(0, `rgba(255,228,205,${0.95 * anim.fire})`);
      zone.addColorStop(0.45, `rgba(255,112,72,${0.85 * anim.fire})`);
      zone.addColorStop(1, 'rgba(255,60,40,0)');
      ctx.fillStyle = zone;
      ctx.fillRect(-2 * half, -2 * half, 4 * half, 4 * half);
      ctx.restore();
    }
  }

  // An expansion-deflection nozzle: the plug in its throat, and the hollow behind the plug.
  const plug = profile.plug;
  if (plug) {
    // With the gas drawn, the hollow is drawn too. While the outside air fills it, it runs the
    // length of the bell and leaves the gas a band along the wall as wide as the jet the figures
    // describe. Once it has closed, it is a short cone of dead gas behind the plug.
    if (anim.fire > 0.01 && !anim.failure && !simGas) {
      const re = profile.points[profile.points.length - 1].r;
      const open = result.state === 'compensating';
      const endX = open ? profile.exitX : plug.capX + 2.2 * plug.capR;
      const endR = open ? Math.min(0.97 * re, Math.sqrt(Math.max(0, re * re - (result.effectiveExitDia / 2) ** 2))) : 0;
      ctx.beginPath();
      ctx.moveTo(X(plug.capX), cy - plug.capR * ppm);
      ctx.lineTo(X(endX), cy - Math.max(endR, open ? plug.capR : 0) * ppm);
      ctx.lineTo(X(endX), cy + Math.max(endR, open ? plug.capR : 0) * ppm);
      ctx.lineTo(X(plug.capX), cy + plug.capR * ppm);
      ctx.closePath();
      ctx.fillStyle = open ? '#0d0f14' : 'rgba(13,15,20,0.7)';
      ctx.fill();
    }
    // The plug itself: a stalk that flares out to a flat-backed rim, in the wall's metal.
    const steel = ctx.createLinearGradient(0, cy - plug.rimR * ppm, 0, cy + plug.rimR * ppm);
    steel.addColorStop(0, '#a9b1bd');
    steel.addColorStop(0.5, '#565d69');
    steel.addColorStop(1, '#8f97a3');
    ctx.beginPath();
    ctx.moveTo(X(plug.stalkX), cy - plug.stalkR * ppm);
    ctx.lineTo(X(plug.flareX), cy - plug.stalkR * ppm);
    for (const q of plug.cap) ctx.lineTo(X(q.x), cy - q.r * ppm);
    for (let i = plug.cap.length - 1; i >= 0; i--) ctx.lineTo(X(plug.cap[i].x), cy + plug.cap[i].r * ppm);
    ctx.lineTo(X(plug.flareX), cy + plug.stalkR * ppm);
    ctx.lineTo(X(plug.stalkX), cy + plug.stalkR * ppm);
    ctx.closePath();
    ctx.fillStyle = steel;
    ctx.fill();
    ctx.strokeStyle = '#23262d';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Nuclear salt water: a film of plain water runs down the inside of the nozzle wall to keep
  // the reaction off it.
  if (isSaltwater && !anim.failure) {
    const bell = pts.filter((p) => p.x >= profile.throatX);
    const flowing = 0.3 + 0.7 * anim.fire;
    const film = ctx.createLinearGradient(X(profile.throatX), 0, X(profile.exitX), 0);
    film.addColorStop(0, `rgba(70,150,255,${0.95 * flowing})`);
    film.addColorStop(1, `rgba(70,150,255,${0.3 * flowing})`);
    ctx.strokeStyle = film;
    ctx.lineWidth = Math.max(2, 0.035 * profile.maxRadius * ppm);
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      bell.forEach((p, i) => {
        const y = cy + sign * (p.r * ppm - ctx.lineWidth / 2);
        if (i === 0) ctx.moveTo(X(p.x), y);
        else ctx.lineTo(X(p.x), y);
      });
      ctx.stroke();
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
  if (isSaltwater) {
    // No injector: the tube bundle and its pipe simply carry on forward to the tank.
    const left = -20;
    drawTubeBundle(ctx, left, X(0) + 1, cy - rc * ppm, 2 * rc * ppm);
    ctx.fillStyle = '#8f97a3';
    ctx.strokeStyle = '#1b1e25';
    ctx.lineWidth = 1;
    for (const sign of [-1, 1]) {
      const y = sign < 0 ? cy - rc * ppm - wallPx : cy + rc * ppm;
      ctx.fillRect(left, y, X(0) - left + 1, wallPx);
      ctx.strokeRect(left, y, X(0) - left + 1, wallPx);
    }
    // Water manifolds at the base of the bell, feeding the film that protects the nozzle wall.
    const boxW = Math.max(12, 1.3 * rt * ppm);
    const boxH = Math.max(7, 0.65 * rt * ppm);
    for (const sign of [-1, 1]) {
      const inner = cy + sign * (rt * ppm + wallPx);
      const y = sign < 0 ? inner - boxH : inner;
      const water = ctx.createLinearGradient(0, y, 0, y + boxH);
      water.addColorStop(0, '#2f7de0');
      water.addColorStop(1, '#5aa6ff');
      ctx.fillStyle = water;
      ctx.fillRect(X(profile.throatX) - boxW, y, boxW * 1.1, boxH);
      ctx.strokeRect(X(profile.throatX) - boxW, y, boxW * 1.1, boxH);
    }
  } else {
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
      ctx.fillStyle = singleFeed ? feedColour : i % 2 ? OX_COLOUR : FUEL_COLOUR;
      ctx.fillRect(X(0) - headW * 0.55, hy - 1, headW * 0.55, 2);
    }
    const pipe = Math.max(4, 0.22 * rc * ppm);
    ctx.fillStyle = singleFeed ? feedColour : OX_COLOUR;
    if (multi) {
      // Fed from the shared turbopump instead.
    } else if (singleFeed) {
      // One propellant only: a single feed line.
      ctx.fillRect(X(0) - headW - pipe * 1.6, cy - pipe / 2, pipe * 1.6, pipe);
    } else {
      ctx.fillRect(X(0) - headW - pipe * 1.6, cy - headH * 0.55 - pipe / 2, pipe * 1.6, pipe);
      ctx.fillStyle = '#d6a04f';
      ctx.fillRect(X(0) - headW - pipe * 1.6, cy + headH * 0.55 - pipe / 2, pipe * 1.6, pipe);
    }
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
  // A flame that goes out, or never lights, leaves the engine whole. A detonation bursts the chamber.
  if (anim.failure && destroys(anim.failure) && index === 0) {
    const fx = X(anim.failure === 'burnthrough' ? profile.throatX : cfg.chamberLen * 0.55);
    const fr = (anim.failure === 'burnthrough' ? rt : rc) * ppm;
    const size = Math.max(40, profile.maxRadius * ppm);
    const holes = (anim.failure === 'burnthrough' ? [-1] : [-1, 1]).map((sign) => ({
      x: fx,
      y: cy + sign * fr,
      seed: sign > 0 ? 40 : 0,
    }));
    drawFailure(ctx, anim, fx, cy, holes, size, widthPx, heightPx);
  }
  };

  if (profile.spike) {
    drawAerospike(ctx, cfg, result, view, anim, profile.spike, widthPx, heightPx);
    // A solid motor burns out here too: say how much is left, under the spike's thrust cells.
    if (cfg.energy === 'solid' && !anim.failure) {
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(232,238,246,0.9)';
      const lipY = view.centreY + profile.spike.lip.r * view.ppm;
      ctx.fillText(grainLabel(cfg, anim.burnt ?? 0), 14, Math.min(heightPx - 40, lipY + 26));
    }
  } else {
    profile.offsets.forEach((offset, index) => {
      ctx.save();
      ctx.translate(0, offset * ppm);
      drawChamber(index);
      ctx.restore();
    });
  }
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
  ctx.fillText(scaleBarLabel(barM), bx + barPx + 8, by + 4);

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
