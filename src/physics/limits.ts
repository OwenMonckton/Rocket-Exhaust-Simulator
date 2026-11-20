import { ENERGY_SOURCES } from './parts';
import type { EngineConfig, Failure, Limits } from './types';

/** Allowable chamber hoop stress, in bar (≈ 300 MPa). */
export const SIGMA_ALLOW_BAR = 3000;
const HEAT_ALLOW = 2.9;
/** The two things that can overheat: the throat, and the reactor core where an engine has one. */
function heatSources(cfg: EngineConfig, pcBar: number, tc: number): { throat: number; core: number } {
  const prop = ENERGY_SOURCES[cfg.energy];
  const wallTemp = tc * (prop.wallHeatFactor ?? 1);
  const throat =
    (Math.pow(pcBar / 100, 0.8) * Math.pow(0.25 / cfg.throatDia, 0.2) * (wallTemp / 3500)) / HEAT_ALLOW;
  const core = prop.coreTempLimit ? tc / prop.coreTempLimit : 0;
  return { throat, core };
}

/** Each limit is a fraction of its allowable: 1 or more means the engine fails. */
export function computeLimits(cfg: EngineConfig, pcBar: number, tc: number): Limits {
  const structural = (pcBar * cfg.chamberDia) / (2 * cfg.wall) / SIGMA_ALLOW_BAR;
  const heat = heatSources(cfg, pcBar, tc);
  const refDia = ENERGY_SOURCES[cfg.energy].instabilityRefDia;
  const instability = Math.pow(cfg.chamberDia / refDia, 1.5) * (0.9 + (0.1 * pcBar) / 70);
  return { structural, heating: Math.max(heat.throat, heat.core), instability };
}

export function failureFor(cfg: EngineConfig, pcBar: number, tc: number): Failure {
  const l = computeLimits(cfg, pcBar, tc);
  if (l.structural >= 1) return 'burst';
  if (l.heating >= 1) {
    const heat = heatSources(cfg, pcBar, tc);
    return heat.core >= heat.throat ? 'meltdown' : 'burnthrough';
  }
  if (l.instability >= 1) return 'instability';
  return null;
}

/** True when the failure tears the engine open; false when the flame simply goes out or never lights. */
export function destroys(f: Failure): boolean {
  return f !== null && f !== 'flameout' && f !== 'inert' && f !== 'unsolved';
}
