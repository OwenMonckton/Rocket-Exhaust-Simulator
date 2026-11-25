import { describe, expect, it } from 'vitest';
import { isBeam } from '../physics/parts';
import { sanitize, simulate } from '../physics/engine';
import { destroys } from '../physics/limits';
import { areaRatio, machFromAreaRatio } from '../physics/nozzle';
import { PRESETS } from '../physics/presets';
import { starterEngine, withEnergy, withExhaust } from '../physics/reshape';
import { engineProfile, grainLabel, radiusAt, spikeJetRadius, spikeSurfaceRadius, viewTransform } from './geometry';

/** The examples with a chamber, a throat and a bell or cone: not the aerospike, and not the beam thrusters, which have none of them. */
const NOZZLED = PRESETS.filter((q) => q.config.exhaust !== 'aerospike' && !isBeam(q.config.energy));

describe('engine profile', () => {
  for (const p of NOZZLED) {
    it(`${p.name} has a sane contour`, () => {
      const cfg = p.config;
      const prof = engineProfile(cfg);
      expect(prof.points[0]).toEqual({ x: 0, r: cfg.chamberDia / 2 });
      expect(prof.points.at(-1)!.r).toBeCloseTo(cfg.exitDia / 2, 9);
      const min = prof.points.reduce((a, b) => (b.r < a.r ? b : a));
      expect(min.r).toBeCloseTo(cfg.throatDia / 2, 9);
      expect(min.x).toBeCloseTo(prof.throatX, 9);
      for (let i = 1; i < prof.points.length; i++) {
        if (i > 1) expect(prof.points[i].x).toBeGreaterThan(prof.points[i - 1].x);
        expect(Number.isFinite(prof.points[i].r)).toBe(true);
      }
      // The bell only ever widens after the throat.
      const bell = prof.points.filter((q) => q.x >= prof.throatX);
      for (let i = 1; i < bell.length; i++) expect(bell[i].r).toBeGreaterThanOrEqual(bell[i - 1].r);
      expect(radiusAt(prof, prof.throatX)).toBeCloseTo(cfg.throatDia / 2, 9);
      expect(radiusAt(prof, 1e9)).toBeCloseTo(cfg.exitDia / 2, 9);
    });
  }
  it('turns the wall out of the throat along an arc, with no corner', () => {
    for (const p of NOZZLED) {
      const cfg = p.config;
      const prof = engineProfile(cfg);
      const bell = prof.points.filter((q) => q.x >= prof.throatX - 1e-12);
      const angles = bell.slice(1).map((q, i) => Math.atan2(q.r - bell[i].r, q.x - bell[i].x));
      // It leaves the throat nearly straight along the engine, and never turns sharply after.
      expect(angles[0], p.id).toBeLessThan((6 * Math.PI) / 180);
      for (let i = 1; i < angles.length; i++) {
        expect(Math.abs(angles[i] - angles[i - 1]), `${p.id} point ${i}`).toBeLessThan((6 * Math.PI) / 180);
      }
      // The arc is the size real bells use, or smaller where the bell is too short for one.
      const rt = cfg.throatDia / 2;
      const steepest = Math.max(...angles);
      const arcEnd = bell[angles.indexOf(steepest)];
      expect(arcEnd.x - prof.throatX, p.id).toBeLessThanOrEqual(0.382 * rt * Math.sin(steepest) * 1.05);
      // The lip still has the slope the plume is told the bell ends with.
      const lipSlope = (0.45 * Math.tan((15 * Math.PI) / 180) * 100) / cfg.nozzleLenPct;
      expect(Math.tan(angles.at(-1)!) / lipSlope, p.id).toBeGreaterThan(0.9);
      expect(Math.tan(angles.at(-1)!) / lipSlope, p.id).toBeLessThan(1.2);
    }
  });
  it('makes a longer bell at 100% than at 60%', () => {
    const cfg = PRESETS[0].config;
    const short = engineProfile({ ...cfg, nozzleLenPct: 60 });
    const long = engineProfile({ ...cfg, nozzleLenPct: 100 });
    expect(long.length).toBeGreaterThan(short.length);
  });
  it('keeps a small nozzle big enough to see, cropping the front of a long engine', () => {
    const solid = PRESETS.find((p) => p.id === 'solid-booster')!;
    const prof = engineProfile(solid.config);
    for (const zoom of [1, 0.5, 0.3]) {
      const v = viewTransform(prof, 1200, 600, zoom);
      expect((solid.config.exitDia / 2) * v.ppm).toBeGreaterThanOrEqual(600 * 0.03);
      expect(v.originX + prof.length * v.ppm).toBeLessThan(0.5 * 1200);
    }
    // Ordinary engines are unaffected and stay fully on screen.
    const merlin = engineProfile(PRESETS[0].config);
    expect(viewTransform(merlin, 1200, 600).originX).toBeGreaterThan(0);
  });
  it('draws two chambers side by side for a multi-chamber engine, with room for the pump', () => {
    const rd170 = PRESETS.find((p) => p.id === 'rd-170')!.config;
    const prof = engineProfile(rd170);
    expect(prof.offsets).toHaveLength(2);
    expect(prof.offsets[0]).toBeCloseTo(-prof.offsets[1], 9);
    // Nozzles clear each other.
    expect(prof.offsets[1] - prof.offsets[0]).toBeGreaterThan(rd170.exitDia);
    expect(prof.frontSpace).toBeGreaterThan(0);
    const v = viewTransform(prof, 1200, 600);
    expect(2 * prof.halfHeight * v.ppm).toBeLessThanOrEqual(0.55 * 600 + 1e-6);
    expect(v.originX - prof.frontSpace * v.ppm).toBeGreaterThan(0);
    const single = engineProfile(PRESETS[0].config);
    expect(single.offsets).toEqual([0]);
    expect(single.frontSpace).toBe(0);
  });
  it('splits a nozzle with an extension, and slides the extension forward to stow it', () => {
    const rl10 = PRESETS.find((p) => p.id === 'rl10b-2')!.config;
    const seated = engineProfile(rl10).extension!;
    expect(seated).not.toBeNull();
    expect(seated.shift).toBe(0);
    expect(seated.seam.r).toBeCloseTo(rl10.extFixedDia / 2, 9);
    expect(seated.fixedPoints.at(-1)).toEqual(seated.seam);
    expect(seated.points[0]).toEqual(seated.seam);
    expect(seated.points.at(-1)!.r).toBeCloseTo(rl10.exitDia / 2, 9);
    expect(seated.seamSlope).toBeGreaterThan(0);
    const stowed = engineProfile({ ...rl10, extDeploy: 0 });
    expect(stowed.extension!.shift).toBeCloseTo(seated.length, 9);
    expect(engineProfile({ ...rl10, extDeploy: 0.5 }).extension!.shift).toBeCloseTo(seated.length / 2, 9);
    // The view does not move as it deploys, and leaves room in front for the stowed extension.
    expect(stowed.length).toBe(engineProfile(rl10).length);
    expect(stowed.frontSpace).toBe(engineProfile(rl10).frontSpace);
    const v = viewTransform(stowed, 1200, 600);
    expect(v.originX + (seated.seam.x - seated.length) * v.ppm).toBeGreaterThan(0);
    expect(engineProfile(PRESETS[0].config).extension).toBeNull();
  });
  it('shapes the XRS-2200 spike from its cells to a flat base', () => {
    const cfg = PRESETS.find((p) => p.id === 'xrs-2200')!.config;
    const prof = engineProfile(cfg);
    const spike = prof.spike!;
    expect(prof.extension).toBeNull();
    expect(prof.offsets).toEqual([0]);
    // The lip encloses all twenty cells' share of the exit area.
    expect(spike.lip.r).toBeCloseTo((Math.sqrt(20) * cfg.exitDia) / 2, 9);
    expect(prof.throatX).toBe(spike.lip.x);
    expect(prof.exitX).toBe(spike.base.x);
    // The spike narrows steadily from the cells to the base, and the Mach number climbs.
    const c = spike.contour;
    expect(c[0].r).toBeLessThan(spike.lip.r);
    for (let i = 1; i < c.length; i++) {
      expect(c[i].x).toBeGreaterThan(c[i - 1].x);
      expect(c[i].r).toBeLessThanOrEqual(c[i - 1].r + 1e-12);
      expect(c[i].mach).toBeGreaterThanOrEqual(c[i - 1].mach);
    }
    expect(spike.base).toEqual({ x: c.at(-1)!.x, r: c.at(-1)!.r });
    expect(spike.base.r).toBeGreaterThan(0.2 * spike.lip.r);
    // The cells do some of the expanding, and the spike the rest.
    expect(spike.cell.exitAreaRatio).toBeGreaterThan(2);
    expect(spike.cell.exitAreaRatio).toBeLessThan((cfg.exitDia / cfg.throatDia) ** 2 / 4);
    expect(spike.cell.throatS).toBeGreaterThan(spike.cell.chamberEndS);
    expect(spike.cell.exitS).toBeGreaterThan(spike.cell.throatS);
    // The engine starts at the front of the cells.
    expect(Math.min(spike.cell.origin.x, c[0].x)).toBeGreaterThanOrEqual(-1e-9);
    expect(prof.halfHeight).toBeGreaterThanOrEqual(spike.lip.r);
  });
  it('puts the spike exactly where each Mach line from the lip needs it', () => {
    const cfg = PRESETS.find((p) => p.id === 'xrs-2200')!.config;
    const spike = engineProfile({ ...cfg, nozzleLenPct: 100 }).spike!;
    const g = simulate(cfg, { altitudeKm: 0, throttle: 1 }).gamma;
    const throatArea = cfg.chambers * (Math.PI / 4) * cfg.throatDia ** 2;
    const c = spike.contour;
    // Angelino: the gas crossing the Mach line from the lip to any point on the spike has
    // exactly the flow area its Mach number calls for.
    for (const q of c.slice(1, -1)) {
      const alpha = Math.atan2(spike.lip.r - q.r, q.x - spike.lip.x);
      const mu = Math.asin(1 / q.mach);
      const flowArea = (Math.PI * (spike.lip.r ** 2 - q.r ** 2) * Math.sin(mu)) / Math.sin(alpha);
      expect(flowArea / throatArea, `Mach ${q.mach}`).toBeCloseTo(areaRatio(q.mach, g), 6);
    }
    // It ends at the design exit Mach number, having turned the flow to run straight back.
    expect(c.at(-1)!.mach).toBeCloseTo(machFromAreaRatio((cfg.exitDia / cfg.throatDia) ** 2, g), 9);
    // From the cells to the first Mach line the surface runs straight along the flow.
    expect(Math.atan2(c[0].r - c[1].r, c[1].x - c[0].x)).toBeCloseTo(spike.cell.tilt, 9);
    expect(c[1].mach).toBe(c[0].mach);
    // The cells' exit slot, a thin ring round the lip, has the area the gas needs there.
    const slotH = Math.hypot(spike.lip.x - c[0].x, spike.lip.r - c[0].r);
    const slotArea = Math.PI * (spike.lip.r + c[0].r) * slotH;
    expect(slotArea / throatArea / spike.cell.exitAreaRatio).toBeGreaterThan(0.95);
    expect(slotArea / throatArea / spike.cell.exitAreaRatio).toBeLessThan(1.05);
    // The cells themselves are drawn at their true size.
    expect(spike.cell.points[0].r).toBe(cfg.chamberDia / 2);
    expect(spike.cell.throatR).toBe(cfg.throatDia / 2);
  });
  it('cuts a spike off shorter at a lower length setting, and keeps it all at 100%', () => {
    const cfg = PRESETS.find((p) => p.id === 'xrs-2200')!.config;
    const short = engineProfile({ ...cfg, nozzleLenPct: 60 }).spike!;
    const full = engineProfile({ ...cfg, nozzleLenPct: 100 }).spike!;
    expect(full.base.x - full.lip.x).toBeGreaterThan(2 * (short.base.x - short.lip.x));
    expect(full.base.x - full.lip.x).toBeCloseTo(full.fullLength, 6);
    expect(full.base.r).toBeLessThan(1e-9);
    expect(short.base.r).toBeGreaterThan(full.base.r);
  });
  it('reads the spike surface off at any point along the engine', () => {
    const spike = engineProfile(PRESETS.find((p) => p.id === 'xrs-2200')!.config).spike!;
    const c = spike.contour;
    for (const q of c) expect(spikeSurfaceRadius(spike, q.x)).toBeCloseTo(q.r, 9);
    const mid = spikeSurfaceRadius(spike, 0.5 * (c[3].x + c[4].x));
    expect(mid).toBeCloseTo(0.5 * (c[3].r + c[4].r), 9);
    // Forward of where it begins it keeps its starting radius; behind the base there is nothing.
    expect(spikeSurfaceRadius(spike, c[0].x - 1)).toBe(c[0].r);
    expect(spikeSurfaceRadius(spike, spike.base.x + 1e-6)).toBe(0);
  });
  it('wraps an aerospike jet around its spike, never wider than the lip while the air squeezes it', () => {
    const cfg = PRESETS.find((p) => p.id === 'xrs-2200')!.config;
    const spike = engineProfile(cfg).spike!;
    // At the design altitude the jet's outer edge runs straight back from the lip.
    expect(spikeJetRadius(cfg, cfg.exitDia, 0)).toBeCloseTo(spike.lip.r, 9);
    expect(spikeJetRadius(cfg, cfg.exitDia, spike.base.r)).toBeCloseTo(spike.lip.r, 9);
    // Squeezed by the air, the jet still wraps around the base, and widens as the air thins.
    const squeezed = spikeJetRadius(cfg, 2 * cfg.throatDia, spike.base.r);
    expect(squeezed).toBeGreaterThan(spike.base.r);
    expect(squeezed).toBeLessThan(spike.lip.r);
    expect(spikeJetRadius(cfg, 3 * cfg.throatDia, spike.base.r)).toBeGreaterThan(squeezed);
    // With no spike in the way, it is simply as wide as its flow area.
    expect(spikeJetRadius(cfg, 2 * cfg.throatDia, 0)).toBeCloseTo(Math.sqrt(20) * cfg.throatDia, 9);
    // At every altitude the drawn jet stays between the base and the lip.
    for (let h = 0; h <= 100; h += 1) {
      const r = simulate(cfg, { altitudeKm: h, throttle: 1 });
      const jet = spikeJetRadius(cfg, r.effectiveExitDia, spike.base.r);
      expect(jet, `${h} km`).toBeGreaterThan(spike.base.r);
      expect(jet, `${h} km`).toBeLessThanOrEqual(spike.lip.r + 1e-9);
    }
  });
  it('fits the engine in the left of the stage', () => {
    for (const p of PRESETS) {
      const prof = engineProfile(p.config);
      const v = viewTransform(prof, 1200, 600);
      expect(v.originX + prof.length * v.ppm).toBeLessThan(0.5 * 1200);
      expect(2 * prof.maxRadius * v.ppm).toBeLessThanOrEqual(0.55 * 600 + 1e-6);
    }
  });
  it('ends an engine with no nozzle at its throat', () => {
    const p = engineProfile(sanitize({ ...starterEngine(), exhaust: 'none' }));
    expect(p.exitX).toBe(p.throatX);
    expect(p.points.at(-1)!.r).toBeCloseTo(starterEngine().throatDia / 2, 9);
    expect(p.extension).toBeNull();
    expect(p.kink).toBeNull();
  });
  it('marks a dual bell kink in engine coordinates', () => {
    const cfg = sanitize({ ...starterEngine(), exhaust: 'dualBell' });
    const p = engineProfile(cfg);
    expect(p.kink!.r).toBeCloseTo(cfg.innerExitDia / 2, 9);
    expect(p.kink!.x).toBeGreaterThan(p.throatX);
    expect(p.kink!.x).toBeLessThan(p.exitX);
    expect(radiusAt(p, p.kink!.x)).toBeCloseTo(p.kink!.r, 6);
  });
});

