import { RANGES, sanitize, sanitizeFlight } from '../physics/engine';
import { DEFAULT_PRESET_ID, getPreset } from '../physics/presets';
import { PROPELLANTS } from '../physics/propellants';
import type { EngineConfig, FlightState } from '../physics/types';
import type { AppState } from './share';

export type { AppState };

const SCALED: (keyof EngineConfig)[] = ['chamberDia', 'chamberLen', 'throatDia', 'exitDia', 'wall', 'extFixedDia'];

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
  const keys: (keyof EngineConfig)[] = [
    'chamberDia', 'chamberLen', 'throatDia', 'exitDia', 'nozzleLenPct',
    'wall', 'chamberPressureBar', 'mixtureRatio', 'scale', 'chambers', 'extFixedDia', 'extDeploy',
  ];
  return keys.some((k) => !close(cfg[k] as number, stock[k] as number));
}

export function defaultState(): AppState {
  return { config: { ...getPreset(DEFAULT_PRESET_ID)!.config }, flight: { altitudeKm: 0, throttle: 1 } };
}

export interface Store {
  get(): AppState;
  set(patch: { config?: Partial<EngineConfig>; flight?: Partial<FlightState> }): void;
  replace(state: AppState): void;
  loadPreset(id: string): void;
  setScale(scale: number): void;
  subscribe(fn: (s: AppState) => void): () => void;
}

export function createStore(initial: AppState): Store {
  let state: AppState = { config: sanitize(initial.config), flight: sanitizeFlight(initial.flight) };
  const listeners = new Set<(s: AppState) => void>();
  const emit = () => listeners.forEach((fn) => fn(state));

  return {
    get: () => state,
    set(patch) {
      let config = state.config;
      if (patch.config) {
        const merged = { ...config, ...patch.config };
        // A new propellant starts at its own sensible mixture ratio.
        if (patch.config.propellant && patch.config.propellant !== config.propellant) {
          merged.mixtureRatio = PROPELLANTS[patch.config.propellant]?.ofDefault ?? merged.mixtureRatio;
        }
        config = sanitize(merged);
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
      state = { config: { ...preset.config }, flight: state.flight };
      emit();
    },
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
