// The gas simulation as a whole: one flow, worked out on two grids.
//
// - The engine grid (engineSim.ts) is fitted to the engine's walls and covers the injector
//   face to the nozzle exit.
// - The plume grid (fluidSim.ts) is rectangular and covers everything outside the nozzle.
//
// With both in use they are advanced together, a step at a time on the same clock, and each
// reads the other across the nozzle exit: the plume grid takes the gas arriving from the
// engine grid, and the engine grid's cells just beyond its exit hold whatever the plume grid
// has there. Either can also run alone: the plume from a formula for the gas leaving the
// nozzle, the engine with a set pressure outside.

import { ENGINE_NX, ENGINE_NY, engineStableStep, type EngineSim, type EngineSimInputs } from './engineSim';
import { SIM_NX, SIM_NY, STEPS_PER_FRAME, type FluidSim, type SimInlet, type SimInputs, type SimWall } from './fluidSim';

/**
 * The engine's cells are much smaller than the plume's, so it needs several steps of its own
 * for each of the plume's. This caps how many: beyond it the smallest cells (across the throat)
 * fall behind true time instead, which only shows while the flow is still changing.
 */
const MAX_ENGINE_SUBSTEPS = 2;

export interface PlumeStep {
  inputs: SimInputs;
  /** Whole span of the plume grid, and how much of it lies upstream of the plume's origin, in plume radii */
  span: number;
  upstream: number;
  wall?: SimWall | null;
}

/** How the two grids meet. Lengths are in plume radii (the plume grid's unit) unless they say otherwise. */
export interface GridLink {
  /** Mach number of the flow the plume grid takes its units from */
  mach: number;
  /** One plume radius, m */
  unitRadius: number;
  /**
   * Where the engine grid ends, measured from the plume's origin, and the nozzle's radius
   * there. Normally 0 and 1: the engine grid ends where the plume begins. With a nozzle
   * extension seated, the engine grid carries on through the extension to the true exit while
   * the plume grid stays put, so the two overlap and the plume grid holds the engine grid's
   * gas wherever it lies inside the nozzle.
   */
  exitX: number;
  exitRadius: number;
}

export interface EngineStep {
  inputs: EngineSimInputs;
  /** Left out, the engine grid runs on its own. */
  link?: GridLink;
}

/** Advance the gas by one display frame. */
export function stepGas(plume: FluidSim | null, engine: EngineSim | null, plumeStep: PlumeStep | null, engineStep: EngineStep | null): void {
  const link = plume && engine && plumeStep && engineStep ? engineStep.link : undefined;
  if (engine && engineStep && !link) engine.step(engineStep.inputs);
  if (!plume || !plumeStep) return;

  if (!link) {
    plume.begin(plumeStep.inputs, plumeStep.span, plumeStep.wall, plumeStep.upstream, null);
    plume.advance(STEPS_PER_FRAME, null);
    plume.finish();
    return;
  }

  // The plume grid measures the gas against its state where it leaves the nozzle; the engine
  // grid against its state at rest in the chamber. These factors convert one to the other.
  const inputs = engineStep!.inputs;
  const g = plumeStep.inputs.gamma;
  const temp = 1 / (1 + ((g - 1) / 2) * link.mach ** 2);
  const pressure = Math.pow(temp, g / (g - 1));
  const density = pressure / temp;
  const inlet: SimInlet = {
    texture: engine!.texture,
    columns: ENGINE_NX,
    rows: ENGINE_NY,
    density: 1 / density,
    speed: Math.sqrt(density / pressure),
    pressure: 1 / pressure,
    coldTemp: inputs.restTemp / temp,
    exitX: link.exitX,
    columnsPerRadius: (link.unitRadius * ENGINE_NX) / inputs.length,
  };
  const dt = plume.begin(plumeStep.inputs, plumeStep.span, plumeStep.wall, plumeStep.upstream, inlet);
  engine!.begin(inputs, {
    columns: SIM_NX,
    rows: SIM_NY,
    cell: plumeStep.span / SIM_NX,
    upstream: plumeStep.upstream,
    unitRadius: link.unitRadius,
    exitX: link.exitX,
    exitRadius: link.exitRadius,
    density,
    speed: 1 / inlet.speed,
    pressure,
  });
  // The same stretch of time, in the engine grid's units.
  const engineDt = dt * link.unitRadius * inlet.speed;
  const substeps = Math.min(MAX_ENGINE_SUBSTEPS, Math.max(1, Math.ceil(engineDt / engineStableStep(inputs))));
  for (let n = 0; n < STEPS_PER_FRAME; n++) {
    engine!.advance(engineDt / substeps, substeps, plume.texture);
    plume.advance(1, engine!.texture);
  }
  engine!.finish();
  plume.finish();
}
