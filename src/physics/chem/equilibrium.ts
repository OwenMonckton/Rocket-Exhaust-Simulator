// Chemical equilibrium by minimising Gibbs energy, after NASA RP-1311 (Gordon & McBride), chapters 2-3.
// Equation numbers in comments are RP-1311's. Amounts are kmol per kg of mixture throughout.
import { R_UNIVERSAL as R, cpR, hRT, sR, speciesFor, type Reactant, type Species } from './thermo';

export interface Mixture { b0: Record<string, number>; h0: number } // kmol of atoms per kg; J/kg
export type Problem =
  | { kind: 'tp'; t: number; pBar: number }
  | { kind: 'hp'; h: number; pBar: number }
  | { kind: 'sp'; s: number; pBar: number }; // s in J/(kg K)
export interface EqState {
  ok: boolean;              // false: did not settle; no other field may be shown
  belowFloor: boolean;      // settled, but colder than the data covers (ok is then false): for rocket's cold exit only
  t: number; pBar: number;
  n: number;                // kmol of gas per kg
  species: Species[]; moles: Float64Array; // kmol per kg, same order
  lnMoles: Float64Array;    // ln of each gas's moles, kept even where `moles` is counted as zero (unused for condensed)
  h: number; s: number;     // J/kg, J/(kg K)
  molarMass: number;        // 1/n
  cp: number; gammaS: number; dlnVdlnT: number; dlnVdlnP: number;
  condensedMassFraction: number;
  iterations: number;
}

/** Atoms and enthalpy per kg of a mixture of reactants given by mass fraction. */
export function mixtureFrom(parts: { reactant: Reactant; massFraction: number }[]): Mixture {
  const b0: Record<string, number> = {};
  let h0 = 0;
  for (const { reactant: r, massFraction: w } of parts) {
    for (const [el, a] of Object.entries(r.elements)) b0[el] = (b0[el] ?? 0) + (a * w) / r.molarMass;
    h0 += (1000 * w * r.h) / r.molarMass;
  }
  return { b0, h0 };
}

const ZERO = 18.420681;      // a gas with ln(n_j/n) at or below -ZERO counts as zero moles (3.1)
const REENTRY = 9.2103404;   // a zeroed gas may grow back at most to ln(n_j/n) = -REENTRY per step (3.2)
const TOL = 0.5e-5;          // convergence (3.5)
const T_TOL = 1e-4;
const BALANCE_TOL = 1e-6;
const LIMIT = 100;           // iterations per attempt
const RESTARTS = 2;          // singular-matrix restarts
const RESTART_MOLES = 1e-6;
const CONDENSED_CHANGES = 50; // condensed species added, removed or swapped per point before giving up
// The lowest temperature NASA's data covers (no gas's fit starts below 200 K). Below it no condensed
// species' range holds T, so none can join, and a gas-only state "settles" on extrapolated fits
// (a beryllium-rich flame once came out at 86 K). Such a state is not an answer: ok is false.
export const T_FLOOR = 200;

/**
 * Gaussian elimination with partial pivoting on the m x (m + nr) row-major matrix g; the solutions
 * replace the right-hand-side columns. Returns false on a zero (or non-finite) pivot.
 */
function solve(g: Float64Array, m: number, nr: number): boolean {
  const w = m + nr;
  for (let c = 0; c < m; c++) {
    let p = c;
    let best = Math.abs(g[c * w + c]);
    for (let r = c + 1; r < m; r++) {
      const v = Math.abs(g[r * w + c]);
      if (v > best) { best = v; p = r; }
    }
    if (!(best > 0) || !Number.isFinite(best)) return false;
    if (p !== c) {
      for (let k = c; k < w; k++) { const t = g[c * w + k]; g[c * w + k] = g[p * w + k]; g[p * w + k] = t; }
    }
    const inv = 1 / g[c * w + c];
    for (let r = c + 1; r < m; r++) {
      const f = g[r * w + c] * inv;
      if (f === 0) continue;
      for (let k = c; k < w; k++) g[r * w + k] -= f * g[c * w + k];
    }
  }
  for (let q = m; q < w; q++) {
    for (let r = m - 1; r >= 0; r--) {
      let v = g[r * w + q];
      for (let k = r + 1; k < m; k++) v -= g[r * w + k] * g[k * w + q];
      g[r * w + q] = v / g[r * w + r];
    }
  }
  return true;
}

