import { describe, expect, it } from 'vitest';
import { sanitize, simulate } from '../physics/engine';
import { starterEngine, withEnergy } from '../physics/reshape';
import { scaleBarLabel } from '../render/drawUtil';
import { formatLength, formatPower, formatVoltage, hiddenForBeam, mixtureShown, powerShown, pressureLog, roundPressure, voltageShown } from './controls';
import { LIMIT_COPY, TIPS, failureCopy, limitCopy, restartLabel } from './copy';
import { getPreset } from '../physics/presets';
import { beamReadout, delta, fmtFlow, fmtIntoThrust, fmtPush, fmtThrust, gaugesFor, rowsHidden } from './readouts';

const flight = { altitudeKm: 100, throttle: 1 };
const state = (energy: 'combustion' | 'reactor' | 'solid' | 'resistojet' | 'arcjet' | 'ion' | 'hall') => ({ config: withEnergy(starterEngine(), energy), flight });

describe('small figures', () => {
  it('gives lengths under a centimetre in millimetres', () => {
    expect(formatLength(0.0006)).toBe('0.60 mm');
    expect(formatLength(0.006)).toBe('6.00 mm');
    expect(formatLength(0.05)).toBe('5.00 cm');
    expect(formatLength(0.5)).toBe('50.0 cm');
    expect(formatLength(2)).toBe('2.00 m');
  });

  it('gives thrust in the unit that suits its size', () => {
    expect(fmtThrust(0.092)).toBe('92.0 mN');
    expect(fmtThrust(0.2249)).toBe('225 mN');
    expect(fmtThrust(1.25)).toBe('1.25 N');
    expect(fmtThrust(250)).toBe('250 N');
    expect(fmtThrust(4200)).toBe('4.2 kN');
    expect(fmtThrust(845000)).toBe('845 kN');
    expect(fmtThrust(35e6)).toBe('35.00 MN');
  });

  it('gives flow in the unit that suits its size', () => {
    expect(fmtFlow(41e-6)).toBe('41.0 mg/s');
    expect(fmtFlow(0.0032)).toBe('3.20 g/s');
    expect(fmtFlow(12)).toBe('12.0 kg/s');
    expect(fmtFlow(250)).toBe('250 kg/s');
  });

  it('says how much a small thrust would lift', () => {
    expect(fmtPush(845000)).toBe('86 tonnes of push');
    expect(fmtPush(20000)).toBe('2.0 tonnes of push');
    expect(fmtPush(250)).toBe('25 kg of push');
    expect(fmtPush(0.225)).toBe('23 grams of push');
    expect(fmtPush(0.0092)).toBe('0.9 grams of push');
  });

  it('gives power in watts below a kilowatt', () => {
    expect(formatPower(2)).toBe('2.00 kW');
    expect(formatPower(0.35)).toBe('350 W');
    expect(formatPower(25)).toBe('25.0 kW');
  });

  it('labels the scale bar in millimetres when the engine is tiny', () => {
    expect(scaleBarLabel(2)).toBe('2 m');
    expect(scaleBarLabel(0.2)).toBe('20 cm');
    expect(scaleBarLabel(0.005)).toBe('5 mm');
    expect(scaleBarLabel(0.0005)).toBe('0.5 mm');
  });
});

describe('the controls an electrically heated engine shows', () => {
  it('has a power setting and no mixture setting', () => {
    for (const e of ['resistojet', 'arcjet'] as const) {
      expect(powerShown(state(e)), e).toBe(true);
      expect(mixtureShown(state(e)), e).toBe(false);
    }
    for (const e of ['combustion', 'reactor', 'solid'] as const) {
      expect(powerShown(state(e)), e).toBe(false);
      expect(mixtureShown(state(e)), e).toBe(true);
    }
  });

  it('has tips for the new settings', () => {
    expect(TIPS.powerKW.length).toBeGreaterThan(30);
  });
});

