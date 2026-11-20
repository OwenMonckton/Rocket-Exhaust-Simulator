// Equilibrium flow from the chamber through the throat to the nozzle exit, after NASA RP-1311
// (Gordon & McBride) chapter 6: infinite-area chamber, isentropic expansion, composition in
// equilibrium at every station, no losses.
import { R_UNIVERSAL as R } from './thermo';
import { equilibrate, type EqState, type Mixture, type Problem } from './equilibrium';

export interface RocketResult {
  ok: boolean;        // false if any solve, or the throat or exit iteration, did not settle
  chamber: EqState; throat: EqState; exit: EqState;
  cStar: number;      // m/s
  ispVac: number;     // m/s, at the exit, equilibrium flow, no losses
  pExitBar: number;
}

const THROAT_TOL = 0.4e-4;   // |u² − a²|/u² at the throat
const THROAT_PASSES = 8;
const JUMP_WIDTH = 1e-6;     // relative pressure bracket that locates a sonic jump
const JUMP_STEPS = 60;
const EXIT_TOL = 4e-5;       // change in ln(Pc/Pe)
const EXIT_PASSES = 20;

interface Station { st: EqState; u2: number; a2: number }

/**
 * Chamber at `chamber` (`hp` for a flame, `tp` for a fluid heated to a fixed temperature), then the
 * throat and the exit at area ratio `eps`, expanding at the chamber's entropy. Each solve starts
 * from the previous station; with `start`, from the matching station of `start`, whose pressure
 * ratios are also the first guesses.
 */
export function rocket(mix: Mixture, chamber: Problem, eps: number, start?: RocketResult): RocketResult {
  const warm = start?.ok ? start : undefined;
  /**
   * A solve started from `from`, and from the solver's own cold start if that does not settle: a
   * start far from the answer can fail where a cold one does not (two phases carried in from a
   * melting point to an exit far below it, for one).
   */
  const solve = (problem: Problem, from?: EqState) => {
    const st = equilibrate(mix, problem, undefined, from);
    return st.ok || from === undefined ? st : equilibrate(mix, problem);
  };
  const ch = solve(chamber, start?.chamber);
  const pc = chamber.pBar;
  const hc = ch.h;
  let ok = ch.ok;

  /** The equilibrium state at the chamber's entropy and `pBar`, with its flow speed and sound speed. */
  const station = (pBar: number, from: EqState): Station => {
    const st = solve({ kind: 'sp', s: ch.s, pBar }, from);
    return { st, u2: 2 * (hc - st.h), a2: st.n * R * st.t * st.gammaS };
  };
  const settled = (x: Station) => x.st.ok && x.u2 > 0;
  const flux = (x: Station) => (1e5 * x.st.pBar) / (x.st.n * R * x.st.t) * Math.sqrt(x.u2); // ρu, kg/(m² s)

  // Throat (RP-1311 sec. 6.3): the pressure where the flow speed equals the sound speed.
  const g = ch.gammaS;
  let pt = warm ? pc * (warm.throat.pBar / warm.chamber.pBar) : pc / ((g + 1) / 2) ** (g / (g - 1));
  let from = start?.throat ?? ch;
  let th: Station | undefined;
  let sub: Station | undefined; // lowest pressure seen still below sonic
  let sup: Station | undefined; // highest pressure seen already above sonic
  let throatOk = false;
  for (let pass = 0; pass < THROAT_PASSES; pass++) {
    const x = station(pt, from);
    th = x;
    if (!settled(x)) break;
    from = x.st;
    if (Math.abs(x.u2 - x.a2) / x.u2 <= THROAT_TOL) { throatOk = true; break; }
    if (x.u2 < x.a2) { if (!sub || x.st.pBar < sub.st.pBar) sub = x; }
    else if (!sup || x.st.pBar > sup.st.pBar) sup = x;
    pt *= (1 + (x.st.gammaS * x.u2) / x.a2) / (1 + x.st.gammaS);
  }
  // Throat discontinuity: where a product starts or stops melting the sound speed jumps, so u² − a²
  // can change sign with no root and the update above cycles across the jump. Halve the bracket in
  // ln P until it is negligible; the throat is then the subsonic side of the jump, where the flow
  // goes from below to above sonic. A smooth root met on the way ends the search as usual. A probe
  // landing exactly on a phase boundary can fail to settle; the search then probes off-centre.
  const probe = (lo: Station, hi: Station) => {
    let x = station(Math.sqrt(lo.st.pBar * hi.st.pBar), lo.st);
    for (const f of [0.25, 0.75]) {
      if (settled(x)) break;
      x = station(lo.st.pBar ** (1 - f) * hi.st.pBar ** f, lo.st);
    }
    return x;
  };
  if (!throatOk && sub && sup) {
    for (let step = 0; step < JUMP_STEPS; step++) {
      if ((sub.st.pBar - sup.st.pBar) / sub.st.pBar <= JUMP_WIDTH) { th = sub; throatOk = true; break; }
      const x = probe(sub, sup);
      if (!settled(x)) { th = x; break; }
      if (Math.abs(x.u2 - x.a2) / x.u2 <= THROAT_TOL) { th = x; throatOk = true; break; }
      if (x.u2 < x.a2) sub = x; else sup = x;
    }
  }
  ok &&= throatOk;
  const throat = th!;

  // Exit at area ratio eps (RP-1311 sec. 6.4): adjust ln(Pc/Pe) until the area ratio matches.
  const lnEps = Math.log(eps);
  const lnPt = Math.log(pc / throat.st.pBar);
  let lnPr = warm ? Math.log(warm.chamber.pBar / warm.exit.pBar)
    : eps >= 2 ? throat.st.gammaS + 1.4 * lnEps
    : lnPt + Math.sqrt(3.294 * lnEps * lnEps + 1.535 * lnEps);
  from = start?.exit ?? throat.st;
  let ex = throat;
  let exitOk = false;
  if (ok) {
    const throatFlux = flux(throat);
    for (let pass = 0; pass < EXIT_PASSES; pass++) {
      const x = station(pc / Math.exp(lnPr), from);
      ex = x;
      if (!settled(x)) break;
      from = x.st;
      const d = ((x.st.gammaS * x.u2) / (x.u2 - x.a2)) * (lnEps - Math.log(throatFlux / flux(x)));
      if (!Number.isFinite(d)) break;
      if (Math.abs(d) <= EXIT_TOL) { exitOk = true; break; }
      // The exit stays downstream of the throat: never step past it.
      lnPr = lnPr + d > lnPt ? lnPr + d : (lnPr + lnPt) / 2;
    }
  }
  ok &&= exitOk;

  const ue = Math.sqrt(ex.u2);
  return {
    ok,
    chamber: ch, throat: throat.st, exit: ex.st,
    cStar: (1e5 * pc) / flux(throat),
    ispVac: ue + (ex.st.n * R * ex.st.t) / ue,
    pExitBar: ex.st.pBar,
  };
}
