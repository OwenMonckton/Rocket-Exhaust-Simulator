// Equilibrium flow from the chamber through the throat to the nozzle exit, after NASA RP-1311
// (Gordon & McBride) chapter 6: infinite-area chamber, isentropic expansion, composition in
// equilibrium at every station, no losses.
import { R_UNIVERSAL as R, cpR } from './thermo';
import { equilibrate, T_FLOOR, type EqState, type Mixture, type Problem } from './equilibrium';

export interface RocketResult {
  ok: boolean;        // false if any solve, or the throat or exit iteration, did not settle
  chamber: EqState; throat: EqState; exit: EqState;
  cStar: number;      // m/s
  ispVac: number;     // m/s, at the exit, equilibrium flow, no losses
  pExitBar: number;
  /**
   * The exit would be colder than the data covers (200 K): the flow is in equilibrium down to the
   * 200 K station on the chamber's isentrope and frozen (composition and specific heat fixed) beyond.
   */
  coldExit: boolean;
}

const THROAT_TOL = 0.4e-4;   // |u² − a²|/u² at the throat
const THROAT_PASSES = 8;
const THROAT_SAMPLES = 12;   // stations between chamber and throat checked for an earlier sonic point
const JUMP_WIDTH = 1e-6;     // relative pressure bracket that locates a sonic jump
const JUMP_STEPS = 60;
const EXIT_TOL = 4e-5;       // change in ln(Pc/Pe)
const EXIT_PASSES = 20;
const FLOOR_BAND = 0.5;      // K: the 200 K station lies within this above the floor
const FLOOR_STEPS = 60;
const FLOOR_WALK = 60;       // steps down the isentrope looking for the floor
const FLOOR_STRIDE = Math.LN2; // largest step in ln P on that walk
const FLOOR_STEP_MIN = 0.01;   // smallest
const FROZEN_STEPS = 100;
const FROZEN_SPAN = 60;      // ln P below the 200 K station searched for a frozen exit

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
  // The throat is the first sonic point going down from the chamber. Where a product melts, the
  // sound speed jumps and the flow can go sonic, back below sonic and sonic again; the iteration
  // above can settle on the later point (c* once 4% high). With condensed mass about, look at
  // stations between the chamber and the throat in hand, each started from the last; if one is
  // already supersonic, search between it and the last subsonic one above it instead.
  if (throatOk && th && (ch.condensedMassFraction > 0 || th.st.condensedMassFraction > 0)) {
    let above: Station = { st: ch, u2: 0, a2: ch.n * R * ch.t * ch.gammaS };
    let fromUp = ch;
    for (let k = 1; k < THROAT_SAMPLES; k++) {
      const x = station(pc * (th.st.pBar / pc) ** (k / THROAT_SAMPLES), fromUp);
      if (!settled(x)) continue;
      fromUp = x.st;
      if (x.u2 < x.a2) { above = x; continue; }
      sub = above; sup = x; throatOk = false;
      break;
    }
  }
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
  // A throat resting on frozen-composition derivatives is where the speed meets the frozen sound
  // speed, not the equilibrium one: c* there can read many percent high. No answer instead.
  ok &&= !throat.st.frozenDerivatives;

  /**
   * The station on the isentrope where equilibrium gives 200 K (within FLOOR_BAND above), going down
   * in pressure from `warmSide` (settled, at or above the floor). A state found far below a condensing
   * one can sit on another branch (water staying vapour, as no ice is known below 200 K), so the walk
   * goes in short steps, each started from the last, to the first station below the floor, and then
   * halves that bracket in ln P. A probe that does not settle counts as cold.
   */
  const floorStation = (warmSide: Station): Station | undefined => {
    let w = warmSide;
    let c: Station | undefined;
    for (let step = 0; step < FLOOR_WALK && !c; step++) {
      if (w.st.t - T_FLOOR <= FLOOR_BAND) return w;
      // Where a perfect gas of this gamma would reach the floor, at most a halving of pressure on.
      // (On a melting plateau gamma_s is at or below 1 and says nothing: take the full stride.)
      const g = w.st.gammaS;
      const guess = (g / (g - 1)) * Math.log(w.st.t / T_FLOOR);
      const dlnP = g > 1 && guess > 0 ? Math.min(FLOOR_STRIDE, Math.max(FLOOR_STEP_MIN, guess)) : FLOOR_STRIDE;
      const x = station(w.st.pBar * Math.exp(-dlnP), w.st);
      if (settled(x)) w = x; else c = x;
    }
    if (!c) return undefined;
    for (let step = 0; step < FLOOR_STEPS; step++) {
      if (w.st.t - T_FLOOR <= FLOOR_BAND) return w;
      const x = station(Math.sqrt(w.st.pBar * c.st.pBar), w.st);
      if (settled(x)) w = x; else c = x;
    }
    return undefined;
  };

  /**
   * Frozen expansion from station `c` to area ratio `eps` (facts.md, "Cold exits"): composition and
   * cp fixed at c, T = T1 (P/P1)^((γ−1)/γ), u² = u1² + 2 cp (T1 − T).
   */
  const frozenExit = (c: Station, throatFlux: number): Station | undefined => {
    const st1 = c.st;
    let sumC = 0;
    for (let j = 0; j < st1.species.length; j++) if (st1.moles[j] > 0) sumC += st1.moles[j] * cpR(st1.species[j], st1.t);
    const cp = R * sumC;
    const nR = st1.n * R;
    const gf = cp / (cp - nR);
    const lnP1 = Math.log(st1.pBar);
    const at = (lnP: number) => {
      const t = st1.t * Math.exp(((gf - 1) / gf) * (lnP - lnP1));
      const u2 = c.u2 + 2 * cp * (st1.t - t);
      return { t, u2, flux: ((1e5 * Math.exp(lnP)) / (nR * t)) * Math.sqrt(u2) };
    };
    // The area ratio grows as the pressure falls.
    let hi = lnP1;
    let lo = lnP1 - FROZEN_SPAN;
    if (!(throatFlux / at(lo).flux > eps)) return undefined;
    for (let i = 0; i < FROZEN_STEPS; i++) {
      const mid = 0.5 * (lo + hi);
      if (throatFlux / at(mid).flux < eps) hi = mid; else lo = mid;
    }
    const lnPe = 0.5 * (lo + hi);
    const e = at(lnPe);
    if (![gf, e.t, e.u2].every(Number.isFinite) || !(e.u2 > 0) || !(gf > 1)) return undefined;
    const st: EqState = {
      ...st1,
      ok: true, belowFloor: false,
      t: e.t, pBar: Math.exp(lnPe),
      moles: Float64Array.from(st1.moles), lnMoles: Float64Array.from(st1.lnMoles),
      h: hc - e.u2 / 2, s: st1.s,
      cp, gammaS: gf, dlnVdlnT: 1, dlnVdlnP: -1,
    };
    return { st, u2: e.u2, a2: nR * e.t * gf };
  };

  // Exit at area ratio eps (RP-1311 sec. 6.4): adjust ln(Pc/Pe) until the area ratio matches.
  const lnEps = Math.log(eps);
  const lnPt = Math.log(pc / throat.st.pBar);
  let lnPr = warm ? Math.log(warm.chamber.pBar / warm.exit.pBar)
    : eps >= 2 ? throat.st.gammaS + 1.4 * lnEps
    : lnPt + Math.sqrt(3.294 * lnEps * lnEps + 1.535 * lnEps);
  from = (warm?.coldExit ? undefined : start?.exit) ?? throat.st;
  let ex = throat;
  let exitOk = false;
  let coldExit = false;
  if (ok && eps <= 1) {
    // An exit at area ratio 1 is the throat itself, already found: no expansion to search for.
    exitOk = true;
  } else if (ok) {
    const throatFlux = flux(throat);
    let warmest = throat;          // the lowest-pressure station seen that settled at or above the floor
    let lnPrMax = Infinity;        // ln(Pc/P) at the 200 K station, once found: an equilibrium exit lies above it
    for (let pass = 0; pass < EXIT_PASSES; pass++) {
      let x = station(pc / Math.exp(lnPr), from);
      if (x.st.belowFloor && lnPrMax === Infinity) {
        // A start far from the answer can land on vapour colder than the data where the true state
        // is warmer with liquid: walk there from the warmest station, at most halving the pressure
        // per step and each step started from the last, before believing it.
        const target = pc / Math.exp(lnPr);
        let w = warmest;
        while (settled(w) && w.st.pBar > target * (1 + 1e-7)) w = station(Math.max(target, w.st.pBar / 2), w.st);
        if (settled(w)) x = w;
      }
      if (x.st.belowFloor && lnPrMax === Infinity) {
        // Colder than the data: find where the isentrope crosses 200 K.
        const c = floorStation(warmest);
        if (!c) { ex = x; break; }
        if (throatFlux / flux(c) <= eps) {
          const f = frozenExit(c, throatFlux);
          if (f) { ex = f; exitOk = true; coldExit = true; }
          else ex = c;
          break;
        }
        // The exit is warmer than 200 K after all: carry on from the 200 K station.
        lnPrMax = Math.log(pc / c.st.pBar);
        lnPr = lnPrMax;
        from = c.st;
        continue;
      }
      ex = x;
      if (!settled(x)) break;
      if (x.st.pBar < warmest.st.pBar) warmest = x;
      from = x.st;
      const d = ((x.st.gammaS * x.u2) / (x.u2 - x.a2)) * (lnEps - Math.log(throatFlux / flux(x)));
      if (!Number.isFinite(d)) break;
      if (Math.abs(d) <= EXIT_TOL) { exitOk = true; break; }
      // The exit stays downstream of the throat (never step past it) and above the 200 K station.
      let next = lnPr + d > lnPt ? lnPr + d : (lnPr + lnPt) / 2;
      if (next > lnPrMax) next = (lnPr + lnPrMax) / 2;
      lnPr = next;
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
    coldExit: ok && coldExit,
  };
}
