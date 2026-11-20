# Engine Builder Part 1: An Engine Made of Parts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The simulator opens on a blank custom engine assembled from three independent parts (energy source, exhaust type, propellant), with real engines as examples and a choice of working fluid for nuclear engines.

**Architecture:** A new `src/physics/parts.ts` holds an energy-source table and an exhaust-type table. `EngineConfig` carries `energy`, `exhaust` and `propellant` ids; behaviour that hung off `Propellant` (throttling, what the mixture slider means, core limit, wall heat factor, instability size) moves to the energy source. Part changes go through pure reshaping functions in `src/physics/reshape.ts`, called by new store actions.

**Tech Stack:** TypeScript, Vite, Vitest, WebGL2. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-20-engine-builder-design.md`

## Global Constraints

- Each of the twelve examples returns the same `simulate` figures after the change as before (Task 1's snapshot must pass unchanged at the end of every later task).
- No combination is refused, greyed out or answered with an error. An invalid combination is made valid by `sanitize`.
- Old `v1` share links still open.
- Every new control and option has a plain-English label and a one-line hover tip in `src/ui/copy.ts`.
- No changes to the gas solvers (`src/render/engineSim.ts`, `fluidSim.ts`, `gasSim.ts`) unless Task 7 finds a combination that breaks them.
- Work on a branch `engine-parts`, not `main`. Run `npm test` and `npx tsc --noEmit` before every commit.

## Review Focus

1. A share link whose propellant doesn't belong to its energy source (hand-edited) opens with that source's first propellant, not a blank page or the default engine. Test in Task 3.
2. Switching energy source at the ends of the size range (throat 0.02 m, throat 5 m), where the reshaped chamber hits `RANGES` clamps: the engine must not burst from the switch alone. Test in Task 5.
3. Switching exhaust on an engine with a nozzle extension (RL10B-2): the extension is dropped and every figure stays finite. Test in Task 5.
4. Bell → aerospike → bell returns the original dimensions when no clamp was hit. Test in Task 5.
5. An aerospike with 1 cell or 40 cells (the count slider's ends) still has a finite drawable shape. Test in Task 6.

---

### Task 1: Pin today's example figures

**Files:**
- Create: `src/physics/presets.regression.test.ts` (and the snapshot file Vitest writes beside it)

- [ ] **Step 1: Write the snapshot test**

For every entry of `PRESETS`, at `{altitudeKm: 0, throttle: 1}` and `{altitudeKm: 100, throttle: 1}`, snapshot `thrust`, `isp`, `ispSeaLevel`, `ispVacuum`, `massFlow`, `tc`, `exitMach`, `pe`, `limits.structural`, `limits.heating`, `limits.instability`, `state` and `failure` from `simulate(preset.config, flight)`. Round each number with `Number(v.toPrecision(10))`. One `toMatchSnapshot()` per preset, test named `figures for <preset.id>`.

- [ ] **Step 2: Run `npm test`** — expected: 12 snapshots written, all tests pass.

- [ ] **Step 3: Commit** the test and its `__snapshots__` file: `Pin the example engines' figures before restructuring`.

---

### Task 2: Split the engine into three part records

**Files:**
- Create: `src/physics/parts.ts`, `src/physics/parts.test.ts`
- Modify: `src/physics/types.ts`, `propellants.ts`, `engine.ts`, `limits.ts`, `presets.ts`, `src/state/store.ts`, `src/state/share.ts` (compile fix only; format change is Task 3), `src/ui/copy.ts`, `src/ui/controls.ts`, `src/main.ts`, `src/sim/runtime.ts`, `src/render/engineView.ts`, `aerospikeView.ts`, `geometry.ts`, `plumeParams.ts`, `plume.ts`, `plume.frag.ts`, `fluidSim.ts`, `engineSim.ts`, `simFigures.ts`, `src/dev/accuracy.ts`, and existing tests that build configs.

**Interfaces — Produces:**

