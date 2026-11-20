# Fuel and Oxidiser Chemistry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A combustion engine takes any fuel with any oxidiser, with performance from a chemical-equilibrium solver running in the browser and a verdict on whether the pair works.

**Architecture:** A pure solver under `src/physics/chem/` (NASA CEA's method, RP-1311) reads a checked-in data file built from NASA's `thermo.inp`. One seam, `resolveGas(cfg, pcBar, eps)`, gives the rest of the simulator its gas: tabled propellants go through today's table code untouched, calculated ones through the solver, a fit to one gamma and molar mass, and a cache. `simulate` stays synchronous; no worker (measured: under 1 ms per solve).

**Tech Stack:** TypeScript, Vite, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-20-fuel-chemistry-design.md`

## Global Constraints

- The twelve examples' pinned figures (`src/physics/presets.regression.test.ts` and its snapshot) do not change. Never update that snapshot.
- No picker option is refused, greyed out or answered with an error.
- A figure from a solve that did not settle is never shown as real.
- Every propellant fact (lights on contact, detonates, attacks materials, toxicity, freezing and boiling point, heat content not from `thermo.inp`) carries a source string in the code. No source, no fact: leave the ingredient or the fact out and list it in `docs/future-work.md`.
- `simulate` stays a plain synchronous function. The solver never runs per frame for unchanged inputs.
- Share links in the `v1` and `v2` formats decode exactly as now.
- Plain-English labels with hover text; tests beside the code; no new runtime dependencies.
- Do not copy from GPL sources (cpropep, RocketCEA). `nasa/cea` (Apache-2.0) and `equilibrium-c` (MIT) may be read.
- Each task ends with the whole suite green: `npm test`, then `npx tsc --noEmit`.
- Commit messages are plain sentences, ending with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Facts gathered before planning

These were measured or read from sources before the plan was written. Use them; do not re-derive.

**`thermo.inp`** (https://raw.githubusercontent.com/nasa/cea/main/data/thermo.inp, 1,234,323 bytes, sha256 `fa7746572952d74e249e818a82a35c113829742fb421a308e167185528884363`):

- Lines 1–62 are `!` comments, line 63 `thermo`, line 64 a header to skip. Products run to `END PRODUCTS`, then reactant-only records to `END REACTANTS`. Lines are not padded: pad to 80 before slicing. Fields abut: slice by column, never split on whitespace.
- Record line 1: name in cols 1–18 (names have no spaces).
- Record line 2: cols 1–2 interval count n; cols 11–50 five pairs of (2-char element symbol, 6-char number), blank symbol means unused; cols 51–52 phase (0 gas, otherwise condensed); cols 53–65 molar mass g/mol; cols 66–80 heat of formation at 298.15 K in J/mol, or, when n = 0, the assigned enthalpy in J/mol.
- n = 0: one more line, cols 1–11 the temperature (K) of that enthalpy.
- n > 0: n blocks of three lines. Line A: Tmin cols 1–11, Tmax cols 12–22. Line B: a1–a5 as five 16-char fields. Line C: a6, a7 in cols 1–32, b1 cols 49–64, b2 cols 65–80. Exponents use `D`; replace with `E`.
- Element symbols are upper case (`AL`, `CL`, `LI`, `BE`, `HE`). `E` is the electron: any record containing it is an ion. Names starting `Inert` and `Air` are not wanted.
- Cp/R = a1/T² + a2/T + a3 + a4·T + a5·T² + a6·T³ + a7·T⁴
- H/RT = −a1/T² + a2·ln(T)/T + a3 + a4·T/2 + a5·T²/3 + a6·T³/4 + a7·T⁴/5 + b1/T (absolute: includes heat of formation)
- S/R = −a1/(2T²) − a2/T + a3·ln T + a4·T + a5·T²/2 + a6·T³/3 + a7·T⁴/4 + b2
- Products containing only C, H, O, N, F, Cl, B, Li, Al, Be, He, no ions: 511 (427 gas, 84 condensed).
- Reactant record names for the lists: `O2(L)`, `F2(L)`, `O3(L)`, `F2O(L)`, `NF3(L)`, `CLF3(L)`, `CLO3F(L)`, `N2O4(L)`, `HNO3(L)`, `IRFNA`, `H2O2(L)`, `H2(L)`, `CH4(L)`, `C2H6(L)`, `C3H8(L)`, `C2H2(L),acetyle`, `RP-1`, `C8H18(L),isooct`, `Jet-A(L)`, `JP-10(L)`, `C2H5OH(L)`, `CH3OH(L)`, `NH3(L)`, `N2H4(L)`, `CH6N2(L)`, `C2H8N2(L),UDMH`, `C6H5NH2(L)`, `B2H6(L)`, `B5H9(L)`, `C2N2(L)`, `CH3NO2(L)`. Product records usable as reactants at 298.15 K: `NO`, `N2O`, `H2O(L)`, `Li(cr)`, `AL(cr)`, `Be(a)`, `CO2`, `He`.
- Not in the file, so each needs a cited heat content or is left out: liquid ClF5, liquid N2O, tetranitromethane, Syntin, turpentine, liquid isopropanol, furfuryl alcohol, hydrazine hydrate (for UH25), condensed BeH2.

**Solver** (RP-1311 equation numbers; R = 8314.51 J/(kmol·K); n_j in kmol per kg of mixture; n = Σ over gases):

- Reactants: b0_i = Σ_j a_ij·w_j/M_j per kg of mixture; h0 = 1000·Σ_j w_j·H_j/M_j (J/kg; H in J/mol, M in g/mol), w_j mass fractions.
- μ_j/RT = H°/RT − S°/R + ln(n_j/n) + ln P (P in bar) for a gas; H°/RT − S°/R for condensed.
- Unknowns per iteration: π_i (one per element), Δn_j (one per active condensed species), Δln n, and Δln T unless T is given. Write H_j = H°_j/RT, C_j = Cp°_j/R, S_j = S°_j/R − ln(n_j/n) − ln P (gas) or S°_j/R (condensed).
  - Element row k (2.24): Σ_i[Σ_g a_kj a_ij n_j]π_i + Σ_c a_kj Δn_j + [Σ_g a_kj n_j]Δln n + [Σ_g a_kj n_j H_j]Δln T = (b0_k − b_k) + Σ_g a_kj n_j μ_j
  - Condensed row j (2.25): Σ_i a_ij π_i + H_j Δln T = μ_j
  - Moles row (2.26): Σ_i[Σ_g a_ij n_j]π_i + [Σ_g n_j − n]Δln n + [Σ_g n_j H_j]Δln T = n − Σ_g n_j + Σ_g n_j μ_j
  - Enthalpy row, HP (2.27): Σ_i[Σ_g a_ij n_j H_j]π_i + Σ_c H_j Δn_j + [Σ_g n_j H_j]Δln n + [Σ_all n_j C_j + Σ_g n_j H_j²]Δln T = (h0 − h)/RT + Σ_g n_j H_j μ_j
  - Entropy row, SP (2.28): Σ_i[Σ_g a_ij n_j S_j]π_i + Σ_c S_j Δn_j + [Σ_g n_j S_j]Δln n + [Σ_all n_j C_j + Σ_g n_j H_j S_j]Δln T = (s0 − s)/R + n − Σ_g n_j + Σ_g n_j S_j μ_j
  - Gas update (2.18): Δln n_j = Σ_i a_ij π_i + Δln n + H_j Δln T − μ_j
- Damping (3.1–3.3): λ1 = 2/max(5|Δln T|, 5|Δln n|, |Δln n_j| over gases with ln(n_j/n) > −18.420681); for gases at or below that with Δln n_j ≥ 0, λ2 = min|(−ln(n_j/n) − 9.2103404)/(Δln n_j − Δln n)|; λ = min(1, λ1, λ2). A gas with ln(n_j/n) ≤ −18.420681 counts as zero moles in sums while its log keeps updating.
- Converged (3.5): n_j|Δln n_j|/Σn ≤ 0.5e-5 for every gas, |Δn_j|/Σn ≤ 0.5e-5 for condensed, n|Δln n|/Σn ≤ 0.5e-5, element balance within 1e-6 × largest b0, |Δln T| ≤ 1e-4. Iteration limit 100 (CEA's 50 was exceeded by a cold start at an extreme mixture in the spike). Past it: not settled.
- Start: T 3800 K, n 0.1, every gas 0.1/NG, no condensed. Later points start from the previous point.
- Drop elements with b0 = 0 and every species containing them before solving.
- Condensed (3.7): after each convergence, among inactive condensed species whose temperature interval contains T, find those with μ°_j/RT − Σ_i π_i a_ij < 0; add the single most negative and re-converge; remove any whose n_j < 0 and re-converge. Condensed moles update as n_j ← n_j + λ·Δn_j. Two phases of one substance: keep the one whose interval contains T. If a phase swap would reverse the previous swap at the same point (the point sits on a melting point: CEA's Example 13 throat is at 2851 K, where beryllium oxide melts), do not swap back: keep the phase in hand, evaluated from its nearest interval, and accept that convergence. Phase is chosen afresh by interval at the next point.
- Singular matrix: set every zeroed gas to 1e-6 and restart, at most twice; then not settled.
- Derivatives at a converged point, same matrix without the T column and with the moles-row Δln n entry zero. Right-hand sides for ∂/∂ln T: element row −Σ_g a_kj n_j H_j, condensed row −H_j, moles row −Σ_g n_j H_j. For ∂/∂ln P: element row Σ_g a_kj n_j, condensed 0, moles row Σ_g n_j. Then cp/R = Σ_i[Σ_g a_ij n_j H_j]∂π_i + Σ_c H_j ∂n_j + [Σ_g n_j H_j]∂ln n + Σ_all n_j C_j + Σ_g n_j H_j² (all ∂/∂ln T); dlnV/dlnT = 1 + ∂ln n/∂ln T; dlnV/dlnP = −1 + ∂ln n/∂ln P; cv = cp + nR(dlnV/dlnT)²/(dlnV/dlnP); γ_s = −(cp/cv)/(dlnV/dlnP); sound speed² = nRTγ_s.
- Rocket (ch. 6): chamber HP at pc. Throat: Pc/Pt first guess ((γ_s+1)/2)^(γ_s/(γ_s−1)); SP at chamber entropy; u² = 2(h_c − h); done when |u² − a²|/u² ≤ 0.4e-4, else Pt ← Pt(1 + γ_s u²/a²)/(1 + γ_s); at most 8 passes. Exit at area ratio ε: first guess ln(Pc/Pe) = γ_s + 1.4 ln ε (ε ≥ 2) or ln(Pc/Pt) + sqrt(3.294 ln²ε + 1.535 ln ε) (ε < 2); SP; ε_k = (ρu)_t/(ρu)_e with ρ = 1e5·P_bar/(nRT) in kg/m³ (ln P in μ and S stays in bar); ln(Pc/Pe) += [γ_s u²/(u² − a²)]·(ln ε − ln ε_k) until the change ≤ 4e-5; at most 20 passes. c* = 1e5·Pc_bar/(ρ_t u_t). The exit's first guess uses the throat's γ_s. Vacuum Isp (m/s) = u_e + n_e R T_e/u_e.

**Spike results** (throwaway script, gas only): LOX/LH2 O/F 5.88 at 32.750 bar gave vacuum Isp 464.92, 467.66, 481.02 s at ε 84, 100, 280 against CEA's 464.9, 467.7, 481.0. N2O4/MMH O/F 2.0 at 17.237 bar, ε 50: 341.13 s, c* 1736.39 m/s, Tc 3226.16 K against 340.8, 1735.2, 3223.3. One chamber + throat + exit: 0.6 ms cold with 158 species, 0.2 ms warm.

**The fit:** with losses off, vacuum Isp·g0/c* in the simulator's maths depends on gamma only, and falls as gamma rises (checked from 1.01 to 1.67). That holds for area ratios of about 3 and above; below that the ratio barely moves with gamma or rises with it. So: for ε ≥ 3, and when the solver's Isp/c* lies between the values at gamma 1.01 and 1.67, solve gamma by bisection; otherwise use the solver's throat γ_s clamped to 1.05–1.67. Then molar mass from c* at the solver's Tc, with R = 8314.46/M as `propellants.ts` has it. The fitted gas's exit pressure reads 12–25% high; accepted, and recorded in `docs/future-work.md`.

**Sources for facts:**
- Flame-out: NASA SP-8081 Table I, the coolest operating bipropellant gas generator runs at 811 K. Threshold 800 K.
- Droplet loss: US 8,051,640 B2 (citing AFRPL): about 1% of Isp per 5% aluminium, 4% at 20%. That is 0.105 × the condensed mass fraction of the exhaust.
- Detonates (on-screen failure): liquid ozone (Clark, *Ignition!* ch. 8; CAMEO 5102), tetranitromethane (CAMEO, NFPA instability 4), liquid acetylene (29 CFR 1910.253). Nitromethane, hydrazine, peroxide and nitrous oxide support a warning only.
- Lights on contact: ClF3 with every fuel (Clark ch. 6); F2 and FLOX with almost anything (Clark ch. 8); nitric acid and N2O4 with hydrazine, MMH, UDMH, Aerozine 50, aniline, furfuryl alcohol, turpentine (Clark ch. 2–4; SP-8081 Table I); peroxide with hydrazine and MMH (Clark ch. 5; CAMEO); nitric acid and N2O4 not with alcohols, hydrocarbons, ammonia (Clark ch. 2–3); LOX not with hydrocarbons or hydrogen (SP-8081 Table I). OF2, ClF5, NF3 and N2O: no statement found, so the note says nothing either way.
- Attacks ordinary engine materials: fluorine, FLOX, ClF3 (Clark ch. 6 and ch. 8; HSDB via PubChem), nitric acids (HSDB, PubChem CID 944; Clark ch. 4), peroxide (Clark ch. 5; CAMEO). Toxic exhaust: hydrogen fluoride from any fluorine-bearing oxidiser (HSDB, PubChem CID 14917), beryllium oxide (HSDB, PubChem CID 14775).
- Freezing and boiling points: HSDB via PubChem. Toxicity: NFPA 704 health (PubChem, CAMEO), mapped H0–1 → 0, H2 → 1, H3 → 2, H4 → 3; liquid oxygen 0. Unrated: O3, OF2, NF3, ClF5, ClO3F, N2O.
- Zubrin's nuclear figures (NTRS 19910012833, Table 1) at 2,800 K, infinite expansion: CO2 283 s, water 370 s, methane 606 s; about 93% of those at area ratio 100. No pressure is stated and ammonia is not in the table.

## Review Focus

1. **A mixture pushed to an extreme** (very fuel-rich hydrocarbon forming soot, almost pure oxidiser): the solver settles or reports unsettled; nothing on screen is NaN. Test in Task 3.
2. **A cold exit at a large area ratio** (hydrogen and oxygen at ε 280, where steam starts to condense and temperatures fall below some species' fitted range): the expansion returns a finite answer. Test in Task 4.
3. **A pair with nothing to react** (ammonia with "None", helium-like inert mixes, a metal with no oxidiser): fails as inert or flame-out, never as a crash or a singular matrix. Test in Task 7.
4. **Throttle and a deploying extension change pressure and area ratio every frame:** each frame's solve stays under 2 ms warm and the cache does not grow without bound. Test in Task 6.
5. **Old and damaged share links:** `v1` and `v2` links open as before; a `v3` link naming an unknown fuel or oxidiser opens with the first in the list. Test in Task 10.

---

### Task 1: The data file

**Files:**
- Create: `scripts/build-thermo.mjs`, `src/physics/chem/thermo.json`, `src/physics/chem/THERMO-NOTICE.txt`, `src/physics/chem/thermo.ts`
- Test: `src/physics/chem/thermo.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const R_UNIVERSAL = 8314.51; // J/(kmol K)
  export interface Interval { tMin: number; tMax: number; a: number[]; b: [number, number] }
  export interface Species { name: string; elements: Record<string, number>; phase: number; molarMass: number; intervals: Interval[] }
  export interface Reactant { name: string; elements: Record<string, number>; molarMass: number; h: number; t: number }
  export const SPECIES: Species[];            // products, gases first
  export const REACTANTS: Record<string, Reactant>;
  export function cpR(s: Species, t: number): number;
  export function hRT(s: Species, t: number): number;
  export function sR(s: Species, t: number): number;
  export function speciesFor(elements: string[]): Species[];
  ```
  Element symbols in the JSON are normal case (`Al`, `Cl`). `h` is J/mol at `t` K. Outside a species' range, use the nearest interval.

- [ ] **Step 1: Write the failing test** `thermo.test.ts`:
  - `SPECIES.length` is 511; 427 have `phase === 0`.
  - No species name starts with `Inert`; none has element `E`.
  - For `H2O`: `hRT(s, 298.15) * 8.31451 * 298.15` is within 1 J/mol of −241826.
  - `cpR` of `H2O` at 1000 K is continuous across the interval boundary (999.999 and 1000.001 within 1e-4).
  - `REACTANTS['O2(L)']` is `{ h: -12979, t: 90.17 }`; `REACTANTS['RP-1'].elements` is `{ C: 1, H: 1.95 }`; `REACTANTS['Li(cr)'].h` is 0.
  - Every reactant name listed under "Facts gathered" is present.
  - `speciesFor(['H', 'O'])` has 9 gases and includes `H2O(L)`; none contains carbon.
- [ ] **Step 2: Run it.** `npx vitest run src/physics/chem/thermo.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Write `scripts/build-thermo.mjs`.** `node scripts/build-thermo.mjs <path to thermo.inp>`: checks the sha256 above (fails loudly if different), parses per the format above, keeps products within the eleven elements without ions, keeps every non-`Inert`, non-`Air` reactant record within those elements plus the eight product records named above as reactants (h = H at 298.15 from the polynomial, t = 298.15), drops intervals above 6000 K, writes `src/physics/chem/thermo.json` with numbers at full precision. Fetch `thermo.inp` to a temporary folder to run it; do not commit `thermo.inp`.
- [ ] **Step 4: Write `THERMO-NOTICE.txt`:** the source URL, the sha256, "NASA Glenn thermodynamic database, from NASA/TP-2002-211556; distributed with NASA CEA under the Apache License 2.0", and the copyright line from the `nasa/cea` NOTICE file.
- [ ] **Step 5: Write `thermo.ts`** importing the JSON statically.
- [ ] **Step 6: Run the test.** Expected: PASS. Then check `thermo.json` is under 300 KB.
- [ ] **Step 7: Commit** "Add NASA's thermodynamic data for the chemistry solver".

### Task 2: Equilibrium of a gas mixture

**Files:**
- Create: `src/physics/chem/equilibrium.ts`
- Test: `src/physics/chem/equilibrium.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  export interface Mixture { b0: Record<string, number>; h0: number } // kmol of atoms per kg; J/kg
  export type Problem =
    | { kind: 'tp'; t: number; pBar: number }
    | { kind: 'hp'; h: number; pBar: number }
    | { kind: 'sp'; s: number; pBar: number };   // s in J/(kg K)
  export interface EqState {
    ok: boolean;              // false: did not settle; no other field may be shown
    t: number; pBar: number;
    n: number;                // kmol of gas per kg
    species: Species[]; moles: Float64Array; // kmol per kg, same order
    lnMoles: Float64Array;    // ln of each gas's moles, kept even where `moles` is counted as zero
    h: number; s: number;     // J/kg, J/(kg K)
    molarMass: number;        // 1/n
    cp: number; gammaS: number; dlnVdlnT: number; dlnVdlnP: number;
    condensedMassFraction: number;
    iterations: number;
  }
  export function mixtureFrom(parts: { reactant: Reactant; massFraction: number }[]): Mixture;
  export function equilibrate(mix: Mixture, problem: Problem, species?: Species[], start?: EqState): EqState;
  ```
  `species` defaults to `speciesFor` the elements present in `mix`. A warm start copies `t`, `n`, `lnMoles` and the condensed `moles` from `start`. This task handles gases only: condensed species in the list are ignored until Task 3.

- [ ] **Step 1: Write the failing tests** (CEA sample problems, gas only):
  - **Fixed temperature** (RP-1311 Example 14): `H2(L)` 100 mol with `O2(L)` 60 mol, 0.05 atm (0.0506625 bar), 1000 K: mole fractions H2O 0.90909, O2 0.090909, each within 1e-4.
  - **Chamber** (Example 8): `H2(L)`, `O2(L)`, O/F 5.55157, 53.3172 bar, HP: T within 0.1% of 3383.845 K; molar mass within 0.1% of 12.716; mole fractions H2O 0.63456, H2 0.29479, OH 0.033341, H 0.033498 each within 2e-4; `gammaS` within 0.2% of 1.145.
  - **Chamber** (Example 12): `CH6N2(L)` with `N2O4(L)`, O/F 2.5, 68.948 bar: T within 0.3% of 3382.32 K, molar mass within 0.3% of 23.845, `gammaS` within 0.5% of 1.138.
  - **Atoms conserved:** for the Example 8 result, Σ_j a_ij·moles_j equals b0_i within 1e-6 × the largest b0, for each element.
  - **Fixed entropy returns to itself:** SP at the Example 8 chamber's own `s` and pressure gives its T within 0.01%.
  - **Warm start:** the Example 12 chamber re-solved at 1% higher pressure from `start` takes at most 5 iterations.
  - **Absent elements:** `equilibrate` of hydrogen and oxygen given `speciesFor(['C','H','O','N'])` gives the same T as with the default list, within 0.01%.
- [ ] **Step 2: Run.** `npx vitest run src/physics/chem/equilibrium.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `mixtureFrom` and `equilibrate` per "Facts gathered: Solver", with Gaussian elimination with partial pivoting (a zero pivot is "singular"), the damping, convergence tests, zero-mole handling, singular-matrix restart and the derivatives. Allocate work arrays once per call, not per iteration.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** "Find the equilibrium make-up of a hot gas mixture".

### Task 3: Liquid and solid products

**Files:**
- Modify: `src/physics/chem/equilibrium.ts`
- Test: `src/physics/chem/equilibrium.test.ts`

**Interfaces:** unchanged. `EqState.moles` now holds condensed species too; `condensedMassFraction` is their share of the mixture's mass.

- [ ] **Step 1: Write the failing tests:**
  - **Water condenses** (Example 14): same mixture at 0.05 atm and 300 K: mole fraction (over all species) of `H2O(L)` within 0.002 of 0.69949.
  - **Beryllium oxide droplets** (Example 13 chamber): fuel 80% `N2H4(L)` + 20% `Be(a)` by mass, oxidiser `H2O2(L)`, 67% fuel by mass, 206.84 bar, HP: T within 0.5% of 3002.54 K; mole fraction of `BeO(L)` within 0.003 of 0.19218; molar mass (1/n) within 0.5% of 16.627.
  - **Soot** (Review Focus 1): `RP-1` with `O2(L)` at O/F 0.5, 70 bar: `ok` is true, `C(gr)` has moles above 0, T is finite and between 800 and 2500 K.
  - **Almost pure oxidiser** (Review Focus 1): `RP-1` with `O2(L)` at O/F 200, 70 bar: either `ok` with a finite T, or `ok === false`; never NaN in `t`, `n` or `molarMass`.
  - **Alumina:** `AL(cr)` 30% + `RP-1` 70% by mass as fuel with `O2(L)`, O/F 2, 70 bar: `ok`, `condensedMassFraction` above 0.1, an `AL2O3` condensed species has moles above 0.
  - The Task 2 tests still pass unchanged.
- [ ] **Step 2: Run.** Expected: the new tests FAIL (no condensed moles; water test reports no liquid).
- [ ] **Step 3: Implement** the condensed rows of the matrix, the add-one-and-reconverge loop, removal on negative moles, and phase choice by temperature interval, per "Facts gathered: Solver".
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** "Let liquid and solid products form in the equilibrium solver".

### Task 4: Through the nozzle

**Files:**
- Create: `src/physics/chem/rocket.ts`
- Test: `src/physics/chem/rocket.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  ```ts
  export interface RocketResult {
    ok: boolean;
    chamber: EqState; throat: EqState; exit: EqState;
    cStar: number;      // m/s
    ispVac: number;     // m/s, at the exit, equilibrium flow, no losses
    pExitBar: number;
  }
  export function rocket(mix: Mixture, chamber: Problem, eps: number, start?: RocketResult): RocketResult;
  ```
  `chamber` is `hp` for a flame and `tp` for a reactor-heated fluid. `ok` is false if any of the three solves, or the throat or exit iteration, did not settle.

- [ ] **Step 1: Write the failing tests:**
  - **Example 8:** O/F 5.55157, 53.3172 bar: `cStar` within 0.2% of 2332.34; `ispVac` within 0.2% of 4348.51, 4487.30, 4554.91 at ε 25, 50, 75.
  - **RocketCEA, hydrogen and oxygen**, O/F 5.88, 32.750 bar: `ispVac/9.80665` within 0.3% of 464.9, 467.7, 473.5, 477.1, 481.0 at ε 84, 100, 150, 200, 280. (The last is Review Focus 2: a cold, partly condensing exit.)
  - **RocketCEA sweep, hydrogen and oxygen**, 6.895 bar, ε 40, O/F 2 to 8 in steps of 1: within 0.5% of 424.360, 445.444, 453.133, 453.240, 448.190, 438.743, 424.700 s.
  - **RocketCEA sweep, N2O4 and MMH**, 17.237 bar, ε 50, O/F 1.5, 2.0, 2.3, 2.9: `ispVac` within 1% of 329.3, 340.8, 343.0, 329.3 s; `cStar` within 1% of 1736.9, 1735.2, 1706.5, 1638.5 m/s; chamber T within 1% of 2988.7, 3223.3, 3241.8, 3181.3 K; chamber molar mass within 1% of 19.75, 21.99, 22.98, 24.47.
  - **Droplets through the nozzle** (Example 13): pressure ratio 300 corresponds to ε 30.0004: `rocket` at ε 30.0004 gives `ispVac` within 1% of 3770.30 and `cStar` within 1% of 1946.68.
  - **Lithium and fluorine** (Example 11, CEA includes ions, we do not): `Li(cr)` 1 mol with `F2(L)` 0.5556 mol, 68.948 bar, ε 100: `cStar` within 2% of 2274.40, `ispVac` within 2% of 4504.51.
  - **Fixed-temperature chamber:** `NH3(L)` alone, `{ kind: 'tp', t: 2800, pBar: 55 }`, ε 100: `ok`, chamber molar mass between 8.3 and 8.7.
  - **Huzel and Huang** (1971 table, 68.95 bar, ε 40; the table's own data is older, hence 3%): `ispVac` within 3% of LOX/H2 4462 at O/F 4.83, LOX/CH4 3615 at 3.45, LOX/RP-1 3510 at 2.77, F2/H2 4697 at 9.74, F2/NH3 4143 at 3.35, ClF3/N2H4 3356 at 2.89, N2O4/MMH 3347 at 2.37, N2O4/N2H4 3369 at 1.42, H2O2/N2H4 3308 at 2.12, LOX/B2H6 4016 at 2.06, N2O4/B5H9 3513 at 3.26. (The spec names chlorine pentafluoride; its liquid is not in `thermo.inp`. If Task 5 finds a sourced heat content, add ClF5/N2H4 3580 at 2.71 to `pair.test.ts`; if not, future-work says so.)
- [ ] **Step 2: Run.** `npx vitest run src/physics/chem/rocket.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `rocket`** per "Facts gathered: Solver: Rocket". Each solve starts from the previous station; with `start`, from the matching station of `start`.
- [ ] **Step 4: Run.** Expected: PASS. If a Huzel row misses 3% while the CEA rows pass, the table is the suspect: mark that one row `it.fails` with the measured error in a comment, record it in the ledger as a ruling and in `docs/future-work.md`. Do not widen the tolerance.
- [ ] **Step 5: Commit** "Follow the reacting exhaust through the throat to the nozzle exit".

### Task 5: The ingredients

**Files:**
- Create: `src/physics/chem/ingredients.ts`
- Test: `src/physics/chem/ingredients.test.ts`

**Interfaces:**
- Consumes: `REACTANTS`, `mixtureFrom`.
- Produces:
  ```ts
  export type Family = 'hydrogen' | 'hydrocarbon' | 'alcohol' | 'amine' | 'borane' | 'metal' | 'nitro' | 'cyanogen'
    | 'oxygen' | 'nitrogen-oxide' | 'peroxide' | 'halogen' | 'none';
  export interface Fact { text: string; source: string }
  export interface Ingredient {
    id: string; name: string; tip: string;
    group: 'Everyday' | 'Storable' | 'Exotic';
    family: Family;
    /** What it is made of: thermo.inp reactants and their mass shares (sum 1) */
    parts: { reactant: string; share: number }[];
    /** Heat content not from thermo.inp: the reactant record and where it came from */
    custom?: { reactant: Reactant; source: string }[];
    freezeC?: number; boilC?: number; pointsSource?: string;
    toxicity?: 0 | 1 | 2 | 3; toxicitySource?: string; toxicExhaust?: Fact;
    detonates?: Fact; attacksMaterials?: Fact; warning?: Fact;
    /** Runs alone over a catalyst */
    monopropellant?: Fact;
  }
  export const NO_OXIDISER = 'none';
  export const FUELS: Record<string, Ingredient>; export const FUEL_IDS: string[];
  export const OXIDISERS: Record<string, Ingredient>; export const OXIDISER_IDS: string[];
  export function isFuelId(v: unknown): v is string; export function isOxidiserId(v: unknown): v is string;
  export function reactantOf(name: string): Reactant;      // thermo.inp or a custom record
  export function mixtureOf(fuel: string, oxidiser: string, of: number): Mixture;  // NO_OXIDISER ignores `of`
  export function lightsOnContact(fuel: string, oxidiser: string): { lights: boolean; source: string } | null;
  ```
  Ids are short lower-case slugs (`rp1`, `lox`, `mmh`, `n2o4`, `clf3`). The first fuel is `rp1`, the first oxidiser `lox`.

- [ ] **Step 1: Write the failing tests:**
  - Every ingredient: `parts` shares sum to 1 within 1e-9; every part resolves through `reactantOf`; `tip` is longer than 20 characters; `name` is unique within its list.
  - Every `Fact` on every ingredient, every `custom` record, and every `pointsSource`/`toxicitySource` where the value is set, has a `source` longer than 8 characters.
  - `FUEL_IDS` has at least 26 entries and includes `h2`, `ch4`, `rp1`, `ethanol`, `nh3`, `n2h4`, `mmh`, `udmh`, `aerozine50`, `b5h9`, `li`, `al-slurry`, `c2n2`, `ch3no2`; `OXIDISER_IDS` has at least 14 and includes `none`, `lox`, `lf2`, `flox70`, `o3`, `of2`, `clf3`, `n2o4`, `mon25`, `irfna`, `wfna`, `htp90`, `htp98`.
  - `OXIDISERS.lf2.attacksMaterials` and `OXIDISERS.clf3.attacksMaterials` are set.
  - `OXIDISERS.o3.detonates` and `FUELS.c2h2.detonates` are set; `FUELS.ch3no2.detonates` and `FUELS.n2h4.detonates` are not.
  - `FUELS.n2h4.monopropellant` and `FUELS.ch3no2.monopropellant` are set; `FUELS.rp1.monopropellant` is not.
  - `mixtureOf('h2', 'lox', 8)`: `b0.H / b0.O` within 0.5% of 2 × (15.9994/1.00794)/8.
  - `mixtureOf('n2h4', 'none', 3)` equals `mixtureOf('n2h4', 'none', 0)`.
  - `lightsOnContact('mmh', 'n2o4')` is `{ lights: true }`; `('rp1', 'lox')` is `{ lights: false }`; `('h2', 'clf3')` is `{ lights: true }`; `('ethanol', 'wfna')` is `{ lights: false }`; `('rp1', 'of2')` is `null`.
- [ ] **Step 2: Run.** `npx vitest run src/physics/chem/ingredients.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Write the records.** Use the reactant names and sources under "Facts gathered". Blends: Aerozine 50 = 50/50 `N2H4(L)`/`C2H8N2(L),UDMH`; MON-25 = 75/25 `N2O4(L)`/`NO`; FLOX-70 = 70/30 `F2(L)`/`O2(L)`; ethanol 75% = 75/25 `C2H5OH(L)`/`H2O(L)`; peroxide 90% and 98% = `H2O2(L)` with `H2O(L)`; aluminium slurry = 30/70 `AL(cr)`/`RP-1`; gasoline as iso-octane, named "Gasoline (iso-octane)". Peroxide (90%) and nitrous oxide also appear in the fuel list, for use alone. For each ingredient not in `thermo.inp` (list under "Facts gathered"), look for a liquid heat of formation in the NIST Chemistry WebBook; with one, add it as `custom` with the URL as source; without one, leave the ingredient out and add it to a list in `docs/future-work.md`. A fact with no entry under "Facts gathered: Sources" and no source you can open is left unset.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** "List the fuels and oxidisers, with a source for every fact".

### Task 6: A pair's gas, fitted for the simulator

**Files:**
- Create: `src/physics/chem/pair.ts`
- Test: `src/physics/chem/pair.test.ts`

**Interfaces:**
- Consumes: `rocket`, `mixtureOf`, `REACTANTS`, and from `src/physics/nozzle.ts` the existing `cStar`, `machFromAreaRatio`, `pressureRatio`, `exitVelocity`.
- Produces:
  ```ts
  export const DROPLET_LOSS = 0.105;   // share of Isp lost per unit condensed mass fraction (US 8,051,640)
  export interface SolvedGas {
    ok: boolean;
    tc: number; gamma: number; molarMass: number;   // the fitted simple gas
    cStar: number; ispVac: number;                  // solver's own, m/s, droplet loss applied to ispVac
    condensedShare: number;                         // mass fraction at the exit
    exhaust: { name: string; share: number }[];     // exit mole fractions over all species, largest first, at most 6, each ≥ 0.005
  }
  export function fitGas(tc: number, cStar: number, ispVac: number, eps: number): { gamma: number; molarMass: number };
  export function solvePair(fuel: string, oxidiser: string, of: number, pcBar: number, eps: number): SolvedGas;
  export function solveFluid(reactant: string, tK: number, pcBar: number, eps: number): SolvedGas;
  export interface MixRange { ofMin: number; ofMax: number; ofDefault: number; ofPeak: number }
  export function pairRange(fuel: string, oxidiser: string): MixRange;
  export function clearChemCache(): void;
  ```
  `solvePair` and `solveFluid` keep results in a map keyed on fuel, oxidiser, `of` rounded to 0.01, `pcBar` and `eps` each rounded to 3 significant figures; they solve at the rounded values, warm-start from the last result for the same pair, and drop the oldest entries past 2,000. `pairRange` (cached per pair) works at 70 bar and ε 40: `ofPeak` is the ratio of highest chamber temperature; `ofDefault` the ratio of highest `ispVac`, rounded to 0.01; `ofMin` and `ofMax` are where chamber temperature falls to 700 K either side (bisection), held within `ofDefault/50` and `ofDefault × 50`. In the bisection an unsettled solve counts as colder than 700 K. Where 700 K is not reached inside the hold, the hold is the limit and that end does not flame out: a fuel that gives off heat falling apart (kerosene, hydrazines, boranes) never goes cold at the fuel-rich end at equilibrium. With `NO_OXIDISER` all four are 0.

- [ ] **Step 1: Write the failing tests:**
  - **Fit reproduces the solver:** for `('h2','lox',5.88,32.75,280)` and `('mmh','n2o4',2.0,17.237,50)`, putting the result's `tc`, `gamma`, `molarMass` through the simulator's maths (`cStar(g, 8314.46/M, tc)` and the vacuum thrust expression in `simulate` with `nozzleEff` 1) gives `cStar` and `ispVac` within 0.5% of the result's own.
  - **Fit is the documented one:** `fitGas(3384.18, 2299.03, 481.02 * 9.80665, 280)` gives gamma within 0.002 of 1.17705 and molar mass within 0.05 of 12.835.
  - **Droplet loss:** `solvePair('al-slurry','lox', pairRange(...).ofDefault, 70, 40)` has `condensedShare` above 0.1, and its `ispVac` is the loss-free value × (1 − 0.105 × condensedShare) within 1e-9 (compare with `rocket` directly).
  - **Exhaust readout:** hydrogen and oxygen at O/F 6: first entry is `H2O` with share above 0.6; shares are in falling order; at most 6.
  - **Range:** `pairRange('h2','lox')`: `ofDefault` between 3.5 and 5.5; `ofPeak` between 7 and 9; `ofMin` below 1; `ofMax` above 20; `solvePair` at `ofMin` and `ofMax` has `tc` below 800 or `ok` false. `pairRange('rp1','lox')`: `ofMin` equals `ofDefault/50` within 0.01 and `solvePair` at `ofMax` has `tc` below 800 or `ok` false.
  - **Small nozzles:** `solvePair('rp1','lox', 2.5, 70, eps)` at ε 1.1025 and 2: `gamma` between 1.05 and 1.4, and the simulator's `cStar` from the fitted gas within 0.5% of the result's.
  - **Monopropellant:** `pairRange('n2h4','none')` is all zeros; `solvePair('n2h4','none',0,20,50).ok` is true with `tc` between 800 and 1500.
  - **Not settled is said:** stub by calling `solvePair` with a `pcBar` of `NaN`: `ok` is false.
  - **Speed** (Review Focus 4): after `clearChemCache()`, 200 calls of `solvePair('b5h9','of2', 3, p, 40)` with `p` stepping 100 → 60 bar take under 400 ms in total, and the first call under 200 ms. Then, with a 30 s test timeout, 2,100 calls of `solvePair('h2','lox', 2 + i*0.01, 70, 40)` leave `chemCacheSize()` (exported beside `clearChemCache`) at exactly 2,000.
  - **Fluid:** `solveFluid('NH3(L)', 2800, 55, 100)`: `ok`, `tc` 2800, `ispVac/9.80665` between 380 and 480.
- [ ] **Step 2: Run.** `npx vitest run src/physics/chem/pair.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** `fitGas`: bisection on gamma over 1.01–1.67 so the simulator's vacuum thrust coefficient at `eps` equals `ispVac/cStar`, clamped to that span; then molar mass from `cStar` at `tc`. `solveFluid`: `rocket` with a `tp` chamber on the reactant alone.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** "Fit a pair's calculated exhaust to the simple gas the simulator uses".

### Task 7: Whether it works

**Files:**
- Create: `src/physics/chem/verdict.ts`
- Test: `src/physics/chem/verdict.test.ts`

**Interfaces:**
- Consumes: `FUELS`, `OXIDISERS`, `lightsOnContact`, `SolvedGas`.
- Produces:
  ```ts
  export const FLAMEOUT_K = 800;   // NASA SP-8081 Table I
  export type ChemFailure = 'flameout' | 'inert' | 'detonation' | 'unsolved';
  export interface Verdict { failure: ChemFailure | null; notes: string[] }
  export function verdictFor(fuel: string, oxidiser: string, gas: SolvedGas): Verdict;
  ```
  Order of failure: `detonation` (either ingredient has `detonates`), `inert` (no oxidiser and the fuel has no `monopropellant`), `unsolved` (`!gas.ok`), `flameout` (an oxidiser is present and `gas.tc < FLAMEOUT_K`). Notes, in this order, each one short sentence: lights on contact / needs an igniter (omitted when `lightsOnContact` is `null` or there is no oxidiser); one freezes the other (one's `boilC` is below the other's `freezeC`); attacks materials; toxicity 3 "Extremely toxic", 2 "Toxic"; toxic exhaust; any `warning`; droplets when `condensedShare ≥ 0.02` ("9% of the exhaust is liquid or solid droplets"); the hydrazine-alone caveat from the spec.

- [ ] **Step 1: Write the failing tests** (using `solvePair` and `pairRange` for the gas):
  - `('rp1','lox')` at default: no failure; notes include one containing "igniter".
  - `('mmh','n2o4')`: notes include one containing "on contact".
  - `('h2','o3')` and `('c2h2','lox')`: `detonation`.
  - `('h2','lox')` at `ofMin` and at `ofMax`: `flameout`. `('rp1','lox')` at `ofMax`: `flameout`.
  - (Review Focus 3) `('nh3','none')`, `('li','none')`, `('rp1','none')`: `inert` whatever `solvePair` returned for them, and `solvePair` for each returned without throwing (it may return `ok: false`).
  - `('n2h4','none')`: no failure; a note mentions real thrusters.
  - `('b5h9','of2')`: no failure; notes include "Extremely toxic". `('al-slurry','lox')`: a note about droplets.
  - `('h2','lf2')`: no failure; a note about attacking materials.
  - A gas with `ok: false`: `unsolved`.
  - `('h2','n2o4')`: a note about freezing (hydrogen boils at −252.8 °C, N2O4 freezes at −9.3 °C).
- [ ] **Step 2: Run.** `npx vitest run src/physics/chem/verdict.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `verdictFor`.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** "Judge whether a fuel and oxidiser would work".

### Task 8: One way to ask for an engine's gas

**Files:**
- Create: `src/physics/gasSource.ts`
- Modify: `src/physics/types.ts`, `src/physics/propellants.ts`, `src/physics/engine.ts`, `src/physics/engine.test.ts`, `src/physics/limits.ts`, `src/physics/reshape.ts`, `src/physics/presets.ts`, `src/physics/parts.ts`, `src/ui/copy.ts`, `src/ui/controls.ts`, `src/state/share.ts`, `src/render/plumeParams.ts`, `src/render/geometry.ts`, `src/render/engineView.ts`, `src/render/aerospikeView.ts`, `src/sim/runtime.ts`
- Test: `src/physics/gasSource.test.ts`, and existing tests updated as named below

**Interfaces:**
- Consumes: Tasks 5–7.
- Produces:
  ```ts
  // types.ts
  PropellantId gains 'calculated';
  EngineConfig gains `fuel: string; oxidiser: string;`
  Failure gains 'flameout' | 'inert' | 'detonation' | 'unsolved';
  SimResult gains `exhaust: { name: string; share: number }[]; notes: string[]; calculated: boolean;`
  // propellants.ts
  PROPELLANTS.calculated, placed after hypergolic: energy 'combustion', name 'Calculated', a tip over 20 characters,
    ofMin/ofMax/ofDefault 0, lStarRef 1.0, kerolox's look, empty table (none of these is read: the seam answers for it);
  Propellant gains `pair?: { fuel: string; oxidiser: string }` (kerolox rp1/lox, hydrolox h2/lox, methalox ch4/lox, hypergolic udmh/n2o4)
    and `fluid?: string` (thermo reactant for ntr-ammonia etc.; not used until Task 9);
  // gasSource.ts
  export interface GasSource {
    calculated: boolean;
    gas: GasProps;
    lStarRef: number; look: PlumeLook; richness: number;
    failure: ChemFailure | null; exhaust: { name: string; share: number }[]; notes: string[];
  }
  export function resolveGas(cfg: EngineConfig, pcBar: number, eps: number): GasSource;
  export function mixRange(cfg: EngineConfig): { ofMin: number; ofMax: number; ofDefault: number };
  export function staticLook(cfg: EngineConfig): PlumeLook;   // for callers with no pressure to hand
  ```
  `mixRange` for a tabled propellant returns the record's own `ofMin`, `ofMax`, `ofDefault` and never calls the solver, so building the examples at module load stays table-only. For a tabled propellant `resolveGas` returns exactly `gasProps(cfg.propellant, cfg.mixtureRatio)`, the record's `lStarRef` and `look`, `richness(...)`, no failure, no exhaust, no notes. For `'calculated'`: `solvePair` and `verdictFor`; `lStarRef` and `look` borrowed by fuel family (hydrogen → hydrolox's; hydrocarbon, metal, cyanogen → kerolox's; alcohol, nitro → methalox's; every other family → hypergolic's); `richness` = clamp((ofPeak − of)/ofPeak, −1, 1), 0 with no oxidiser. With no oxidiser and a fuel that has no `monopropellant`, the solver is not called. Whenever there is no settled gas (that case, or `!gas.ok`, whatever the failure), the gas is `{ tc: 300, gamma: 1.4, molarMass: 28, R: 8314.46 / 28 }` and `exhaust` is empty. A fitted gas has `R = 8314.46 / molarMass`.

  `simulate` changes, and nothing else in its arithmetic: it takes `gas`, `lStarRef` from `const gasSource = resolveGas(cfg, pcBar, eps)`; keeps both existing `mixKind` conditions on the `(pcBar/70)^0.03` factor and on `rough`, and ANDs each with `!gasSource.calculated`; returns `failure: gasSource.failure ?? failureFor(...)`, plus `exhaust`, `notes`, `calculated`.

  `sanitize`: `fuel` and `oxidiser` not known become `FUEL_IDS[0]` and `OXIDISER_IDS[0]`; for a tabled propellant with a `pair`, they are set to that pair; mixture clamps to `mixRange`. `propellantsFor('combustion')` no longer lists `'calculated'` first: it returns the four tabled ids then `'calculated'`, and `withEnergy(cfg, 'combustion')` and `starterEngine()` use `'calculated'` with `rp1`/`lox` at `pairRange('rp1','lox').ofDefault`.

- [ ] **Step 1: Write the failing tests** in `gasSource.test.ts`:
  - For each tabled combustion id at its `ofDefault`: `resolveGas` gas deep-equals `gasProps(id, of)`; `calculated` false; `failure` null.
  - `simulate` of every example at 0 km and 100 km: `calculated` false, `notes` and `exhaust` empty.
  - A calculated `rp1`/`lox` engine (from `starterEngine()`): `simulate(...).calculated` true; `failure` null; vacuum Isp between 290 and 360 s; `exhaust` non-empty.
  - The same engine with `fuel: 'h2'` then `fuel: 'rp1'`: identical `simulate` result to before (one basis).
  - `starterEngine()` with `oxidiser: 'o3'`: `failure` is `'detonation'`. With `mixtureRatio` at `mixRange(...).ofMax`: `'flameout'`. With `oxidiser: 'none'`: `'inert'`.
  - `sanitize(preset.config)` deep-equals `preset.config` for every example.
  - **Solver against the tables:** for each tabled pair at its `ofDefault`, 70 bar, ε 16, the same engine tabled and with `propellant: 'calculated'`: `console.info` the percentage difference in vacuum Isp; each is finite and under 10%.
  - A calculated engine's Isp does not carry the pressure fudge: `simulate(...).tc` equals `solvePair(...).tc` at the same rounded inputs.
  - `sanitize` of a config with `fuel: 'bogus'` gives `fuel === 'rp1'`; of the Merlin example gives `fuel: 'rp1', oxidiser: 'lox', propellant: 'kerolox'`.
  - Every calculated starter engine with each fuel in `FUEL_IDS` against `lox`, and `h2` against each oxidiser: `simulate` returns finite `thrust`, `isp`, `tc` (no NaN), whatever the failure.
- [ ] **Step 2: Run.** `npx vitest run src/physics/gasSource.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the types, `gasSource.ts`, and the `simulate`/`sanitize` changes above. To keep `tsc` green in this task: add the four new `FAILURE_COPY` entries in `src/ui/copy.ts` (wording under Task 11); add `fuel`/`oxidiser` (`FUEL_IDS[0]`, `OXIDISER_IDS[0]`; `sanitize` then applies the pair) to the config literal in `share.ts` `decodeState`; add `fuel: 'rp1', oxidiser: 'lox'` to `base` in `engine.test.ts`; in `presets.ts` `build()` set `fuel`/`oxidiser` to `PROPELLANTS[s.propellant].pair` where there is one and `FUEL_IDS[0]`/`OXIDISER_IDS[0]` otherwise (exactly what `sanitize` returns); in `controls.ts` take the mixture slider's range and step from `mixRange`.
- [ ] **Step 4: Switch the other readers** from `PROPELLANTS[cfg.propellant]`/`gasProps`/`richness`/`clampMixture` to the seam: `reshape.ts` (`lStarRef` via `resolveGas` at the config's own pressure and area ratio; `ofDefault` via `mixRange`), `plumeParams.ts:122,180,194`, `geometry.ts:218`, `engineView.ts:164`, `aerospikeView.ts:33`, `runtime.ts:405`, and add `fuel` and `oxidiser` to the two reset keys at `runtime.ts:126,302`. Export a helper from `engine.ts` for callers that hold only a config: `gasFor(cfg: EngineConfig): GasSource` using full throttle and `flowExitDiameter`.
- [ ] **Step 5: Update existing tests that pin the old shape:** `parts.test.ts:20` (combustion list now ends with `'calculated'`), `reshape.test.ts` (starter engine and `withEnergy(…,'combustion')` are calculated), `state.test.ts` where the starter's propellant is named. Do not touch `presets.regression.test.ts` or its snapshot.
- [ ] **Step 6: Run** `npm test` and `npx tsc --noEmit`. Expected: all pass, snapshot unchanged ("0 snapshots written, 0 updated").
- [ ] **Step 7: Commit** "Give every engine its gas through one seam, tabled or calculated".

### Task 9: Nuclear fluids from the solver

**Files:**
- Modify: `src/physics/propellants.ts`, `src/physics/gasSource.ts`, `src/physics/propellants.test.ts`
- Test: `src/physics/gasSource.test.ts`

**Interfaces:**
- `fluid` set on `ntr-ammonia` (`NH3(L)`), `ntr-methane` (`CH4(L)`), `ntr-water` (`H2O(L)`), `ntr-co2` (`CO2`), `ntr-helium` (`He`). `ntr-hydrogen` has none and keeps its table. Their hand-typed tables are deleted; `ofMin`, `ofMax`, `ofDefault`, name, tip and look stay.
- `resolveGas` for a propellant with `fluid`: `solveFluid(fluid, cfg.mixtureRatio, pcBar, eps)`; `calculated` true; `failure` only ever `unsolved` or null; notes carry the droplet note; `lStarRef` 0.

- [ ] **Step 1: Write the failing tests:**
  - NERVA's figures unchanged (the regression snapshot covers it; assert here that `resolveGas` for `ntr-hydrogen` is not `calculated`).
  - `rocket` directly (no droplet loss), `tp` chamber at 2,800 K, 55 bar, ε 100, `ispVac/9.80665`: water within 2% of 364; carbon dioxide within 2% of 247 (both measured with the spike's solver; neither forms droplets); methane nearer to 564 (93% of Zubrin's 606) than 474 (93% of part 1's 510). Zubrin's "about 93% at area ratio 100" does not hold per fluid (water comes out at 98% of 370, carbon dioxide at 87% of 283), and his study states no pressure; Step 4 records the gaps.
  - On the NERVA example with each fluid: `simulate` has no failure at the fluid's default temperature, finite figures, and the order of vacuum Isp is hydrogen > helium > methane > ammonia > water > carbon dioxide (if the solver disagrees on methane against helium or ammonia, assert the solver's order and record it).
  - Helium: exhaust readout is `He` at share 1; gamma within 0.01 of 1.667.
  - Methane at 2,800 K: a droplet note is present (soot).
- [ ] **Step 2: Run.** Expected: FAIL (`fluid` unset, tables still in use).
- [ ] **Step 3: Implement.** Replace the old Isp-share bands in `propellants.test.ts` (lines 46–61) with the tests above.
- [ ] **Step 4: Record** in `docs/future-work.md` each fluid's solver figure against Zubrin's, and an explanation for any more than 5% out.
- [ ] **Step 5: Run** `npm test`. Expected: PASS, snapshot unchanged.
- [ ] **Step 6: Commit** "Work out a reactor's working fluids with the solver".

### Task 10: Store and share links

**Files:**
- Modify: `src/state/store.ts`, `src/state/share.ts`
- Test: `src/state/state.test.ts`

**Interfaces:**
- `store.setFuel(id: string): void`, `store.setOxidiser(id: string): void`: set the part, set `propellant: 'calculated'`, and put `mixtureRatio` at the new pair's `ofDefault`. `isModified` also compares `fuel` and `oxidiser`. `store.set({config:{propellant}})` to a tabled id keeps working (examples, Reset).
- `share.ts`: `VERSION = 'v3'`, 20 entries: the `v2` layout with `fuel` and `oxidiser` inserted after `propellant`. `v2` (18) and `v1` decode as now, then `sanitize` fills `fuel` and `oxidiser`. A `v3` link with an unknown fuel or oxidiser decodes (sanitised to the first in each list); an unknown energy, exhaust or propellant still returns null.

- [ ] **Step 1: Write the failing tests:**
  - A calculated engine (`b5h9`, `of2`, O/F 3.1) round-trips through `encodeState`/`decodeState` with the same fuel, oxidiser, propellant and mixture.
  - Every example still round-trips. The existing assertion at `state.test.ts:48-54` changes to `v3.` and 20 entries, fuel and oxidiser after propellant.
  - (Review Focus 5) The existing `v1` and `v2` fixtures in `state.test.ts` decode to the same engines as before, with `fuel` and `oxidiser` filled from the tabled pair.
  - (Review Focus 5) A `v3` link edited to name fuel `'xyz'` decodes with `fuel === 'rp1'`; one of wrong length returns null.
  - `setFuel('ch4')` on the Merlin example: `propellant` is `'calculated'`, `isModified` true, mixture equals `pairRange('ch4','lox').ofDefault`. Then `setFuel('rp1')`: still `'calculated'`, still modified. Then Reset to stock: `propellant` `'kerolox'`, not modified.
- [ ] **Step 2: Run.** `npx vitest run src/state/state.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** "Carry fuel and oxidiser in the store and in share links".

### Task 11: The workshop screen

**Files:**
- Modify: `src/ui/controls.ts`, `src/ui/copy.ts`, `src/ui/readouts.ts`, `src/main.ts`, `src/style.css`, `src/render/engineView.ts`, `src/render/aerospikeView.ts`, `src/sim/runtime.ts`
- Test: `src/ui/copy.test.ts` (create if absent), `src/render/geometry.test.ts` or the nearest existing render test for the failure drawing choice

**Interfaces:**
- `SelectSpec` gains `hidden?(s: AppState): boolean` and options gain `group?: string` (rendered as `<optgroup>`; group names join the rebuild key). `SliderSpec.log` becomes `boolean | ((s: AppState) => boolean)`.
- `copy.ts`: `FAILURE_COPY` entries (added in Task 8; final wording here) for `flameout` ("Flame-out", the mixture is too cold to keep burning), `inert` ("Nothing to burn it with"), `detonation` ("Detonation", naming that the propellant explodes when pumped), `unsolved` ("No answer", the chemistry would not settle for this mixture, so no figures are shown); `failureCopy` unchanged in signature. `TIPS.fuel`, `TIPS.oxidiser`. `SPECIES_NAMES: Record<string, string>` giving plain names for exhaust species (`H2O` "Steam", `CO2` "Carbon dioxide", `HF` "Hydrogen fluoride", `B2O3(L)` "Liquid boron oxide", `C(gr)` "Soot", …) and `speciesName(name: string): string` falling back to the formula.
- `export function destroys(f: Failure): boolean` in `src/physics/limits.ts`: false for null, `flameout`, `inert`, `unsolved`; true otherwise.

- [ ] **Step 1: Write the failing tests:**
  - `failureCopy` returns a title and text for each of the four new kinds, for energy `'combustion'`.
  - `speciesName('H2O')` is `'Steam'`; `speciesName('XyZ')` is `'XyZ'`; every species name that `solvePair` reports in `exhaust` for `('rp1','lox')`, `('h2','lf2')`, `('b5h9','of2')`, `('mmh','n2o4')`, `('al-slurry','lox')` at their defaults has an entry in `SPECIES_NAMES`.
  - `showsFigures` is false for a result with failure `unsolved` and true for `flameout`, `burst` and null.
  - `destroys('flameout')` false; `destroys('detonation')` true; `destroys('burst')` true.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Pickers.** In the Parts group: Fuel and Oxidiser selects (`#fuel`, `#oxidiser`), hidden unless the energy source is `'combustion'`; the Propellant select hidden when it is. Options grouped by `Ingredient.group`. The oxidiser's note shows `result.notes` joined with " · " (read from the latest `simulate` of the state); for an example still on its table the fuel's note reads "Tuned to the real engine's published figures". Mixture slider: `log` true for a calculated combustion engine whose `mixRange(...).ofMin` is above 0, disabled when the oxidiser is `none`.
- [ ] **Step 4: Readout.** Add an "Exhaust" row to `readouts.ts`'s template, filled from `result.exhaust` as "Steam 63% · Hydrogen 29% · …" and hidden when empty. The "Past a limit" line reads "This mixture will not keep burning." for `flameout`, "Nothing here will burn." for `inert`, "No figures: the chemistry would not settle." for `unsolved`. Add `export function showsFigures(result: SimResult): boolean` to `copy.ts`, false only for `unsolved`; when it is false every figure in `readouts.ts` that comes from the gas shows "—" and the limit bars are hidden.
- [ ] **Step 5: Failures.** In `runtime.ts`, the four new kinds latch like the others. In `engineView.ts:606-618` and `aerospikeView.ts:232-243`, draw holes and fireball only when `destroys(failure)`; `detonation` uses the chamber path. In `main.ts`, the failure box button reads "Relight engine" when `!destroys(failure)` and "Rebuild engine" otherwise; both call the existing rebuild.
- [ ] **Step 6: Run** `npm test`, `npx tsc --noEmit`, `npm run build`. Expected: all pass.
- [ ] **Step 7: Commit** "Pick a fuel and an oxidiser, and see what the exhaust is made of".

### Task 12: In the browser, and the record

**Files:**
- Modify: `docs/future-work.md`, `docs/superpowers/specs/2026-11-20-fuel-chemistry-design.md` (status line only)

- [ ] **Step 1: Run the app** (`preview_start` name `rocket-sim`) and check, reading values from the page, with no console errors throughout:
  - opens on RP-1 and liquid oxygen, calculated, fires at sea level and 100 km;
  - pentaborane with oxygen difluoride fires; notes and exhaust readout show;
  - hydrogen with liquid ozone: fire → detonation, engine destroyed, Rebuild works;
  - hydrogen and oxygen, mixture slider to either end: fire → flame-out, no damage drawn, Relight works; RP-1 and oxygen: flame-out at the oxidiser-rich end only;
  - ammonia with None: inert; hydrazine with None: runs;
  - Merlin example: figures equal the stock figures; change fuel to methane and back: marked modified; Reset restores;
  - NERVA on ammonia and on methane: runs, exhaust readout shows;
  - drag mixture, pressure and exit-diameter sliders on a calculated engine while firing; throttle sweep: read the frame time from `performance.now()` deltas over 300 frames and confirm no frame over 50 ms and the same mean as a tabled engine within 10%;
  - an old `v2` link (take one from `state.test.ts`) opens.
- [ ] **Step 2: Measure the gap** between the solver and the four tables: for each tabled pair at its `ofDefault`, 70 bar, ε 16, the calculated and tabled vacuum Isp. Write the four differences into `docs/future-work.md`.
- [ ] **Step 3: Write `docs/future-work.md`:** what part 2 built; ingredients left out for want of a source; facts left unset; the fitted gas's exit pressure reading 12–25% high (so separation starts later than it should); no ions; a product sitting on its melting point is held in one phase; kerosene, hydrazines and boranes never flame out at the fuel-rich end, because equilibrium has them falling apart and giving off heat; hydrazine alone; the solver-against-table gap; three-propellant engines and user blends not done.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npm run build`. Expected: all pass.
- [ ] **Step 5: Commit** "Record what the chemistry piece built and left".
