# Electric Thrusters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four electric energy sources (resistojet, arcjet, gridded ion, Hall) to the engine builder, with a Power control, honest figures, their own limits, a cutaway and beam for the two beam thrusters, and five real examples.

**Architecture:** Resistojet and arcjet are energy sources whose gas is the chemistry solver's, heated by a set amount of energy per kilogram (an enthalpy-and-pressure solve, which the solver already does for flames) instead of to a set temperature. Ion and Hall thrusters branch out of `simulate` at its top into `src/physics/electric.ts`, return a `SimResult` whose optional `electric` field carries their figures, and are drawn on the 2D overlay canvas by a new view; the WebGL plume and both gas grids are switched off for them.

**Tech Stack:** TypeScript, Vite, Vitest, Canvas 2D. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-25-electric-thrusters-design.md`

## Global Constraints

- The twelve existing entries in `src/physics/__snapshots__/presets.regression.test.ts.snap` and `src/render/__snapshots__/geometry.regression.test.ts.snap` are not regenerated. New examples add entries. After every test run: `git checkout -- src/physics/__snapshots__ src/render/__snapshots__` unless the task is adding examples, and then check the diff only adds.
- `SimResult` gains one optional field, `electric?: ElectricFigures`, set only for the four new sources. No other field is added.
- `EngineConfig` gains `powerKW: number` and `voltage: number`, kept by every engine.
- `sanitize` turns any config into a valid one and never throws.
- Share links: `v6` = v5's 23 entries + `powerKW`, `voltage` (25). v1–v5 open with the fallbacks.
- `src/render/fluidSim.ts`, `engineSim.ts`, `gasSim.ts`, `plume.frag.ts` are not edited.
- Every constant is tuned once against the examples as a set, never per example, and carries a comment naming its source or what it was tuned to.
- Copy is plain English in the voice of `src/ui/copy.ts`. No em dashes in new copy.
- Test command for the whole suite: `npx vitest run`. Type check: `npx tsc --noEmit`.
- Commit trailer: `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Names fixed here

```ts
// types.ts
export type EnergyId = 'combustion' | 'solid' | 'reactor' | 'saltwater' | 'resistojet' | 'arcjet' | 'ion' | 'hall';
export type PropellantId = /* existing */ | 'rj-hydrazine' | 'rj-ammonia' | 'rj-hydrogen' | 'rj-water'
  | 'aj-hydrazine' | 'aj-ammonia' | 'aj-hydrogen' | 'xenon' | 'krypton' | 'argon' | 'iodine';
export type Failure = /* existing */ | 'underpowered' | 'noVacuum' | 'gridOverload' | 'channelOverheat';
export interface ElectricFigures {
  /** W, at the throttle setting */
  power: number;
  /** thrust² / (2 × flow × power) */
  thrustEfficiency: number;
  /** Beam thrusters only: V and A */
  voltage?: number;
  beamCurrent?: number;
  /** Thermal electrics only: K the gas was heated to */
  heatedTo?: number;
}
// parts.ts — EnergySource gains
mixKind: 'ratio' | 'temperature' | 'none' | 'power';
kind?: 'thermal' | 'beam';           // absent for the four existing sources
heatingShare?: number;                // thermal: share of power that reaches the gas as usable heat
export const isBeam = (e: EnergyId) => ENERGY_SOURCES[e].kind === 'beam';
export const isElectric = (e: EnergyId) => ENERGY_SOURCES[e].kind !== undefined;
// engine.ts
RANGES.powerKW = { min: 0.05, max: 100, fallback: 2 };
RANGES.voltage = { min: 100, max: 5000, fallback: 300 };
export function rangesFor(energy: EnergyId): typeof RANGES;   // smaller sizes for thermal electrics; voltage span per beam type
// chem/pair.ts
export function solveHeated(reactant: string, addedJPerKg: number, pcBar: number, eps: number): SolvedGas;
// electric.ts
export interface BeamPropellant { massU: number; ioniseEV: number; colour: RGB; colourName: string }
export const BEAM_PROPELLANTS: Record<'xenon' | 'krypton' | 'argon' | 'iodine', BeamPropellant>;
export function simulateBeam(cfg: EngineConfig, flight: FlightState): SimResult;
export const BEAM_VACUUM_PA = 1;      // lights only where outside pressure is below this
// render/beamView.ts
export function drawBeamThruster(ctx, cfg, result, view, opts: { fire: number; failure: Failure }, w: number, h: number): void;
```