```ts
// types.ts
export type EnergyId = 'combustion' | 'solid' | 'reactor' | 'saltwater';
export type ExhaustId = 'bell' | 'aerospike';
export type PropellantId = 'kerolox' | 'hydrolox' | 'methalox' | 'hypergolic' | 'solid' | 'ntr-hydrogen' | 'saltwater';
// EngineConfig: add `energy: EnergyId`, `exhaust: ExhaustId`; remove `aerospike: boolean`.
// Propellant: add `energy: EnergyId`; remove throttleable, mixKind, mixLabel, coreTempLimit,
// wallHeatFactor, instabilityRefDia. Keep lStarRef.

// parts.ts
export interface EnergySource {
  id: EnergyId; name: string; tip: string;
  throttleable: boolean;
  mixKind: 'ratio' | 'temperature' | 'none';
  mixLabel?: { label: string; tip: string };
  coreTempLimit?: number;
  wallHeatFactor?: number;
  instabilityRefDia: number;
  /** Usual proportions, as the examples in presets.ts use them */
  starter: { contraction: number; lStar: number };
}
export const ENERGY_SOURCES: Record<EnergyId, EnergySource>;
export const ENERGY_IDS: EnergyId[];
export const EXHAUSTS: Record<ExhaustId, { id: ExhaustId; name: string; tip: string }>;
export const EXHAUST_IDS: ExhaustId[];
export function isEnergyId(v: unknown): v is EnergyId;
export function isExhaustId(v: unknown): v is ExhaustId;
/** Propellants a source offers, in menu order */
export function propellantsFor(energy: EnergyId): PropellantId[];
```

Values, moved unchanged from today's `PROPELLANTS`:

| Source | name | throttleable | mixKind | instabilityRefDia | other | starter (contraction, lStar) |
|---|---|---|---|---|---|---|
| combustion | Combustion chamber | true | ratio | 1.15 | | 1.7, 1.1 |
| solid | Solid motor | false | none | 4.0 | | 3.0, 5 |
| reactor | Nuclear reactor | true | temperature | 6.0 | coreTempLimit 2900, mixLabel "Core temperature" | 6.0, 1.3 |
| saltwater | Nuclear salt water | true | temperature | 8.0 | wallHeatFactor 0.0225, mixLabel "Reaction temperature" | 1.12, 4.0 |

The reactor's `mixLabel.tip` and the meltdown text in `copy.ts` say "hydrogen" today; change both to "propellant". Exhaust names: "Bell nozzle", "Aerospike".

- [ ] **Step 1: Write failing tests in `parts.test.ts`**
  - every `PropellantId`'s `energy` is a key of `ENERGY_SOURCES`, and `propellantsFor(e)` returns exactly the propellants whose `energy` is `e`, non-empty for each source;
  - `propellantsFor('combustion')` equals `['kerolox','hydrolox','methalox','hypergolic']`;
  - `sanitize` of a config with `energy: 'reactor', propellant: 'kerolox'` returns `propellant: 'ntr-hydrogen'` and `mixtureRatio` inside that propellant's range;
  - `sanitize` of a config with an invalid `energy` and `propellant: 'solid'` returns `energy: 'solid'`; with both invalid returns `combustion` + `kerolox`;
  - `sanitize` of a config with an invalid `exhaust` returns `'bell'`.

- [ ] **Step 2: Run `npm test`** — expected: FAIL, `parts` module missing.

