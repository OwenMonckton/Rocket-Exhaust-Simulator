# Rocket Engine Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser sandbox showing a rocket engine cross-section with a physics-driven plume, tweakable real-engine presets, failure limits and shareable builds.

**Architecture:** A pure TypeScript physics module (`src/physics/`) turns an `EngineConfig` + `FlightState` into a `SimResult`. A small store holds the config, mirrors it into the URL hash, and notifies the UI. Rendering is two stacked canvases: WebGL2 (sky + plume fragment shader) underneath, Canvas2D (engine cutaway) on top. Plain HTML controls.

**Tech Stack:** Vite, TypeScript (strict), Vitest, raw WebGL2, Canvas2D, Web Audio (stretch). No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-rocket-engine-sim-design.md`

## Global Constraints

- Desktop Chrome/Edge/Firefox/Safari, WebGL2 required; 60 fps on integrated GPU.
- Builds to a static site (`npm run build` → `dist/`, relative base path `./`).
- `src/physics/` imports nothing from DOM, render, ui or state.
- Units inside physics: SI (m, Pa, K, kg, N) — except `chamberPressureBar` and `altitudeKm` on the config, converted at the boundary.
- Every control has a plain-English label and a one-line tooltip; every failure message names the knob to back off.
- Real presets within ±10% of published thrust and Isp.
- The folder is not a git repository: no commit steps. If the user initialises one, commit after each task.

## Review Focus

1. **Garbage or hostile share links** (truncated base64, wrong types, out-of-range numbers, unknown propellant/preset) → app loads the default preset or clamps values; never throws, never NaN. (Task 6 tests.)
2. **Degenerate geometry from individual sliders** (throat ≥ chamber, exit ≤ throat, zero lengths) → `sanitize()` clamps so `simulate` always returns finite numbers. (Task 4 tests.)
3. **Vacuum** (`Pa = 0`, altitude ≥ 86 km) → no division by zero; state is `under`, no separation, plume bloom capped. (Task 4 tests.)
4. **Solid propellant arriving with throttle/mixture values** (via URL or switching propellant) → throttle forced to 1, mixture ignored. (Task 4 tests.)
5. **WebGL2 missing / context lost, window resize, high-DPI** → readable fallback message instead of a blank page; canvases resize with devicePixelRatio capped at 2. (Task 8, checked by hand.)

---

### Task 1: Scaffold

**Files:** Create `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/style.css`, `.gitignore`.

- [ ] `package.json` scripts: `dev` (vite), `build` (tsc --noEmit && vite build), `test` (vitest run). Dev deps: `vite`, `typescript`, `vitest`.
- [ ] `vite.config.ts`: `base: './'`, vitest `environment: 'node'`, `include: ['src/**/*.test.ts']`.
- [ ] `index.html`: header (title, preset select, Share, sound toggle), left `<aside id="controls">`, `<main>` with `<div id="stage">` holding `<canvas id="gl">` + `<canvas id="overlay">`, and `<section id="readouts">`.
- [ ] Verify: `npm install`, `npm run build` succeeds.

### Task 2: Gas dynamics and atmosphere

**Files:** Create `src/physics/atmosphere.ts`, `src/physics/nozzle.ts`, tests alongside (`*.test.ts`).

**Produces:**
- `ambientPressure(altitudeM: number): number` — Pa; US Standard Atmosphere 1976 layers to 86 km, `0` at ≥ 86 km, clamps negatives to sea level.
- `areaRatio(mach: number, g: number): number`
- `machFromAreaRatio(eps: number, g: number): number` — supersonic root, bisection/Newton; `eps ≤ 1` → 1.
- `pressureRatio(mach: number, g: number): number` — p/Pc.
- `machFromPressureRatio(pOverPc: number, g: number): number`
- `cStar(g: number, R: number, Tc: number): number`
- `exitVelocity(mach: number, g: number, R: number, Tc: number): number`

- [ ] Tests: `ambientPressure(0)` = 101325 ±1; `(11000)` = 22632 ±1%; `(30000)` ≈ 1197 ±3%; `(86000)` = 0; `areaRatio(machFromAreaRatio(e,1.2),1.2)` ≈ e for e ∈ {1.5, 16, 69, 280}; `machFromAreaRatio(16,1.2)` between 3.2 and 3.6; `cStar(1.2, 8314/22, 3550)` ≈ 1787 ±1%.
- [ ] Implement; `npm test` passes.

### Task 3: Propellants

**Files:** Create `src/physics/types.ts`, `src/physics/propellants.ts`, `src/physics/propellants.test.ts`.

**Produces:**
```ts
type PropellantId = 'kerolox' | 'hydrolox' | 'methalox' | 'hypergolic' | 'solid';
interface GasProps { tc: number; gamma: number; molarMass: number; R: number }
interface PlumeLook { core: RGB; mid: RGB; edge: RGB; richTint: RGB; opacity: number; soot: number; smoke: number }
interface Propellant { id; name; fuel; oxidiser; ofMin; ofMax; ofDefault; lStarRef: number; instabilityRefDia: number; table: {of,tc,gamma,molarMass}[]; look: PlumeLook; throttleable: boolean }
PROPELLANTS: Record<PropellantId, Propellant>
gasProps(id: PropellantId, of: number): GasProps   // linear interpolation, clamps of to table range
richness(id, of): number  // -1 (ox-rich end) … 0 (peak Tc) … +1 (fuel-rich end)
```
- Tables from published CEA results (~70 bar), 5–6 rows each. `lStarRef`: kerolox 1.0, hydrolox 0.7, methalox 0.9, hypergolic 0.8, solid 0 (always complete). `instabilityRefDia`: liquids 1.15 m, solid 4.0 m. Solid: single row, `throttleable: false`.

- [ ] Tests: interpolation midway between two rows is the mean; out-of-range O/F clamps; kerolox peak Tc is 3500–3700 K near O/F 2.6–3.0; hydrolox molar mass at O/F 6 is 13–14.5; every table row has γ in (1.1, 1.3).
- [ ] Implement; tests pass.

### Task 4: Engine model, limits, sanitising

**Files:** Create `src/physics/engine.ts`, `src/physics/limits.ts`, `src/physics/engine.test.ts`. Extend `types.ts`.

**Produces:**
```ts
interface EngineConfig {
  presetId: string | null; propellant: PropellantId;
  chamberDia: number; chamberLen: number; throatDia: number; exitDia: number; // m
  nozzleLenPct: number;        // 60–100
  wall: number;                // m, scales with Engine scale, not user-editable
  chamberPressureBar: number; mixtureRatio: number; scale: number;
}
interface FlightState { altitudeKm: number; throttle: number } // throttle 0.4–1
type ExpansionState = 'ideal' | 'over' | 'under' | 'separated';
interface Limits { structural: number; heating: number; instability: number } // 1 = failure
interface SimResult {
  thrust; isp; ispSeaLevel; ispVacuum; massFlow; pc; pe; pa; exitMach; exitVelocity;
  expansionRatio; effectiveExitDia;   // < exitDia when separated
  tc; gamma; cStarEff; lStar; combustionEff; nozzleEff;
  state: ExpansionState; rough: boolean; shudder: number; // 0–1
  limits: Limits; failure: null | 'burst' | 'burnthrough' | 'instability';
}
RANGES: Record<keyof numeric config/flight field, {min,max,step}>
sanitize(cfg: EngineConfig): EngineConfig   // clamps to RANGES; throat ≤ 0.9·chamber; exit ≥ 1.05·throat; O/F into propellant range
simulate(cfg: EngineConfig, flight: FlightState): SimResult
computeLimits(cfg, pcBar, tc): Limits
```
- Calculation chain exactly as spec "Physics model" steps 1–9. `simulate` calls `sanitize` first; solid forces throttle 1.
- Combustion efficiency: `0.975 ×` (1 if L* ≥ ref; linear to 0.85 at ref/3; linear on to floor 0.6 at 0).
- Nozzle efficiency λ: `0.965 + 0.025·(nozzleLenPct − 60)/40`.
- `rough`: O/F within 4% of range ends → combustion efficiency × 0.97.
- State: ideal if |Pe/Pa − 1| ≤ 0.1; `Pa = 0` → `under`. Separation uses the Schmucker criterion `p_sep/Pa = k·(1.88·Me − 1)^−0.64` with `k` tuned in tests (start 0.7) — the spec's flat 0.4 would wrongly separate the RS-25 at sea level. When separated, effective exit is where wall pressure equals `p_sep`; thrust uses that station.
- Limits: `structural = (pc·Dc/(2·wall)) / SIGMA_ALLOW`; `heating = (pc/100)^0.8 · (0.25/Dt)^0.2 · (Tc/3500) / 2.9` (pc in bar); `instability = (Dc/refDia)^1.5 · (0.9 + 0.1·pc/70)`. Throttled `pc` is used. `shudder = clamp((instability − 0.7)/0.3)`, costing up to 3% combustion efficiency. `failure` = first limit ≥ 1 (order: burst, burnthrough, instability).

- [ ] Tests — behaviour: thrust rises with altitude for a fixed engine; vacuum Isp > sea-level Isp; doubling throat area ≈ doubles mass flow; raising Pc raises thrust and all three limits or leaves them equal; uniform scale ×2 (all dims and wall) leaves `structural` unchanged and ≈ quadruples thrust; widening chamber alone raises `structural`; short chamber lowers `combustionEff`.
- [ ] Tests — Review Focus 2, 3, 4: throat > chamber, exit < throat, zeros and NaN inputs give all-finite results; altitude 100 km gives finite thrust, state `under`; solid with throttle 0.4 equals solid with throttle 1.
- [ ] Implement; tests pass.

### Task 5: Presets and calibration

**Files:** Create `src/physics/presets.ts`, `src/physics/presets.test.ts`.

**Produces:** `PRESETS: Preset[]` where `Preset = { id; name; blurb; config: EngineConfig; published: { thrustKN; atVacuum: boolean; ispSL?: number; ispVac: number } }`, `getPreset(id)`, `DEFAULT_PRESET_ID = 'merlin-1d'`.

Published targets (thrust kN / Isp SL / Isp vac): Merlin 1D 845 SL / 282 / 311; Merlin Vacuum 981 vac / – / 348; Raptor 2 2260 SL / 327 / 350; RS-25 1860 SL / 366 / 452; RD-180 3830 SL / 311 / 338; F-1 6770 SL / 263 / 304; RL10B-2 110 vac / – / 465; Solid booster 1200 SL / 240 / 265. Pc, O/F, ε per spec table. Throat diameters back-solved from the model; wall sized from a per-preset stock structural fraction (Raptor 0.87, RD-180 0.80, RS-25 0.72, Merlin 0.60, MVac 0.60, F-1 0.55, RL10 0.40, solid 0.50).

- [ ] Tests: every preset — thrust and each published Isp within ±10%; all limits < 1; Raptor's highest limit in 0.82–0.92; F-1 instability in 0.75–0.85; Merlin Vacuum and RL10B-2 are `separated` at sea level; RS-25, Merlin 1D, Raptor, RD-180, F-1 are not separated at sea level at full throttle; `sanitize(preset.config)` equals `preset.config`.
- [ ] Implement, tuning `k`, `SIGMA_ALLOW`, tables and throats until tests pass.

### Task 6: Store, scaling, sharing

**Files:** Create `src/state/store.ts`, `src/state/share.ts`, `src/state/share.test.ts`, `src/state/store.test.ts`.

**Produces:**
```ts
interface AppState { config: EngineConfig; flight: FlightState }
createStore(initial: AppState): { get(): AppState; set(patch: {config?: Partial<EngineConfig>; flight?: Partial<FlightState>}): void; loadPreset(id: string): void; setScale(s: number): void; subscribe(fn: (s: AppState) => void): () => void }
applyScale(cfg: EngineConfig, newScale: number): EngineConfig  // multiplies chamberDia, chamberLen, throatDia, exitDia, wall by newScale/cfg.scale
encodeState(s: AppState): string       // 'v1.' + base64url(JSON of a compact array)
decodeState(hash: string): AppState | null   // null on anything malformed; result is sanitized
isModified(cfg: EngineConfig): boolean  // differs from its preset's stock config
```
- [ ] Tests: `decodeState(encodeState(s))` deep-equals `s` for every preset; `applyScale` to 2 then back to 1 restores dims (±1e-9); Review Focus 1 — `decodeState` of `''`, `'v1.!!!'`, `'v9.abc'`, truncated strings, JSON with strings in number slots, and huge numbers returns `null` or a sanitized in-range state, never throws.
- [ ] Implement; tests pass.

### Task 7: Engine cutaway view

**Files:** Create `src/render/geometry.ts`, `src/render/geometry.test.ts`, `src/render/engineView.ts`.

**Produces:**
- `engineProfile(cfg: EngineConfig): { points: {x: number; r: number}[]; throatX: number; exitX: number; length: number }` — metres, x from injector face; cylinder, 30° converging cone with rounded throat, parabolic bell whose length is `nozzleLenPct`% of a 15° cone.
- `viewTransform(profile, widthPx, heightPx): { ppm: number; originX: number; centreY: number }` — engine occupies ≤ 34% of width and ≤ 55% of height, exit plane therefore known in pixels.
- `drawEngine(ctx, cfg, result, view, anim: { fire: number; time: number; overlay: 'none' | 'mach' | 'temp'; failure: SimResult['failure']; failT: number })` — wall with thickness, injector plate, interior glow when firing, optional Mach/temperature colouring, shudder offset, burst/burn-through animation.

- [ ] Tests: profile radius at x=0 is `chamberDia/2`, minimum radius is `throatDia/2` at `throatX`, last point radius is `exitDia/2`, x strictly increasing, bell longer at 100% than 60%.
- [ ] Implement.

### Task 8: Plume shader

**Files:** Create `src/render/plume.ts`, `src/render/plume.frag.ts`, `src/render/plumeParams.ts`, `src/render/plumeParams.test.ts`.

**Produces:**
- `plumeParams(cfg, result, flight, fire: number): PlumeParams` — pure: `{ pressureRatio (Pe/Pa capped 0.05–40), mach, exitRadiusM, intensity, lengthM, diamondSpacingM (1.3·De·√(Me²−1)·clamp), diamondStrength, turbulence, core/mid/edge RGB, opacity, soot, smoke, separated, skyTop/skyBottom RGB }`.
- `createPlumeRenderer(canvas): { draw(p: PlumeParams, view, timeS): void; resize(): void } | null` — `null` if WebGL2 unavailable.

- [ ] Tests: diamond strength is 0 at vacuum and when ideal, > 0 over-expanded at sea level; envelope flare parameter increases monotonically with altitude; kerolox fuel-rich has more soot than ox-rich; intensity is 0 when `fire` is 0.
- [ ] Implement shader: sky gradient; plume envelope (neck when Pe<Pa, flare when Pe>Pa, vacuum bloom); diamonds; fbm noise shear layer; soot core; solid smoke trail; additive glow.
- [ ] Review Focus 5: `null` renderer shows a "needs WebGL2" message in the stage; DPR capped at 2; resize handled.

### Task 9: UI, firing loop, failures

**Files:** Create `src/ui/controls.ts`, `src/ui/readouts.ts`, `src/ui/copy.ts` (labels, tooltips, failure messages), `src/sim/runtime.ts`; fill in `src/main.ts`, `src/style.css`.

**Produces:** `createRuntime(store)` owning: `firing`, `fire` ramp (1 s up, 0.6 s down), ascent sweep (0→100 km in 30 s, stops at top or on shutdown), failure state (cuts plume, plays animation, shows message + **Rebuild** restoring the last non-failing `AppState`), `requestAnimationFrame` loop.

- [ ] Controls per spec table, generated from `RANGES` + `copy.ts`; expansion ratio shown as derived readout; mixture and throttle disabled for solid; preset select, "Reset to stock", Share (copies URL, shows "Link copied"), overlay toggle.
- [ ] Readouts per spec, with stock deltas when `isModified`; three limit meters amber ≥ 85%, red ≥ 100%; failures only trigger while firing (meters still show when idle).
- [ ] URL hash updates via `history.replaceState` on every change; initial state from hash, else default preset.
- [ ] Verify by hand in the browser (Task 11 list).

### Task 10: Sound (stretch)

**Files:** Create `src/audio/rumble.ts`.

- [ ] `createRumble(): { setLevel(thrustFraction: number, altitudeFraction: number): void; setMuted(m: boolean): void }` — looped noise buffer → low-pass (cutoff falls with altitude) → gain. Muted by default; AudioContext created on first unmute click.

### Task 11: Verification

- [ ] `npm test` and `npm run build` clean.
- [ ] In the browser: each preset loads and fires; Merlin Vacuum at sea level shows separation; altitude sweep changes plume from diamonds to bloom; each propellant looks distinct; mixture slider changes colour; over-pressure triggers burst and Rebuild works; shared link reproduces the engine in a fresh tab; no console errors.
