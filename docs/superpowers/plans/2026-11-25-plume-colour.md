# Plume Colour From The Exhaust's Make-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An engine built from a fuel and an oxidiser (or a solver-worked reactor fluid) gets its plume's colours, brightness, soot, smoke and sparks from what the chemistry says leaves the nozzle.

**Architecture:** One new pure module turns the exhaust's make-up into the existing `PlumeLook` record and a line of plain words, using a table of exhaust families. `resolveGas` uses it in the two places a look is borrowed today. The shader, the gas simulation and the plume's shape are untouched.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-25-plume-colour-design.md`

## Global Constraints

- The twelve example engines keep their hand-picked looks exactly. So do every tabled propellant, the solid motor, tabled hydrogen in a reactor, and salt water.
- `src/physics/__snapshots__/presets.regression.test.ts.snap` and `src/render/__snapshots__/geometry.regression.test.ts.snap` are never regenerated or edited. Do not add a field to `SimResult` (the snapshot holds it whole). If Vitest rewrites a snapshot's line endings, `git checkout --` it before committing.
- Do not change `src/render/engineSim.ts`, `src/render/fluidSim.ts`, `src/render/gasSim.ts`, `src/render/plume.ts` or `src/render/plume.frag.ts`.
- Colours are the ones each family of exhaust is known for, turned up enough to see; no spectroscopy.
- When the solver has no settled gas, the borrowed look stands, as now.
- Every number in a look is finite; colours and `opacity`, `soot`, `smoke`, `afterburnStrength`, `particles` are within 0 to 1.
- Words the user reads are plain English for an enthusiast, in the page's existing voice.
- The new module lives in `src/physics/`, not `src/render/` as the spec first said: `src/physics/gasSource.ts` must import it, and physics does not import from render. Task 3 corrects the spec's path.
- Commit messages are plain-English sentences in the style of `git log`, ending with the trailer `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. **An exhaust species no family lists** (the solver knows about 190). Expected: it shows nothing and nothing breaks; a test fails if a species is in neither a family nor the "shows nothing" list. Task 1.
2. **An exhaust that is all invisible gas** (helium in a reactor; hydrogen with fluorine). Expected: a faint plume that can still be seen, never black or fully transparent. Task 1.
3. **The gas drawn inside the engine disagrees with the plume.** `staticLook` (used by `src/render/engineView.ts:329` and `src/render/aerospikeView.ts:34`) still borrows. Expected: the gas inside a calculated engine is the same colour as its plume. Task 2.
4. **The mixture slider dragged across its whole range.** Expected: the look changes smoothly, with no jump when a species crosses the 0.5% listing threshold or drops out of the six listed. Task 2.
5. **A calculated pair that fails to settle part-way through a drag.** Expected: the plume falls back to the borrowed look for those frames without an error. Task 2.

---

### Task 1: The family table and the look it gives

**Files:**
- Create: `src/physics/plumeLook.ts`
- Test: `src/physics/plumeLook.test.ts`

**Interfaces:**
- Consumes: `PlumeLook`, `RGB` from `src/physics/types.ts`; `SPECIES` from `src/physics/chem/thermo.ts` (each has a `name`); `solvePair(fuel, oxidiser, of, pcBar, eps)`, `solveFluid(fluid, tempK, pcBar, eps)` and `pairRange(fuel, oxidiser)` from `src/physics/chem/pair.ts` (tests only); `PROPELLANTS` from `src/physics/propellants.ts` (tests only).
- Produces:
  ```ts
  export type FamilyId = 'soot' | 'steam' | 'carbonOxide' | 'boron' | 'lithium' | 'aluminium' | 'beryllium'
    | 'halide' | 'chlorine' | 'cyanogen' | 'nitrogenOxide' | 'hydrocarbon' | 'none';
  export interface ExhaustFamily {
    id: FamilyId;
    /** How the colour line names it: "soot glowing orange", "a green tinge from boron" */
    words: { main: string; tinge: string };
    colour: RGB;
    /** How strongly a unit share shows, 0 (nothing) upward */
    strength: number;
    soot: number; smoke: number; particles: number;
    /** True when it burns where the plume meets the air */
    burns: boolean;
  }
  export const FAMILIES: Record<FamilyId, ExhaustFamily>;
  /** The family of a species, by the solver's own name for it ("H2O", "AL2O3(L)") */
  export function familyOf(species: string): FamilyId;
  export interface ExhaustInput { exhaust: readonly { name: string; share: number }[]; tc: number; condensedShare: number }
  export function lookFromExhaust(input: ExhaustInput): PlumeLook;
  /** "Colour: soot glowing orange, with a green tinge from boron." Empty when there is no make-up. */
  export function colourNote(exhaust: readonly { name: string; share: number }[]): string;
  ```