- [ ] **Step 3: Implement.** Create `parts.ts`; change the types; in `propellants.ts` rename `nuclear` to `ntr-hydrogen` (name "Hydrogen"), add `energy` to each entry and delete the moved fields. In `sanitize` (`engine.ts`): resolve `energy` (valid as given, else the propellant's own, else `combustion`), then `propellant` (kept if it belongs to the source, else `propellantsFor(energy)[0]`), then `exhaust` (else `bell`). Everywhere else, mechanically:
  - `PROPELLANTS[x].throttleable | mixKind | mixLabel | coreTempLimit | wallHeatFactor | instabilityRefDia` → `ENERGY_SOURCES[cfg.energy].…`
  - `cfg.aerospike` → `cfg.exhaust === 'aerospike'`
  - `propellant === 'solid' | 'nuclear' | 'saltwater'` checks in `engineView.ts`, `runtime.ts`, and `failureCopy` → `energy === 'solid' | 'reactor' | 'saltwater'`; `failureCopy(failure, energy: EnergyId)`
  - the solver cache keys in `runtime.ts` (lines ~125, ~301) include `energy` and `exhaust`
  - `presets.ts` `Spec` gains `energy` (derived from the propellant's `energy`), `aerospike?: boolean` becomes `exhaust?: ExhaustId`
  - `isModified` in `store.ts` compares `energy`, `exhaust` and `propellant`
  - `share.ts`: keep the `v1` layout for now, writing `exhaust === 'aerospike' ? 1 : 0` and reading it back into `exhaust`, with `energy` taken from the propellant.

- [ ] **Step 4: Run `npm test` and `npx tsc --noEmit`** — expected: all pass, Task 1 snapshots unchanged (do not update them).

- [ ] **Step 5: Commit**: `Describe an engine as an energy source, an exhaust type and a propellant`.

---

### Task 3: Share links carry the three parts

**Files:** Modify `src/state/share.ts`, `src/state/state.test.ts`

**Interfaces:** `encodeState` / `decodeState` signatures unchanged. New layout, version `'v2'`, exactly 18 entries: `[presetId, energy, exhaust, propellant, chamberDia, chamberLen, throatDia, exitDia, nozzleLenPct, wall, chamberPressureBar, mixtureRatio, scale, altitudeKm, throttle, chambers, extFixedDia, extDeploy]`. Any other length returns `null`.

- [ ] **Step 1: Write failing tests**
  - round trip: `decodeState(encodeState(s))` deep-equals `s` for the `nerva`, `xrs-2200` and `rl10b-2` examples;
  - a `v1` link built by hand with propellant `'nuclear'` (17 entries, aerospike flag 0) decodes to `energy: 'reactor', propellant: 'ntr-hydrogen', exhaust: 'bell'`; with `'saltwater'` to `saltwater`/`saltwater`; with `'solid'` to `solid`/`solid`; with `'hydrolox'` and flag 1 to `combustion`/`hydrolox`/`aerospike`; 13-, 14- and 16-entry `v1` links still decode;
  - (Review Focus 1) a `v2` link with `energy: 'reactor', propellant: 'kerolox'` decodes to a non-null state with `propellant: 'ntr-hydrogen'`;
  - a `v2` link with an unknown energy, exhaust or propellant string returns `null`.

- [ ] **Step 2: Run** — expected FAIL. **Step 3: Implement** `v2` encoding and a `v1` decoder with the legacy propellant map. **Step 4: Run `npm test`** — PASS.

- [ ] **Step 5: Commit**: `Carry the three parts in share links, and keep old links working`.

---

### Task 4: Nuclear working fluids

**Files:** Modify `src/physics/types.ts` (ids), `propellants.ts`, `propellants.test.ts`

**Interfaces — Produces:** `PropellantId` gains `'ntr-ammonia' | 'ntr-methane' | 'ntr-water' | 'ntr-co2' | 'ntr-helium'`, all with `energy: 'reactor'`, `lStarRef: 0`, `ofMin 1500, ofMax 3200, ofDefault 2360`, and table rows at the same five temperatures as hydrogen (`of` = `tc`). `propellantsFor('reactor')` order: hydrogen, ammonia, methane, water, carbon dioxide, helium.

Starting table values (gamma, molar mass at 1500 / 2000 / 2360 / 2800 / 3200 K). Tune within the test bands below; note the source beside each table as the existing ones do (Zubrin's NIMF propellant figures at 2800 K: CO₂ 283 s, H₂O 370 s, CH₄ 606 s; ammonia fully cracked to N₂ + 3H₂).

| Fluid | name | gamma | molar mass | look |
|---|---|---|---|---|
| ntr-ammonia | Ammonia | 1.31, 1.30, 1.295, 1.29, 1.28 | 8.52, 8.52, 8.52, 8.50, 8.45 | faint and pale like hydrogen, warmer tint; afterburns (hydrogen in it), strength 0.7 |
| ntr-methane | Methane | 1.24, 1.23, 1.22, 1.21, 1.19 | 8.0, 8.0, 7.9, 7.6, 7.0 | orange glow from carbon particles: particles 0.6, soot 0.5, opacity 0.8; afterburn 0.9 |
| ntr-water | Water | 1.20, 1.19, 1.185, 1.18, 1.17 | 18.0, 18.0, 17.9, 17.6, 17.0 | near-invisible steam, opacity 0.3, afterburnStrength 0 |
| ntr-co2 | Carbon dioxide | 1.18, 1.17, 1.17, 1.16, 1.15 | 44.0, 43.8, 43.3, 42.0, 40.0 | near-invisible, opacity 0.25, afterburnStrength 0.1 |
| ntr-helium | Helium | 1.667 (all rows) | 4.003 (all rows) | near-invisible, opacity 0.2, afterburnStrength 0 |

- [ ] **Step 1: Write failing tests.** With the `nerva` example's config, `altitudeKm: 100`, and `mixtureRatio: 2800`, compute `ispVacuum` for each fluid as a fraction of hydrogen's:
  - ammonia 0.44–0.52; methane 0.55–0.70; water 0.36–0.44; carbon dioxide 0.26–0.33; helium 0.50–0.62;
  - every fluid at 3200 K fails with `'meltdown'` and at 2360 K has `failure: null` (the core limit belongs to the reactor);
  - `richness(id, x)` is finite across the range for each fluid.

- [ ] **Step 2: Run** — FAIL. **Step 3: Add the five entries.** **Step 4: Run `npm test`** — PASS; tune table values only if a band is missed.

- [ ] **Step 5: Commit**: `Let a nuclear engine run on ammonia, methane, water, carbon dioxide or helium`.

---

### Task 5: Swapping parts reshapes the engine

**Files:**
- Create: `src/physics/reshape.ts`, `src/physics/reshape.test.ts`
- Modify: `src/physics/presets.ts` (share the chamber-shape arithmetic), `src/state/store.ts`, `src/state/state.test.ts`

**Interfaces — Produces:**

```ts
// reshape.ts
/** Chamber diameter and length for a throat, as presets.ts build() computes them today */
export function chamberShape(throatDia: number, contraction: number, lStar: number, lStarRef: number): { chamberDia: number; chamberLen: number };
export function withEnergy(cfg: EngineConfig, energy: EnergyId): EngineConfig;
export function withExhaust(cfg: EngineConfig, exhaust: ExhaustId): EngineConfig;
/** The blank engine the simulator opens on: presetId null */
export function starterEngine(): EngineConfig;
export const DEFAULT_CELLS = 20;

// store.ts — Store gains:
setEnergy(id: EnergyId): void;
setExhaust(id: ExhaustId): void;
newEngine(): void;
// defaultState() returns starterEngine() at altitude 0, throttle 1.
```

Rules (from the spec):
- `withEnergy`: no change if `energy` is already set. Otherwise propellant = `propellantsFor(energy)[0]`, `mixtureRatio` = its `ofDefault`, chamber from `chamberShape(throatDia, starter.contraction, starter.lStar, propellant.lStarRef)`, and `wall` multiplied by `newChamberDia / oldChamberDia` using the chamber diameter **after** `sanitize` has clamped it, so `limits.structural` is unchanged. Throat, exit, pressure, `presetId`, `scale`, `chambers`, exhaust all kept.
- `withExhaust`: no change if already set. With `n` = `DEFAULT_CELLS` going to an aerospike and 1 going to a bell, and `k = sqrt(cfg.chambers / n)`: multiply `chamberDia`, `throatDia`, `exitDia` and `wall` by `k`; multiply `chamberLen` by `k` only when the propellant's `lStarRef` is 0 (a burning chamber keeps its length, and so its characteristic length); set `chambers = n`; going to an aerospike set `extFixedDia = 0`, `extDeploy = 1`.
- `starterEngine`: combustion, bell, kerolox, 100 bar, mixture 2.36, throat 0.2 m, expansion ratio 16, `chamberShape(0.2, 1.7, 1.1, 1.0)`, `nozzleLenPct` 80, wall for a structural fraction of 0.5 (`pc·chamberDia / (2·SIGMA_ALLOW_BAR·0.5)`), scale 1, one chamber, no extension.
- Store actions apply the function, `sanitize`, emit. `newEngine` keeps `flight`.

- [ ] **Step 1: Write failing tests**
  - `starterEngine()` survives `sanitize` unchanged, has `presetId: null`, and `simulate` at sea level gives `failure: null` with all three limits below 0.7;
  - for each energy source `e`, `withEnergy(starterEngine(), e)`: `energy === e`, propellant is the source's first, throat/exit/pressure unchanged, `limits.structural` within 1% of the starter's, `failure: null` at altitude 0 and 100;
  - (Review Focus 2) the same structural check starting from the starter rescaled so `throatDia` is 0.02 and again 5 (use `applyScale`-style multiplication then `sanitize`): `limits.structural` after `sanitize(withEnergy(...))` is no more than 1.01× before, for every source;
  - `withExhaust(starterEngine(), 'aerospike')`: 20 cells, total throat area (`chambers · throatDia²`) and total exit area equal to before within 1e-9 relative, thrust at 100 km within 3% of before, `limits.structural` unchanged within 1%;
  - (Review Focus 4) `withExhaust(withExhaust(starterEngine(), 'aerospike'), 'bell')` equals `starterEngine()` to 1e-9 on every number;
  - (Review Focus 3) `withExhaust(rl10b2.config, 'aerospike')` has `extFixedDia: 0` and `simulate` returns finite `thrust`, `isp`, `massFlow` at altitude 0 and 100;
  - store: `loadPreset('merlin-1d')` then `setEnergy('reactor')` leaves `presetId: 'merlin-1d'` and `isModified` true; `newEngine()` gives `presetId: null` and a config equal to `starterEngine()`; `defaultState().config.presetId` is null;
  - Task 1 snapshots still pass after `presets.ts` uses `chamberShape`.

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run `npm test`, `npx tsc --noEmit`** — PASS.

- [ ] **Step 5: Commit**: `Reshape the engine to suit a new energy source or exhaust type`.

---

### Task 6: The workshop screen

**Files:** Modify `index.html`, `src/ui/controls.ts`, `src/ui/copy.ts`, `src/main.ts`, `src/style.css`, `src/render/geometry.test.ts`

**Interfaces — Consumes:** `ENERGY_SOURCES`, `ENERGY_IDS`, `EXHAUSTS`, `EXHAUST_IDS`, `propellantsFor`, `store.setEnergy`, `store.setExhaust`, `store.newEngine`, `RANGES.chambers`, `RANGES.cells`.

- [ ] **Step 1: Write the failing test** (Review Focus 5) in `geometry.test.ts`: for `withExhaust(starterEngine(), 'aerospike')` with `chambers` set to 1 and to 40, every point of `engineProfile(cfg)`'s contour and spike is finite and `simulate` returns finite thrust. Run — fix `geometry.ts` only if it fails.

- [ ] **Step 2: Part pickers.** A new first group in the left panel titled "Parts" with three selects, each a `label.row` with a hover tip like the existing propellant row:
  - "Energy source" (`id="energy"`) from `ENERGY_IDS`, calling `store.setEnergy`;
  - "Exhaust" (`id="exhaust"`) from `EXHAUST_IDS`, calling `store.setExhaust`;
  - "Propellant" (`id="propellant"`, moved from the Propellant group), its options rebuilt from `propellantsFor(s.config.energy)` whenever the energy source changes, with the existing fuel + oxidiser note under it.
  Add `TIPS.energy`, `TIPS.exhaust`; each option's `title` is its record's `tip`. The mixture slider stays in the Propellant group.

- [ ] **Step 3: Count slider** in the Engine group after "Engine scale": `id="chambers"`, range `RANGES.cells` for an aerospike else `RANGES.chambers`, integer steps, label and tip via `describe`: "Chambers" / "How many identical chambers share the engine. Thrust and propellant flow rise with each one." and "Thrust cells" / "How many small chambers fire along the spike. Thrust and propellant flow rise with each one." Format: the bare integer.

- [ ] **Step 4: Examples menu.** In `index.html` the header label reads "Examples". `fillPresetSelect` puts a selectable "New engine" option first (value `__new`), then the examples, then the hidden "Your engine" option (value `''`) shown when `presetId` is null. In `main.ts`, selecting `__new` calls `store.newEngine()`; `syncHeader` blurb for no example: "Your own engine. Pick its parts on the left, or start from an example." Update the `TIPS.propellant` wording so it fits a reactor fluid ("What the engine pushes out…").

- [ ] **Step 5: Verify in the browser.** `preview_start` the dev server from `.claude/launch.json`. Check: opens on "Your engine" with Reset disabled; each energy source selected in turn redraws and fires without a failure box; propellant options change with the source; aerospike switch shows 20 cells and the count slider moves 1–40; "New engine" returns to the start; loading NERVA then choosing Ammonia shows vacuum Isp near 400 s and "Modified NERVA"; no console errors. Screenshot the nuclear-ammonia engine firing.

- [ ] **Step 6: Run `npm test`, `npm run build`** — PASS. **Commit**: `Open on a build-your-own engine with part pickers`.

---

### Task 7: Every source with every exhaust

**Files:** whatever Step 1 finds; `docs/future-work.md`

- [ ] **Step 1:** In the browser, with Plume and Engine gas both Simulated, fire each of the eight source × exhaust combinations at sea level and at 100 km, lit from cold, and each reactor fluid on a bell. For each, note: draws correctly, no console error, no runaway (blank or flashing gas), readouts finite. Run `src/dev/accuracy.ts` as its header describes for a reactor aerospike and a solid aerospike.

- [ ] **Step 2:** For each fault, write a failing test where one can express it (a geometry or `simInputs` value), fix it, and re-run Step 1 for that combination. A combination whose simulated gas cannot be made stable falls back to the drawn plume for that combination, as a separated light-exhaust jet already does in `runtime.ts`; it is never blocked.

- [ ] **Step 3:** Add a short section to `docs/future-work.md`: the five-part roadmap from the spec, which part is built, and anything Step 2 left as a fallback.

- [ ] **Step 4: Run `npm test`, `npm run build`** — PASS. **Commit**: `Check every energy source against every exhaust type`.
