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
 * present; species containing an absent element are dropped. Gas phase only: condensed species in the
 * list are carried with zero moles.
 */
export function equilibrate(mix: Mixture, problem: Problem, species?: Species[], start?: EqState): EqState {
  // Elements present, and the species made only of them.
  const elements = Object.keys(mix.b0).filter((e) => mix.b0[e] > 0);
  const present = new Set(elements);
  const list = (species ?? speciesFor(elements)).filter((s) => Object.keys(s.elements).every((e) => present.has(e)));
  const L = elements.length;
  const NS = list.length;
  const gas: number[] = [];
  list.forEach((s, j) => { if (s.phase === 0) gas.push(j); });

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

  // Unknowns: π_i (0..L-1), Δn_j of active condensed species (none in the gas-only solver),
  // Δln n, then Δln T unless T is given.
  const nc = 0;
  const iN = L + nc;
  const iT = iN + 1;
  const fixedT = problem.kind === 'tp';
  const m = fixedT ? iN + 1 : iT + 1;
  const g = new Float64Array((L + nc + 2) * (L + nc + 4)); // big enough for the iteration and derivative matrices

  const lnP = Math.log(problem.pBar);
  let t = problem.kind === 'tp' ? problem.t : 3800;
  let n = 0.1;

  // Start (3.6): cold, or from a previous point.
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
      else moles[j] = k === undefined ? 0 : start.moles[k];
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
  }

  let ok = false;
  let iterations = 0;
  let restarts = 0;
  attempts: for (;;) {
    for (let it = 1; it <= LIMIT; it++) {
      iterations++;
      evaluate(t);
      const lnn = Math.log(n);
      const w = m + 1;
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
      let balance = 0;
      for (let k = 0; k < L; k++) {
        const bk = g[k * w + iN];
        g[k * w + m] += b0[k] - bk;
        balance = Math.max(balance, Math.abs(b0[k] - bk));
      }
      g[iN * w + iN] = sumN - n;
      g[iN * w + m] = n - sumN + sumNMu;
      if (!fixedT) {
        g[iN * w + iT] = sumNH;
        if (problem.kind === 'hp') {
          g[iT * w + iN] = sumNH;
          g[iT * w + iT] = sumNC + sumNHH;
          g[iT * w + m] = mix.h0 / (R * t) - sumNH + sumNHMu;
        } else {
          g[iT * w + iN] = sumNS;
          g[iT * w + iT] = sumNC + sumNHS;
          g[iT * w + m] = problem.s / R - sumNS + n - sumN + sumNSMu;
        }
      }

      if (!solve(g, m, 1)) {
        if (restarts >= RESTARTS) break attempts;
        restarts++;
        for (const j of gas) if (moles[j] === 0) { moles[j] = RESTART_MOLES; lnMoles[j] = Math.log(RESTART_MOLES); }
        continue attempts;
      }

      // Corrections (2.18) and damping (3.1-3.3).
      const dlnn = g[iN * w + m];
      const dlnT = fixedT ? 0 : g[iT * w + m];
      let big = Math.max(5 * Math.abs(dlnT), 5 * Math.abs(dlnn));
      let lambda2 = 1;
      for (const j of gas) {
        let d = dlnn + H[j] * dlnT - mu[j];
        for (let i = 0; i < L; i++) { const aij = a[i * NS + j]; if (aij !== 0) d += aij * g[i * w + m]; }
        dln[j] = d;
        const lr = lnMoles[j] - lnn;
        if (lr > -ZERO) big = Math.max(big, Math.abs(d));
        else if (d >= 0) lambda2 = Math.min(lambda2, Math.abs((-lr - REENTRY) / (d - dlnn)));
      }
      const lambda = Math.min(1, big > 0 ? 2 / big : 1, lambda2);

      // Convergence (3.5), judged on this iteration's corrections.
      let settled = (n * Math.abs(dlnn)) / sumN <= TOL && Math.abs(dlnT) <= T_TOL && balance <= BALANCE_TOL * b0max;
      if (settled) for (const j of gas) if ((moles[j] * Math.abs(dln[j])) / sumN > TOL) { settled = false; break; }

      n = Math.exp(lnn + lambda * dlnn);
      if (!fixedT) t = Math.exp(Math.log(t) + lambda * dlnT);
      const lnn2 = Math.log(n);
      for (const j of gas) {
        lnMoles[j] += lambda * dln[j];
        moles[j] = lnMoles[j] - lnn2 > -ZERO ? Math.exp(lnMoles[j]) : 0;
      }
      if (settled && Number.isFinite(t) && Number.isFinite(n)) { ok = true; break attempts; }
    }
    break;
  }

  // Properties and equilibrium derivatives at the final point (2.50-2.59, 2.70-2.75).
  evaluate(t);
  const lnn = Math.log(n);
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
  // Σ_g a_ij n_j H_j, kept before elimination overwrites the matrix.
  const anh = new Float64Array(L);
  for (let k = 0; k < L; k++) anh[k] = -g[k * wd + md];
  g[iN * wd + md] = -sumNH;
  g[iN * wd + md + 1] = sumN;
  const derivOk = solve(g, md, 2);
  let cpOverR = sumNC + sumNHH + sumNH * g[iN * wd + md];
  for (let i = 0; i < L; i++) cpOverR += anh[i] * g[i * wd + md];
  const dlnVdlnT = 1 + g[iN * wd + md];
  const dlnVdlnP = -1 + g[iN * wd + md + 1];
  const cvOverR = cpOverR + (n * dlnVdlnT * dlnVdlnT) / dlnVdlnP;
  const gammaS = -(cpOverR / cvOverR) / dlnVdlnP;

  let condensedMass = 0;
  for (let j = 0; j < NS; j++) if (list[j].phase !== 0) condensedMass += moles[j] * list[j].molarMass;

  const state: EqState = {
    ok: false,
    t, pBar: problem.pBar, n,
    species: list, moles, lnMoles,
    h: R * t * sumNH, s: R * sumNS,
    molarMass: 1 / n,
    cp: R * cpOverR, gammaS, dlnVdlnT, dlnVdlnP,
    condensedMassFraction: condensedMass,
    iterations,
  };
  state.ok = ok && derivOk && [t, n, state.h, state.s, state.cp, gammaS].every(Number.isFinite);
  return state;
}
