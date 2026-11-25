import { describe, expect, it } from 'vitest';
import { sanitize } from '../physics/engine';
import { starterEngine, withEnergy } from '../physics/reshape';
import { scaleBarLabel } from '../render/drawUtil';
import { formatLength, formatPower, mixtureShown, powerShown, pressureStep } from './controls';
import { LIMIT_COPY, TIPS, failureCopy, limitCopy } from './copy';
import { fmtFlow, fmtPush, fmtThrust, gaugesFor } from './readouts';

const flight = { altitudeKm: 100, throttle: 1 };
const state = (energy: 'combustion' | 'reactor' | 'solid' | 'resistojet' | 'arcjet') => ({ config: withEnergy(starterEngine(), energy), flight });

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

  it('steps a low chamber pressure by a tenth of a bar', () => {
    expect(pressureStep(state('arcjet'))).toBe(0.1);
    expect(pressureStep(state('combustion'))).toBe(1);
    const high = { config: sanitize({ ...state('arcjet').config, chamberPressureBar: 60 }), flight };
    expect(pressureStep(high)).toBe(0.1);
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