describe('the gauges and failures of an electrically heated engine', () => {
  it('shows no instability gauge: nothing burns', () => {
    expect(gaugesFor('arcjet')).toEqual(['structural', 'heating']);
    expect(gaugesFor('resistojet')).toEqual(['structural', 'heating']);
    expect(gaugesFor('combustion')).toEqual(['structural', 'heating', 'instability']);
    expect(gaugesFor('reactor')).toEqual(['structural', 'heating', 'instability']);
  });

  it('says what the heat gauge is watching', () => {
    expect(limitCopy('heating', 'resistojet').tip).toMatch(/heater/);
    expect(limitCopy('heating', 'arcjet').tip).toMatch(/electrodes/);
    expect(limitCopy('heating', 'combustion')).toEqual(LIMIT_COPY.heating);
    expect(limitCopy('structural', 'arcjet')).toEqual(LIMIT_COPY.structural);
  });

  it('names each failure for the engine it happened to', () => {
    expect(failureCopy('meltdown', 'resistojet').title).toBe('Heater burnt out');
    expect(failureCopy('meltdown', 'arcjet').title).toBe('Electrodes eroded');
    expect(failureCopy('meltdown', 'reactor').title).toBe('Reactor core meltdown');
    expect(failureCopy('underpowered', 'resistojet').title).toBe('Not enough power to boil the propellant');
    for (const e of ['resistojet', 'arcjet'] as const) {
      for (const f of ['meltdown', 'underpowered', 'burst', 'burnthrough'] as const) {
        const copy = failureCopy(f, e);
        expect(copy.text, `${e} ${f}`).not.toMatch(/core temperature|mixture ratio|—/);
      }
    }
  });
});

describe('the controls a beam thruster shows', () => {
  const beam = (energy: 'ion' | 'hall') => ({ config: withEnergy(starterEngine(), energy), flight });

  it('has power, voltage and diameter, and none of the parts of an engine', () => {
    for (const e of ['ion', 'hall'] as const) {
      const s = beam(e);
      expect(powerShown(s)).toBe(true);
      expect(voltageShown(s)).toBe(true);
      expect(mixtureShown(s)).toBe(false);
      for (const id of ['exhaust', 'scale', 'chambers', 'chamberDia', 'chamberLen', 'throatDia', 'nozzleLenPct', 'coneAngleDeg', 'innerExitDia', 'plugShare', 'chamberPressureBar', 'mixtureRatio']) {
        expect(hiddenForBeam(id), id).toBe(true);
      }
      for (const id of ['energy', 'propellant', 'exitDia', 'powerKW', 'voltage', 'altitudeKm', 'throttle']) expect(hiddenForBeam(id), id).toBe(false);
    }
    expect(voltageShown(state('arcjet'))).toBe(false);
    expect(voltageShown(state('combustion'))).toBe(false);
  });

  it('has tips for voltage and diameter, and prints a voltage plainly', () => {
    expect(TIPS.voltage.length).toBeGreaterThan(30);
    expect(TIPS.beamDia.length).toBeGreaterThan(30);
    expect(formatVoltage(1100)).toBe('1,100 V');
    expect(formatVoltage(300)).toBe('300 V');
  });
});