Family membership (by the solver's species names; a name's phase suffix such as `(L)`, `(cr)`, `(a)` does not change its family):
- `soot`: `C(gr)`, `C3`, `C2H2,acetylene`, `C10H8,naphthale`. Colour orange-yellow.
- `steam`: `H2O`, `H2`, `H`, `OH`, `O`, `O2`, liquid water and ice. Faint pale blue.
- `carbonOxide`: `CO`, `CO2`. Blue.
- `hydrocarbon`: `CH4`. Shows nothing by itself (`strength` 0) but `burns`.
- `boron`: every species whose name starts with `B` followed by anything but `e` (boron, its oxides, fluorides, acids, nitride, carbide), plus `HBO`, `HBO2`, `H3BO3`, `H3B3O6`. Green.
- `lithium`: every species whose name starts with `Li`. Crimson.
- `aluminium`: every species whose name starts with `AL`. Brilliant white; smoky; sparks.
- `beryllium`: every species whose name starts with `Be`. White; smoky.
- `halide`: `HF`, `H2F2`, `H6F6`, `F`, `F2`, `HCL`, `NF3`, `NH4F`, `NH4CL`, and the carbon fluorides (`CF`, `CF2`, `CF3`, `CF4`, `C2F2`, `COF2`, `CF3CL`). Nearly clear; a little smoke for `HCL` and the ammonium salts.
- `chlorine`: `CL`, `CL2`, `CLF`, `CLF3`. Pale green-yellow.
- `cyanogen`: `CN`, `HCN`. Violet.
- `nitrogenOxide`: `NO`, `NOF`, `NOF3`, `NO2F`. Orange-brown.
- `none`: `N2`, `NH3`, `He`.

`burns` is true for `soot`, `hydrocarbon`, `carbonOxide` (for its `CO`) and `steam` (for its `H2` and `H`); the afterburn strength counts only the shares of `H2`, `H`, `CO`, `CH4` and the soot species.

- [ ] **Step 1: Write the failing tests** in `src/physics/plumeLook.test.ts`

