import { sanitize, sanitizeFlight } from '../physics/engine';
import { getPreset } from '../physics/presets';
import { isPropellantId } from '../physics/propellants';
import type { EngineConfig, FlightState } from '../physics/types';

export interface AppState {
  config: EngineConfig;
  flight: FlightState;
}

const VERSION = 'v1';

function toBase64Url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/** Pack the whole setup into a short string for the URL hash. */
export function encodeState(s: AppState): string {
  const c = s.config;
  const packed = [
    c.presetId,
    c.propellant,
    c.chamberDia,
    c.chamberLen,
    c.throatDia,
    c.exitDia,
    c.nozzleLenPct,
    c.wall,
    c.chamberPressureBar,
    c.mixtureRatio,
    c.scale,
    s.flight.altitudeKm,
    s.flight.throttle,
    c.chambers,
    c.extFixedDia,
    c.extDeploy,
  ];
  return `${VERSION}.${toBase64Url(JSON.stringify(packed))}`;
}

/** Unpack a URL hash. Returns null for anything malformed; the result is always in range. */
export function decodeState(hash: string): AppState | null {
  try {
    const text = String(hash ?? '').replace(/^#/, '');
    const dot = text.indexOf('.');
    if (dot < 0 || text.slice(0, dot) !== VERSION) return null;
    const a: unknown = JSON.parse(fromBase64Url(text.slice(dot + 1)));
    // Older links are shorter: 13 entries (one chamber, one-piece nozzle) or 14 (chamber count added).
    if (!Array.isArray(a) || ![13, 14, 16].includes(a.length)) return null;
    const [presetId, propellant, ...nums] = a;
    if (!isPropellantId(propellant)) return null;
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const n = nums as number[];
    const config = sanitize({
      presetId: typeof presetId === 'string' && getPreset(presetId) ? presetId : null,
      propellant,
      chamberDia: n[0],
      chamberLen: n[1],
      throatDia: n[2],
      exitDia: n[3],
      nozzleLenPct: n[4],
      wall: n[5],
      chamberPressureBar: n[6],
      mixtureRatio: n[7],
      scale: n[8],
      chambers: n.length > 11 ? n[11] : 1,
      extFixedDia: n.length > 13 ? n[12] : 0,
      extDeploy: n.length > 13 ? n[13] : 1,
    });
    return { config, flight: sanitizeFlight({ altitudeKm: n[9], throttle: n[10] }) };
  } catch {
    return null;
  }
}
