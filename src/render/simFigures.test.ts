import { describe, expect, it } from 'vitest';
import { cStar, exitVelocity, pressureRatio } from '../physics/nozzle';
import { ENGINE_NY } from './engineSim';
import { simulatedFigures, type ExitConditions } from './simFigures';

const G0 = 9.80665;

/** A column of the engine's grid holding the same gas all the way across: (density, speed along, speed outward, pressure). */
function column(rho: number, u: number, v: number, p: number, gamma: number): Float32Array {
  const gas = new Float32Array(ENGINE_NY * 4);
  for (let j = 0; j < ENGINE_NY; j++) {
    gas.set([rho, rho * u, rho * v, p / (gamma - 1) + 0.5 * rho * (u * u + v * v)], j * 4);
  }
  return gas;
}

/** The gas an ideal nozzle would have at a Mach number, in the grid's units. */
function ideal(mach: number, gamma: number): Float32Array {
  const temp = 1 / (1 + ((gamma - 1) / 2) * mach * mach);
  const p = Math.pow(temp, gamma / (gamma - 1));
  return column(p / temp, mach * Math.sqrt(gamma * temp), 0, p, gamma);
}

const conditions: ExitConditions = {
  gamma: 1.2,
  pc: 100e5,
  pa: 101325,
  tc: 3500,
  gasR: 380,
  combustionEff: 1,
  chambers: 1,
};
const throatR = 0.1;
const exitR = 0.4;
const exitMach = 3.6;

describe('figures from the simulated gas', () => {
  it('agree with the textbook when the gas is the textbook gas', () => {
    const g = conditions.gamma;
    const figs = simulatedFigures(
      { gas: ideal(exitMach, g), radius: exitR },
      { gas: ideal(1, g), radius: throatR },
      conditions,
    );
    // Flow: chamber pressure times throat area over the characteristic velocity.
    const flow = (conditions.pc * Math.PI * throatR ** 2) / cStar(g, conditions.gasR, conditions.tc);
    expect(figs.massFlow / flow).toBeCloseTo(1, 6);
    // Thrust: momentum out of the exit, plus the pressure left over across its area. The exit
    // column here carries its own flow, which need not match the throat's.
    const ve = exitVelocity(exitMach, g, conditions.gasR, conditions.tc);
    const pe = conditions.pc * pressureRatio(exitMach, g);
    const exitDensity = pe / (conditions.gasR * (conditions.tc / (1 + ((g - 1) / 2) * exitMach ** 2)));
    const area = Math.PI * exitR ** 2;
    const thrust = exitDensity * ve * ve * area + (pe - conditions.pa) * area;
    expect(figs.thrust / thrust).toBeCloseTo(1, 6);
    expect(figs.isp).toBeCloseTo(figs.thrust / (figs.massFlow * G0), 9);
  });

  it('count every chamber, and need more propellant where it burns less completely', () => {
    const g = conditions.gamma;
    const exit = { gas: ideal(exitMach, g), radius: exitR };
    const throat = { gas: ideal(1, g), radius: throatR };
    const one = simulatedFigures(exit, throat, conditions);
    const four = simulatedFigures(exit, throat, { ...conditions, chambers: 4 });
    expect(four.thrust / one.thrust).toBeCloseTo(4, 9);
    expect(four.massFlow / one.massFlow).toBeCloseTo(4, 9);
    expect(four.isp).toBeCloseTo(one.isp, 9);
    // The same thrust for more propellant: thrust depends on chamber pressure, not on how it was reached.
    const poor = simulatedFigures(exit, throat, { ...conditions, combustionEff: 0.9 });
    expect(poor.thrust).toBeCloseTo(one.thrust, 6);
    expect(poor.massFlow / one.massFlow).toBeCloseTo(1 / 0.9, 9);
    expect(poor.isp / one.isp).toBeCloseTo(0.9, 9);
  });

  it('take propellant flow from the throat, so air carried through the exit is not counted', () => {
    const g = conditions.gamma;
    const throat = { gas: ideal(1, g), radius: throatR };
    const clean = simulatedFigures({ gas: ideal(exitMach, g), radius: exitR }, throat, conditions);
    // A separated nozzle: the outer half of the exit is dense outside air drifting out.
    const mixed = ideal(exitMach, g);
    const air = column(0.5, 0.05, 0, conditions.pa / conditions.pc, g);
    mixed.set(air.subarray((ENGINE_NY / 2) * 4), (ENGINE_NY / 2) * 4);
    const separated = simulatedFigures({ gas: mixed, radius: exitR }, throat, conditions);
    expect(separated.massFlow).toBeCloseTo(clean.massFlow, 9);
    expect(separated.thrust).toBeLessThan(clean.thrust);
    expect(separated.thrust).toBeGreaterThan(0);
  });

  it('push less against more outside pressure, and never report a pull', () => {
    const g = conditions.gamma;
    const exit = { gas: ideal(exitMach, g), radius: exitR };
    const throat = { gas: ideal(1, g), radius: throatR };
    const vacuum = simulatedFigures(exit, throat, { ...conditions, pa: 0 });
    const ground = simulatedFigures(exit, throat, conditions);
    expect((vacuum.thrust - ground.thrust) / (conditions.pa * Math.PI * exitR ** 2)).toBeCloseTo(1, 6);
    expect(vacuum.massFlow).toBeCloseTo(ground.massFlow, 9);
    expect(simulatedFigures(exit, throat, { ...conditions, pa: 50 * conditions.pc }).thrust).toBe(0);
    // Nothing flowing: no thrust, no flow, and no division by zero.
    const still = { gas: new Float32Array(ENGINE_NY * 4), radius: exitR };
    expect(simulatedFigures(still, still, { ...conditions, pa: 0 })).toEqual({ thrust: 0, massFlow: 0, isp: 0 });
  });
});