```ts
const solve = (fuel: string, ox: string, of?: number) => {
  const g = solvePair(fuel, ox, of ?? pairRange(fuel, ox).ofDefault, 70, 16);
  expect(g.ok).toBe(true);
  return lookFromExhaust({ exhaust: g.exhaust, tc: g.tc, condensedShare: g.condensedShare });
};
const greenness = (c: RGB) => c[1] - (c[0] + c[2]) / 2;
const redness = (c: RGB) => c[0] - (c[1] + c[2]) / 2;
const whiteness = (c: RGB) => Math.min(c[0], c[1], c[2]);

it('gives every species the solver knows a family', () => {
  for (const s of SPECIES) expect(Object.keys(FAMILIES), s.name).toContain(familyOf(s.name));
  // Nothing falls into "none" by accident: only these show nothing.
  const none = SPECIES.filter((s) => familyOf(s.name) === 'none').map((s) => s.name).sort();
  expect(none).toEqual(['He', 'N2', 'NH3']);
});
it('burns boron green', () => {
  expect(greenness(solve('b5h9', 'lox').mid)).toBeGreaterThan(greenness(solve('rp1', 'lox').mid) + 0.15);
  expect(greenness(solve('b5h9', 'lox').mid)).toBeGreaterThan(0);
});
it('burns lithium red', () => {
  expect(redness(solve('li', 'lf2').mid)).toBeGreaterThan(0.15);
});
it('makes aluminium whiter and smokier than kerosene', () => {
  const al = solve('al-slurry', 'lox'), rp1 = solve('rp1', 'lox');
  expect(whiteness(al.core)).toBeGreaterThan(whiteness(rp1.core));
  expect(al.smoke).toBeGreaterThan(rp1.smoke + 0.2);
  expect(al.particles).toBeGreaterThan(rp1.particles);
});
it('makes hydrogen with fluorine fainter than kerosene with oxygen, but still there', () => {
  expect(solve('h2', 'lf2').opacity).toBeLessThan(solve('rp1', 'lox').opacity - 0.2);
  expect(solve('h2', 'lf2').opacity).toBeGreaterThanOrEqual(0.15);
});
it('makes richer kerosene sootier than lean', () => {
  const r = pairRange('rp1', 'lox');
  expect(solve('rp1', 'lox', r.ofMin + 0.1 * (r.ofMax - r.ofMin)).soot)
    .toBeGreaterThan(solve('rp1', 'lox', r.ofMax - 0.1 * (r.ofMax - r.ofMin)).soot);
});
it('leaves helium from a reactor nearly invisible but not gone', () => {
  const g = solveFluid(PROPELLANTS['ntr-helium'].fluid!, 2500, 40, 100);
  const look = lookFromExhaust({ exhaust: g.exhaust, tc: g.tc, condensedShare: g.condensedShare });
  expect(look.opacity).toBeLessThanOrEqual(0.3);
  expect(look.opacity).toBeGreaterThanOrEqual(0.15);
});
it('gives a look within range for every fuel with oxygen and hydrogen with every oxidiser', () => {
  // FUEL_IDS and OXIDISER_IDS from ../physics/chem/ingredients; skip NO_OXIDISER and pairs whose solve is not ok.
  // For each: every colour channel and opacity, soot, smoke, afterburnStrength, particles is finite and in [0, 1];
  // opacity >= 0.15.
});
it('comes out recognisably like the hand-picked looks for the three everyday pairs', () => {
  const near = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (const [fuel, id] of [['rp1', 'kerolox'], ['ch4', 'methalox'], ['h2', 'hydrolox']] as const) {
    const made = solve(fuel, 'lox'), picked = PROPELLANTS[id].look;
    expect(near(made.core, picked.core), `${id} core`).toBeLessThan(0.35);
    expect(near(made.mid, picked.mid), `${id} mid`).toBeLessThan(0.35);
    expect(near(made.edge, picked.edge), `${id} edge`).toBeLessThan(0.45);
    expect(Math.abs(made.opacity - picked.opacity), `${id} opacity`).toBeLessThan(0.3);
    expect(Math.abs(made.soot - picked.soot), `${id} soot`).toBeLessThan(0.25);
  }
});
it('changes smoothly as a species comes and goes from the list', () => {
  // The same make-up with and without a 0.5% species differs by less than 0.03 in every number of the look.
  const base = [{ name: 'H2O', share: 0.6 }, { name: 'CO2', share: 0.395 }];
  const a = lookFromExhaust({ exhaust: base, tc: 3400, condensedShare: 0 });
  const b = lookFromExhaust({ exhaust: [...base, { name: 'BO2', share: 0.005 }], tc: 3400, condensedShare: 0 });
  // compare every channel of core, mid, edge, richTint, afterburn and every scalar
});
it('says what is colouring the plume, in words', () => {
  const g = solvePair('b5h9', 'lox', pairRange('b5h9', 'lox').ofDefault, 70, 16);
  expect(colourNote(g.exhaust)).toMatch(/^Colour: /);
  expect(colourNote(g.exhaust)).toMatch(/boron/);
  expect(colourNote([])).toBe('');
  expect(colourNote([{ name: 'He', share: 1 }])).toBe('Colour: almost none. This exhaust barely glows.');
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/physics/plumeLook.test.ts`
Expected: FAIL, cannot find module `./plumeLook`.

- [ ] **Step 3: Implement `src/physics/plumeLook.ts`** to the interface above.

The blend: each listed species adds weight `share × strength` to its family. `mid` is the weighted mix of family colours; `core` is `mid` pulled toward white by temperature (nothing at 1500 K, most of the way by 3600 K); `edge` is `mid` darkened and pulled toward the soot colour by the soot share. `opacity` rises with total weight and with `condensedShare`, floored at 0.15 and capped at 1. `soot`, `smoke` and `particles` are the weighted sums of the families' own, with `condensedShare` adding to `smoke`. `richTint` is the same as `mid` (a derived look is not tinted again, Task 2). `afterburn` colour is the mix of the burning families' colours and `afterburnStrength` rises with the share of `H2`, `H`, `CO`, `CH4` and soot. Choose the colours and strengths so the tests pass; they are the tuning.

