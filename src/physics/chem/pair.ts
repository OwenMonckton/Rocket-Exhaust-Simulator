// A fuel and oxidiser's calculated exhaust, fitted to the one-gamma, one-molar-mass gas the rest of
// the simulator uses, with a cache so a slider can be dragged without re-solving.
import { cStar as cStarOf, exitVelocity, machFromAreaRatio, pressureRatio } from '../nozzle';
import { equilibrate, mixtureFrom, type EqState, type Mixture, type Problem } from './equilibrium';
import { mixtureOf, NO_OXIDISER, reactantOf } from './ingredients';
import { rocket, type RocketResult } from './rocket';

/**
 * Share of Isp lost per unit condensed mass fraction of the exhaust, from liquid and solid droplets
 * lagging the gas: about 1% of Isp per 5% aluminium, 4% at 20%. Source: US 8,051,640 B2 (citing AFRPL).
 */
export const DROPLET_LOSS = 0.105;

export interface SolvedGas {
  ok: boolean;
  tc: number; gamma: number; molarMass: number;   // the fitted simple gas
  cStar: number; ispVac: number;                  // solver's own, m/s, droplet loss applied to ispVac
  condensedShare: number;                         // mass fraction at the exit
  exhaust: { name: string; share: number }[];     // exit mole fractions over all species, largest first, at most 6, each ≥ 0.005
}
export interface MixRange { ofMin: number; ofMax: number; ofDefault: number; ofPeak: number }

const R_SIM = 8314.46;        // the universal gas constant as src/physics/propellants.ts has it
const G_LO = 1.01;
const G_HI = 1.67;
const G_FALLBACK_LO = 1.05;
const FIT_EPS_MIN = 3;        // below this area ratio Isp/c* barely depends on gamma (facts.md, "The fit")
const CACHE_LIMIT = 2000;
const EXHAUST_MAX = 6;
const EXHAUST_MIN_SHARE = 0.005;
const RANGE_PC = 70;          // bar
const RANGE_EPS = 40;
const FLAME_OUT_T = 700;      // K, where pairRange puts the ends of a pair's mixtures
const HOLD = 50;              // ofMin and ofMax stay within ofDefault / HOLD and ofDefault × HOLD

const NOT_SETTLED: SolvedGas = {
  ok: false, tc: 0, gamma: 0, molarMass: 0, cStar: 0, ispVac: 0, condensedShare: 0, exhaust: [],
};

/** Vacuum Isp over c* for a simple gas of ratio of specific heats `g` at area ratio `eps`. */
function ispOverCStar(g: number, eps: number): number {
  const mach = machFromAreaRatio(eps, g);
  // With R = 1 and Tc = 1: ve/c* and pe/pc depend on gamma alone.
  return exitVelocity(mach, g, 1, 1) / cStarOf(g, 1, 1) + eps * pressureRatio(mach, g);
}

/**
 * The simple gas that gives `cStar` and vacuum `ispVac` (both m/s) at chamber temperature `tc` and
 * area ratio `eps` in the simulator's maths. Gamma is found by bisection over 1.01–1.67 so that the
 * vacuum Isp over c* matches, clamped to that span; then the molar mass from c* at `tc`. Where the
 * ratio does not pin gamma down (area ratios below 3, or a ratio outside the span), `fallbackGamma`
 * (the solver's throat gamma) is used if given, clamped to 1.05–1.67.
 */
export function fitGas(tc: number, cStar: number, ispVac: number, eps: number, fallbackGamma?: number): { gamma: number; molarMass: number } {
  const target = ispVac / cStar;
  const atLo = ispOverCStar(G_LO, eps);
  const atHi = ispOverCStar(G_HI, eps);
  let gamma: number;
  if (fallbackGamma !== undefined && (eps < FIT_EPS_MIN || !(target <= atLo && target >= atHi))) {
    gamma = Math.min(G_HI, Math.max(G_FALLBACK_LO, fallbackGamma));
  } else if (target >= atLo) {
    gamma = G_LO;
  } else if (target <= atHi) {
    gamma = G_HI;
  } else {
    // The ratio falls as gamma rises.
    let lo = G_LO;
    let hi = G_HI;
    for (let i = 0; i < 50; i++) {
      const mid = 0.5 * (lo + hi);
      if (ispOverCStar(mid, eps) > target) lo = mid;
      else hi = mid;
    }
    gamma = 0.5 * (lo + hi);
  }
  // cStar(g, R, tc) grows as sqrt(R).
  const R = (cStar / cStarOf(gamma, 1, tc)) ** 2;
  return { gamma, molarMass: R_SIM / R };
}

