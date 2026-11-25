# Expansion-Deflection Nozzle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new exhaust type with a plug in its throat, whose figures come from a formula and whose whole nozzle (ring, plug, bell and the hollow behind the plug) is simulated in the plume grid.

**Architecture:** The type is one more record in `src/physics/exhausts.ts` with its own thrust rule in `simulate`. For the simulation it is routed as the aerospike is: the engine grid is switched off and the plume grid is given a ring of gas, a solid body on the centreline and a curved outer wall, all behind one new switch in the shader so every other engine runs the instructions it runs today.

**Tech Stack:** TypeScript, Vitest, WebGL2 (GLSL ES 3.00 in `src/render/fluidSim.ts`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-25-expansion-deflection-design.md`

## Global Constraints

- The twelve example engines are pinned. `src/physics/__snapshots__/presets.regression.test.ts.snap` and `src/render/__snapshots__/geometry.regression.test.ts.snap` are never regenerated or edited. If Vitest rewrites a snapshot's line endings, `git checkout --` it before committing.
- `src/render/engineSim.ts` and `src/render/gasSim.ts` are not changed.
- Every change to the shader in `src/render/fluidSim.ts` is behind a switch that is off unless an ED nozzle is being simulated. Task 4's fingerprints must be identical after Task 5.
- An ED nozzle never reads `'separated'`, and never reads better than an aerospike of the same throat and exit at any altitude.
- Exact values from the spec: `plugShare` range 0.4 to 0.8, default 0.7. Wall radius at the ring `throatDia / 2 / sqrt(1 - plugShare^2)`. Base drag factor on momentum `1 - 0.04 * plugShare^2` at every altitude. Compensation share while the wake is open `0.3 + 0.3 * plugShare`. Gas enters the grid along the axis at Mach 1.1. Grid long enough for 2.2 bell lengths and tall enough for 1.25 mouth radii; not simulated whole when that needs more than 24 ring radii. Share format `v5`.
- When sizes clash, `sanitize` lowers `plugShare` (to no less than 0.4) until the wall at the ring is at most 95% of the chamber's radius and the exit is at least 1.15 times the wall's diameter at the ring; if that is not enough it raises `exitDia`. For an ED nozzle only.
- Words the user reads are plain English for an enthusiast, in the page's voice.
- Commit messages are plain-English sentences in the style of `git log`, ending with the trailer `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. **A plug at either end of its range on an engine with a small exit or a small chamber.** Expected: `sanitize` gives a valid engine whose bell widens toward its mouth, and the picture draws it. Task 1.
2. **Swapping ED to aerospike to bell and back.** Expected: the throat area and the sizes survive, as for the other types, and `plugShare` is what it was. Task 1.
3. **A `v4` link, and a `v5` link naming an exhaust this build does not know.** Expected: the first opens as before; the second opens as a bell. Task 1.
4. **An ED nozzle too long for the grid** (area ratio above about 40). Expected: the plume is simulated from the mouth, the gas inside is drawn, and the page says why. Task 5.
5. **Lit from cold in vacuum, and at low throttle at sea level.** Expected: no runaway and nothing that is not a number. Task 6.

---

### Task 1: The part, its shape, its slider and its links

**Files:**
- Modify: `src/physics/types.ts`, `src/physics/exhausts.ts`, `src/physics/engine.ts` (`RANGES`, `sanitize`, `flowExitDiameter` only), `src/physics/reshape.ts`, `src/state/share.ts`, `src/ui/controls.ts`, `src/ui/copy.ts`
- Test: `src/physics/exhausts.test.ts`, `src/physics/engine.test.ts`, `src/physics/reshape.test.ts`, `src/state/state.test.ts`, `src/ui/controls.test.ts`

**Interfaces:**
- Produces:
  - `ExhaustId` gains `'expansionDeflection'`; `EngineConfig.plugShare: number`.
  - `RANGES.plugShare = { min: 0.4, max: 0.8, fallback: 0.7 }`.
  - `ExhaustType.sliders.plugShare: boolean` (true only for the new type); `EXHAUSTS.expansionDeflection` with `counts: 'chambers'`, `hasNozzle: true`, `extension: false`, sliders `exitDia`, `nozzleLenPct`, `plugShare`.
  - `export function ringWallRadius(cfg: EngineConfig): number` in `exhausts.ts`: `cfg.throatDia / 2 / Math.sqrt(1 - cfg.plugShare ** 2)` for the new type, `cfg.throatDia / 2` otherwise.
  - `divergingWall` and `lipSlope` handle the new type: the ordinary bell contour started from `ringWallRadius(cfg)` at the ring.
  - Until Task 2, `simulate` treats the new type as a bell.

- [ ] **Step 1: Write the failing tests**

```ts
// exhausts.test.ts
it('keeps the ring the size of the throat at every plug size', () => {
  for (const plugShare of [0.4, 0.55, 0.7, 0.8]) {
    const cfg = sanitize({ ...starterEngine(), exhaust: 'expansionDeflection', plugShare });
    const wall = ringWallRadius(cfg), plug = wall * cfg.plugShare;
    expect(Math.PI * (wall ** 2 - plug ** 2)).toBeCloseTo(Math.PI * (cfg.throatDia / 2) ** 2, 9);
  }
});
it('starts the bell at the wall of the ring and widens all the way to the mouth', () => {
  const cfg = sanitize({ ...starterEngine(), exhaust: 'expansionDeflection' });
  const { points } = divergingWall(cfg);
  expect(points[0].r).toBeCloseTo(ringWallRadius(cfg), 9);
  for (let i = 1; i < points.length; i++) expect(points[i].r).toBeGreaterThan(points[i - 1].r);
  expect(points[points.length - 1].r).toBeCloseTo(cfg.exitDia / 2, 9);
});
it('shows the plug slider for this type alone', () => {
  for (const id of EXHAUST_IDS) expect(EXHAUSTS[id].sliders.plugShare, id).toBe(id === 'expansionDeflection');
});

// engine.test.ts
it('gives every other exhaust the default plug and clamps this one', () => {
  expect(sanitize({ ...starterEngine(), plugShare: 0.5 }).plugShare).toBe(0.7);
  const ed = (plugShare: number) => sanitize({ ...starterEngine(), exhaust: 'expansionDeflection', plugShare }).plugShare;
  expect(ed(0.1)).toBe(0.4);
  expect(ed(Number.NaN)).toBe(0.7);
  expect(ed(0.99)).toBeLessThanOrEqual(0.8);
});
it('shrinks the plug, then widens the exit, when the sizes do not fit', () => {
  const base = { ...starterEngine(), exhaust: 'expansionDeflection' as const };
  // An exit only just wider than the throat: the plug gives way to its smallest, then the exit grows.
  const tight = sanitize({ ...base, plugShare: 0.8, exitDia: base.throatDia * 1.05 });
  expect(tight.plugShare).toBe(0.4);
  expect(tight.exitDia).toBeGreaterThanOrEqual(2 * ringWallRadius(tight) * 1.15 - 1e-9);
  // A chamber only just wider than the throat: the wall at the ring stays inside it.
  const narrow = sanitize({ ...base, plugShare: 0.8, chamberDia: base.throatDia / 0.9 });
  expect(ringWallRadius(narrow)).toBeLessThanOrEqual(0.95 * narrow.chamberDia / 2 + 1e-9);
  // The same sizes on a bell are left alone.
  expect(sanitize({ ...base, exhaust: 'bell', exitDia: base.throatDia * 1.05 }).exitDia).toBeCloseTo(base.throatDia * 1.05, 9);
});

// reshape.test.ts
it('keeps the throat, the sizes and the plug through a swap to an aerospike and a bell and back', () => {
  const ed = sanitize({ ...starterEngine(), exhaust: 'expansionDeflection', plugShare: 0.6 });
  const back = withExhaust(withExhaust(withExhaust(ed, 'aerospike'), 'bell'), 'expansionDeflection');
  expect(back.exhaust).toBe('expansionDeflection');
  expect(back.plugShare).toBe(0.6);
  expect(back.throatDia * Math.sqrt(back.chambers)).toBeCloseTo(ed.throatDia * Math.sqrt(ed.chambers), 6);
});

// state.test.ts
it('carries an expansion-deflection nozzle and its plug in a link', () => {
  const state = { config: sanitize({ ...starterEngine(), exhaust: 'expansionDeflection', plugShare: 0.55 }), flight: { altitudeKm: 12, throttle: 0.8 } };
  const opened = decodeState(encodeState(state))!;
  expect(opened.config.exhaust).toBe('expansionDeflection');
  expect(opened.config.plugShare).toBeCloseTo(0.55, 6);
  expect(encodeState(state).startsWith('v5')).toBe(true);
});
it('still opens a v4 link, with the default plug', () => {
  // Build a v4 link by hand from today's layout (22 entries) for the starter engine and decode it:
  // exhaust and sizes as encoded, plugShare 0.7.
});
it('opens a v5 link naming an exhaust it does not know as a bell', () => {
  // Encode an ED engine, replace the exhaust entry with 'warpNacelle', decode: exhaust 'bell'.
});

// controls.test.ts
it('hides the plug slider for every exhaust but expansion-deflection', () => {
  // shapeHidden('plugShare') over EXHAUST_IDS, as the existing shape-slider test does.
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/physics/exhausts.test.ts src/physics/engine.test.ts src/physics/reshape.test.ts src/state/state.test.ts src/ui/controls.test.ts`
Expected: FAIL, `'expansionDeflection'` is not an `ExhaustId`; `ringWallRadius` is not exported.

- [ ] **Step 3: Implement**

- Types, record, `ringWallRadius`, the two switches. `SHAPE_SLIDERS` in `controls.ts` gains `'plugShare'`; a slider "Plug size" reading as a whole percentage, step 0.01; `TIPS.plugShare`.
- `sanitize`: `plugShare` clamps for the new type and is the default for every other; then the size rule from Global Constraints.
- `share.ts`: `VERSION = 'v5'`; `v5` is the `v4` array plus `plugShare` at the end; `v4` and earlier decode as today with `plugShare` 0.7.
- `withExhaust`: the new type counts chambers, so a swap among chamber-counting types stays `sanitize({ ...cfg, exhaust })`.
- `engineProfile` builds its nozzle from `divergingWall`, so the picture already draws a bell starting wider at the throat. Check `src/render/geometry.ts` handles a wall whose first radius is above `throatDia / 2` (the converging section must meet it); fix there if not.

- [ ] **Step 4: Run the whole suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS. No snapshot file changed after `git checkout -- src/physics/__snapshots__ src/render/__snapshots__`.

- [ ] **Step 5: Commit**

```bash
git add src && git commit -m "Add the expansion-deflection nozzle as a part: its shape, its plug slider and its links"
```

---

### Task 2: The thrust rule and its words

**Files:**
- Modify: `src/physics/engine.ts` (thrust block of `simulate`), `src/ui/copy.ts` (`expansionText`, `STATE_COPY`)
- Test: `src/physics/engine.test.ts`, `src/ui/copy.test.ts`

**Interfaces:**
- Consumes: `EngineConfig.plugShare`, `'expansionDeflection'` from Task 1.
- Produces: `export function edBaseDrag(plugShare: number): number` (`1 - 0.04 * plugShare ** 2`) and `export function edCompensation(plugShare: number): number` (`0.3 + 0.3 * plugShare`) in `engine.ts`; `expansionText(result, exhaust)` gives the new type its own sentence for `'compensating'`.

- [ ] **Step 1: Write the failing tests**

```ts
const ed = (patch = {}) => sanitize({ ...starterEngine(), exhaust: 'expansionDeflection', exitDia: starterEngine().throatDia * 6, ...patch });
const at = (cfg: EngineConfig, altitudeKm: number) => simulate(cfg, { altitudeKm, throttle: 1 });

it('compensates near the ground and runs as a bell once the air is thin', () => {
  expect(at(ed(), 0).state).toBe('compensating');
  expect(['ideal', 'under']).toContain(at(ed(), 100).state);
});
it('never separates, at any altitude or throttle', () => {
  for (let km = 0; km <= 100; km += 2) for (const throttle of [0.4, 1]) {
    expect(simulate(ed(), { altitudeKm: km, throttle }).state).not.toBe('separated');
  }
});
it('gains thrust steadily as it climbs, with no step where the wake closes', () => {
  let last = 0;
  for (let km = 0; km <= 100; km += 0.5) {
    const t = at(ed(), km).thrust;
    expect(t, `${km} km`).toBeGreaterThanOrEqual(last - 1e-6 * last);
    last = t;
  }
});
it('beats the same bell near the ground and loses a little to it in vacuum', () => {
  const bell = sanitize({ ...ed(), exhaust: 'bell' });
  expect(at(ed(), 0).thrust).toBeGreaterThan(at(bell, 0).thrust);
  const ratio = at(ed(), 100).thrust / at(bell, 100).thrust;
  expect(ratio).toBeLessThan(1);
  expect(ratio).toBeGreaterThan(0.96);
});
it('never beats an aerospike of the same throat and exit', () => {
  // Compare thrust per unit of throat area, since an aerospike splits the engine into cells:
  // for km in 0..100 step 5, ed thrust / throat area <= aerospike thrust / total throat area * 1.001.
});
it('compensates better near the ground with a bigger plug, and drags more in vacuum', () => {
  expect(at(ed({ plugShare: 0.8 }), 0).thrust).toBeGreaterThan(at(ed({ plugShare: 0.4 }), 0).thrust);
  expect(at(ed({ plugShare: 0.8 }), 100).thrust).toBeLessThan(at(ed({ plugShare: 0.4 }), 100).thrust);
});
it('has the stated constants', () => {
  expect(edBaseDrag(0.7)).toBeCloseTo(0.9804, 4);
  expect(edCompensation(0.7)).toBeCloseTo(0.51, 9);
});

// copy.test.ts
it('says what the air does for each compensating nozzle', () => {
  const r = simulate(ed(), { altitudeKm: 0, throttle: 1 });
  expect(expansionText(r, 'expansionDeflection')).toMatch(/plug/);
  expect(expansionText(r, 'expansionDeflection')).not.toMatch(/spike|aerospike/);
  // and the aerospike's sentence is unchanged from STATE_COPY.compensating.text
});
```

If the aerospike comparison shows the proposed constants let an ED nozzle win somewhere, that is a finding about the constants: lower the compensation share until it does not, and record the change.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/physics/engine.test.ts src/ui/copy.test.ts`
Expected: FAIL: state is `'over'` or `'separated'` at sea level; `edBaseDrag` is not exported.

- [ ] **Step 3: Implement** the rule in the thrust block, beside the aerospike's and with the same shape: base drag on the momentum term at every altitude; where `pa > 0 && pe < pa`, state `'compensating'`, gas leaving at `pa`, thrust pulled `edCompensation(plugShare)` of the way to the matched figure; `'separated'` never chosen for this type. Then the sentence in `copy.ts`.

- [ ] **Step 4: Run the whole suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS, no snapshot changed.

- [ ] **Step 5: Commit**

```bash
git add src && git commit -m "Give the expansion-deflection nozzle its thrust: it compensates while its wake is open and never separates"
```

---

### Task 3: The plug in the picture, and the drawn gas

**Files:**
- Modify: `src/render/geometry.ts` (`EngineProfile`, `engineProfile`), `src/render/engineView.ts`
- Test: `src/render/geometry.test.ts`

**Interfaces:**
- Consumes: `ringWallRadius(cfg)` from Task 1; `SimResult.state` from Task 2.
- Produces:
  ```ts
  export interface PlugGeometry {
    /** x of the plug's flat base, which is the plane of the ring (the profile's throatX) */
    baseX: number;
    /** Radius of the plug's rim, m */
    rimR: number;
    /** Where the stalk that carries it starts, back in the chamber, and its radius */
    stalkX: number;
    stalkR: number;
  }
  // EngineProfile gains: plug: PlugGeometry | null   (null for every other exhaust type)
  ```

- [ ] **Step 1: Write the failing tests** in `src/render/geometry.test.ts`

```ts
it('gives an expansion-deflection nozzle a plug at its throat, and no other type one', () => {
  const cfg = sanitize({ ...starterEngine(), exhaust: 'expansionDeflection', plugShare: 0.6 });
  const p = engineProfile(cfg);
  expect(p.plug).not.toBeNull();
  expect(p.plug!.baseX).toBeCloseTo(p.throatX, 9);
  expect(p.plug!.rimR).toBeCloseTo(0.6 * ringWallRadius(cfg), 9);
  expect(p.plug!.stalkR).toBeLessThan(p.plug!.rimR);
  expect(p.plug!.stalkX).toBeLessThan(p.plug!.baseX);
  expect(p.plug!.stalkX).toBeGreaterThanOrEqual(0);
  for (const id of EXHAUST_IDS) if (id !== 'expansionDeflection') {
    expect(engineProfile(sanitize({ ...starterEngine(), exhaust: id })).plug, id).toBeNull();
  }
});
it('leaves the ring clear: the wall is outside the plug everywhere along it', () => {
  // For plugShare 0.4, 0.7, 0.8: at every profile point with stalkX <= x <= baseX, point.r > the plug's radius there.
});
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run src/render/geometry.test.ts`
Expected: FAIL, `plug` is undefined.

- [ ] **Step 3: Implement** the geometry, then draw it in `engineView.ts`: the plug and stalk in the wall's metal; with the gas drawn (not simulated), a band of gas along the wall and an empty wake while `result.state === 'compensating'`, and the whole bell otherwise. Where the gas is simulated (`anim.simGas`), leave the inside of the bell unpainted.

- [ ] **Step 4: Run the whole suite, then look at it**

Run: `npx tsc --noEmit && npm test` — Expected: PASS, no snapshot changed.
Then in a browser (`npm run dev`), with Plume set to Drawn: build an ED engine, light it at sea level and at 60 km, at plug 0.4, 0.7 and 0.8. Expected: the plug is drawn, the ring is clear, the wake is empty near the ground and filled high up, no console errors.

- [ ] **Step 5: Commit**

```bash
git add src && git commit -m "Draw the plug, and the gas round it when the plume is drawn"
```

---

### Task 4: Fingerprints of the plume grid, before the shader changes

**Files:**
- Modify: `src/dev/accuracy.ts`
- Create: `docs/superpowers/plans/2026-11-25-expansion-deflection-fingerprints.md`

**Interfaces:**
- Produces: in the measuring tool, `fingerprint(name: 'bell' | 'aerospike' | 'extension'): Promise<string>`, callable from the browser console as the tool's other cases are. Each lights its case from cold (`reset()`), ramps the fire over 60 frames, runs 240 frames in all with fixed inputs, reads the whole plume grid back, and returns the sum of every cell's four numbers and the sum of their squares, each printed to 17 significant figures, joined by a space.
  - `bell`: Merlin 1D at sea level, `simInputs` as the tool's joined case builds them, no wall.
  - `aerospike`: the XRS-2200 at sea level, `spikeSimInputs`.
  - `extension`: the RL10B-2 at 60 km with its extension seated and unseated-at-half (two fingerprints), with the `SimWall` the runtime builds for it.

- [ ] **Step 1: Write the three cases.** The tool has no automated test of its own (it needs a GPU); follow its existing structure for a case run from the console.

- [ ] **Step 2: Run each twice in a browser and confirm the two runs agree**

Run: `npm run dev`, open the tool's page as `docs/future-work.md` describes, call `fingerprint('bell')`, `fingerprint('aerospike')`, `fingerprint('extension')` twice each.
Expected: each case prints the same string both times. If a case does not repeat, find out why before going on (time-dependent input, uninitialised cells); the comparison in Task 5 is worthless otherwise.

- [ ] **Step 3: Record the strings** in `docs/superpowers/plans/2026-11-25-expansion-deflection-fingerprints.md`, with the browser and graphics card they were taken on.

- [ ] **Step 4: Commit**

```bash
git add src/dev/accuracy.ts docs/superpowers/plans/2026-11-25-expansion-deflection-fingerprints.md
git commit -m "Fingerprint the plume grid for a bell, an aerospike and an extension before the shader changes"
```

---

### Task 5: The whole nozzle in the plume grid

**Files:**
- Modify: `src/render/fluidSim.ts`, `src/render/plume.ts`, `src/render/plumeParams.ts`, `src/sim/runtime.ts`, `src/render/plume.frag.ts` only if "Show inside" needs it, `src/ui/readouts.ts` or `src/sim/runtime.ts` for the note
- Test: `src/render/plumeParams.test.ts`, `src/render/plume.test.ts`

**Interfaces:**
- Consumes: `PlugGeometry`, `EngineProfile.plug` (Task 3); `ringWallRadius` (Task 1); the fingerprints (Task 4).
- Produces:
  ```ts
  // plumeParams.ts
  export interface EdGrid { lengthRadii: number; bellRadii: number; mouthRadii: number; fits: boolean }
  /** The grid an ED nozzle needs, in ring-wall radii: 2.2 bell lengths, and tall enough for 1.25 mouth radii. */
  export function edGrid(profile: EngineProfile, ringWallR: number): EdGrid;
  /** Inputs for the whole nozzle in the plume grid, or null when it does not fit. */
  export function edSimInputs(cfg: EngineConfig, r: SimResult, fire: number, profile: EngineProfile): { inputs: SimInputs; wall: SimWall; grid: EdGrid } | null;
  // SimInputs gains an optional field, absent for every other engine:
  //   ed?: { ringInner: number }   // the plug's rim, in ring-wall radii; the ring runs from here to 1
  ```
  In the shader: a uniform `uEdOn` (0 or 1) and `uRingInner`. With `uEdOn` at 0 every existing branch is taken exactly as today.

- [ ] **Step 1: Write the failing tests** (pure functions only; the shader has no unit test)

```ts
// plumeParams.test.ts
const edCfg = (patch = {}) => sanitize({ ...starterEngine(), exhaust: 'expansionDeflection', exitDia: starterEngine().throatDia * 4, ...patch });
it('sizes the grid by the bell: 2.2 bell lengths, and 1.25 mouth radii tall', () => {
  const cfg = edCfg(), p = engineProfile(cfg), g = edGrid(p, ringWallRadius(cfg));
  expect(g.fits).toBe(true);
  expect(g.lengthRadii).toBeGreaterThanOrEqual(2.2 * g.bellRadii - 1e-9);
  // 162 cells high, 384 long (with the upstream strip the plume renderer adds): tall enough for the mouth.
  expect(g.lengthRadii).toBeLessThanOrEqual(24);
});
it('keeps the default ring at least five cells wide', () => {
  const cfg = edCfg(), g = edGrid(engineProfile(cfg), ringWallRadius(cfg));
  const cell = (g.lengthRadii + Math.min(2, 0.15 * g.lengthRadii)) / 384;
  expect((1 - cfg.plugShare) / cell).toBeGreaterThanOrEqual(5);
});
it('does not simulate whole a nozzle too long for the grid', () => {
  const big = edCfg({ exitDia: starterEngine().throatDia * 12 });
  expect(edSimInputs(big, simulate(big, { altitudeKm: 0, throttle: 1 }), 1, engineProfile(big))).toBeNull();
});
it('feeds the ring the engine\'s own mass flow, along the axis, just past the speed of sound', () => {
  const cfg = edCfg(), r = simulate(cfg, { altitudeKm: 0, throttle: 1 });
  const { inputs } = edSimInputs(cfg, r, 1, engineProfile(cfg))!;
  expect(inputs.ed!.ringInner).toBeGreaterThan(0);
  expect(inputs.ed!.ringInner).toBeLessThan(1);
  // Entry Mach 1.1 by whatever field carries it; ring area (1 - ringInner^2) times the entry
  // density and speed equals the throat's mass flow within 2%, in the grid's own units.
});
it('starts the wall at the ring and ends it at the mouth', () => {
  const cfg = edCfg(), p = engineProfile(cfg);
  const { wall, grid } = edSimInputs(cfg, simulate(cfg, { altitudeKm: 0, throttle: 1 }), 1, p)!;
  // wall's upstream end at (0, 1), downstream end at (grid.bellRadii, grid.mouthRadii);
  // the fitted wall is within 5% of the drawn bell's radius at ten points along it.
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/render/plumeParams.test.ts`
Expected: FAIL, `edGrid` is not exported.

- [ ] **Step 3: Implement the pure parts** (`edGrid`, `edSimInputs`) and see the tests pass.

- [ ] **Step 4: Change the shader, behind `uEdOn`**

In this order, checking the picture in a browser after each:
1. The ring's bounds as inputs: where `ringState` and `inNozzle` use `uSpike[0]` and `1.0` for the ring, an ED nozzle uses `uRingInner` and `1.0`, with the gas heading along the axis.
2. The plug: solid from the left edge to x = 0 below `uRingInner`, flat base. Guard the three divisions by the spike's length.
3. The bell: the extension wall's solid from (0, 1) to the mouth, active together with the plug. The cells behind the wall (outside the bell, x between 0 and the mouth) are open air as they are for an extension.
4. Inside the bell (x from 0 to the mouth, r below the wall): no relaxation toward the outside state and no turning slow exhaust into air.
5. Start-up: the inside of the bell starts as still outside air.

- [ ] **Step 5: Route it**

`src/sim/runtime.ts`: for a profile with a `plug` and the plume simulated, switch the engine grid off, and if `edSimInputs` gives inputs, hand them and the wall to the plume grid with the grid length from `edGrid` (so `gridLength`'s zoom rule is bypassed for this type); if it gives null, simulate the plume from the mouth with `simInputs(cfg, result, fire)` and draw the gas inside. The note where simulated figures would be: `not for expansion-deflection nozzles`, or `this nozzle is too long to simulate whole` in the fallback. "Show inside" colours the gas in the bell as the aerospike's spike is coloured.

- [ ] **Step 6: The fingerprints must not have moved**

Run the three cases from Task 4 again in the same browser.
Expected: every string identical to the recorded one. Any difference means a change leaked outside the switch: find it and fix it. Do not re-record.

- [ ] **Step 7: Run the whole suite and commit**

Run: `npx tsc --noEmit && npm test && npm run build` — Expected: PASS, no snapshot changed.

```bash
git add src && git commit -m "Simulate the whole expansion-deflection nozzle in the plume grid: ring, plug, bell and wake"
```

**Stop condition for this task (from the spec):** if, with the housekeeping off inside the bell, the nozzle cannot be lit from cold at sea level and in vacuum without runaway or not-a-number cells after a real attempt at the causes, stop, commit what stands behind the switch, and report to the owner. The fallback (a hollow jet) is theirs to choose.

---

### Task 6: Measure it, check the formula against it, and record the piece

**Files:**
- Modify: `src/dev/accuracy.ts`, `src/physics/engine.ts` only if the constants must change, `docs/future-work.md`, the spec's status line
- Test: `src/physics/engine.test.ts` only if the constants change

**Interfaces:**
- Consumes: `edSimInputs` (Task 5), `edBaseDrag`, `edCompensation` (Task 2).
- Produces: in the tool, `edCase(altitudeKm: number, plugShare: number)`: lit from cold as the tool's other cases are (ramp 60 frames, settle 350, average 4 x 50), returning the count of wild cells, the pressure on the centreline one cell behind the plug's base as a share of the outside pressure, whether the wake is open (that share at least 0.5) or closed, and the thrust across the mouth (momentum plus pressure above the outside, over the mouth's area) as a share of the formula's.

- [ ] **Step 1: Write `edCase`** and run it at 0, 5, 10, 20, 40 and 100 km for plug 0.4, 0.7 and 0.8 (18 runs), and at sea level at 40% throttle for plug 0.7.

Expected: no wild cells in any run. The wake open at sea level and closed at 100 km for every plug size.

- [ ] **Step 2: Set the simulation beside the formula**

For plug 0.7, at each altitude: simulated thrust over formula thrust. If any is outside 0.9 to 1.1, change `edCompensation` or `edBaseDrag` so that all six are inside, update Task 2's "has the stated constants" test to the new numbers (watch it fail first), and re-run the suite. Note the altitude between which the wake closed in the simulation and where the formula closes it.

- [ ] **Step 3: Browser sweep**

The default ED engine: lit at sea level, Ascend to vacuum and Descend back, watching the wake open and close; the three "Show inside" views at sea level and at 60 km; plug 0.4 and 0.8; a swap to an aerospike and back while firing; zoom in and out while firing; a nozzle too long to simulate whole (exit 12 times the throat); a shared link opened in a fresh tab. Record what was seen and any console error.

- [ ] **Step 4: Record it**

In `docs/future-work.md`: "Expansion-deflection piece (part 3b): what was built and what was left", in the file's style: words used, what was built, decisions in order, the 19 measurements as a table, the fingerprints before and after, what the browser sweep found, and what was left (no simulated figures on the page; the plug's cooling; gas fed in along the axis; the bell fitted by a slope and a curvature; nozzles above an area ratio of about 40). Update the list under "The engine builder" to show 3b built. Set the spec's status to built.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npx tsc --noEmit && npm test && npm run build` — Expected: PASS, no snapshot changed.

```bash
git add src docs && git commit -m "Measure the expansion-deflection nozzle lit from cold, and record what the piece built and left"
```