/**
 * Equilibrium make-up of `mix` under `problem`. `species` defaults to every product of the elements
 * present; species containing an absent element are dropped. Liquid and solid products join and leave
 * the mixture as RP-1311 section 3.7 describes.
 */
export function equilibrate(mix: Mixture, problem: Problem, species?: Species[], start?: EqState): EqState {
  // Elements present, and the species made only of them.
  const elements = Object.keys(mix.b0).filter((e) => mix.b0[e] > 0);
  const present = new Set(elements);
  const list = (species ?? speciesFor(elements)).filter((s) => Object.keys(s.elements).every((e) => present.has(e)));
  const L = elements.length;
  const NS = list.length;
  const gas: number[] = [];
  const cond: number[] = [];
  list.forEach((s, j) => { (s.phase === 0 ? gas : cond).push(j); });

  // Work arrays, once per call.
  const a = new Float64Array(L * NS); // a[i * NS + j]: atoms of element i in species j
  for (let j = 0; j < NS; j++) for (let i = 0; i < L; i++) a[i * NS + j] = list[j].elements[elements[i]] ?? 0;
  const b0 = Float64Array.from(elements, (e) => mix.b0[e]);
  const b0max = Math.max(0, ...b0);
  const H = new Float64Array(NS);   // H°/RT
  const C = new Float64Array(NS);   // Cp°/R
  const S0 = new Float64Array(NS);  // S°/R at 1 bar
  const mu = new Float64Array(NS);  // μ/RT
  const dln = new Float64Array(NS); // Δln n_j
  const moles = new Float64Array(NS);
  const lnMoles = new Float64Array(NS);
  const pi = new Float64Array(L);   // π_i from the latest solve
  // Phases of one substance share a formula.
  const formula = new Map<number, string>();
  for (const j of cond) formula.set(j, elements.map((e) => list[j].elements[e] ?? 0).join(','));
  /**
   * Whether T lies in the species' own fitted range. The coldest phase of a substance holds down to
   * the 200 K floor: most of NASA's solids, like most of its gases, start at 300 K, and the gases are
   * already extrapolated below that; a solid deleted there would force the metal into gas.
   */
  const covers = (j: number, temp: number) => {
    const iv = list[j].intervals;
    if (temp > iv[iv.length - 1].tMax) return false;
    if (iv[0].tMin <= temp) return true;
    if (temp < T_FLOOR) return false;
    const f = formula.get(j);
    return !cond.some((x) => x !== j && formula.get(x) === f && list[x].intervals[0].tMin < iv[0].tMin);
  };

  // Unknowns: π_i (0..L-1), Δn_j of each active condensed species (in `active` order), Δln n, then
  // Δln T unless T is given. Rows are in the same order.
  const active: number[] = [];
  const fixedT = problem.kind === 'tp';
  const g = new Float64Array((L + cond.length + 2) * (L + cond.length + 4)); // big enough for every matrix

  const lnP = Math.log(problem.pBar);
  let t = problem.kind === 'tp' ? problem.t : 3800;
  let n = 0.1;

  // Start (3.6): cold, or from a previous point (with the condensed species it held).
  const sameList = start !== undefined && start.species.length === NS && start.species.every((s, j) => s === list[j]);
  const fromStart = start === undefined ? undefined
    : sameList ? (j: number) => j
    : (() => { const at = new Map(start.species.map((s, k) => [s.name, k])); return (j: number) => at.get(list[j].name); })();
  if (start && fromStart) {
    if (!fixedT) t = start.t;
    n = start.n;
    for (let j = 0; j < NS; j++) {
      const k = fromStart(j);
      if (list[j].phase === 0) lnMoles[j] = k === undefined ? Math.log(RESTART_MOLES) : start.lnMoles[k];
      else if (k !== undefined && start.moles[k] > 0) { moles[j] = start.moles[k]; active.push(j); }
    }
    // At an assigned temperature two phases of one substance would make the matrix singular: a pair
    // carried over from a melting point becomes the one phase whose range holds T.
    if (fixedT) {
      for (const j of [...active]) {
        const pair = active.filter((x) => formula.get(x) === formula.get(j));
        if (pair.length < 2) continue;
        const keep = pair.find((x) => covers(x, t)) ?? pair[0];
        for (const x of pair) if (x !== keep) { moles[keep] += moles[x]; moles[x] = 0; active.splice(active.indexOf(x), 1); }
      }
    }
  } else {
    for (const j of gas) lnMoles[j] = Math.log(0.1 / gas.length);
  }
  const lnN0 = Math.log(n);
  for (const j of gas) moles[j] = lnMoles[j] - lnN0 > -ZERO ? Math.exp(lnMoles[j]) : 0;

  function evaluate(temp: number) {
    for (const j of gas) {
      H[j] = hRT(list[j], temp);
      C[j] = cpR(list[j], temp);
      S0[j] = sR(list[j], temp);
    }
    for (const j of active) {
      H[j] = hRT(list[j], temp);
      C[j] = cpR(list[j], temp);
      S0[j] = sR(list[j], temp);
    }
  }

  let iterations = 0;
  let restarts = 0;

  /** Newton iterations (2.24-2.28) with the current condensed species; true once settled. */
  function converge(): boolean {
    const nc = active.length;
    const iN = L + nc;
    const iT = iN + 1;
    const m = fixedT ? iN + 1 : iT + 1;
    const w = m + 1;
    attempts: for (;;) {
      for (let it = 1; it <= LIMIT; it++) {
        iterations++;
        evaluate(t);
        const lnn = Math.log(n);
        g.fill(0, 0, m * w);
        let sumN = 0, sumNH = 0, sumNC = 0, sumNHH = 0, sumNS = 0, sumNHS = 0, sumNMu = 0, sumNHMu = 0, sumNSMu = 0;
        for (const j of gas) {
          const lx = lnMoles[j] - lnn + lnP;
          mu[j] = H[j] - S0[j] + lx;
          const nj = moles[j];
          if (nj === 0) continue;
          const hj = H[j], sj = S0[j] - lx, mj = mu[j];
          for (let k = 0; k < L; k++) {
            const akj = a[k * NS + j];
            if (akj === 0) continue;
            const row = k * w, t1 = akj * nj;
            for (let i = 0; i < L; i++) g[row + i] += t1 * a[i * NS + j];       // 2.24
            g[row + iN] += t1;
            if (!fixedT) {
              g[row + iT] += t1 * hj;
              g[iT * w + k] += problem.kind === 'hp' ? t1 * hj : t1 * sj;    // 2.27 / 2.28
            }
            g[iN * w + k] += t1;                                              // 2.26
            g[row + m] += t1 * mj;
          }
          sumN += nj; sumNH += nj * hj; sumNC += nj * C[j]; sumNHH += nj * hj * hj;
          sumNS += nj * sj; sumNHS += nj * hj * sj;
          sumNMu += nj * mj; sumNHMu += nj * hj * mj; sumNSMu += nj * sj * mj;
        }
        // Condensed species: their columns in the element and energy rows, and their own rows (2.25).
        let sumCN = 0, sumCH = 0, sumCC = 0, sumCS = 0;
        for (let c = 0; c < nc; c++) {
          const j = active[c], col = L + c, row = col * w;
          mu[j] = H[j] - S0[j];
          for (let i = 0; i < L; i++) { const aij = a[i * NS + j]; g[i * w + col] = aij; g[row + i] = aij; }
          if (!fixedT) {
            g[row + iT] = H[j];
            g[iT * w + col] = problem.kind === 'hp' ? H[j] : S0[j];
          }
          g[row + m] = mu[j];
          const nj = moles[j];
          sumCN += nj; sumCH += nj * H[j]; sumCC += nj * C[j]; sumCS += nj * S0[j];
        }
        let balance = 0;
        for (let k = 0; k < L; k++) {
          let bk = g[k * w + iN];
          for (const j of active) bk += a[k * NS + j] * moles[j];
          g[k * w + m] += b0[k] - bk;
          balance = Math.max(balance, Math.abs(b0[k] - bk));
        }
        g[iN * w + iN] = sumN - n;
        g[iN * w + m] = n - sumN + sumNMu;
        if (!fixedT) {
          g[iN * w + iT] = sumNH;
          if (problem.kind === 'hp') {
            g[iT * w + iN] = sumNH;
            g[iT * w + iT] = sumNC + sumCC + sumNHH;
            g[iT * w + m] = problem.h / (R * t) - sumNH - sumCH + sumNHMu;
          } else {
            g[iT * w + iN] = sumNS;
            g[iT * w + iT] = sumNC + sumCC + sumNHS;
            g[iT * w + m] = problem.s / R - sumNS - sumCS + n - sumN + sumNSMu;
          }
        }

        if (!solve(g, m, 1)) {
          if (restarts >= RESTARTS) return false;
          restarts++;
          for (const j of gas) if (moles[j] === 0) { moles[j] = RESTART_MOLES; lnMoles[j] = Math.log(RESTART_MOLES); }
          continue attempts;
        }

        // Corrections (2.18) and damping (3.1-3.3).
        const dlnn = g[iN * w + m];
        const dlnT = fixedT ? 0 : g[iT * w + m];
        for (let i = 0; i < L; i++) pi[i] = g[i * w + m];
        let big = Math.max(5 * Math.abs(dlnT), 5 * Math.abs(dlnn));
        let lambda2 = 1;
        for (const j of gas) {
          let d = dlnn + H[j] * dlnT - mu[j];
          for (let i = 0; i < L; i++) { const aij = a[i * NS + j]; if (aij !== 0) d += aij * pi[i]; }
          dln[j] = d;
          const lr = lnMoles[j] - lnn;
          if (lr > -ZERO) big = Math.max(big, Math.abs(d));
          else if (d >= 0) lambda2 = Math.min(lambda2, Math.abs((-lr - REENTRY) / (d - dlnn)));
        }
        const lambda = Math.min(1, big > 0 ? 2 / big : 1, lambda2);

        // Convergence (3.5), judged on this iteration's corrections, relative to all the moles.
        const sumAll = sumN + sumCN;
        let settled = sumAll > 0 && (n * Math.abs(dlnn)) / sumAll <= TOL && Math.abs(dlnT) <= T_TOL
          && balance <= BALANCE_TOL * b0max;
        if (settled) for (const j of gas) if ((moles[j] * Math.abs(dln[j])) / sumAll > TOL) { settled = false; break; }
        if (settled) for (let c = 0; c < nc; c++) if (Math.abs(g[(L + c) * w + m]) / sumAll > TOL) { settled = false; break; }

        n = Math.exp(lnn + lambda * dlnn);
        if (!fixedT) t = Math.exp(Math.log(t) + lambda * dlnT);
        const lnn2 = Math.log(n);
        for (const j of gas) {
          lnMoles[j] += lambda * dln[j];
          moles[j] = lnMoles[j] - lnn2 > -ZERO ? Math.exp(lnMoles[j]) : 0;
        }
        for (let c = 0; c < nc; c++) moles[active[c]] += lambda * g[(L + c) * w + m];
        if (settled && Number.isFinite(t) && Number.isFinite(n)) return true;
      }
      return false;
    }
  }

  // Condensed species (3.7): converge; then remove any with negative moles, or swap a phase whose
  // range no longer holds T, or add the one that most lowers the Gibbs energy; re-converge after each.
  // When a swap would undo the previous swap of that substance, the point sits on its melting point:
  // in HP and SP both phases are kept, and their two condensed rows (2.25) hold T where their Gibbs
  // energies meet, the boundary of their ranges, while the energy row sets the split. A phase that
  // then goes negative is removed as usual, leaving the other.
  const lastSwap = new Map<string, [number, number]>(); // formula -> [from, to]
  let ok = false;
  for (let change = 0; change <= CONDENSED_CHANGES; change++) {
    if (!converge()) break;
    const negative = active.filter((j) => moles[j] < 0);
    if (negative.length > 0) {
      for (const j of negative) { moles[j] = 0; active.splice(active.indexOf(j), 1); }
      continue;
    }
    let swapped = false;
    const outside: number[] = []; // lone species whose range T has left, with no phase to swap to
    for (let c = 0; c < active.length; c++) {
      const j = active[c];
      if (covers(j, t)) continue;
      const f = formula.get(j)!;
      if (active.some((x) => x !== j && formula.get(x) === f)) continue; // a pair on its melting point
      const k = cond.find((x) => x !== j && formula.get(x) === f && covers(x, t));
      if (k === undefined) { outside.push(j); continue; }
      const prev = lastSwap.get(f);
      if (prev && prev[0] === k && prev[1] === j) {
        if (fixedT) continue; // T is assigned: keep the phase in hand
        active.push(k); moles[k] = 0;
        swapped = true;
        continue;
      }
      active[c] = k; moles[k] = moles[j]; moles[j] = 0;
      lastSwap.set(f, [j, k]);
      swapped = true;
    }
    // Never kept outside its own range (it may join again later only if its range then holds T): a
    // species carried in from a distant start would otherwise hold the solve on a false answer.
    for (const j of outside) { moles[j] = 0; active.splice(active.indexOf(j), 1); swapped = true; }
    if (swapped) continue;
    const held = new Set(active.map((j) => formula.get(j)));
    let best = -1, bestTest = 0;
    for (const j of cond) {
      if (held.has(formula.get(j)) || !covers(j, t)) continue;
      let test = hRT(list[j], t) - sR(list[j], t);
      for (let i = 0; i < L; i++) test -= a[i * NS + j] * pi[i];
      if (test < bestTest) { bestTest = test; best = j; }
    }
    if (best < 0) { ok = true; break; }
    active.push(best);
    moles[best] = 0;
  }

  // Properties and equilibrium derivatives at the final point (2.50-2.59, 2.70-2.75).
  // Two phases of one substance on its melting point (both kept by the loop above) enter the
  // derivatives as one condensed unknown with the split between them frozen, its H the mole-weighted
  // H of the pair: with both rows the matrix is singular, since T cannot move at fixed P. So cp and
  // dlnVdlnT there are frozen-split values, and gammaS comes from RP-1311 eq. 3.9 instead.
  evaluate(t);
  const lnn = Math.log(n);
  const dAct: number[] = [];             // condensed unknowns in the derivative matrix
  const dH: number[] = [];               // their H°/RT
  for (const j of active) {
    const f = formula.get(j);
    const c = dAct.findIndex((x) => formula.get(x) === f);
    if (c < 0) { dAct.push(j); dH.push(H[j]); continue; }
    const first = dAct[c], total = moles[first] + moles[j];
    dH[c] = total !== 0 ? (moles[first] * H[first] + moles[j] * H[j]) / total : H[first];
  }
  const twoPhase = dAct.length < active.length;
  const nc = dAct.length;
  const iN = L + nc;
  let sumN = 0, sumNH = 0, sumNC = 0, sumNHH = 0, sumNS = 0;
  const md = L + nc + 1;
  const wd = md + 2;
  g.fill(0, 0, md * wd);
  for (const j of gas) {
    const nj = moles[j];
    if (nj === 0) continue;
    const hj = H[j];
    for (let k = 0; k < L; k++) {
      const akj = a[k * NS + j];
      if (akj === 0) continue;
      const row = k * wd, t1 = akj * nj;
      for (let i = 0; i < L; i++) g[row + i] += t1 * a[i * NS + j];
      g[row + iN] += t1;
      g[iN * wd + k] += t1;
      g[row + md] -= t1 * hj; // ∂/∂ln T
      g[row + md + 1] += t1;  // ∂/∂ln P
    }
    sumN += nj; sumNH += nj * hj; sumNC += nj * C[j]; sumNHH += nj * hj * hj;
    sumNS += nj * (S0[j] - (lnMoles[j] - lnn) - lnP);
  }
  // Condensed rows and columns; their ∂/∂ln P right-hand side is zero.
  for (let c = 0; c < nc; c++) {
    const j = dAct[c], col = L + c, row = col * wd;
    for (let i = 0; i < L; i++) { const aij = a[i * NS + j]; g[i * wd + col] = aij; g[row + i] = aij; }
    g[row + md] = -dH[c];
  }
  let sumCH = 0, sumCC = 0, sumCS = 0;
  for (const j of active) { sumCH += moles[j] * H[j]; sumCC += moles[j] * C[j]; sumCS += moles[j] * S0[j]; }
  // Σ_g a_ij n_j H_j, kept before elimination overwrites the matrix.
  const anh = new Float64Array(L);
  for (let k = 0; k < L; k++) anh[k] = -g[k * wd + md];
  g[iN * wd + md] = -sumNH;
  g[iN * wd + md + 1] = sumN;
  let derivOk = solve(g, md, 2);
  let cpOverR = sumNC + sumCC + sumNHH + sumNH * g[iN * wd + md];
  for (let i = 0; i < L; i++) cpOverR += anh[i] * g[i * wd + md];
  for (let c = 0; c < nc; c++) cpOverR += dH[c] * g[(L + c) * wd + md];
  let dlnVdlnT = 1 + g[iN * wd + md];
  let dlnVdlnP = -1 + g[iN * wd + md + 1];
  const cvOverR = cpOverR + (n * dlnVdlnT * dlnVdlnT) / dlnVdlnP;
  let gammaS = twoPhase ? -1 / dlnVdlnP : -(cpOverR / cvOverR) / dlnVdlnP; // 3.9 on a melting point
  // A gas with its own condensate as the only species present (steam over water or ice) has its
  // element rows dependent and T fixed by P: the derivative matrix is singular, and whether the
  // elimination notices is down to rounding (it once gave cp 1.2e12 J/(kg K), gamma_s 0.52). The
  // state itself is sound; take the frozen-composition values for its derivatives instead.
  const sane = derivOk && cpOverR > 0 && Number.isFinite(gammaS) && (twoPhase || gammaS > 1) && dlnVdlnP < 0;
  if (!sane && active.length > 0) {
    cpOverR = sumNC + sumCC;
    gammaS = cpOverR / (cpOverR - n);
    dlnVdlnT = 1;
    dlnVdlnP = -1;
    derivOk = true;
  }

  let condensedMass = 0;
  for (const j of cond) condensedMass += moles[j] * list[j].molarMass;

  const state: EqState = {
    ok: false, belowFloor: false,
    t, pBar: problem.pBar, n,
    species: list, moles, lnMoles,
    h: R * t * (sumNH + sumCH), s: R * (sumNS + sumCS),
    molarMass: 1 / n,
    cp: R * cpOverR, gammaS, dlnVdlnT, dlnVdlnP,
    condensedMassFraction: condensedMass,
    iterations,
  };
  const settled = ok && derivOk && [t, n, state.h, state.s, state.cp, gammaS].every(Number.isFinite)
    && state.cp > 0 && gammaS > 0 && dlnVdlnP < 0;
  state.ok = settled && t >= T_FLOOR;
  state.belowFloor = settled && t < T_FLOOR;
  return state;
}