describe('what a beam thruster reads out', () => {
  const ion = withEnergy(starterEngine(), 'ion');
  const lit = simulate(ion, flight);

  it('shows one gauge each: the current through the grids, or the heat of the channel', () => {
    expect(gaugesFor('ion')).toEqual(['structural']);
    expect(gaugesFor('hall')).toEqual(['heating']);
    expect(limitCopy('structural', 'ion').label).toBe('Grid current');
    expect(limitCopy('heating', 'hall').label).toBe('Channel heat');
  });

  it('leaves out every figure that belongs to hot gas in a nozzle', () => {
    expect(rowsHidden('ion')).toEqual(['ispBothRow', 'nozzleRow', 'pressRow', 'simRow']);
    expect(rowsHidden('hall')).toEqual(rowsHidden('ion'));
    expect(rowsHidden('arcjet')).toEqual([]);
    expect(rowsHidden('combustion')).toEqual([]);
    const text = Object.values(beamReadout(lit, 'xenon', 1)).join(' | ');
    expect(text).not.toMatch(/bar|Mach|Sea level|Nozzle|chamber| K\b/);
    expect(text).not.toMatch(/NaN|undefined/);
  });

  it('gives its own figures', () => {
    const out = beamReadout(lit, 'xenon', 1);
    expect(out.run).toBe('Running');
    expect(out.power).toMatch(/^2\.30 kW \/ \d+%$/);
    expect(out.volts).toMatch(/^1,100 V \/ 1\.\d\d A$/);
    expect(out.temp).toMatch(/^\d+\.\d km\/s$/);
    expect(out.tempLabel).toBe('Exhaust speed');
    expect(out.exhaust).toBe('Xenon ions');
    expect(out.colour).toBe('Colour: xenon glowing blue-violet.');
    expect(beamReadout(lit, 'argon', 1).colour).toBe('Colour: argon glowing pink-violet.');
  });

  it('says where it stands: off, running up, running, or no use in air', () => {
    expect(beamReadout(lit, 'xenon', 0).run).toBe('Forecast: the thruster is off');
    expect(beamReadout(lit, 'xenon', 0.4).run).toBe('Running up');
    const inAir = simulate(ion, { altitudeKm: 0, throttle: 1 });
    expect(beamReadout(inAir, 'xenon', 0).run).toBe('Will not light in air');
  });

  it('words its failures and its restart for a thruster', () => {
    expect(failureCopy('noVacuum', 'ion').title).toBe('Needs a vacuum');
    expect(failureCopy('gridOverload', 'ion').title).toBe('Grids overloaded');
    expect(failureCopy('channelOverheat', 'hall').title).toBe('Channel overheated');
    expect(restartLabel('ion', 'noVacuum')).toBe('Switch on again');
    expect(restartLabel('arcjet', 'underpowered')).toBe('Restart engine');
    expect(restartLabel('combustion', 'flameout')).toBe('Relight engine');
    expect(restartLabel('combustion', 'burst')).toBe('Rebuild engine');
    expect(restartLabel('reactor', 'meltdown')).toBe('Rebuild engine');
  });
});

describe('final review', () => {
  it('says nothing against a stock figure of nothing, where a percentage would be nonsense', () => {
    expect(delta(0, 0)).toBe('');
    expect(delta(5, 0)).toBe('');
    expect(delta(110, 100)).toBe('+10.0% vs stock');
    expect(delta(100, 100)).toBe('same as stock');
    // The path that showed it: a changed beam example brought down into air, where both thrusts are 0.
    const stock = getPreset('nstar')!.config;
    const changed = sanitize({ ...stock, exitDia: 0.4 });
    const air = { altitudeKm: 10, throttle: 1 };
    expect(delta(simulate(changed, air).thrust, simulate(stock, air).thrust)).toBe('');
  });

  it('spreads a small electric engine\'s chamber pressure by ratio, so a few bar can be set by hand', () => {
    expect(pressureLog(state('arcjet'))).toBe(true);
    expect(pressureLog(state('resistojet'))).toBe(true);
    expect(pressureLog(state('combustion'))).toBe(false);
    expect(pressureLog(state('reactor'))).toBe(false);
    expect(roundPressure(3.7449, state('arcjet'))).toBe(3.7);
    expect(roundPressure(57.3, state('arcjet'))).toBe(57);
    expect(roundPressure(97.4, state('combustion'))).toBe(97);
  });

  it('does not print a share of the power above all of it as a figure', () => {
    expect(fmtIntoThrust(0.334)).toBe('33%');
    expect(fmtIntoThrust(1)).toBe('100%');
    expect(fmtIntoThrust(4.83)).toBe('over 100%');
    expect(fmtIntoThrust(3444969.37)).toBe('over 100%');
  });
});
