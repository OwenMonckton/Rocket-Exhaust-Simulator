import { describe, expect, it } from 'vitest';
import { BEAM_PROPELLANTS, BEAM_VACUUM_PA, beamShares } from './electric';
import { ambientPressure } from './atmosphere';
import { rangesFor, sanitize, simulate } from './engine';
import { destroys } from './limits';
import { ENERGY_SOURCES, isBeam, isElectric, propellantsFor } from './parts';
import { starterEngine, withEnergy, withPropellant } from './reshape';
import type { EngineConfig, PropellantId } from './types';

const E = 1.602176634e-19;
const U = 1.66053907e-27;
const G0 = 9.80665;
const space = { altitudeKm: 100, throttle: 1 };
const TYPES = ['ion', 'hall'] as const;
const beam = (type: 'ion' | 'hall', patch: Partial<EngineConfig> = {}) => sanitize({ ...withEnergy(starterEngine(), type), ...patch });

describe('the two beam thrusters', () => {
  it('are electric sources of their own kind, sharing four propellants', () => {
    for (const t of TYPES) {
      expect(ENERGY_SOURCES[t]).toMatchObject({ kind: 'beam', mixKind: 'none', throttleable: true });
      expect(isBeam(t)).toBe(true);
      expect(isElectric(t)).toBe(true);
      expect(propellantsFor(t)).toEqual(['xenon', 'krypton', 'argon', 'iodine']);
    }
    expect(isBeam('arcjet')).toBe(false);
    expect(propellantsFor('reactor')).not.toContain('xenon');
  });

  it('have no nozzle, one body, and their own spans of voltage and diameter', () => {
    expect(rangesFor('ion').voltage).toMatchObject({ min: 300, max: 5000 });
    expect(rangesFor('hall').voltage).toMatchObject({ min: 100, max: 1000 });
    for (const t of TYPES) {
      expect(rangesFor(t).exitDia).toMatchObject({ min: 0.03, max: 1 });
      const cfg = beam(t, { exhaust: 'aerospike', chambers: 4, exitDia: 7, voltage: 1, extFixedDia: 0.2 });
      expect(cfg).toMatchObject({ exhaust: 'none', chambers: 1, exitDia: 1, extFixedDia: 0, voltage: rangesFor(t).voltage.min });
      expect(sanitize(cfg)).toEqual(cfg);
      expect(beam(t, { exitDia: 0.001 }).exitDia).toBe(0.03);
    }
  });

  it('keep the propellant when the thruster type changes, and through a link-style sanitise', () => {
    const kr = beam('hall', { propellant: 'krypton' });
    expect(kr.propellant).toBe('krypton');
    expect(sanitize({ ...kr, energy: 'ion' }).propellant).toBe('krypton');
    expect(sanitize({ ...kr, propellant: 'kerolox' }).propellant).toBe('xenon');
  });

  it('start as a thruster that runs within its limits in space', () => {
    for (const t of TYPES) {
      const r = simulate(beam(t), space);
      expect(r.failure, t).toBeNull();
      expect(Math.max(r.limits.structural, r.limits.heating, r.limits.instability), t).toBeLessThan(0.8);
      expect(r.thrust, t).toBeGreaterThan(0.02);
      expect(r.thrust, t).toBeLessThan(0.5);
    }
  });
});