## Review Focus

1. A thermal electric at the top of the power range with the smallest flow: the search must end in the heater/arc failure, never in "unsolved" or a NaN.
2. A v5 link, and a v6 link with a non-numeric power: both open; neither throws.
3. Swapping energy source from a 5 m combustion engine to an arcjet and back: no destroyed engine, no NaN, sizes inside each source's ranges.
4. A beam thruster dragged from 100 km to sea level while running: shuts down with the vacuum explanation, and relights when taken back up.
5. Readouts for a beam thruster show no chamber pressure, Mach, nozzle state or zero-valued gas figure anywhere, including "Engineer's numbers" and the stand's callouts.

---

## Stage 1: thermal electrics

### Task 1: Power and voltage in the config and in links

**Files:** `src/physics/types.ts`, `src/physics/engine.ts`, `src/physics/reshape.ts`, `src/physics/presets.ts`, `src/state/share.ts`, `src/state/state.test.ts`, any test fixture that builds a whole `EngineConfig` (type check finds them).

**Produces:** `EngineConfig.powerKW`, `EngineConfig.voltage`, `RANGES.powerKW`, `RANGES.voltage`, link `v6`.

- [ ] Tests first, in `state.test.ts`: a v6 round trip keeps `powerKW: 4.2, voltage: 650`; a v5 link (built by hand as the existing version tests do) opens with `powerKW: 2, voltage: 300`; a v6 link whose power entry is a string returns null like any malformed link; `sanitize({...starterEngine(), powerKW: NaN, voltage: 1e9})` gives `2` and `5000`.
- [ ] Run: FAIL (fields unknown).
- [ ] Add the fields, ranges, `sanitize` clamps, defaults in `starterEngine` and the preset builder (2 and 300), and v6 in `share.ts` (v5 becomes a named older version alongside v4).
- [ ] `npx tsc --noEmit` clean; `npx vitest run` green; snapshots unchanged.
- [ ] Commit: "Carry power and voltage in every engine and in v6 links".

### Task 2: Heating a fluid by a set energy

**Files:** `src/physics/chem/pair.ts`, `src/physics/chem/pair.test.ts`.

**Produces:** `solveHeated(reactant, addedJPerKg, pcBar, eps)`: the fitted gas of `reactant` (as stored: its reactant enthalpy) given `addedJPerKg` of heat at `pcBar`, expanded to `eps`. An `hp` problem with `h = mix.h0 + added` (converted to the units `Mixture.h0` uses; read `equilibrium.ts` for them). Cached like `solveFluid`, the energy rounded to 3 significant figures, chain `heated|<reactant>`.

