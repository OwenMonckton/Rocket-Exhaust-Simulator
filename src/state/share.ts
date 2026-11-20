import { sanitize, sanitizeFlight } from '../physics/engine';
import { isEnergyId, isExhaustId } from '../physics/parts';
import { getPreset } from '../physics/presets';
import { PROPELLANTS, isPropellantId } from '../physics/propellants';
import type { EngineConfig, FlightState, PropellantId } from '../physics/types';

export interface AppState {
  config: EngineConfig;
  flight: FlightState;
}

const VERSION = 'v2';

/** What the propellant names in links made before engines had separate parts are called now. */
const OLD_PROPELLANTS: Record<string, PropellantId> = { nuclear: 'ntr-hydrogen' };

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
    c.energy,
    c.exhaust,
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

const allNumbers = (a: unknown[]): a is number[] => a.every((n) => typeof n === 'number' && Number.isFinite(n));

/**
 * The parts and numbers of a link, whichever version wrote it. The numbers are always in the
 * current order: nine of the engine, altitude, throttle, chambers, extension size and travel.
 */
function unpack(version: string, a: unknown[]): { parts: Pick<EngineConfig, 'energy' | 'exhaust' | 'propellant'>; n: number[] } | null {
  if (version === VERSION) {
    if (a.length !== 18) return null;
    const [, energy, exhaust, propellant, ...n] = a;
    if (!isEnergyId(energy) || !isExhaustId(exhaust) || !isPropellantId(propellant) || !allNumbers(n)) return null;
    return { parts: { energy, exhaust, propellant }, n };
  }
  if (version !== 'v1') return null;
  // Links from before engines had separate parts: the propellant said what kind of engine it
  // was, and a flag at the end marked an aerospike. They come in four lengths: 13 entries (one
  // chamber, one-piece nozzle), 14 (chamber count added), 16 (nozzle extension added) and 17
  // (aerospikes added).
  if (![13, 14, 16, 17].includes(a.length)) return null;
  const [, old, ...n] = a;
  const propellant = typeof old === 'string' ? (OLD_PROPELLANTS[old] ?? old) : old;
  if (!isPropellantId(propellant) || !allNumbers(n)) return null;
  const exhaust = n[14] === 1 ? 'aerospike' : 'bell';
  return {
    parts: { energy: PROPELLANTS[propellant].energy, exhaust, propellant },
    n: [...n.slice(0, 11), n.length > 11 ? n[11] : 1, n.length > 13 ? n[12] : 0, n.length > 13 ? n[13] : 1],
  };
}

/** Unpack a URL hash. Returns null for anything malformed; the result is always in range. */
export function decodeState(hash: string): AppState | null {
  try {
    const text = String(hash ?? '').replace(/^#/, '');
    const dot = text.indexOf('.');
    if (dot < 0) return null;
    const a: unknown = JSON.parse(fromBase64Url(text.slice(dot + 1)));
    if (!Array.isArray(a)) return null;
    const link = unpack(text.slice(0, dot), a);
    if (!link) return null;
    const presetId = a[0];
    const n = link.n;
    const config = sanitize({
      presetId: typeof presetId === 'string' && getPreset(presetId) ? presetId : null,
      ...link.parts,
      chamberDia: n[0],
      chamberLen: n[1],
      throatDia: n[2],
      exitDia: n[3],
      nozzleLenPct: n[4],
      wall: n[5],
      chamberPressureBar: n[6],
      mixtureRatio: n[7],
      scale: n[8],
      chambers: n[11],
      extFixedDia: n[12],
      extDeploy: n[13],
    });
    return { config, flight: sanitizeFlight({ altitudeKm: n[9], throttle: n[10] }) };
  } catch {
    return null;
  }
}