// ---- The cache ----

const results = new Map<string, SolvedGas>();   // oldest first
/** Where a settled result was solved: the mixture figure (O/F, or a fluid's temperature), pressure and area ratio. */
interface At { x: number; p: number; e: number }
const lastOk = new Map<string, { r: RocketResult; at: At }>(); // the last settled result per pair or fluid, to start from
// A warm start is used only from near the point asked for: the mixture figure within 10% (or 0.05
// absolute, for O/F near zero), pressure and area ratio within a factor of 1.5. From further away the
// solve starts cold, so a result never depends on where the user came from.
const NEAR_X = 0.1;
const NEAR_X_ABS = 0.05;
const NEAR_FACTOR = 1.5;
const near = (a: At, b: At) => Math.abs(a.x - b.x) <= Math.max(NEAR_X * Math.abs(b.x), NEAR_X_ABS)
  && Math.max(a.p / b.p, b.p / a.p) <= NEAR_FACTOR && Math.max(a.e / b.e, b.e / a.e) <= NEAR_FACTOR;
const ranges = new Map<string, MixRange>();

export function clearChemCache(): void {
  results.clear();
  lastOk.clear();
  ranges.clear();
}

export function chemCacheSize(): number {
  return results.size;
}

const sig3 = (x: number) => Number(x.toPrecision(3));
const round2 = (x: number) => Math.round(x * 100) / 100;
const usable = (x: number) => Number.isFinite(x) && x >= 0;

/** The rocket result as the simulator's gas, or NOT_SETTLED. */
function toGas(r: RocketResult, eps: number): SolvedGas {
  if (!r.ok) return NOT_SETTLED;
  const ex = r.exit;
  const condensedShare = ex.condensedMassFraction;
  const ispVac = r.ispVac * (1 - DROPLET_LOSS * condensedShare);
  const tc = r.chamber.t;
  const { gamma, molarMass } = fitGas(tc, r.cStar, ispVac, eps, r.throat.gammaS);
  if (![tc, gamma, molarMass, r.cStar, ispVac].every(Number.isFinite)) return NOT_SETTLED;
  let total = 0;
  for (let j = 0; j < ex.moles.length; j++) total += ex.moles[j];
  const exhaust = ex.species
    .map((s, j) => ({ name: s.name, share: ex.moles[j] / total }))
    .filter((e) => e.share >= EXHAUST_MIN_SHARE)
    .sort((x, y) => y.share - x.share)
    .slice(0, EXHAUST_MAX);
  return { ok: true, tc, gamma, molarMass, cStar: r.cStar, ispVac, condensedShare, exhaust };
}

/** A cached solve: `chain` names the pair or fluid whose last settled result is the warm start. */
function cached(key: string, chain: string, at: At, mix: () => Mixture, chamber: (mix: Mixture) => Problem, eps: number): SolvedGas {
  const hit = results.get(key);
  if (hit) return hit;
  const m = mix();
  const problem = chamber(m);
  const last = lastOk.get(chain);
  const from = last && near(last.at, at) ? last.r : undefined;
  let r = rocket(m, problem, eps, from);
  if (!r.ok && from) r = rocket(m, problem, eps); // a warm start far from the answer can fail where a cold one does not
  if (r.ok) lastOk.set(chain, { r, at });
  const gas = toGas(r, eps);
  results.set(key, gas);
  while (results.size > CACHE_LIMIT) results.delete(results.keys().next().value!);
  return gas;
}

