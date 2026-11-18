// Thrust, propellant flow and efficiency worked out from the simulated gas, to set beside the
// figures the formula model gives.

import { ENGINE_NY } from './engineSim';

const G0 = 9.80665;

export interface SimulatedFigures {
  /** N */
  thrust: number;
  /** kg/s */
  massFlow: number;
  /** s */
  isp: number;
}

export interface ExitConditions {
  gamma: number;
  /** Chamber pressure and outside pressure, Pa */
  pc: number;
  pa: number;
  /** Chamber temperature (K) and the exhaust's gas constant (J/(kg K)) */
  tc: number;
  gasR: number;
  /** How completely the propellant burns in the chamber: the same figure the formula model uses */
  combustionEff: number;
  /** How many identical chambers the engine has; the column describes one */
  chambers: number;
}

/** One column of the engine's grid, and the radius of the wall there, m. */
export interface GridColumn {
  /**
   * The gas (see `EngineSim.readColumns`): density and pressure relative to the gas at rest in
   * the chamber, speeds relative to the matching speed, a cell for each of ENGINE_NY equal steps
   * of radius from the centreline to the wall.
   */
  gas: Float32Array;
  radius: number;
}

/** Gas crossing a column each second, and the thrust that would give were it the exit, in the grid's units. */
function across(column: GridColumn, gamma: number, outside: number): { flow: number; force: number } {
  let flow = 0;
  let force = 0;
  for (let j = 0; j < ENGINE_NY; j++) {
    const rho = column.gas[j * 4];
    if (!(rho > 0)) continue;
    const u = column.gas[j * 4 + 1] / rho;
    const v = column.gas[j * 4 + 2] / rho;
    const p = (gamma - 1) * (column.gas[j * 4 + 3] - 0.5 * rho * (u * u + v * v));
    // Each cell is a ring.
    const area = (2 * Math.PI * (j + 0.5) * column.radius * column.radius) / (ENGINE_NY * ENGINE_NY);
    flow += rho * u * area;
    force += (rho * u * u + p - outside) * area;
  }
  return { flow, force };
}

/**
 * What the engine is doing, from the simulated gas.
 *
 * Thrust is what any engine's is: the momentum the gas carries out through the exit each second,
 * plus the pressure it leaves at over the outside pressure, across the exit's area. That is
 * taken at `exit`, the end of the grid.
 *
 * Propellant flow is taken at `throat`. Everything that leaves went through the throat, and
 * nothing else did. The exit will not do: when the jet has torn off the wall of an over-expanded
 * nozzle, outside air is drawn in and carried out again beside it.
 *
 * The simulation does not burn anything. It is handed gas at chamber pressure and temperature,
 * so it has no way to know how completely the propellant burned. The formula model allows for
 * that by needing more propellant for the same chamber pressure, and the same allowance is made
 * here, so that the two efficiencies differ only by what the simulated flow does differently.
 */
export function simulatedFigures(exit: GridColumn, throat: GridColumn, c: ExitConditions): SimulatedFigures {
  const { force } = across(exit, c.gamma, c.pa / c.pc);
  const { flow } = across(throat, c.gamma, 0);
  const thrust = Math.max(0, c.chambers * force * c.pc);
  // Chamber density times the matching speed is pc / sqrt(R Tc).
  const massFlow = (c.chambers * flow * c.pc) / Math.sqrt(c.gasR * c.tc) / c.combustionEff;
  return { thrust, massFlow, isp: massFlow > 0 ? thrust / (massFlow * G0) : 0 };
}