describe('thrust cell count (review focus)', () => {
  const allFinite = (v: unknown, path = 'profile'): void => {
    if (typeof v === 'number') expect(Number.isFinite(v), path).toBe(true);
    else if (Array.isArray(v)) v.forEach((x, i) => allFinite(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) allFinite(x, `${path}.${k}`);
  };
  for (const cells of [1, 2, 40]) {
    it(`draws and runs an aerospike with ${cells} thrust cells`, () => {
      const cfg = sanitize({ ...withExhaust(starterEngine(), 'aerospike'), chambers: cells });
      expect(cfg.chambers).toBe(cells);
      const profile = engineProfile(cfg);
      expect(profile.spike).toBeDefined();
      allFinite(profile);
      for (const altitudeKm of [0, 100]) {
        const r = simulate(cfg, { altitudeKm, throttle: 1 });
        expect(Number.isFinite(r.thrust)).toBe(true);
        expect(r.thrust).toBeGreaterThan(0);
      }
    });
  }
});

describe('solid motor grain label (final review)', () => {
  const motor = withEnergy(starterEngine(), 'solid');
  it('says how much propellant is left, on a bell or an aerospike', () => {
    expect(grainLabel(motor, 0)).toBe('Propellant left: 100%');
    expect(grainLabel(withExhaust(motor, 'aerospike'), 0)).toBe('Propellant left: 100%');
    expect(grainLabel(motor, 0.5)).toMatch(/^Propellant left: \d+%$/);
  });
  it('says so when the motor has burnt out', () => {
    expect(grainLabel(withExhaust(motor, 'aerospike'), 1)).toBe('Burnt out. Fire loads a fresh motor.');
  });
});

describe('which failures tear the engine open', () => {
  it('draws damage only for the failures that destroy the engine', () => {
    expect(destroys(null)).toBe(false);
    expect(destroys('flameout')).toBe(false);
    expect(destroys('inert')).toBe(false);
    expect(destroys('unsolved')).toBe(false);
    expect(destroys('detonation')).toBe(true);
    expect(destroys('burst')).toBe(true);
    expect(destroys('burnthrough')).toBe(true);
  });
});