/**
 * The fitted gas of `fuel` burning with `oxidiser` at oxidiser-to-fuel mass ratio `of` (ignored with
 * NO_OXIDISER), chamber pressure `pcBar` and area ratio `eps`. Solved at `of` rounded to 0.01 and
 * `pcBar`, `eps` to 3 significant figures, and cached.
 */
export function solvePair(fuel: string, oxidiser: string, of: number, pcBar: number, eps: number): SolvedGas {
  if (!usable(of) || !usable(pcBar) || pcBar === 0 || !Number.isFinite(eps) || !(eps > 1)) return NOT_SETTLED;
  const o = oxidiser === NO_OXIDISER ? 0 : round2(of);
  const p = sig3(pcBar);
  const e = sig3(eps);
  const chain = `pair|${fuel}|${oxidiser}`;
  return cached(`${chain}|${o}|${p}|${e}`, chain, { x: o, p, e }, () => mixtureOf(fuel, oxidiser, o),
    (m) => ({ kind: 'hp', h: m.h0, pBar: p }), e);
}

/**
 * The fitted gas of thermo reactant `reactant` alone, heated to `tK` (rounded to 1 K) at `pcBar` and
 * expanded to area ratio `eps`, as in a nuclear or electrically heated engine. Cached as solvePair is.
 */
export function solveFluid(reactant: string, tK: number, pcBar: number, eps: number): SolvedGas {
  if (!usable(tK) || tK === 0 || !usable(pcBar) || pcBar === 0 || !Number.isFinite(eps) || !(eps > 1)) return NOT_SETTLED;
  const t = Math.round(tK);
  const p = sig3(pcBar);
  const e = sig3(eps);
  const chain = `fluid|${reactant}`;
  return cached(`${chain}|${t}|${p}|${e}`, chain, { x: t, p, e }, () => mixtureFrom([{ reactant: reactantOf(reactant), massFraction: 1 }]),
    () => ({ kind: 'tp', t, pBar: p }), e);
}

// ---- A pair's mixtures ----

const GRID_LO = 0.05;
const GRID_HI = 100;
const GRID_POINTS = 49;
const ISP_SCAN_SHARE = 0.5;   // vacuum Isp is scanned only where the chamber is at least this share of its hottest
const REFINE_TOL = 0.004;     // golden-section stops when the bracket is this wide in O/F
const EDGE_TOL = 0.01;        // the 700 K ends are found to about 1% in O/F

/**
 * The span of mixtures for a pair, at 70 bar and area ratio 40: `ofPeak` gives the hottest chamber,
 * `ofDefault` (to 0.01) the highest vacuum Isp, and `ofMin`, `ofMax` are where the chamber cools to
 * 700 K either side (to about 1%), held within ofDefault/50 and ofDefault × 50. A solve that does not
 * settle counts as colder than 700 K. All zeros with NO_OXIDISER. Cached per pair.
 *
 * Chamber temperatures come from the chamber solve alone; only Isp needs the nozzle, and the nozzle
 * is slow where the chamber is cold (an exit far below 200 K is walked down to it).
 */
