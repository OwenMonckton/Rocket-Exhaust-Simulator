// Quasi-1D isentropic relations for a calorically perfect gas.

/** A/A* for a given Mach number. */
export function areaRatio(mach: number, g: number): number {
  const t = (2 / (g + 1)) * (1 + ((g - 1) / 2) * mach * mach);
  return Math.pow(t, (g + 1) / (2 * (g - 1))) / mach;
}

/** Supersonic Mach number for a given A/A* (>= 1). */
export function machFromAreaRatio(eps: number, g: number): number {
  if (!(eps > 1)) return 1;
  let lo = 1;
  let hi = 2;
  while (areaRatio(hi, g) < eps && hi < 100) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (areaRatio(mid, g) < eps) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Subsonic Mach number for a given A/A* (>= 1), as found upstream of the throat. */
export function subsonicMachFromAreaRatio(eps: number, g: number): number {
  if (!(eps > 1)) return 1;
  let lo = 1e-4;
  let hi = 1;
  for (let i = 0; i < 50; i++) {
    const mid = 0.5 * (lo + hi);
    if (areaRatio(mid, g) > eps) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Static-to-chamber pressure ratio p/Pc at a Mach number. */
export function pressureRatio(mach: number, g: number): number {
  return Math.pow(1 + ((g - 1) / 2) * mach * mach, -g / (g - 1));
}

/** Mach number at which p/Pc equals the given ratio. */
export function machFromPressureRatio(pOverPc: number, g: number): number {
  const r = Math.min(Math.max(pOverPc, 1e-12), 1);
  return Math.sqrt((2 / (g - 1)) * (Math.pow(r, -(g - 1) / g) - 1));
}

/** Characteristic velocity c* in m/s. */
export function cStar(g: number, R: number, tc: number): number {
  const gammaFn = g * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
  return Math.sqrt(g * R * tc) / gammaFn;
}

/** Gas velocity at a Mach number after isentropic expansion from chamber temperature. */
export function exitVelocity(mach: number, g: number, R: number, tc: number): number {
  const t = tc / (1 + ((g - 1) / 2) * mach * mach);
  return mach * Math.sqrt(g * R * t);
}
