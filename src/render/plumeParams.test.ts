import { describe, expect, it } from 'vitest';
import { sanitize, simulate } from '../physics/engine';
import { starterEngine } from '../physics/reshape';
import { PRESETS, getPreset } from '../physics/presets';
import { machFromAreaRatio, pressureRatio } from '../physics/nozzle';
import { SPIKE_SAMPLES } from './fluidSim';
import { engineProfile } from './geometry';
import { VACUUM_FLOOR, engineRestPressure, plumeParams, simInputs, spikeSimInputs } from './plumeParams';

const at = (id: string, altitudeKm: number, patch = {}, fire = 1) => {
  const cfg = { ...getPreset(id)!.config, ...patch };
  const flight = { altitudeKm, throttle: 1 };
  return plumeParams(cfg, simulate(cfg, flight), flight, fire);
};

describe('plume parameters', () => {
  it('shows diamonds only where the air can push back', () => {
    expect(at('merlin-1d', 0).diamondStrength).toBeGreaterThan(0.2);
    expect(at('merlin-1d', 100).diamondStrength).toBe(0);
    // Find the altitude where Merlin is ideally expanded: no diamonds there.
    let ideal = 0;
    for (let h = 0; h < 20; h += 0.05) {
      const cfg = getPreset('merlin-1d')!.config;
      if (simulate(cfg, { altitudeKm: h, throttle: 1 }).state === 'ideal') {
        ideal = h;
        break;
      }
    }
    expect(ideal).toBeGreaterThan(0);
    expect(at('merlin-1d', ideal + 0.3).diamondStrength).toBe(0);
  });
  it('flares steadily wider with altitude', () => {
    let prevBloom = -1;
    let prevRadius = 0;
    for (let h = 0; h <= 100; h += 2) {
      const p = at('merlin-1d', h);
      expect(p.bloom).toBeGreaterThanOrEqual(prevBloom);
      expect(p.settleRadius).toBeGreaterThanOrEqual(prevRadius);
      prevBloom = p.bloom;
      prevRadius = p.settleRadius;
    }
    expect(prevBloom).toBe(1);
    expect(at('merlin-1d', 0).settleRadius).toBeLessThan(1);
  });
  it('gets sootier when fuel-rich and cleaner when oxidiser-rich', () => {
    const rich = at('merlin-1d', 0, { mixtureRatio: 1.9 });
    const lean = at('merlin-1d', 0, { mixtureRatio: 3.3 });
    expect(rich.soot).toBeGreaterThan(lean.soot);
    expect(lean.soot).toBe(0);
  });
  it('has no soot or smoke in vacuum, and less of both as the air thins', () => {
    for (const id of ['merlin-1d', 'solid-booster']) {
      const ground = at(id, 0, { mixtureRatio: 1.9 });
      const high = at(id, 30, { mixtureRatio: 1.9 });
      const vacuum = at(id, 100, { mixtureRatio: 1.9 });
      expect(vacuum.soot).toBe(0);
      expect(vacuum.smoke).toBe(0);
      expect(high.soot).toBeLessThan(ground.soot);
      expect(high.smoke).toBeLessThan(ground.smoke);
      expect(ground.smoke).toBeGreaterThan(0);
    }
  });
  it('is dark when not firing and gives every propellant a different colour', () => {
    expect(at('merlin-1d', 0, {}, 0).intensity).toBe(0);
    const mids = ['merlin-1d', 'rs-25', 'raptor-2', 'solid-booster'].map((id) => at(id, 0).mid.join(','));
    expect(new Set(mids).size).toBe(4);
  });
  it('stays finite for every preset from ground to vacuum', () => {
    for (const p of PRESETS) {
      for (const h of [0, 10, 40, 85.9, 86, 100]) {
        for (const v of Object.values(at(p.id, h))) {
          if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  });
});

describe('aerospike simulation inputs', () => {
  const cfg = getPreset('xrs-2200')!.config;
  const spike = engineProfile(cfg).spike!;
  const inputs = (altitudeKm: number, throttle = 1) =>
    spikeSimInputs(cfg, simulate(cfg, { altitudeKm, throttle }), 1, spike);

  it('hands the solver the spike, in units of the lip radius from the plane of the lip', () => {
    const s = inputs(0).spike!;
    expect(s.radii).toHaveLength(SPIKE_SAMPLES);
    // A gap between the spike and the lip for the gas to arrive through.
    expect(s.radii[0]).toBeLessThan(1);
    expect(s.radii[0]).toBeGreaterThan(0.85);
    for (let i = 1; i < s.radii.length; i++) expect(s.radii[i]).toBeLessThanOrEqual(s.radii[i - 1] + 1e-12);
    // It ends at the edge of the flat base.
    expect(s.radii.at(-1)).toBeCloseTo(spike.base.r / spike.lip.r, 9);
    expect(s.length).toBeCloseTo((spike.base.x - spike.lip.x) / spike.lip.r, 9);
    expect(s.tilt).toBe(spike.cell.tilt);
  });

  it('feeds in the gas as it leaves the thrust cells, not as it would leave the spike', () => {
    const r = simulate(cfg, { altitudeKm: 0, throttle: 1 });
    const sim = inputs(0);
    const cellMach = spike.contour[0].mach;
    expect(sim.gamma).toBe(r.gamma);
    expect(sim.uExit).toBeCloseTo(cellMach * Math.sqrt(r.gamma), 9);
    expect(sim.t0).toBeCloseTo(1 + ((r.gamma - 1) / 2) * cellMach ** 2, 9);
    // Even across the ring, and running straight along the cells' axis.
    expect(sim.profile).toBe(0);
    expect(sim.divergence).toBe(0);
    expect(sim.wallCurve).toBe(0);
    // At sea level the cells are under-expanded: the air is at lower pressure than their exhaust.
    const cellPressure = r.pc * pressureRatio(cellMach, r.gamma);
    expect(sim.pAmb).toBeCloseTo(r.pa / cellPressure, 9);
    expect(sim.pAmb).toBeLessThan(1);
    expect(sim.pAmb).toBeGreaterThan(0.3);
    // The whole spike would take the gas on down to the engine's design exit pressure.
    const s = sim.spike!;
    const designPressure = r.pc * pressureRatio(machFromAreaRatio(r.expansionRatio, r.gamma), r.gamma);
    expect(s.designDensity * s.designTemp).toBeCloseTo(designPressure / cellPressure, 9);
    expect(s.designDensity).toBeLessThan(1);
    expect(s.designTemp).toBeLessThan(1);
    expect(s.designTemp).toBeGreaterThan(s.designDensity);
  });

  it('gives the ring the area the cells\u2019 flow needs', () => {
    // Mass crossing the plane of the lip, through the ring and at the cells' tilt, is the
    // engine's whole flow: the throat area times the cells' area ratio.
    const s = inputs(0).spike!;
    const ring = Math.PI * spike.lip.r ** 2 * (1 - s.radii[0] ** 2) * Math.cos(s.tilt);
    const needed = cfg.chambers * (Math.PI / 4) * cfg.throatDia ** 2 * spike.cell.exitAreaRatio;
    expect(ring / needed).toBeGreaterThan(0.95);
    expect(ring / needed).toBeLessThan(1.05);
  });

  it('lets the outside pressure fall away with altitude, down to the solver\u2019s vacuum floor', () => {
    let prev = Infinity;
    for (const h of [0, 5, 10, 17, 30, 60]) {
      const p = inputs(h).pAmb;
      expect(p, `${h} km`).toBeLessThan(prev);
      prev = p;
    }
    expect(inputs(100).pAmb).toBe(VACUUM_FLOOR);
    // Throttled right back at sea level the cells themselves are over-expanded.
    expect(inputs(0, 0.4).pAmb).toBeGreaterThan(1);
  });
});

describe('plume inputs for each nozzle shape', () => {
  const vac = { altitudeKm: 100, throttle: 1 };
  const sl = { altitudeKm: 0, throttle: 1 };

  it('lets the plume leave a cone along its half-angle, and straight back with no nozzle', () => {
    const cone = sanitize({ ...starterEngine(), exhaust: 'cone', coneAngleDeg: 25 });
    expect(simInputs(cone, simulate(cone, vac), 1).divergence).toBeCloseTo(Math.tan((25 * Math.PI) / 180), 9);
    const none = sanitize({ ...starterEngine(), exhaust: 'none' });
    expect(simInputs(none, simulate(none, vac), 1).divergence).toBe(0);
    expect(simInputs(none, simulate(none, vac), 1).uExit).toBeCloseTo(Math.sqrt(simulate(none, vac).gamma), 6);
  });
  it('keeps a bell lip slope exactly as it was', () => {
    const bell = starterEngine();
    expect(simInputs(bell, simulate(bell, vac), 1).divergence)
      .toBe((0.45 * Math.tan((15 * Math.PI) / 180) * 100) / bell.nozzleLenPct);
  });
  it('starts a held dual bell plume from the kink, steady', () => {
    const dual = sanitize({ ...starterEngine(), chamberPressureBar: 60, exitDia: 10 * starterEngine().throatDia, exhaust: 'dualBell' });
    const r = simulate(dual, sl);
    const p = plumeParams(dual, r, sl, 1);
    expect(r.state).toBe('held');
    expect(p.exitRadiusM).toBeCloseTo(dual.innerExitDia / 2, 6);
    const torn = simulate({ ...dual, exhaust: 'bell' }, sl);
    expect(p.turbulence).toBeLessThan(plumeParams({ ...dual, exhaust: 'bell' }, torn, sl, 1).turbulence);
  });
});

describe('the still gas in an unlit engine', () => {
  const exitPressureOf = (cfg: ReturnType<typeof starterEngine>, altitudeKm: number) => {
    const r = simulate(cfg, { altitudeKm, throttle: 1 });
    return { r, exit: pressureRatio(machFromAreaRatio(r.expansionRatio, r.gamma), r.gamma) };
  };
  it('is as it was for every example engine', () => {
    for (const preset of PRESETS) for (const km of [0, 100]) {
      const { r, exit } = exitPressureOf(preset.config, km);
      expect(engineRestPressure(exit, r.pa, r.pc), preset.id).toBe(Math.min(0.3, Math.max(0.3 * exit, r.pa / r.pc)));
    }
  });
  it('holds little gas with no nozzle, so a big chamber clears it quickly as it lights', () => {
    // The gas leaves at the throat at about half the chamber pressure; a tenth of that would
    // fill the chamber with cold gas ten times as dense as the flame's.
    const none = sanitize({ ...starterEngine(), exhaust: 'none' });
    for (const km of [0, 100]) {
      const { r, exit } = exitPressureOf(none, km);
      expect(exit).toBeGreaterThan(0.5);
      expect(engineRestPressure(exit, r.pa, r.pc)).toBeLessThanOrEqual(0.03);
      expect(engineRestPressure(exit, r.pa, r.pc)).toBeGreaterThanOrEqual(r.pa / r.pc);
    }
  });
  it('is still the outside air in an engine at low pressure near the ground', () => {
    const low = sanitize({ ...starterEngine(), exhaust: 'none', chamberPressureBar: 5 });
    const { r, exit } = exitPressureOf(low, 0);
    expect(engineRestPressure(exit, r.pa, r.pc)).toBeCloseTo(r.pa / r.pc, 9);
  });
});