export function pairRange(fuel: string, oxidiser: string): MixRange {
  if (oxidiser === NO_OXIDISER) return { ofMin: 0, ofMax: 0, ofDefault: 0, ofPeak: 0 };
  const key = `${fuel}|${oxidiser}`;
  const hit = ranges.get(key);
  if (hit) return hit;
  const flame = (of: number) => { const mix = mixtureOf(fuel, oxidiser, of); return { mix, chamber: { kind: 'hp', h: mix.h0, pBar: RANGE_PC } as Problem }; };

  // Each solve starts from a nearby settled one, and cold if that fails. Only from nearby: a start
  // far away can carry in a condensed species that holds the solve on a false answer (solid
  // gibbsite from an oxygen-rich 312 K state once gave 2009 K where the flame is at 3955 K).
  let warmCh: EqState | undefined;
  const tcAt = (of: number) => {
    const { mix, chamber } = flame(of);
    let st = equilibrate(mix, chamber, undefined, warmCh);
    if (!st.ok && warmCh) st = equilibrate(mix, chamber);
    if (!st.ok) return -Infinity;
    warmCh = st;
    return st.t;
  };
  let warm: RocketResult | undefined;
  const ispAt = (of: number) => {
    const { mix, chamber } = flame(of);
    let r = rocket(mix, chamber, RANGE_EPS, warm);
    if (!r.ok && warm) r = rocket(mix, chamber, RANGE_EPS);
    if (!r.ok) return -Infinity;
    warm = r;
    return r.ispVac * (1 - DROPLET_LOSS * r.exit.condensedMassFraction);
  };

  // Coarse scan, log-spaced: chamber temperature everywhere, Isp where the chamber is hot.
  const grid = Array.from({ length: GRID_POINTS }, (_, k) => GRID_LO * (GRID_HI / GRID_LO) ** (k / (GRID_POINTS - 1)));
  const chambers: (EqState | undefined)[] = [];
  const rockets: (RocketResult | undefined)[] = [];
  const tcs = grid.map((of) => { const t = tcAt(of); chambers.push(Number.isFinite(t) ? warmCh : undefined); return t; });
  const argmax = (v: number[]) => v.reduce((best, x, k) => (x > v[best] ? k : best), 0);
  const kTc = argmax(tcs);
  const hot = ISP_SCAN_SHARE * tcs[kTc];
  const isps = grid.map((of, k) => {
    if (!(tcs[k] >= hot)) { rockets.push(undefined); return -Infinity; }
    const isp = ispAt(of);
    rockets.push(Number.isFinite(isp) ? warm : undefined);
    return isp;
  });
  const kIsp = argmax(isps);
  if (!Number.isFinite(isps[kIsp]) || !Number.isFinite(tcs[kTc])) {
    const none = { ofMin: 0, ofMax: 0, ofDefault: 0, ofPeak: 0 };
    ranges.set(key, none);
    return none;
  }

  /** Golden-section search for the maximum of f between the grid neighbours of point k. */
  const refine = (k: number, f: (of: number) => number) => {
    let a = grid[Math.max(0, k - 1)];
    let b = grid[Math.min(GRID_POINTS - 1, k + 1)];
    const phi = (Math.sqrt(5) - 1) / 2;
    let c = b - phi * (b - a);
    let d = a + phi * (b - a);
    let fc = f(c);
    let fd = f(d);
    while (b - a > REFINE_TOL) {
      if (fc >= fd) { b = d; d = c; fd = fc; c = b - phi * (b - a); fc = f(c); }
      else { a = c; c = d; fc = fd; d = a + phi * (b - a); fd = f(d); }
    }
    return 0.5 * (a + b);
  };
  warm = rockets[kIsp];
  const ofDefault = round2(refine(kIsp, ispAt));
  warmCh = chambers[kTc];
  const ofPeak = refine(kTc, tcAt);
  // The chamber at ofDefault, to start the searches for the ends from.
  warmCh = undefined;
  const tcDefault = tcAt(ofDefault);
  const hotStart = warmCh;

  /** Where the chamber cools to 700 K between ofDefault and the hold `limit`, or the hold. */
  const edge = (limit: number) => {
    warmCh = undefined;
    if (tcAt(limit) >= FLAME_OUT_T) return limit;
    if (!(tcDefault >= FLAME_OUT_T)) return limit;
    let lo = Math.log(ofDefault); // hot side
    let hi = Math.log(limit);     // cold side
    let hotSide = hotStart;
    while (Math.abs(hi - lo) > EDGE_TOL) {
      const mid = 0.5 * (lo + hi);
      warmCh = hotSide; // each probe starts from the hot side's state
      if (tcAt(Math.exp(mid)) >= FLAME_OUT_T) { lo = mid; hotSide = warmCh; }
      else hi = mid;
    }
    return Math.exp(hi);
  };
  const range = { ofMin: edge(ofDefault / HOLD), ofMax: edge(ofDefault * HOLD), ofDefault, ofPeak };
  ranges.set(key, range);
  return range;
}