`colourNote` names the family with the largest weight by `words.main` and, if a second family has at least a quarter of that weight, adds `, with ` and its `words.tinge`. It ends with a full stop.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run src/physics/plumeLook.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/physics/plumeLook.ts src/physics/plumeLook.test.ts
git commit -m "Work a plume's look out from what is in its exhaust"
```

---

### Task 2: Use the derived look wherever a look is borrowed

**Files:**
- Modify: `src/physics/gasSource.ts` (the `GasSource` interface, `staticLook`, both branches of `resolveGas` that set `look: p.look` for a fluid and `look: borrowed.look`)
- Modify: `src/render/plumeParams.ts:211-226` (the richness tint and the soot multiplier) and wherever it reads `gasSource`
- Modify: `src/render/engineView.ts:329`, `src/render/aerospikeView.ts:34` (callers of `staticLook`)
- Test: `src/physics/gasSource.test.ts` (create if absent), `src/render/plumeParams.test.ts`

**Interfaces:**
- Consumes: `lookFromExhaust(input: ExhaustInput): PlumeLook` from Task 1.
- Produces: on `GasSource`, `derivedLook: boolean` (true only when `look` came from `lookFromExhaust`). `staticLook(cfg)` keeps its name and its promise never to start a solve, but returns the derived look when a settled solve for this engine is already cached.

- [ ] **Step 1: Write the failing tests**

In `src/physics/gasSource.test.ts`:
```ts
it('leaves every example engine its hand-picked look', () => {
  for (const p of PRESETS) {
    const src = resolveGas(p.config, p.config.chamberPressureBar, (p.config.exitDia / p.config.throatDia) ** 2);
    expect(src.look, p.name).toBe(PROPELLANTS[p.config.propellant as PropellantId].look);
    expect(src.derivedLook, p.name).toBe(false);
  }
});
it('gives a calculated pair a look from its own exhaust', () => {
  const cfg = sanitize({ ...starterEngine(), propellant: 'calculated', fuel: 'b5h9', oxidiser: 'lox' });
  const src = resolveGas(cfg, 70, 16);
  expect(src.settled).toBe(true);
  expect(src.derivedLook).toBe(true);
  expect(src.look).not.toBe(PROPELLANTS.kerolox.look);
});
it('gives a solver-worked reactor fluid a look from its own exhaust', () => {
  const cfg = sanitize({ ...getPreset('nerva')!.config, propellant: 'ntr-ammonia' });
  expect(resolveGas(cfg, 40, 100).derivedLook).toBe(true);
});
it('keeps the borrowed look when the gas did not settle', () => {
  const cfg = sanitize({ ...starterEngine(), propellant: 'calculated', fuel: 'rp1', oxidiser: NO_OXIDISER });
  const src = resolveGas(cfg, 70, 16);
  expect(src.settled).toBe(false);
  expect(src.derivedLook).toBe(false);
  expect(src.look).toBe(PROPELLANTS.kerolox.look);
});
it('shows the same look inside the engine as in the plume once the gas is solved', () => {
  const cfg = sanitize({ ...starterEngine(), propellant: 'calculated', fuel: 'b5h9', oxidiser: 'lox' });
  const r = simulate(cfg, { altitudeKm: 0, throttle: 1 });   // solves and caches
  expect(r.thrust).toBeGreaterThan(0);
  expect(staticLook(cfg)).toEqual(resolveGas(cfg, cfg.chamberPressureBar, (cfg.exitDia / cfg.throatDia) ** 2).look);
});
```
If `starterEngine()` already has `propellant: 'calculated'`, drop that key from the spreads; if a tabled propellant with a `fluid` needs other fields to be valid, let `sanitize` settle them.

In `src/render/plumeParams.test.ts`:
```ts
it('does not tint a derived look a second time for its mixture', () => {
  const cfg = sanitize({ ...starterEngine(), propellant: 'calculated', fuel: 'rp1', oxidiser: 'lox' });
  const rich = { ...cfg, mixtureRatio: mixRange(cfg).ofMin };
  const flight = { altitudeKm: 0, throttle: 1 };
  const p = plumeParams(rich, simulate(rich, flight), flight, 1);
  const look = resolveGas(rich, rich.chamberPressureBar, (rich.exitDia / rich.throatDia) ** 2).look;
  expect(p.mid).toEqual(look.mid);
  expect(p.core).toEqual(look.core);
});
it('moves the look smoothly across the whole mixture range', () => {
  // 40 even steps of mixtureRatio from ofMin to ofMax for rp1 + lox at sea level:
  // between neighbouring steps no channel of core, mid or edge, nor opacity or soot, changes by more than 0.12.
});
it('still tints a hand-picked look by its mixture', () => {
  const merlin = getPreset('merlin-1d')!.config;
  const rich = { ...merlin, mixtureRatio: PROPELLANTS.kerolox.ofMin };
  const flight = { altitudeKm: 0, throttle: 1 };
  expect(plumeParams(rich, simulate(rich, flight), flight, 1).mid).not.toEqual(PROPELLANTS.kerolox.look.mid);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/physics/gasSource.test.ts src/render/plumeParams.test.ts`
Expected: FAIL, `derivedLook` does not exist; the tint test fails on `mid`.

- [ ] **Step 3: Wire it in**

- `resolveGas`: where `solved.ok`, set `look: lookFromExhaust({ exhaust: solved.exhaust, tc: solved.tc, condensedShare: solved.condensedShare })` and `derivedLook: true`, in the fluid branch and the calculated-pair branch. Otherwise the look that is there now, `derivedLook: false`. The tabled branch sets `derivedLook: false`.
- `plumeParams`: when `gasSource.derivedLook`, skip the `rich > 0` / else tint block, use `look.soot * air` for soot (no richness multiplier), use `look.afterburnStrength * Math.sqrt(paFrac)` for afterburn, and `look.particles` unscaled.
- `staticLook`: return the look of the gas source the engine's own figures use (the call at `src/physics/engine.ts:145`) when that solve is already cached and settled; otherwise the borrowed look. It must not start a solve: if the cache offers no way to ask without solving, add a small `peek` beside the cache in `src/physics/chem/pair.ts` that returns a cached result or `null`.
- The mixture-range test may show a jump where a species crosses the listing threshold. If so, fix it in `lookFromExhaust` (fade a family in over its first percent of share), not by loosening the test.

- [ ] **Step 4: Run the whole suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS. Then `git checkout -- src/physics/__snapshots__ src/render/__snapshots__` and `git status --short` shows no snapshot file changed.

- [ ] **Step 5: Commit**

```bash
git add src/physics/gasSource.ts src/physics/gasSource.test.ts src/physics/chem/pair.ts src/render/plumeParams.ts src/render/plumeParams.test.ts src/render/engineView.ts src/render/aerospikeView.ts
git commit -m "Give an engine built from parts the plume its own exhaust makes"
```

---

### Task 3: Say what is colouring the plume, check it in a browser, and record it

**Files:**
- Modify: `src/ui/readouts.ts` (the `exhaust` stat under "Engineer's numbers"), `src/ui/copy.ts` (the exhaust tip), `src/style.css` only if the line needs a rule
- Modify: `docs/future-work.md`, `docs/superpowers/specs/2026-11-25-plume-colour-design.md`
- Test: `src/ui/copy.test.ts`

**Interfaces:**
- Consumes: `colourNote(exhaust): string` from Task 1; `ReadoutInfo.result.exhaust` (already there).
- Produces: a `data-r="colour"` line in the readouts, directly under the exhaust's make-up, hidden when the note is empty.

- [ ] **Step 1: Write the failing test** in `src/ui/copy.test.ts`

```ts
it('never names a colour the make-up beside it does not hold', () => {
  // For every fuel with 'lox' whose solve is ok at its default mixture, 70 bar, area ratio 16:
  // every family named in colourNote(g.exhaust) has at least one species in g.exhaust (by familyOf).
  // And the note is one sentence: it starts "Colour: " and ends with a single full stop.
});
```

- [ ] **Step 2: Run it and see it fail or pass for the right reason**

Run: `npx vitest run src/ui/copy.test.ts`
Expected: PASS if Task 1's `colourNote` is right; this test pins it from the page's side. If it fails, fix `colourNote`.

- [ ] **Step 3: Show the line**

In `src/ui/readouts.ts`, add `<span class="d" data-r="colour"></span>` after the exhaust value and set it from `colourNote(r.exhaust)` in the same place `exhaust` is set (before the `showsFigures` early return, so it clears with the make-up).

- [ ] **Step 4: Check it in a browser**

Start the dev server (`npm run dev`), and for each of these, built from "Build your own", lit at sea level and at 60 km: RP-1, methane and hydrogen with liquid oxygen (each beside its example engine: Merlin 1D, Raptor 2, RS-25); pentaborane with oxygen; lithium with fluorine; aluminium in kerosene with oxygen; hydrogen with fluorine; cyanogen with oxygen; and a reactor on ammonia and on helium. For each record: the plume's colour in words, that the gas inside the engine matches the plume, the colour line shown, and any console error. Drag the mixture slider end to end on RP-1 with oxygen and note any jump.

- [ ] **Step 5: Record it and commit**

- In `docs/future-work.md` add "Plume colour piece (part 4): what was built and what was left", in the file's style: what was built, the family table as a short list, the decisions made, what the browser check found, and what was left (not physically true; six listed species at most; the example engines unchanged by choice).
- In the same file, change the lines that say plume colour "still comes from a hand-picked look" (near lines 146 and 442) to say it is done for calculated pairs and solver-worked fluids.
- In the spec, change `src/render/plumeLook.ts` to `src/physics/plumeLook.ts` and set its status to built.

```bash
git add src/ui/readouts.ts src/ui/copy.test.ts src/style.css docs
git commit -m "Say what is colouring the plume, and record the piece"
```
