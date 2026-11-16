import { PROPELLANTS } from './propellants';
import type { EngineConfig, Failure, Limits } from './types';

/** Allowable chamber hoop stress, in bar (≈ 300 MPa). */
export const SIGMA_ALLOW_BAR = 3000;
const HEAT_ALLOW = 2.9;

/** Each limit is a fraction of its allowable: 1 or more means the engine fails. */
export function computeLimits(cfg: EngineConfig, pcBar: number, tc: number): Limits {
  const structural = (pcBar * cfg.chamberDia) / (2 * cfg.wall) / SIGMA_ALLOW_BAR;
  const heating =
    (Math.pow(pcBar / 100, 0.8) * Math.pow(0.25 / cfg.throatDia, 0.2) * (tc / 3500)) / HEAT_ALLOW;
  const refDia = PROPELLANTS[cfg.propellant].instabilityRefDia;
  const instability = Math.pow(cfg.chamberDia / refDia, 1.5) * (0.9 + (0.1 * pcBar) / 70);
  return { structural, heating, instability };
}

export function failureFor(l: Limits): Failure {
  if (l.structural >= 1) return 'burst';
  if (l.heating >= 1) return 'burnthrough';
  if (l.instability >= 1) return 'instability';
  return null;
}
