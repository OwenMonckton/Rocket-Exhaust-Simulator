import data from './thermo.json';

export const R_UNIVERSAL = 8314.51; // J/(kmol K)

export interface Interval { tMin: number; tMax: number; a: number[]; b: [number, number] }
export interface Species { name: string; elements: Record<string, number>; phase: number; molarMass: number; intervals: Interval[] }
/** A thing that can be put in a tank. `h` is its enthalpy in J/mol at `t` K. */
export interface Reactant { name: string; elements: Record<string, number>; molarMass: number; h: number; t: number }

/** NASA Glenn products within C, H, O, N, F, Cl, B, Li, Al, Be, He, gases first. See THERMO-NOTICE.txt. */
export const SPECIES: Species[] = [...(data.species as unknown as Species[])].sort(
  (x, y) => Number(x.phase !== 0) - Number(y.phase !== 0),
);
export const REACTANTS: Record<string, Reactant> = data.reactants as unknown as Record<string, Reactant>;

/** The interval containing t, or the nearest one when t is outside every range. */
function intervalAt(s: Species, t: number): Interval {
  let best = s.intervals[0];
  let bestGap = Infinity;
  for (const iv of s.intervals) {
    const gap = t < iv.tMin ? iv.tMin - t : t > iv.tMax ? t - iv.tMax : 0;
    if (gap < bestGap) { best = iv; bestGap = gap; }
    if (gap === 0 && t < iv.tMax) break;
  }
  return best;
}

/** Cp/R. */
export function cpR(s: Species, t: number): number {
  const [a1, a2, a3, a4, a5, a6, a7] = intervalAt(s, t).a;
  return a1 / (t * t) + a2 / t + a3 + a4 * t + a5 * t * t + a6 * t ** 3 + a7 * t ** 4;
}

/** H/RT, absolute (includes the heat of formation). */
export function hRT(s: Species, t: number): number {
  const iv = intervalAt(s, t);
  const [a1, a2, a3, a4, a5, a6, a7] = iv.a;
  return -a1 / (t * t) + (a2 * Math.log(t)) / t + a3 + (a4 * t) / 2 + (a5 * t * t) / 3
    + (a6 * t ** 3) / 4 + (a7 * t ** 4) / 5 + iv.b[0] / t;
}

/** S/R at 1 bar. */
export function sR(s: Species, t: number): number {
  const iv = intervalAt(s, t);
  const [a1, a2, a3, a4, a5, a6, a7] = iv.a;
  return -a1 / (2 * t * t) - a2 / t + a3 * Math.log(t) + a4 * t + (a5 * t * t) / 2
    + (a6 * t ** 3) / 3 + (a7 * t ** 4) / 4 + iv.b[1];
}

/** Every product species made only of the given elements (normal-case symbols). */
export function speciesFor(elements: string[]): Species[] {
  const allowed = new Set(elements);
  return SPECIES.filter((s) => Object.keys(s.elements).every((e) => allowed.has(e)));
}
