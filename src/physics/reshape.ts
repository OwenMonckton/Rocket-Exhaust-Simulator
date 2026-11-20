import { sanitize } from './engine';
import { SIGMA_ALLOW_BAR, computeLimits } from './limits';
import { ENERGY_SOURCES, propellantsFor } from './parts';
import { PROPELLANTS, gasProps } from './propellants';
import type { EnergyId, EngineConfig, ExhaustId } from './types';

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** How many thrust cells an engine gets when it is first given an aerospike. */
export const DEFAULT_CELLS = 20;

/** Share of its heat limit an engine is brought down to when a new energy source would overheat it. */
const SAFE_HEAT = 0.9;

/**
 * Chamber diameter and length for a throat. `contraction` is chamber diameter over throat
 * diameter. `lStar` is the characteristic length in m where a liquid burns in the chamber
 * (`lStarRef` above 0), or the chamber's length as a multiple of its diameter where nothing does.
 */
export function chamberShape(
  throatDia: number,
  contraction: number,
  lStar: number,
  lStarRef: number,
): { chamberDia: number; chamberLen: number } {
  const chamberDia = round(throatDia * contraction);
  const at = (Math.PI / 4) * throatDia ** 2;
  const chamberLen =
    lStarRef === 0 ? round(chamberDia * lStar) : round((lStar * at) / ((Math.PI / 4) * chamberDia ** 2));
  return { chamberDia, chamberLen };
}

/** Chamber wall (m) that puts an engine at `fraction` of its structural limit. */
export function wallFor(pcBar: number, chamberDia: number, fraction: number): number {
  return (pcBar * chamberDia) / (2 * SIGMA_ALLOW_BAR * fraction);
}

/**
 * The same engine built round a different energy source. The throat, the exit and the chamber
 * pressure stay; the chamber takes the proportions that source usually has, the propellant
 * becomes the source's first, and the wall is re-sized so the engine is as close to bursting
 * as it was before: no more, no less.
 */
export function withEnergy(cfg: EngineConfig, energy: EnergyId): EngineConfig {
  if (cfg.energy === energy) return cfg;
  const source = ENERGY_SOURCES[energy];
  const propellant = propellantsFor(energy)[0];
  const prop = PROPELLANTS[propellant];
  const shape = chamberShape(cfg.throatDia, source.starter.contraction, source.starter.lStar, prop.lStarRef);
  // Sanitise first: the wall has to follow the chamber the engine really ends up with.
  const shaped = sanitize({ ...cfg, energy, propellant, mixtureRatio: prop.ofDefault, ...shape });
  let next = sanitize({ ...shaped, wall: (cfg.wall * shaped.chamberDia) / cfg.chamberDia });
  // A source that runs on temperature may be too hot for a throat this size at its usual
  // setting (a salt-water reaction in a small nozzle). Start it as hot as the engine can take.
  if (source.mixKind === 'temperature') {
    const heat = computeLimits(next, next.chamberPressureBar, gasProps(propellant, next.mixtureRatio).tc).heating;
    if (heat > SAFE_HEAT) next = sanitize({ ...next, mixtureRatio: (next.mixtureRatio * SAFE_HEAT) / heat });
  }
  return next;
}

/**
 * The same engine with a different exhaust. An aerospike's dimensions describe one of its
 * thrust cells, so going to one divides the engine into `DEFAULT_CELLS` cells with the same
 * total throat and exit area, and coming back merges them into one chamber: thrust stays about
 * the same either way.
 */
export function withExhaust(cfg: EngineConfig, exhaust: ExhaustId): EngineConfig {
  if (cfg.exhaust === exhaust) return cfg;
  const count = exhaust === 'aerospike' ? DEFAULT_CELLS : 1;
  const k = Math.sqrt(cfg.chambers / count);
  // A chamber a liquid burns in keeps its length, and with it the time the propellant has to burn.
  const burnsInChamber = PROPELLANTS[cfg.propellant].lStarRef > 0;
  return sanitize({
    ...cfg,
    exhaust,
    chambers: count,
    chamberDia: cfg.chamberDia * k,
    chamberLen: burnsInChamber ? cfg.chamberLen : cfg.chamberLen * k,
    throatDia: cfg.throatDia * k,
    exitDia: cfg.exitDia * k,
    wall: cfg.wall * k,
    // A spike has no bell to extend.
    extFixedDia: exhaust === 'aerospike' ? 0 : cfg.extFixedDia,
    extDeploy: exhaust === 'aerospike' ? 1 : cfg.extDeploy,
  });
}

/** The blank engine the simulator opens on: a mid-sized kerolox engine, well inside every limit. */
export function starterEngine(): EngineConfig {
  const throatDia = 0.2;
  const pcBar = 100;
  const source = ENERGY_SOURCES.combustion;
  const shape = chamberShape(throatDia, source.starter.contraction, source.starter.lStar, PROPELLANTS.kerolox.lStarRef);
  return sanitize({
    presetId: null,
    energy: 'combustion',
    exhaust: 'bell',
    propellant: 'kerolox',
    ...shape,
    throatDia,
    exitDia: round(throatDia * Math.sqrt(16)),
    nozzleLenPct: 80,
    wall: round(wallFor(pcBar, shape.chamberDia, 0.5)),
    chamberPressureBar: pcBar,
    mixtureRatio: PROPELLANTS.kerolox.ofDefault,
    scale: 1,
    chambers: 1,
    extFixedDia: 0,
    extDeploy: 1,
  });
}
