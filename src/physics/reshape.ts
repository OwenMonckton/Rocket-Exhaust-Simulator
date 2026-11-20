import { RANGES, sanitize, simulate } from './engine';
import { SIGMA_ALLOW_BAR } from './limits';
import { ENERGY_SOURCES, propellantsFor } from './parts';
import { PROPELLANTS } from './propellants';
import type { EnergyId, EngineConfig, ExhaustId } from './types';

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** How many thrust cells an engine gets when it is first given an aerospike. */
export const DEFAULT_CELLS = 20;

/** The most of its heat limit a burning engine's thrust cells may run at when it is first given an aerospike. */
const CELL_HEAT = 0.97;

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
 * as it was before: no more, no less. Where that would overheat the engine it is turned down:
 * the temperature where that is a setting, the chamber pressure where a flame sets it.
 *
 * `throttle` is where the throttle stands. A source that cannot throttle runs flat out, so an
 * engine throttled down and given one takes the pressure it was really running at as its own:
 * otherwise the swap alone would raise the pressure, and could burst it.
 */
export function withEnergy(cfg: EngineConfig, energy: EnergyId, throttle = 1): EngineConfig {
  if (cfg.energy === energy) return cfg;
  const source = ENERGY_SOURCES[energy];
  if (ENERGY_SOURCES[cfg.energy].throttleable && !source.throttleable && throttle < 1) {
    // Whole bars, as the slider sets them, and never more than it was running at.
    const running = Math.max(RANGES.chamberPressureBar.min, Math.floor(cfg.chamberPressureBar * throttle + 1e-9));
    cfg = { ...cfg, chamberPressureBar: Math.min(cfg.chamberPressureBar, running) };
  }
  const propellant = propellantsFor(energy)[0];
  const prop = PROPELLANTS[propellant];
  const shape = chamberShape(cfg.throatDia, source.starter.contraction, source.starter.lStar, prop.lStarRef);
  // Sanitise first: the wall has to follow the chamber the engine really ends up with.
  const shaped = sanitize({ ...cfg, energy, propellant, mixtureRatio: prop.ofDefault, ...shape });
  const swapped = sanitize({ ...shaped, wall: (cfg.wall * shaped.chamberDia) / cfg.chamberDia });
  // The new source starts at its own usual temperature, so there is no old setting to keep.
  return source.mixKind === 'temperature' ? cooled(swapped, 0) : eased(swapped, heatLoad(cfg));
}

/** How close an engine is to its heat limit: 1 or more and it fails. */
function heatLoad(cfg: EngineConfig): number {
  return simulate(cfg, { altitudeKm: 0, throttle: 1 }).limits.heating;
}

/**
 * An engine whose temperature is a setting (a reactor, a salt-water reaction) may come out of a
 * part swap too hot for its throat: a salt-water reaction in a small nozzle, or in the small
 * throats of an aerospike's cells. Turn it down to as hot as the engine can take, so that
 * swapping a part never destroys the engine by itself. `heatBefore` is how hot the engine ran
 * before the swap: an engine the swap has not made any hotter keeps the setting it was given.
 * A flame's temperature is not a setting, so this leaves a burning engine alone.
 */
function cooled(cfg: EngineConfig, heatBefore: number): EngineConfig {
  if (ENERGY_SOURCES[cfg.energy].mixKind !== 'temperature') return cfg;
  const heat = heatLoad(cfg);
  if (heat <= Math.max(SAFE_HEAT, heatBefore)) return cfg;
  // Rounded down to two figures, so the setting reads as a round number.
  const target = (cfg.mixtureRatio * SAFE_HEAT) / heat;
  const step = Math.pow(10, Math.floor(Math.log10(target)) - 1);
  return sanitize({ ...cfg, mixtureRatio: Math.floor(target / step) * step });
}

/**
 * A flame's temperature is not a setting, so a burning engine that a new energy source has made
 * too hot for its throat (a small, high-pressure reactor turned into a solid motor) runs at a
 * lower chamber pressure instead, with a wall thinned to match, so it is as close to bursting as
 * it was. `heatBefore` is how hot the engine ran before the swap: an engine the swap has not
 * made any hotter keeps its pressure.
 */
