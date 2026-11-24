import { pairRange } from './chem/pair';
import { RANGES, sanitize, simulate } from './engine';
import { mixRange, resolveGas } from './gasSource';
import { SIGMA_ALLOW_BAR } from './limits';
import { ENERGY_SOURCES, propellantsFor } from './parts';
import { isPropellantId } from './propellants';
import type { EnergyId, EngineConfig, ExhaustId, PropellantId } from './types';

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** How many thrust cells an engine gets when it is first given an aerospike. */
export const DEFAULT_CELLS = 20;

/** The most of its heat limit a burning engine's thrust cells may run at when it is first given an aerospike. */
const CELL_HEAT = 0.97;

/** Share of its heat limit an engine is brought down to when a new energy source would overheat it. */
const SAFE_HEAT = 0.9;

/** The most of its instability limit an engine's chambers may run at when its cells are merged into bells. */
const SAFE_INSTABILITY = 0.9;

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

/** The chamber length a liquid needs to burn completely in this engine, at its own pressure and area ratio. */
function lStarRefOf(cfg: EngineConfig): number {
  return resolveGas(cfg, cfg.chamberPressureBar, (cfg.exitDia / cfg.throatDia) ** 2).lStarRef;
}

/** Chamber wall (m) that puts an engine at `fraction` of its structural limit. */
export function wallFor(pcBar: number, chamberDia: number, fraction: number): number {
  return (pcBar * chamberDia) / (2 * SIGMA_ALLOW_BAR * fraction);
}

/**
 * The same engine built round a different energy source. The throat, the exit and the chamber
 * pressure stay; the chamber takes the proportions that source usually has, the propellant
 * becomes the source's first (for a combustion chamber, RP-1 and liquid oxygen, worked out by the
 * solver), and the wall is re-sized so the engine is as close to bursting as it was before: no
 * more, no less. Where that would overheat the engine it is turned down: the temperature where
 * that is a setting, the chamber pressure where a flame sets it.
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
  const burns = energy === 'combustion';
  const propellant: PropellantId = burns ? 'calculated' : propellantsFor(energy)[0];
  const parts = { energy, propellant, fuel: burns ? 'rp1' : cfg.fuel, oxidiser: burns ? 'lox' : cfg.oxidiser };
  const mixtureRatio = mixRange({ ...cfg, ...parts }).ofDefault;
  const lStarRef = lStarRefOf({ ...cfg, ...parts, mixtureRatio });
  const shape = chamberShape(cfg.throatDia, source.starter.contraction, source.starter.lStar, lStarRef);
  // Sanitise first: the wall has to follow the chamber the engine really ends up with.
  const shaped = sanitize({ ...cfg, ...parts, mixtureRatio, ...shape });
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
 * The same engine on a different propellant, at that propellant's usual mixture or temperature.
 * Where that would overheat an engine the old propellant did not, it is turned down as a change
 * of energy source is: the temperature where that is a setting, the chamber pressure where a
 * flame sets it.
 */
export function withPropellant(cfg: EngineConfig, propellant: PropellantId): EngineConfig {
  if (cfg.propellant === propellant) return cfg;
  const mixtureRatio = isPropellantId(propellant)
    ? mixRange({ ...sanitize({ ...cfg, propellant }), propellant }).ofDefault
    : cfg.mixtureRatio;
  return settled(sanitize({ ...cfg, propellant, mixtureRatio }), heatLoad(cfg));
}

/**
 * The same combustion engine burning a different fuel or oxidiser, worked out by the solver, at
 * the new pair's most efficient mixture. Turned down like any other change of propellant where
 * the new flame would overheat an engine the old one did not. Any other engine is left alone.
 */
export function withPair(cfg: EngineConfig, part: { fuel?: string; oxidiser?: string }): EngineConfig {
  if (cfg.energy !== 'combustion') return cfg;
  const chosen = sanitize({ ...cfg, ...part, propellant: 'calculated' });
  return settled(sanitize({ ...chosen, mixtureRatio: mixRange(chosen).ofDefault }), heatLoad(cfg));
}

/** An engine on a new propellant, turned down if it now runs hotter than its throat can take. */
function settled(next: EngineConfig, heatBefore: number): EngineConfig {
  return ENERGY_SOURCES[next.energy].mixKind === 'temperature' ? cooled(next, heatBefore) : eased(next, heatBefore);
}

/**
 * The fewest bell chambers an engine's cells fit into: one, unless a single chamber of the same
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
  const burnsInChamber = lStarRefOf(cfg) > 0;
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
 * than a chamber can be, or so wide that it would be unstable when the cells were not): thrust
 * stays about the same either way. It gets `DEFAULT_CELLS` cells unless that would destroy it: fewer where the throats
 * would be smaller than a throat can be, and fewer where a flame would burn through throats
 * that small (small throats are the hardest to keep cool).
 */
export function withExhaust(cfg: EngineConfig, exhaust: ExhaustId): EngineConfig {
  if (cfg.exhaust === exhaust) return cfg;
  const heatBefore = heatLoad(cfg);
  if (exhaust !== 'aerospike') {
    // A wide chamber is an unstable one: more, smaller chambers where the fewest would shake
    // themselves apart. Where even the most would, the fewest stand: that is the physics, not the swap.
    const instability = (c: EngineConfig) => simulate(c, { altitudeKm: 0, throttle: 1 }).limits.instability;
    const calm = Math.max(SAFE_INSTABILITY, instability(cfg));
    const fewest = divided(cfg, exhaust, bellsFor(cfg));
    let merged = fewest;
    for (let bells = fewest.chambers; instability(merged) > calm; ) {
      if (++bells > RANGES.chambers.max) { merged = fewest; break; }
      merged = divided(cfg, exhaust, bells);
    }
    return cooled(merged, heatBefore);
  }
  const smallest = RANGES.throatDia.min;
  let count = Math.max(1, Math.min(DEFAULT_CELLS, Math.floor(cfg.chambers * (cfg.throatDia / smallest) ** 2 + 1e-9)));
  let next = divided(cfg, exhaust, count);
  if (ENERGY_SOURCES[cfg.energy].mixKind !== 'temperature') {
    const limit = Math.max(CELL_HEAT, heatBefore);
    while (count > 1 && heatLoad(next) > limit) next = divided(cfg, exhaust, --count);
  }
  return cooled(next, heatBefore);
}

/**
 * The blank engine the simulator opens on: a mid-sized engine burning RP-1 with liquid oxygen,
 * worked out by the solver, well inside every limit.
 */
export function starterEngine(): EngineConfig {
  const throatDia = 0.2;
  const pcBar = 100;
  const source = ENERGY_SOURCES.combustion;
  const unshaped: EngineConfig = {
    presetId: null,
    energy: 'combustion',
    exhaust: 'bell',
    propellant: 'calculated',
    fuel: 'rp1',
    oxidiser: 'lox',
    chamberDia: 0,
    chamberLen: 0,
    throatDia,
    exitDia: round(throatDia * Math.sqrt(16)),
    nozzleLenPct: 80,
    wall: 0,
    chamberPressureBar: pcBar,
    mixtureRatio: pairRange('rp1', 'lox').ofDefault,
    scale: 1,
    chambers: 1,
    extFixedDia: 0,
    extDeploy: 1,
    coneAngleDeg: 15,
    innerExitDia: 0,
  };
  const shape = chamberShape(throatDia, source.starter.contraction, source.starter.lStar, lStarRefOf(unshaped));
  return sanitize({ ...unshaped, ...shape, wall: round(wallFor(pcBar, shape.chamberDia, 0.5)) });
}
