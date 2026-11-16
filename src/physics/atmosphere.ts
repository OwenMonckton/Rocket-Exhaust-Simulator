// US Standard Atmosphere 1976, geopotential layers up to 86 km.
const G0 = 9.80665;
const R_AIR = 287.053;
const EARTH_R = 6356766;

// base geopotential height (m), base temperature (K), lapse rate (K/m)
const LAYERS: [number, number, number][] = [
  [0, 288.15, -0.0065],
  [11000, 216.65, 0],
  [20000, 216.65, 0.001],
  [32000, 228.65, 0.0028],
  [47000, 270.65, 0],
  [51000, 270.65, -0.0028],
  [71000, 214.65, -0.002],
];
const TOP_GEOPOTENTIAL = 84852;
export const VACUUM_ALTITUDE_M = 86000;
export const SEA_LEVEL_PRESSURE = 101325;

/** Ambient pressure in Pa at a geometric altitude in metres. Zero at and above 86 km. */
export function ambientPressure(altitudeM: number): number {
  if (!Number.isFinite(altitudeM) || altitudeM <= 0) return SEA_LEVEL_PRESSURE;
  if (altitudeM >= VACUUM_ALTITUDE_M) return 0;
  const h = Math.min((EARTH_R * altitudeM) / (EARTH_R + altitudeM), TOP_GEOPOTENTIAL);
  let p = SEA_LEVEL_PRESSURE;
  for (let i = 0; i < LAYERS.length; i++) {
    const [hb, tb, lapse] = LAYERS[i];
    const top = i + 1 < LAYERS.length ? LAYERS[i + 1][0] : TOP_GEOPOTENTIAL;
    const dh = Math.min(h, top) - hb;
    if (dh <= 0) break;
    if (lapse === 0) {
      p *= Math.exp((-G0 * dh) / (R_AIR * tb));
    } else {
      p *= Math.pow((tb + lapse * dh) / tb, -G0 / (R_AIR * lapse));
    }
  }
  return p;
}