function eased(cfg: EngineConfig, heatBefore: number): EngineConfig {
  const limit = Math.max(SAFE_HEAT, heatBefore);
  const heat = heatLoad(cfg);
  if (heat <= limit) return cfg;
  const lowest = RANGES.chamberPressureBar.min;
  // The throat's heating goes as pressure to the power 0.8; whole bars, as the slider sets them.
  let pc = Math.floor(cfg.chamberPressureBar * Math.pow(limit / heat, 1.25));
  for (;;) {
    pc = Math.max(lowest, pc);
    const next = sanitize({ ...cfg, chamberPressureBar: pc, wall: (cfg.wall * pc) / cfg.chamberPressureBar });
    if (pc <= lowest || heatLoad(next) <= limit) return next;
    pc -= 1;
  }
}

/**
 * How many bell chambers an engine's cells merge into: one, unless a single chamber of the same
 * total area would be bigger than a chamber, a throat or a nozzle can be, and then as few as
 * hold it. A spike too big even for the most chambers a bell engine can have gets that many, at
 * their largest size, and is the one merge that loses area.
 */
function bellsFor(cfg: EngineConfig): number {
  const most = RANGES.chambers.max;
  const fits = (dia: number, k: number, max: number) => dia * k <= max * (1 + 1e-9);
  for (let count = 1; count < most; count++) {
    const k = Math.sqrt(cfg.chambers / count);
    if (
      fits(cfg.throatDia, k, RANGES.throatDia.max) &&
      fits(cfg.chamberDia, k, RANGES.chamberDia.max) &&
      fits(cfg.exitDia, k, RANGES.exitDia.max)
    ) {
      return count;
    }
  }
  return most;
}

/** The engine divided into, or merged down to, `count` chambers of the same total throat and exit area. */
function divided(cfg: EngineConfig, exhaust: ExhaustId, count: number): EngineConfig {
  const k = Math.sqrt(cfg.chambers / count);
  // A chamber a liquid burns in keeps its length, and with it the time the propellant has to burn.
  const burnsInChamber = PROPELLANTS[cfg.propellant].lStarRef > 0;
  const shaped = sanitize({
    ...cfg,
    exhaust,
    chambers: count,
    chamberDia: cfg.chamberDia * k,
    chamberLen: burnsInChamber ? cfg.chamberLen : cfg.chamberLen * k,
    throatDia: cfg.throatDia * k,
    exitDia: cfg.exitDia * k,
    // A spike has no bell to extend.
    extFixedDia: exhaust === 'aerospike' ? 0 : cfg.extFixedDia,
    extDeploy: exhaust === 'aerospike' ? 1 : cfg.extDeploy,
  });
  // The wall follows the chamber the engine really ends up with, which keeps it as close to
  // bursting as it was even where a very small chamber has been held at its smallest size.
  return sanitize({ ...shaped, wall: (cfg.wall * shaped.chamberDia) / cfg.chamberDia });
}

/**
 * The same engine with a different exhaust. An aerospike's dimensions describe one of its
 * thrust cells, so going to one divides the engine into cells with the same total throat and
 * exit area, and coming back merges them into one chamber (or more, where one would be bigger
 * than a chamber can be): thrust stays about the same either way. It gets `DEFAULT_CELLS` cells unless that would destroy it: fewer where the throats
 * would be smaller than a throat can be, and fewer where a flame would burn through throats
 * that small (small throats are the hardest to keep cool).
 */
export function withExhaust(cfg: EngineConfig, exhaust: ExhaustId): EngineConfig {
  if (cfg.exhaust === exhaust) return cfg;
  const heatBefore = heatLoad(cfg);
  if (exhaust !== 'aerospike') return cooled(divided(cfg, exhaust, bellsFor(cfg)), heatBefore);
  const smallest = RANGES.throatDia.min;
  let count = Math.max(1, Math.min(DEFAULT_CELLS, Math.floor(cfg.chambers * (cfg.throatDia / smallest) ** 2 + 1e-9)));
  let next = divided(cfg, exhaust, count);
  if (ENERGY_SOURCES[cfg.energy].mixKind !== 'temperature') {
    const limit = Math.max(CELL_HEAT, heatBefore);
    while (count > 1 && heatLoad(next) > limit) next = divided(cfg, exhaust, --count);
  }
  return cooled(next, heatBefore);
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