describe('the beam formula', () => {
  /** Twenty settings spread over each type's ranges, the same every run. */
  const settings = (type: 'ion' | 'hall') => {
    const r = rangesFor(type);
    const out: EngineConfig[] = [];
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const props = propellantsFor(type);
    for (let i = 0; i < 20; i++) {
      out.push(beam(type, {
        propellant: props[i % 4] as PropellantId,
        powerKW: 0.05 * 2000 ** rnd(),
        voltage: r.voltage.min * (r.voltage.max / r.voltage.min) ** rnd(),
        exitDia: 0.03 * (1 / 0.03) ** rnd(),
      }));
    }
    return out;
  };

  it('keeps thrust, current, flow, speed and efficiency agreeing with each other', () => {
    for (const type of TYPES) {
      for (const cfg of settings(type)) {
        const r = simulate(cfg, space);
        const el = r.electric!;
        const m = BEAM_PROPELLANTS[cfg.propellant as 'xenon'].massU * U;
        const s = beamShares(type, cfg.propellant as 'xenon', cfg.voltage);
        const vNet = cfg.voltage - s.lostVolts;
        const label = `${type} ${cfg.propellant} ${cfg.powerKW.toFixed(2)} kW ${cfg.voltage.toFixed(0)} V`;
        expect(el.power, label).toBeCloseTo(cfg.powerKW * 1000, 6);
        expect(el.voltage, label).toBe(cfg.voltage);
        expect(el.beamCurrent!, label).toBeCloseTo((s.electrical * el.power) / cfg.voltage, 9);
        expect(r.exitVelocity, label).toBeCloseTo(Math.sqrt((2 * E * vNet) / m), 3);
        const thrust = s.beam * el.beamCurrent! * Math.sqrt((2 * m * vNet) / E);
        const flow = (el.beamCurrent! * m) / (E * s.used);
        expect(r.thrust / thrust, label).toBeCloseTo(1, 9);
        expect(r.massFlow / flow, label).toBeCloseTo(1, 9);
        expect(r.isp / (thrust / (flow * G0)), label).toBeCloseTo(1, 9);
        expect(r.ispVacuum).toBe(r.isp);
        expect(el.thrustEfficiency / (thrust ** 2 / (2 * flow * el.power)), label).toBeCloseTo(1, 9);
        expect(el.thrustEfficiency, label).toBeGreaterThan(0);
        expect(el.thrustEfficiency, label).toBeLessThan(1);
        for (const [k, v] of Object.entries(r)) if (typeof v === 'number') expect(Number.isFinite(v), `${label} ${k}`).toBe(true);
        for (const v of Object.values(r.limits)) expect(Number.isFinite(v), label).toBe(true);
      }
    }
  });

  it('trades thrust for exhaust speed as the voltage rises on a fixed power', () => {
    for (const type of TYPES) {
      const lo = simulate(beam(type, { voltage: 400, exitDia: 1 }), space);
      const hi = simulate(beam(type, { voltage: 800, exitDia: 1 }), space);
      expect(hi.isp, type).toBeGreaterThan(1.3 * lo.isp);
      expect(hi.thrust, type).toBeLessThan(lo.thrust);
    }
  });

  it('doubles its thrust and flow on double the power, at the same exhaust speed', () => {
    for (const type of TYPES) {
      const one = simulate(beam(type, { powerKW: 1, exitDia: 1 }), space);
      const two = simulate(beam(type, { powerKW: 2, exitDia: 1 }), space);
      expect(two.thrust / one.thrust, type).toBeCloseTo(2, 9);
      expect(two.massFlow / one.massFlow, type).toBeCloseTo(2, 9);
      expect(two.isp / one.isp, type).toBeCloseTo(1, 9);
    }
  });

  it('throttles by power: half the thrust at the same exhaust speed', () => {
    for (const type of TYPES) {
      const cfg = beam(type);
      const full = simulate(cfg, space);
      const half = simulate(cfg, { altitudeKm: 100, throttle: 0.5 });
      expect(half.thrust / full.thrust, type).toBeCloseTo(0.5, 9);
      expect(half.isp / full.isp, type).toBeCloseTo(1, 9);
      expect(half.electric!.power, type).toBeCloseTo(full.electric!.power / 2, 6);
    }
  });

  it('gives a lighter propellant a faster exhaust and less thrust, with no rule saying so', () => {
    for (const type of TYPES) {
      const by = (propellant: PropellantId) => simulate(beam(type, { propellant, exitDia: 1 }), space);
      const [xe, kr, ar] = [by('xenon'), by('krypton'), by('argon')];
      expect(kr.isp, type).toBeGreaterThan(xe.isp);
      expect(ar.isp, type).toBeGreaterThan(kr.isp);
      expect(kr.thrust, type).toBeLessThan(xe.thrust);
      expect(ar.thrust, type).toBeLessThan(kr.thrust);
    }
    // The formula never asks which propellant it has, only its atom's mass and how hard it is to
    // ionise: iodine, a shade lighter than xenon and easier to ionise, falls where those put it.
    for (const type of TYPES) {
      const xe = simulate(beam(type, { propellant: 'xenon', exitDia: 1 }), space);
      const io = simulate(beam(type, { propellant: 'iodine', exitDia: 1 }), space);
      expect(io.isp / xe.isp, type).toBeGreaterThan(1);
      expect(io.isp / xe.isp, type).toBeLessThan(1.05);
    }
  });

  it('has the four propellants with their atoms', () => {
    expect(BEAM_PROPELLANTS.xenon).toMatchObject({ massU: 131.29, ioniseEV: 12.13 });
    expect(BEAM_PROPELLANTS.krypton).toMatchObject({ massU: 83.8, ioniseEV: 14.0 });
    expect(BEAM_PROPELLANTS.argon).toMatchObject({ massU: 39.95, ioniseEV: 15.76 });
    expect(BEAM_PROPELLANTS.iodine).toMatchObject({ massU: 126.9, ioniseEV: 10.45 });
    for (const p of Object.values(BEAM_PROPELLANTS)) expect(p.colourName.length).toBeGreaterThan(3);
  });
});

