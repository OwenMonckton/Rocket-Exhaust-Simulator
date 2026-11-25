import { RANGES, sanitize, sanitizeFlight } from '../physics/engine';
import { ENERGY_SOURCES, isBeam, isEnergyId } from '../physics/parts';
import { getPreset } from '../physics/presets';
import { starterEngine, withEnergy, withExhaust, withPair, withPropellant } from '../physics/reshape';
import type { EnergyId, EngineConfig, ExhaustId, FlightState } from '../physics/types';
import type { AppState } from './share';

export type { AppState };

const SCALED: (keyof EngineConfig)[] = ['chamberDia', 'chamberLen', 'throatDia', 'exitDia', 'wall', 'extFixedDia', 'innerExitDia'];

/** Grow or shrink the whole engine: every dimension, and the wall, by the same factor. */
export function applyScale(cfg: EngineConfig, newScale: number): EngineConfig {
  const target = Math.min(RANGES.scale.max, Math.max(RANGES.scale.min, newScale));
  const k = target / cfg.scale;
  const next = { ...cfg, scale: target };
  for (const key of SCALED) (next[key] as number) = (cfg[key] as number) * k;
  return next;
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/** True when the engine no longer matches the stock preset it started from. */
export function isModified(cfg: EngineConfig): boolean {
  const stock = getPreset(cfg.presetId)?.config;
  if (!stock) return false;
  if (cfg.energy !== stock.energy || cfg.exhaust !== stock.exhaust || cfg.propellant !== stock.propellant) return true;
  if (cfg.fuel !== stock.fuel || cfg.oxidiser !== stock.oxidiser) return true;
  const keys: (keyof EngineConfig)[] = [
    'chamberDia', 'chamberLen', 'throatDia', 'exitDia', 'nozzleLenPct',
    'wall', 'chamberPressureBar', 'mixtureRatio', 'scale', 'chambers', 'extFixedDia', 'extDeploy',
    // What an electric example is set by. Every other example carries the same two figures as its stock.
    'powerKW', 'voltage',
  ];
  return keys.some((k) => !close(cfg[k] as number, stock[k] as number));
}

/**
 * Where an engine just picked stands: a beam thruster only runs in a vacuum, so picking one takes
 * it to the top of the altitude range. Every other engine stays where the last one was.
 */
export function flightFor(config: EngineConfig, flight: FlightState): FlightState {
  return isBeam(config.energy) ? { ...flight, altitudeKm: RANGES.altitudeKm.max } : flight;
}

export function defaultState(): AppState {
  return { config: starterEngine(), flight: { altitudeKm: 0, throttle: 1 } };
}

export interface Store {
  get(): AppState;
  set(patch: { config?: Partial<EngineConfig>; flight?: Partial<FlightState> }): void;
  replace(state: AppState): void;
  loadPreset(id: string): void;
  /** Start again from the blank engine */
  newEngine(): void;
  /** Rebuild the engine round a different energy source */
  setEnergy(id: EnergyId): void;
  /** Swap the exhaust, keeping the engine about as powerful */
  setExhaust(id: ExhaustId): void;
  /** Work the gas out from this fuel (with the current oxidiser), at the pair's own mixture */
  setFuel(id: string): void;
  /** Work the gas out from this oxidiser (with the current fuel), at the pair's own mixture */
  setOxidiser(id: string): void;
  setScale(scale: number): void;
  subscribe(fn: (s: AppState) => void): () => void;
}

export function createStore(initial: AppState): Store {
  let state: AppState = { config: sanitize(initial.config), flight: sanitizeFlight(initial.flight) };
  const listeners = new Set<(s: AppState) => void>();
  const emit = () => listeners.forEach((fn) => fn(state));
  /** Calculate the gas from a changed fuel or oxidiser, starting at the new pair's default mixture. */
  const calculate = (part: Partial<Pick<EngineConfig, 'fuel' | 'oxidiser'>>) => {
    // Only a combustion chamber burns a fuel and oxidiser; any other engine keeps what it has.
    if (state.config.energy !== 'combustion') return;
    state = { config: withPair(state.config, part), flight: state.flight };
    emit();
  };

  return {
    get: () => state,
    set(patch) {
      let config = state.config;
      if (patch.config) {
        // A new propellant starts at its own sensible mixture ratio, turned down if that would overheat the engine.
        const { propellant, ...rest } = patch.config;
        if (propellant && propellant !== config.propellant) config = withPropellant(config, propellant);
        config = sanitize({ ...config, ...rest });
      }
      const flight = patch.flight ? sanitizeFlight({ ...state.flight, ...patch.flight }) : state.flight;
      state = { config, flight };
      emit();
    },
    replace(next) {
      state = { config: sanitize(next.config), flight: sanitizeFlight(next.flight) };
      emit();
    },
    loadPreset(id) {
      const preset = getPreset(id);
      if (!preset) return;
      state = { config: { ...preset.config }, flight: flightFor(preset.config, state.flight) };
      emit();
    },
    newEngine() {
      state = { config: starterEngine(), flight: state.flight };
      emit();
    },
    setEnergy(id) {
      if (!isEnergyId(id)) return;
      const config = sanitize(withEnergy(state.config, id, state.flight.throttle));
      // A source that cannot throttle takes the pressure the engine was throttled down to as its
      // own, so the throttle goes back to full: left where it was, it would be applied a second
      // time on the way back.
      const baked = ENERGY_SOURCES[state.config.energy].throttleable && !ENERGY_SOURCES[id].throttleable;
      state = { config, flight: flightFor(config, baked ? { ...state.flight, throttle: 1 } : state.flight) };
      emit();
    },
    setExhaust(id) {
      state = { config: sanitize(withExhaust(state.config, id)), flight: state.flight };
      emit();
    },
    setFuel: (id) => calculate({ fuel: id }),
    setOxidiser: (id) => calculate({ oxidiser: id }),
    setScale(scale) {
      state = { config: sanitize(applyScale(state.config, scale)), flight: state.flight };
      emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