- [ ] Tests first: (a) hydrazine with 0 J/kg settles between 800 and 1,500 K (it decomposes by itself); (b) for ammonia, `solveHeated` with the energy that `solveFluid` at 2,000 K implies gives 2,000 K ± 5 (work the energy out by bisection on `solveHeated` in the test, then compare the two gases' `cStar` within 0.5%); (c) temperature rises monotonically with energy over 1–40 MJ/kg for hydrogen; (d) water with 0.5 MJ/kg added (not enough to boil) returns `ok: false` or a temperature below 400 K, and never throws; (e) non-finite or negative energy returns not-settled.
- [ ] Run: FAIL. Implement. Run: PASS.
- [ ] Commit: "Solve a fluid heated by a set energy per kilogram".

### Task 3: Resistojet and arcjet as energy sources

**Files:** `src/physics/types.ts`, `parts.ts`, `propellants.ts`, `gasSource.ts`, `engine.ts`, `limits.ts`, `reshape.ts`; new `src/physics/thermalElectric.test.ts`.

**Consumes:** `solveHeated`, `powerKW`.

**Decisions:**
- Sources: `resistojet` (`kind: 'thermal'`, `mixKind: 'power'`, `heatingShare: 0.8`, `coreTempLimit: 2400`, `throttleable: true`, starter contraction 3, lStar 1.5) and `arcjet` (`heatingShare: 0.4` to be tuned in Task 5, `coreTempLimit: 6000`, `wallHeatFactor: 0.4`, starter contraction 3, lStar 2). Instability reference diameter large enough never to matter (100).
- Propellant records via a helper beside `reactorFluid`: `rj-*` and `aj-*`, each naming its `fluid` (`N2H4(L)`, `NH3(L)`, `H2(L)`, `H2O(L)`: use the reactant names the reactor fluids already use; hydrazine's is in `chem/ingredients.ts`). `ofMin = ofMax = ofDefault = 0`.
- `resolveGas` for a `'power'` source: flow per second is `chambers × pc × At / (cStar × 0.98)`, heat per second is `heatingShare × powerKW × 1000 × (pcBar / cfg.chamberPressureBar)` (throttle turns both down together). The energy per kilogram `q` is found by bisection in log space between 1e4 and 1e9 J/kg so that `q × flow(q) = heat` (flow falls as `q` rises, `q × flow` rises), 40 steps at most, stopping at 0.1%. An unsettled solve at a trial `q` counts as "too cold" below the first settled point and "too hot" above the last. Cache the answer by `(propellant, powerKW, pcBar, eps, throatDia, chambers)` rounded to 4 figures in a small map (limit 500).
- Failures, in this order: no settled gas at or below 400 K anywhere in the search → `'underpowered'` (does not destroy; add to the non-destroying list in `limits.ts`); gas temperature ≥ `coreTempLimit` → `'meltdown'` through the existing core limit; then the ordinary limits.
- A note "The heater is adding little: the gas leaves at only N K." when the gas is below 700 K, not for hydrazine.
- `simulate` sets `electric: { power, thrustEfficiency, heatedTo }` for these sources, and treats `'power'` like `'temperature'` where it skips the flame's pressure correction.
- `rangesFor('resistojet' | 'arcjet')`: `chamberDia.min 0.002`, `chamberLen.min 0.002`, `throatDia.min 0.0003`, `exitDia.min 0.0005`, `chamberPressureBar.min 0.5`. `sanitize` clamps with `rangesFor(energy)`.
- `withEnergy` to a thermal electric: a starter of that kind, not the old engine's size: throat 0.6 mm, area ratio 100, 4 bar, 2 kW (arcjet) or 0.5 kW (resistojet), wall at half its structural limit, first propellant (hydrazine). From a thermal electric to anything else: `starterEngine()`'s sizes with the new source applied by the existing path.

- [ ] Tests first (`thermalElectric.test.ts`): energy balance closes (recompute `flow × (h gained)` from `electric.heatedTo` via a second `solveHeated` call and compare with `heatingShare × power` within 1%); more power → hotter and higher Isp, same flow within 3%… (flow falls as c* rises: assert it falls); throttle 0.5 keeps `heatedTo` within 2%; 100 kW into the starter arcjet → `'meltdown'`; 0.05 kW into a water resistojet at 4 bar → `'underpowered'`, and `destroys('underpowered')` is false; hydrazine at 0.05 kW runs (no failure) above 700 K; `sanitize` of an arcjet keeps a 0.4 mm throat and of a combustion engine still lifts it to 20 mm; `withEnergy` combustion → arcjet → combustion yields engines with no failure at 100 km; every field of the result is finite for all seven propellants at the starter.
- [ ] Run: FAIL. Implement. Run: PASS. Whole suite green, snapshots unchanged, `tsc` clean.
- [ ] Commit: "Add the resistojet and arcjet: gas heated by electrical power".

### Task 4: The page for thermal electrics

**Files:** `src/ui/controls.ts`, `readouts.ts`, `copy.ts`, `src/ui/console.test.ts` or a new `src/ui/electric.test.ts`, `src/main.ts` if failure wording needs it, `src/style.css` only if a row needs it.

- [ ] Tests first: `formatLength(0.0006)` is `0.60 mm` and `formatLength(0.05)` unchanged; a new exported `fmtThrust` gives `92.0 mN`, `1.25 N`, `845 kN`; `fmtFlow` gives `41.0 mg/s`, `3.2 g/s`, `12.0 kg/s`; the power slider is hidden for combustion and shown for arcjet, the mixture slider hidden for `'power'`; the instability gauge is hidden for an electric engine; `failureCopy('underpowered', 'resistojet')` and `failureCopy('meltdown', 'arcjet')` have their own titles ("Not enough power to boil the propellant", "Electrodes eroded"; resistojet meltdown "Heater burnt out").
- [ ] Implement: Power slider (log, `rangesFor`, format `2.0 kW` / `350 W`), sliders take ranges from `rangesFor(s.config.energy)`, chamber pressure steps by 0.1 bar below 10 bar for thermal electrics, readout rows "Power" and "Power into thrust" (`thrustEfficiency` as %), the temperature row labelled "Gas temp / exhaust speed" for electrics, tips for everything new, `LIMIT_COPY` heating tip variants ("the heater", "the electrodes"), thrust sub-line in grams of push when under a kilogram.
- [ ] Run tests; whole suite; `tsc`.
- [ ] In the browser (`preview_start` `rocket-sim`, `?fire`): pick Arcjet, check the cutaway and callouts read in mm, the gas simulation runs, the plume shows, no console errors; drag power to both ends. Fix what is wrong (metre-scale constants in `geometry.ts`, `stand.ts`, `engineView.ts` are the likely places) with a test for each fix.
- [ ] Commit: "Show the resistojet and arcjet on the page".

### Task 5: The arcjet example and its tune

**Files:** `src/physics/presets.ts`, `parts.ts` (the tuned share), `src/physics/presets.test.ts` or the thermal test file, snapshots (additions only), `src/ui/picker.ts` if cards need anything.

- [ ] Check the MR-510's published power, thrust and Isp against a source on the web (maker's data sheet or a paper); record the source in a comment. If they differ from the spec's table, the source wins.
- [ ] `Spec` gains optional `powerKW`; the builder sizes the throat to the published thrust as it does now (trial throat 0.6 mm for thermal electrics, since 0.3 m is out of range), at 4 bar, area ratio 100 unless the source says otherwise.
- [ ] Test first: the example's thrust and vacuum Isp are within 10% of published at published power; it has no failure at 100 km; its heating gauge is between 0.3 and 0.9.
- [ ] Tune `heatingShare` for the arcjet until it passes; write what it was tuned to beside it.
- [ ] Whole suite. The snapshot diff adds one entry per file and changes none.
- [ ] Commit: "Add the MR-510 arcjet as an example".

## Stage 2: beam thrusters

### Task 6: The beam formula

**Files:** new `src/physics/electric.ts`, `src/physics/electric.test.ts`; `types.ts`, `parts.ts`, `propellants.ts`, `engine.ts`, `limits.ts`, `reshape.ts`.

**Decisions:**
- Sources `ion` and `hall`: `kind: 'beam'`, `mixKind: 'none'`, `throttleable: true`.
- Propellant records `xenon`, `krypton`, `argon`, `iodine` (energy `ion`; `propellantsFor` returns these four for both beam sources: give `Propellant` an optional `alsoFor?: EnergyId[]` or make `propellantsFor` special-case beam sources, whichever is smaller). `BEAM_PROPELLANTS`: xenon 131.29 u / 12.13 eV, krypton 83.80 / 14.00, argon 39.95 / 15.76, iodine 126.90 / 10.45; colours xenon `[0.55,0.6,1]` "blue-violet", krypton `[0.85,0.82,1]` "pale lilac", argon `[0.9,0.55,0.95]` "pink-violet", iodine `[0.8,0.95,0.45]` "yellow-green".
- Formula exactly as the spec's "How they are worked out". Constants (starting values, tuned once in Task 9): ion: cost of an ion `200 V × (ioniseEV / 12.13)`, beam share 0.96, used share 0.88; Hall: channel loss 50 V, electrical share 0.75, beam share 0.88, used share `0.9 × (massU / 131.29)^0.15`.
- Power used is `powerKW × 1000 × throttle`.
- `rangesFor('ion')`: voltage 300–5000, `exitDia` 0.03–1; `rangesFor('hall')`: voltage 100–1000, same diameter. `sanitize` for a beam source: exhaust `'none'`, chambers 1, no extension, `scale` kept.
- Limits: ion `structural` slot = beam current density over the grids' limit, `J / (K_GRID × V^1.5)` with `J = I / (π/4 × d²)`; Hall `heating` slot = waste power per channel area over its limit, `(P − thrust²/(2 × flow)) / (K_HALL × π/4 × d² × 0.4)` (the channel is taken as 40% of the face). The other slots are 0. `K_GRID` and `K_HALL` set in Task 9 so the examples sit between a third and two thirds.
- Failures: outside pressure ≥ `BEAM_VACUUM_PA` → `'noVacuum'`; limit ≥ 1 → `'gridOverload'` / `'channelOverheat'`. None destroys.
- `SimResult` for a beam thruster: `thrust`, `isp = ispVacuum`, `ispSeaLevel = 0`, `massFlow`, `exitVelocity` = the atoms' speed, `effectiveExitDia = flowExitDia = exitDia`, `expansionRatio = 1`, `state = 'ideal'`, `settled = true`, `calculated = false`, `exhaust = []`, `gamma = 5/3`, every other number 0, `electric` filled. With `'noVacuum'` thrust and flow are 0.
- `simulate` begins `if (isBeam(cfg.energy)) return simulateBeam(cfg, flight)` after sanitising.
- `withEnergy` to a beam source: starter of that kind (ion: 2.3 kW, 1,100 V, 0.3 m, xenon; Hall: 1.35 kW, 300 V, 0.1 m, xenon). From one: as from a thermal electric.

- [ ] Tests first: thrust, current, flow, Isp and efficiency agree with each other by the spec's relations for 20 random in-range settings per type (recompute independently in the test); at fixed power, doubling voltage raises Isp and lowers thrust; at fixed voltage, doubling power doubles thrust and leaves Isp alone (within 1e-9); krypton against xenon at the same settings: higher Isp, lower thrust, both types, with no propellant-specific branch (grep-level: `electric.ts` has no `=== 'krypton'`); `'noVacuum'` at 0 km and at 79 km, running at 86 km and 100 km; low voltage, high power, 3 cm ion thruster → `'gridOverload'`; 100 kW into a 3 cm Hall → `'channelOverheat'`; throttle 0.5 halves thrust and keeps Isp; every result field finite across the ranges' corners; `sanitize` forces exhaust `'none'`.
- [ ] Run: FAIL. Implement. PASS. Whole suite, snapshots, `tsc`.
- [ ] Commit: "Work out gridded ion and Hall thrusters from power and voltage".

### Task 7: Drawing a beam thruster

**Files:** new `src/render/beamView.ts`, `src/render/beamView.test.ts`; `src/render/geometry.ts`, `src/sim/runtime.ts`, `src/render/engineView.ts` (dispatch only), `src/ui/stand.ts`, `src/ui/picker.ts`.

**Decisions:**
- `engineProfile` for a beam source returns a plain cylinder: length `0.6 × exitDia` (ion) or `0.35 × exitDia` (Hall), radius `exitDia / 2`, `throatX = chamberEndX = exitX = length`, one offset, no spike, plug or extension, plus `beam: 'ion' | 'hall'`. This keeps `viewTransform` and the layout working unchanged.
- `runtime.ts`: for a beam profile, skip `plumeParams`, the gas grids and `plume.draw` entirely (clear the GL canvas once: add `plume.clear()` if there is no way to draw nothing), call `drawBeamThruster`, set `simulatedNote = 'not for beam thrusters'`, silence the rumble, and report layout as now. Pure helpers that decide this are exported and tested; the drawing itself is checked in the browser.
- `drawBeamThruster`: body, then for ion two grid lines across the mouth and a discharge glow inside; for Hall an annular channel (outer radius `d/2`, inner `0.6 × d/2`) round a centre pole with a glow in the channel; a small neutraliser cylinder above the body with a faint link of glow to the beam; the beam as a linear-gradient wedge from the face, half-angle 12° (ion) or 35° (Hall), drawn with `globalCompositeOperation = 'lighter'`, length 12 diameters, alpha `fire × min(1, 0.25 + 0.5 × powerDensity share)`, colour from `BEAM_PROPELLANTS`. `beamShape(cfg): { halfAngleDeg: number; lengthM: number }` and `beamAlpha(result, cfg, fire): number` are exported for tests.
- Stand callouts: for a beam thruster only "Diameter" and the neutraliser; none of chamber, throat, exit ratio. The test stand itself is drawn as for any engine.
- Picker silhouettes: a can with two bars (ion), a ring (Hall); thermal electrics use the ordinary engine silhouette.
- "Show inside" and the two gas menus are disabled with the title "A beam of charged atoms is not a gas the simulation can follow." while a beam thruster is selected, and restored after.

- [ ] Tests first: `engineProfile` of a beam config has `beam` set, finite points, and `exitX > 0`; `beamShape` angles 12 and 35; `beamAlpha` is 0 unlit and for `'noVacuum'`, rises with power, never above 1; `calloutsFor` a beam layout names no chamber or throat; `silhouettePath` returns a non-empty path for each beam source.
- [ ] Implement. Suite, snapshots, `tsc`.
- [ ] Commit: "Draw gridded ion and Hall thrusters and their beams".

### Task 8: The page for beam thrusters

**Files:** `src/ui/controls.ts`, `readouts.ts`, `copy.ts`, `src/state/store.ts`, `src/main.ts`, `src/sim/runtime.ts`, tests beside each.

- [ ] Tests first: controls: for `ion`, the exhaust menu, chambers, chamber diameter and length, throat, nozzle sliders, chamber pressure and mixture are hidden; Power, Voltage and "Thruster diameter" shown; Voltage's range follows the type. Store: `setEnergy('ion')` and `loadPreset` of a beam example set `flight.altitudeKm` to 100; `setEnergy('arcjet')` does not; nothing else changes altitude. Readouts (render into a detached root): a beam result shows thrust in mN, Isp, power, voltage, beam current in A, flow in mg/s, exhaust speed in km/s, "Power into thrust"; the text contains none of "bar", "Mach", "Sea level /", "Nozzle exit"; run-state reads "Running" or "Will not light in air"; the colour line reads "xenon glowing blue-violet". Runtime's latch rule (`latchesNow` or its beam equivalent): a running beam thruster taken below 80 km gets `'noVacuum'` and stops; `failureCopy` for the three beam failures; the rebuild button reads as a relight, not "Rebuild engine".
- [ ] Implement, including the test-log line "Altitude set to 100 km: this thruster only runs in a vacuum." and no ignition flash for electrics (`#ignition` class not set when `isBeam`).
- [ ] Suite, snapshots, `tsc`.
- [ ] Browser: pick Ion thruster, fire, drag voltage and power, drag altitude to sea level and back, switch to Hall, each propellant; desktop and 390-wide; no console errors. Screenshot both thrusters lit.
- [ ] Commit: "Give beam thrusters their controls, readouts and vacuum rule".

### Task 9: Four examples and the tune

**Files:** `src/physics/presets.ts`, `electric.ts` (tuned constants), `src/physics/electric.test.ts`, snapshots (additions only).

- [ ] Check NSTAR, NEXT, SPT-100 and XR-5 (BPT-4000) power, voltage, thrust, Isp and diameter against sources on the web; record each source in a comment; sources win over the spec's table.
- [ ] `Spec` gains optional `voltage` and `diameterM`; a beam example is not sized to its thrust (thrust follows from power and voltage); its config is built directly.
- [ ] Test first: each example within 10% of published thrust and Isp at published power and voltage; none fails at 100 km; each one's active gauge between 1/3 and 2/3.
- [ ] Tune the Task 6 constants as a set, and `K_GRID`, `K_HALL`. If no one set brings all four within 10%, stop tuning, keep the best set, loosen nothing, and record which example misses and by how much in the test (as an explicit wider bound for that example with a comment) and in the record.
- [ ] Suite; snapshot diff adds four entries per file and changes none.
- [ ] Commit: "Add NSTAR, NEXT, SPT-100 and XR-5 as examples".

### Task 10: Record and final check

**Files:** `docs/future-work.md`, the spec's status line, `src/dev/accuracy.ts` only if its `ENERGIES` list must skip the new sources to keep working.

- [ ] `docs/future-work.md`: mark piece 5 built in the list; add "Electric thrusters (part 5)" with what was built, every constant and its source or tune target, each example's published and modelled figures, what was left out (the spec's list plus anything found), and known limits.
- [ ] Full suite, `tsc`, `npm run build`.
- [ ] Browser pass over all twelve old examples at sea level and 100 km lit: nothing looks different (spot-check three against the live site).
- [ ] Commit: "Record the electric thrusters piece".