describe('where a beam thruster will not run', () => {
  it('needs a vacuum: nothing in air, and no harm done', () => {
    expect(BEAM_VACUUM_PA).toBe(1);
    for (const type of TYPES) {
      for (const altitudeKm of [0, 30, 60, 75]) {
        expect(ambientPressure(altitudeKm * 1000)).toBeGreaterThan(BEAM_VACUUM_PA);
        const r = simulate(beam(type), { altitudeKm, throttle: 1 });
        expect(r.failure, `${type} ${altitudeKm}`).toBe('noVacuum');
        expect(r.thrust).toBe(0);
        expect(r.massFlow).toBe(0);
        expect(r.isp).toBe(0);
        expect(r.electric!.beamCurrent).toBe(0);
      }
      for (const altitudeKm of [86, 100]) expect(simulate(beam(type), { altitudeKm, throttle: 1 }).failure).toBeNull();
    }
    expect(destroys('noVacuum')).toBe(false);
  });

  it('trips a gridded thruster whose grids cannot pass the current', () => {
    const r = simulate(beam('ion', { powerKW: 20, voltage: 300, exitDia: 0.03 }), space);
    expect(r.limits.structural).toBeGreaterThan(1);
    expect(r.failure).toBe('gridOverload');
    expect(destroys('gridOverload')).toBe(false);
    // More voltage lets the same grids pass far more.
    const eased = simulate(beam('ion', { powerKW: 2.3, voltage: 300, exitDia: 0.3 }), space).limits.structural;
    const pulled = simulate(beam('ion', { powerKW: 2.3, voltage: 1200, exitDia: 0.3 }), space).limits.structural;
    expect(pulled).toBeLessThan(eased / 4);
    expect(simulate(beam('ion'), space).limits.heating).toBe(0);
  });

  it('trips a Hall thruster whose channel overheats', () => {
    const r = simulate(beam('hall', { powerKW: 100, exitDia: 0.03 }), space);
    expect(r.limits.heating).toBeGreaterThan(1);
    expect(r.failure).toBe('channelOverheat');
    expect(destroys('channelOverheat')).toBe(false);
    const small = simulate(beam('hall', { exitDia: 0.1 }), space).limits.heating;
    const big = simulate(beam('hall', { exitDia: 0.2 }), space).limits.heating;
    expect(big).toBeCloseTo(small / 4, 9);
    expect(simulate(beam('hall'), space).limits.structural).toBe(0);
  });
});

describe('swapping to and from a beam thruster', () => {
  it('starts each type from a thruster of that kind on xenon', () => {
    expect(beam('ion')).toMatchObject({ propellant: 'xenon', powerKW: 2.3, voltage: 1100, exitDia: 0.3, presetId: null });
    expect(beam('hall')).toMatchObject({ propellant: 'xenon', powerKW: 1.35, voltage: 300, exitDia: 0.1 });
  });

  it('comes back to an engine that burns without breaking it', () => {
    for (const type of TYPES) {
      const back = withEnergy(beam(type), 'combustion');
      expect(back.energy).toBe('combustion');
      expect(back.exhaust).toBe('bell');
      expect(simulate(back, space).failure).toBeNull();
      expect(simulate(withEnergy(beam(type), 'arcjet'), space).failure).toBeNull();
    }
  });

  it('changes propellant without touching the settings', () => {
    const a = beam('ion');
    const b = withPropellant(a, 'krypton');
    expect(b).toMatchObject({ propellant: 'krypton', powerKW: a.powerKW, voltage: a.voltage, exitDia: a.exitDia });
  });
});
