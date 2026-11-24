# Engine Builder Part 3a: Cone, Dual Bell and No Nozzle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three new exhaust types (plain cone, dual bell, no nozzle) in the Exhaust picker, each with its own shape, figures and simulated gas, working behind every energy source.

**Architecture:** A new `src/physics/exhausts.ts` holds one record per exhaust type: its flags (what it counts, which sliders it shows, whether it can carry an extension), the wall contour after the throat, the slope of the wall at the lip, and its thrust factor. `engineProfile`, `simulate`, `withExhaust`, the controls and the runtime ask the record. The dual bell's low mode is a new expansion state, `'held'`, that reuses the separated-jet path with the kink as the station where the jet leaves the wall.

**Tech Stack:** TypeScript, Vite, Vitest, WebGL2. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-23-more-exhaust-types-design.md`

## Global Constraints

- The twelve examples give exactly today's figures: `src/physics/presets.regression.test.ts` passes unchanged at the end of every task, and its snapshot file is never regenerated. (Vitest rewrites that file's line endings when it runs; if `git status` shows it modified with no content change, `git checkout --` it before committing.)
- No combination is refused, greyed out, or shows `NaN`. `sanitize` makes any configuration valid.
- Share links in formats `v1`, `v2` and `v3` still open as the same engine.
- Every new control and option has a plain-English label and a one-line hover tip in `src/ui/copy.ts`.
- No change to the method of either gas solver (`src/render/engineSim.ts`, `src/render/fluidSim.ts`, `src/render/gasSim.ts`) unless Task 9 finds a combination that breaks one; a fix there is recorded in `docs/future-work.md`.
- The nozzle extension stays bell-only. No new example engines. No hysteresis in the dual bell. No new penalty for a separated ordinary bell.
- Work on the branch `more-exhaust-types`. Run `npm test` and `npx tsc --noEmit` before every commit.

## Review Focus

1. **A dual bell whose kink is at an extreme** (inner exit just above the throat, just below the exit, or an exit barely wider than the throat): the contour is finite and rises monotonically, and every figure is finite. Tests in Tasks 2 and 3.
2. **No nozzle at the lowest pressure the sliders reach** (5 bar at 40% throttle, sea level): thrust is not negative, nothing is `NaN`, and the state is never `'separated'`. Test in Task 4.
3. **A calculated gas with no nozzle** (area ratio 1): every fuel and oxidiser pair, and every reactor fluid, that settles with a bell settles with no nozzle. Test in Task 4.
4. **Swapping exhaust types back and forth**: no nozzle → bell brings the nozzle back exactly; a bell with an extension (RL10B-2) → cone drops the extension and stays finite; dual bell → aerospike → dual bell keeps total throat area. Tests in Task 5.
5. **A link that names an exhaust type this version does not know** opens as a bell with the rest of the engine intact, not as the blank engine. Test in Task 6.

---

### Task 1: Pin the examples' shapes

The contour builder is about to be restructured. The figures are pinned already; the shapes are not.

**Files:**
- Create: `src/render/geometry.regression.test.ts` (and the snapshot Vitest writes beside it)

- [ ] **Step 1: Write the snapshot test**

For every entry of `PRESETS` (from `src/physics/presets.ts`), snapshot from `engineProfile(preset.config)`: every point of `points` as `[x, r]`, plus `throatX`, `exitX`, `length`, `maxRadius`, `offsets`, `halfHeight`, `frontSpace`, and for an engine with an extension `extension.seam`, `extension.length` and `extension.seamSlope`. Round each number with `Number(v.toPrecision(10))`. One `toMatchSnapshot()` per preset, test named `shape of <preset.id>`.

- [ ] **Step 2: Run it to write the snapshot**

Run: `npx vitest run src/render/geometry.regression.test.ts`
Expected: 12 passed, 12 snapshots written.

- [ ] **Step 3: Commit**

```bash
git add src/render/geometry.regression.test.ts src/render/__snapshots__/geometry.regression.test.ts.snap
git commit -m "Pin the example engines' shapes before restructuring the contour"
```

---

### Task 2: Exhaust records, new ids and settings

**Files:**
- Create: `src/physics/exhausts.ts`, `src/physics/exhausts.test.ts`
- Modify: `src/physics/types.ts`, `src/physics/parts.ts` (re-export only), `src/physics/engine.ts` (`RANGES`, `sanitize`), `src/physics/presets.ts`, `src/physics/reshape.ts` (`starterEngine`), `src/physics/engine.test.ts`

**Interfaces:**
- Produces, in `src/physics/types.ts`:
  - `type ExhaustId = 'bell' | 'cone' | 'dualBell' | 'none' | 'aerospike'`
  - `EngineConfig.coneAngleDeg: number` (half-angle of a plain cone, degrees)
  - `EngineConfig.innerExitDia: number` (diameter at a dual bell's kink, m; 0 means "not set yet")
  - `type ExpansionState` gains `'held'` (a dual bell's jet held at the kink)
- Produces, in `src/physics/exhausts.ts`:

```ts
export interface WallPoint { x: number; r: number }

export interface ExhaustType {
  id: ExhaustId;
  name: string;
  tip: string;
  /** What the count slider counts */
  counts: 'chambers' | 'cells';
  /** False where there is no diverging wall at all */
  hasNozzle: boolean;
  /** True where a deployable extension can be fitted */
  extension: boolean;
  /** Which shape sliders this type shows */
  sliders: { exitDia: boolean; nozzleLenPct: boolean; coneAngleDeg: boolean; innerExitDia: boolean };
}

export const EXHAUSTS: Record<ExhaustId, ExhaustType>;
export const EXHAUST_IDS: ExhaustId[];          // menu order: bell, cone, dualBell, aerospike, none
export function isExhaustId(v: unknown): v is ExhaustId;
/** The kink diameter a dual bell opens with: the inner bell gets the square root of the full area ratio. */
export function defaultInnerExitDia(throatDia: number, exitDia: number): number;  // throatDia * sqrt(exitDia / throatDia)
/** True where the jet has left the nozzle wall before the exit, by tearing off or by being held at a kink. */
export function jetLeftWall(state: ExpansionState): boolean;                       // 'separated' || 'held'
```

- `src/physics/parts.ts` re-exports `EXHAUSTS`, `EXHAUST_IDS` and `isExhaustId` from `./exhausts` so existing imports keep working.
- Produces, in `src/physics/engine.ts`: `RANGES.coneAngleDeg = { min: 8, max: 30, fallback: 15 }` and `RANGES.innerExitDia = { min: 0, max: 25, fallback: 0 }`.

- [ ] **Step 1: Write the failing tests**

`src/physics/exhausts.test.ts`:

```ts
it('has a record for every exhaust id, with a name and a tip', () => {
  expect(EXHAUST_IDS).toEqual(['bell', 'cone', 'dualBell', 'aerospike', 'none']);
  for (const id of EXHAUST_IDS) {
    expect(EXHAUSTS[id].id).toBe(id);
    expect(EXHAUSTS[id].name.length).toBeGreaterThan(0);
    expect(EXHAUSTS[id].tip.length).toBeGreaterThan(0);
  }
});
it('only a bell takes an extension, only an aerospike counts cells, only no-nozzle has no nozzle', () => {
  expect(EXHAUST_IDS.filter((id) => EXHAUSTS[id].extension)).toEqual(['bell']);
  expect(EXHAUST_IDS.filter((id) => EXHAUSTS[id].counts === 'cells')).toEqual(['aerospike']);
  expect(EXHAUST_IDS.filter((id) => !EXHAUSTS[id].hasNozzle)).toEqual(['none']);
});
it('shows each type its own sliders', () => {
  expect(EXHAUSTS.cone.sliders).toEqual({ exitDia: true, nozzleLenPct: false, coneAngleDeg: true, innerExitDia: false });
  expect(EXHAUSTS.dualBell.sliders).toEqual({ exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: true });
  expect(EXHAUSTS.none.sliders).toEqual({ exitDia: false, nozzleLenPct: false, coneAngleDeg: false, innerExitDia: false });
  expect(EXHAUSTS.bell.sliders).toEqual({ exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: false });
  expect(EXHAUSTS.aerospike.sliders).toEqual({ exitDia: true, nozzleLenPct: true, coneAngleDeg: false, innerExitDia: false });
});
it('opens a dual bell with the square root of the area ratio in its inner bell', () => {
  expect(defaultInnerExitDia(0.2, 2.0)).toBeCloseTo(0.2 * Math.sqrt(10), 12);
});
it('counts a held jet and a torn-off jet as having left the wall', () => {
  expect(['ideal', 'over', 'under', 'separated', 'compensating', 'held'].filter((s) => jetLeftWall(s as ExpansionState)))
    .toEqual(['separated', 'held']);
});
```

Add to `src/physics/engine.test.ts`, in the `sanitize` tests, with `base = starterEngine()`:

```ts
it('makes an unknown exhaust a bell', () => {
  expect(sanitize({ ...base, exhaust: 'warp' as ExhaustId }).exhaust).toBe('bell');
});
it('keeps a cone angle within 8 to 30 degrees, 15 where it is not a number', () => {
  expect(sanitize({ ...base, coneAngleDeg: 2 }).coneAngleDeg).toBe(8);
  expect(sanitize({ ...base, coneAngleDeg: 90 }).coneAngleDeg).toBe(30);
  expect(sanitize({ ...base, coneAngleDeg: NaN }).coneAngleDeg).toBe(15);
});
it('keeps a dual bell kink between the throat and the exit, and sets one that is not set', () => {
  const dual = { ...base, exhaust: 'dualBell' as const, throatDia: 0.2, exitDia: 2 };
  expect(sanitize({ ...dual, innerExitDia: 0 }).innerExitDia).toBeCloseTo(0.2 * Math.sqrt(10), 9);
  expect(sanitize({ ...dual, innerExitDia: 0.05 }).innerExitDia).toBeCloseTo(1.1 * 0.2, 9);
  expect(sanitize({ ...dual, innerExitDia: 9 }).innerExitDia).toBeCloseTo(0.95 * 2, 9);
});
it('keeps a dual bell kink in order where the exit is barely wider than the throat', () => {
  const tight = sanitize({ ...base, exhaust: 'dualBell', throatDia: 0.2, exitDia: 0.21, innerExitDia: 0.5 });
  expect(tight.innerExitDia).toBeGreaterThan(tight.throatDia);
  expect(tight.innerExitDia).toBeLessThan(tight.exitDia);
});
it('leaves the kink setting alone on other exhausts, and drops an extension from anything but a bell', () => {
  expect(sanitize({ ...base, exhaust: 'cone', innerExitDia: 0.7 }).innerExitDia).toBe(0.7);
  const rl10 = PRESETS.find((p) => p.id === 'rl10b-2')!.config;
  expect(sanitize({ ...rl10, exhaust: 'cone' }).extFixedDia).toBe(0);
  expect(sanitize({ ...rl10, exhaust: 'dualBell' }).extFixedDia).toBe(0);
  expect(sanitize({ ...rl10, exhaust: 'none' }).extFixedDia).toBe(0);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/physics/exhausts.test.ts src/physics/engine.test.ts`
Expected: FAIL (`./exhausts` not found; `coneAngleDeg` not on `EngineConfig`).

- [ ] **Step 3: Implement**

- `exhausts.ts`: the records. Names: "Bell nozzle", "Plain cone", "Dual bell", "Aerospike", "No nozzle". Bell's and aerospike's tips move over unchanged from `parts.ts`. The dual bell's tip must say it pays off on a nozzle too big for the ground.
- `sanitize`: `exhaust` unknown → `'bell'`; `coneAngleDeg` clamped to its range; an extension is kept only where `EXHAUSTS[exhaust].extension`; for `'dualBell'`, `innerExitDia` that is not a positive number becomes `defaultInnerExitDia(throatDia, exitDia)`, then it is clamped to `[1.1 * throatDia, 0.95 * exitDia]`, and where that interval is empty it becomes the midpoint of `throatDia` and `exitDia`; for every other exhaust `innerExitDia` is clamped to `RANGES.innerExitDia` only. The count range reads `EXHAUSTS[exhaust].counts`.
- `presets.ts` (`build`) and `starterEngine`: `coneAngleDeg: 15`, `innerExitDia: 0`.

- [ ] **Step 4: Run all tests**

Run: `npm test` and `npx tsc --noEmit`
Expected: PASS; the two regression snapshots unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/physics
git commit -m "Describe each exhaust type in a record, with a cone angle and a dual bell kink among the engine's settings"
```

---

### Task 3: The three contours

**Files:**
- Modify: `src/physics/exhausts.ts`, `src/physics/exhausts.test.ts`, `src/render/geometry.ts`, `src/render/geometry.test.ts`

**Interfaces:**
- Consumes: `EXHAUSTS`, `WallPoint`, `EngineConfig.coneAngleDeg`, `EngineConfig.innerExitDia` (Task 2).
- Produces, in `src/physics/exhausts.ts`:

```ts
export interface Diverging {
  /** Wall from just after the throat to the lip, x measured from the throat */
  points: WallPoint[];
  /** Length from the throat to the lip, m */
  length: number;
  /** Where a dual bell's wall kinks, x measured from the throat; null for every other type */
  kink: WallPoint | null;
}
/** The wall after the throat. Not for an aerospike, which has its own geometry. */
export function divergingWall(cfg: EngineConfig): Diverging;
/** Slope (dr/dx) of the wall at the lip, which the plume leaves along. */
export function lipSlope(cfg: EngineConfig): number;
```

- Produces, in `src/render/geometry.ts`: `EngineProfile.kink: ProfilePoint | null` (the kink in engine coordinates; null unless a dual bell). `engineProfile` builds the chamber and converging section as now, then appends `divergingWall(cfg).points` shifted by `throatX`. For `'none'`, `exitX === throatX` and the last point is the throat.

Shapes (exact values the implementer cannot choose):

- **bell**: today's code moved, unchanged: the arc, then the quadratic Bezier, 8 + 28 points. `lipSlope` is today's formula from `src/render/plumeParams.ts`: `(0.45 * tan(15°) * 100) / nozzleLenPct`.
- **cone**: the throat arc (radius `0.382 * rt`, made smaller where it would not fit, as the bell's is) turning to the half-angle, 8 points; then a straight wall to the exit radius, 12 points evenly spaced. `lipSlope` is `tan(coneAngleDeg)`.
- **dualBell**: an inner bell built exactly as a bell is, from the throat radius to `innerExitDia / 2`, with length `(nozzleLenPct / 100) * (rk - rt) / tan(15°)`; then an outer bell from the kink to the exit radius, with length `(nozzleLenPct / 100) * (re - rk) / tan(15°)`, as a quadratic Bezier that leaves the kink at `1.4` times its chord slope and arrives at `0.6` times its chord slope (chord slope is `(re - rk) / outerLength`), 20 points. The kink is one shared point. `lipSlope` is `0.6` times the outer chord slope.
- **none**: no points. `length` 0. `lipSlope` 0.
- **aerospike**: `divergingWall` returns no points and `lipSlope` 0; `engineProfile` never asks, since it hands an aerospike to `aerospikeProfile` first.

- [ ] **Step 1: Write the failing tests**

In `src/physics/exhausts.test.ts`, with `base = starterEngine()`:

```ts
const rising = (pts: WallPoint[]) => pts.every((p, i) => i === 0 || (p.x > pts[i - 1].x && p.r >= pts[i - 1].r));

it('ends a cone at the exit radius along its half-angle', () => {
  const cfg = sanitize({ ...base, exhaust: 'cone', coneAngleDeg: 20 });
  const wall = divergingWall(cfg);
  const [a, b] = wall.points.slice(-2);
  expect(wall.points.at(-1)!.r).toBeCloseTo(cfg.exitDia / 2, 9);
  expect((b.r - a.r) / (b.x - a.x)).toBeCloseTo(Math.tan((20 * Math.PI) / 180), 6);
  expect(lipSlope(cfg)).toBeCloseTo(Math.tan((20 * Math.PI) / 180), 12);
  expect(rising(wall.points)).toBe(true);
});
it('makes a wide cone shorter than a narrow one', () => {
  const at = (deg: number) => divergingWall(sanitize({ ...base, exhaust: 'cone', coneAngleDeg: deg })).length;
  expect(at(30)).toBeLessThan(0.5 * at(8));
});
it('kinks a dual bell outwards at the inner exit', () => {
  const cfg = sanitize({ ...base, exhaust: 'dualBell', exitDia: 10 * base.throatDia });
  const wall = divergingWall(cfg);
  const i = wall.points.findIndex((p) => p === wall.kink || (p.x === wall.kink!.x && p.r === wall.kink!.r));
  const slope = (j: number) => (wall.points[j + 1].r - wall.points[j].r) / (wall.points[j + 1].x - wall.points[j].x);
  expect(wall.kink!.r).toBeCloseTo(cfg.innerExitDia / 2, 9);
  expect(slope(i)).toBeGreaterThan(slope(i - 1) + Math.tan((5 * Math.PI) / 180));
  expect(wall.points.at(-1)!.r).toBeCloseTo(cfg.exitDia / 2, 9);
  expect(rising(wall.points)).toBe(true);
});
it('gives a finite rising dual bell with the kink at either extreme', () => {
  for (const inner of [0.0001, 99]) {
    const cfg = sanitize({ ...base, exhaust: 'dualBell', exitDia: 10 * base.throatDia, innerExitDia: inner });
    const wall = divergingWall(cfg);
    expect(wall.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.r))).toBe(true);
    expect(rising(wall.points)).toBe(true);
  }
  const tight = divergingWall(sanitize({ ...base, exhaust: 'dualBell', exitDia: 1.05 * base.throatDia }));
  expect(rising(tight.points)).toBe(true);
});
it('gives no wall at all with no nozzle', () => {
  const wall = divergingWall(sanitize({ ...base, exhaust: 'none' }));
  expect(wall.points).toEqual([]);
  expect(wall.length).toBe(0);
  expect(wall.kink).toBeNull();
});
it('fits a 30 degree cone to the smallest nozzle there can be', () => {
  const wall = divergingWall(sanitize({ ...base, exhaust: 'cone', coneAngleDeg: 30, exitDia: 1.05 * base.throatDia }));
  expect(rising(wall.points)).toBe(true);
  expect(wall.points.at(-1)!.r).toBeCloseTo((1.05 * base.throatDia) / 2, 9);
});
```

In `src/render/geometry.test.ts`:

```ts
it('ends an engine with no nozzle at its throat', () => {
  const p = engineProfile(sanitize({ ...starterEngine(), exhaust: 'none' }));
  expect(p.exitX).toBe(p.throatX);
  expect(p.points.at(-1)!.r).toBeCloseTo(starterEngine().throatDia / 2, 9);
  expect(p.extension).toBeNull();
  expect(p.kink).toBeNull();
});
it('marks a dual bell kink in engine coordinates', () => {
  const cfg = sanitize({ ...starterEngine(), exhaust: 'dualBell' });
  const p = engineProfile(cfg);
  expect(p.kink!.r).toBeCloseTo(cfg.innerExitDia / 2, 9);
  expect(p.kink!.x).toBeGreaterThan(p.throatX);
  expect(p.kink!.x).toBeLessThan(p.exitX);
  expect(radiusAt(p, p.kink!.x)).toBeCloseTo(p.kink!.r, 6);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/physics/exhausts.test.ts src/render/geometry.test.ts`
Expected: FAIL (`divergingWall` not defined).

- [ ] **Step 3: Implement `divergingWall` and `lipSlope`, and have `engineProfile` use them**

The bell branch must reproduce today's points bit for bit: move the arithmetic, do not rewrite it. `maxRadius` and the chamber pitch use the throat radius in place of the exit radius where there is no nozzle. The extension is looked for only where `EXHAUSTS[cfg.exhaust].extension`.

- [ ] **Step 4: Run all tests**

Run: `npm test` and `npx tsc --noEmit`
Expected: PASS, with `src/render/geometry.regression.test.ts` and `src/physics/presets.regression.test.ts` unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/physics/exhausts.ts src/physics/exhausts.test.ts src/render/geometry.ts src/render/geometry.test.ts
git commit -m "Shape a plain cone, a dual bell and an engine with no nozzle"
```

---

### Task 4: Thrust for each type

**Files:**
- Modify: `src/physics/engine.ts`, `src/physics/engine.test.ts`, and whatever in `src/physics/gasSource.ts` or `src/physics/chem/pair.ts` an area ratio of 1 needs (with a test beside it)

**Interfaces:**
- Consumes: `EXHAUSTS`, `jetLeftWall` (Task 2).
- Produces:
  - `flowExitDiameter(cfg)` returns `cfg.throatDia` where `!EXHAUSTS[cfg.exhaust].hasNozzle`, so `expansionRatio` is 1.
  - `SimResult.state` can be `'held'`. In that state `effectiveExitDia` is `innerExitDia`, `exitMach` and `pe` are the kink's.
  - `SimResult.nozzleEff` is the factor on the momentum part of the thrust for the nozzle as it is running.

Rules (the spec's, with its constants):

- **bell, aerospike**: unchanged.
- **cone**: `nozzleEff = 0.99 * (1 + cos(coneAngle)) / 2`. Separation as a bell.
- **none**: `nozzleEff = 0.99`. Never `'separated'`: the separation test is skipped.
- **dualBell**: `nozzleEff` starts as the bell's length-based factor. Work out what a bell of the full size does, as now.
  - Attached to the exit (any state but `'separated'`): **high mode**. The momentum part is multiplied by a further `0.985`.
  - `'separated'` with the separation Mach number at or above the kink's (`machFromAreaRatio((innerExitDia / throatDia) ** 2, g)`): **low mode**, state `'held'`. Mach, exit pressure and area are the kink's; thrust is the bell formula at the kink, less `0.05 * pa * (ae - kinkArea)`.
  - `'separated'` below the kink's Mach number: as a bell, `'separated'`.

- [ ] **Step 1: Write the failing tests**

In `src/physics/engine.test.ts`, with `base = starterEngine()`, `sl = { altitudeKm: 0, throttle: 1 }`, `vac = { altitudeKm: 100, throttle: 1 }`:

```ts
it('loses thrust to a cone by its half-angle', () => {
  const cone = (deg: number) => simulate({ ...base, exhaust: 'cone', coneAngleDeg: deg }, vac);
  expect(cone(15).nozzleEff).toBeCloseTo(0.99 * (1 + Math.cos((15 * Math.PI) / 180)) / 2, 9);
  expect(cone(30).nozzleEff).toBeCloseTo(0.99 * (1 + Math.cos((30 * Math.PI) / 180)) / 2, 9);
  expect(cone(30).ispVacuum).toBeLessThan(cone(8).ispVacuum);
  const bell = simulate(base, vac);
  expect(cone(15).ispVacuum).toBeLessThan(bell.ispVacuum);
  expect(cone(15).ispVacuum).toBeGreaterThan(0.98 * bell.ispVacuum);
});
it('runs an engine with no nozzle at the speed of sound, and poorly', () => {
  const none = simulate({ ...base, exhaust: 'none' }, vac);
  const bell = simulate(base, vac);
  expect(none.expansionRatio).toBeCloseTo(1, 9);
  expect(none.exitMach).toBeCloseTo(1, 6);
  expect(none.effectiveExitDia).toBeCloseTo(base.throatDia, 9);
  expect(none.ispVacuum / bell.ispVacuum).toBeGreaterThan(0.6);
  expect(none.ispVacuum / bell.ispVacuum).toBeLessThan(0.8);
  expect(simulate({ ...base, exhaust: 'none' }, sl).state).toBe('under');
});
it('never separates and never goes negative with no nozzle, however low the pressure', () => {
  const r = simulate({ ...base, exhaust: 'none', chamberPressureBar: 5 }, { altitudeKm: 0, throttle: 0.4 });
  expect(r.state).not.toBe('separated');
  expect(r.thrust).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(r.isp)).toBe(true);
});
// A nozzle big enough for space: area ratio 100, kink at area ratio 10, 60 bar.
const big = { ...base, chamberPressureBar: 60, exitDia: 10 * base.throatDia };
const dual = { ...big, exhaust: 'dualBell' as const, innerExitDia: Math.sqrt(10) * base.throatDia };
it('holds a dual bell jet at the kink near the ground, and beats the plain bell there', () => {
  const d = simulate(dual, sl);
  const b = simulate(big, sl);
  expect(b.state).toBe('separated');
  expect(d.state).toBe('held');
  expect(d.effectiveExitDia).toBeCloseTo(dual.innerExitDia, 6);
  expect(d.thrust / b.thrust).toBeGreaterThan(1.05);
  expect(d.thrust / b.thrust).toBeLessThan(1.2);
});
it('fills a dual bell in space, a little behind the plain bell', () => {
  const d = simulate(dual, vac);
  const b = simulate(big, vac);
  expect(d.state).toBe('under');
  expect(d.thrust / b.thrust).toBeGreaterThan(0.975);
  expect(d.thrust / b.thrust).toBeLessThan(0.99);
});
it('dips in thrust as a dual bell jet snaps out to fill the bell', () => {
  let last = simulate(dual, sl);
  let dip = 0;
  for (let km = 0.5; km <= 40; km += 0.5) {
    const now = simulate(dual, { altitudeKm: km, throttle: 1 });
    if (last.state === 'held' && now.state !== 'held') dip = (last.thrust - now.thrust) / last.thrust;
    last = now;
  }
  expect(dip).toBeGreaterThan(0.01);
  expect(dip).toBeLessThan(0.08);
});
it('runs a small dual bell full from the ground', () => {
  expect(simulate({ ...base, exhaust: 'dualBell' }, sl).state).not.toBe('held');
});
it('lets a dual bell jet tear off before the kink where the air is that much stronger', () => {
  const late = { ...dual, chamberPressureBar: 12, innerExitDia: 8 * base.throatDia };
  const d = simulate(late, sl);
  const b = simulate({ ...late, exhaust: 'bell' }, sl);
  expect(d.state).toBe('separated');
  expect(d.effectiveExitDia).toBeCloseTo(b.effectiveExitDia, 6);
});
it('settles with no nozzle wherever it settles with a bell', () => {
  for (const fuel of FUEL_IDS) for (const oxidiser of ['lox', 'n2o4'] as const) {
    const cfg = sanitize({ ...base, fuel, oxidiser });
    if (!simulate(cfg, vac).settled) continue;
    const none = simulate({ ...cfg, exhaust: 'none' }, vac);
    expect(none.settled, `${fuel} with ${oxidiser}`).toBe(true);
    expect(Number.isFinite(none.ispVacuum)).toBe(true);
  }
  for (const propellant of propellantsFor('reactor')) {
    const cfg = sanitize({ ...base, energy: 'reactor', propellant, exhaust: 'none' });
    expect(simulate(cfg, vac).settled, propellant).toBe(true);
  }
});
```

Use the oxidiser ids as they are spelled in `src/physics/chem/ingredients.ts` for liquid oxygen and nitrogen tetroxide. If a dual bell assertion fails, check the formula against the table in the spec's dual bell section before changing the test: at gamma 1.2, 60 bar, area ratio 100 and a kink at area ratio 10 the thrust coefficients are 1.485 held and 1.351 separated at 1 bar.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/physics/engine.test.ts`
Expected: FAIL on every new test.

- [ ] **Step 3: Implement the rules in `simulate`**

Keep the bell and aerospike paths arithmetically identical: the regression test is the judge. For an area ratio of 1 with a calculated gas, make `resolveGas(cfg, pcBar, 1)` return a settled gas whose vacuum Isp is the solver's at its own throat; how is the implementer's choice (read `docs/future-work.md`, "The fitted gas", for why ratios under 3 are touchy), with a test beside the code that the fitted gas at ratio 1 reproduces the solver's throat-plane Isp to 1%.

- [ ] **Step 4: Run all tests**

Run: `npm test` and `npx tsc --noEmit`
Expected: PASS; regression snapshots unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/physics
git commit -m "Work out the thrust of a plain cone, a dual bell in both its modes, and an engine with no nozzle"
```

---

### Task 5: Swapping the exhaust type

**Files:**
- Modify: `src/physics/reshape.ts`, `src/physics/reshape.test.ts`

**Interfaces:**
- Consumes: `EXHAUSTS[id].counts`, `EXHAUSTS[id].extension`, `defaultInnerExitDia` (Task 2).
- Produces: `withExhaust(cfg, exhaust)` handles all five ids:
  - between two types that count chambers: `sanitize({ ...cfg, exhaust })` and nothing else (dimensions, count, pressure and wall kept; the extension dropped by `sanitize` where the new type takes none; a dual bell's kink set by `sanitize` where it was 0);
  - to an aerospike from any chamber type, and from an aerospike to any chamber type: today's dividing and merging, with the new type's id.

- [ ] **Step 1: Write the failing tests**

In `src/physics/reshape.test.ts`:

```ts
const chamberTypes = ['bell', 'cone', 'dualBell', 'none'] as const;
it('changes only the nozzle between exhausts that count chambers', () => {
  const from = starterEngine();
  for (const to of chamberTypes) {
    const next = withExhaust(from, to);
    expect(next.exhaust).toBe(to);
    for (const key of ['chamberDia', 'chamberLen', 'throatDia', 'exitDia', 'wall', 'chamberPressureBar', 'chambers'] as const) {
      expect(next[key], `${to} ${key}`).toBe(from[key]);
    }
  }
});
it('brings the nozzle back exactly after no nozzle', () => {
  const from = starterEngine();
  expect(withExhaust(withExhaust(from, 'none'), 'bell')).toEqual(from);
});
it('gives a dual bell a kink when it is first chosen, and keeps one already set', () => {
  const first = withExhaust(starterEngine(), 'dualBell');
  expect(first.innerExitDia).toBeCloseTo(defaultInnerExitDia(first.throatDia, first.exitDia), 9);
  const moved = sanitize({ ...first, innerExitDia: 1.3 * first.throatDia });
  expect(withExhaust(withExhaust(moved, 'cone'), 'dualBell').innerExitDia).toBeCloseTo(moved.innerExitDia, 9);
});
it('drops an extension on leaving a bell, and stays finite', () => {
  const rl10 = PRESETS.find((p) => p.id === 'rl10b-2')!.config;
  for (const to of ['cone', 'dualBell', 'none'] as const) {
    const next = withExhaust(rl10, to);
    expect(next.extFixedDia).toBe(0);
    const r = simulate(next, { altitudeKm: 100, throttle: 1 });
    expect(Number.isFinite(r.thrust) && Number.isFinite(r.isp)).toBe(true);
  }
});
it('keeps total throat area through an aerospike and back, for each chamber type', () => {
  const area = (c: EngineConfig) => c.chambers * c.throatDia ** 2;
  for (const type of chamberTypes) {
    const from = withExhaust(starterEngine(), type);
    const back = withExhaust(withExhaust(from, 'aerospike'), type);
    expect(back.exhaust).toBe(type);
    expect(area(back)).toBeCloseTo(area(from), 6);
  }
});
it('does not destroy any example by swapping in a new exhaust', () => {
  for (const preset of PRESETS) for (const to of ['cone', 'dualBell', 'none'] as const) {
    if (simulate(preset.config, { altitudeKm: 0, throttle: 1 }).failure) continue;
    expect(simulate(withExhaust(preset.config, to), { altitudeKm: 0, throttle: 1 }).failure, `${preset.id} → ${to}`).toBeNull();
  }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/physics/reshape.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run all tests**

Run: `npm test` and `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/physics/reshape.ts src/physics/reshape.test.ts
git commit -m "Swap between a bell, a cone, a dual bell and no nozzle without touching the rest of the engine"
```

---

### Task 6: Share links

**Files:**
- Modify: `src/state/share.ts`, `src/state/state.test.ts`

**Interfaces:**
- Produces: link version `v4`: the `v3` array with `coneAngleDeg` then `innerExitDia` appended (22 entries). `v3` (20 entries) still opens, with `coneAngleDeg` 15 and `innerExitDia` 0. In `v4` only, an exhaust id that is a string but not known becomes `'bell'` and the link opens.

- [ ] **Step 1: Write the failing tests**

In `src/state/state.test.ts`:

```ts
it('carries a cone angle and a dual bell kink through a link', () => {
  const cone = sanitize({ ...starterEngine(), exhaust: 'cone', coneAngleDeg: 22 });
  expect(decodeState(encodeState({ config: cone, flight: { altitudeKm: 12, throttle: 0.8 } }))!.config).toEqual(cone);
  const dual = sanitize({ ...starterEngine(), exhaust: 'dualBell', innerExitDia: 0.31 });
  expect(decodeState(encodeState({ config: dual, flight: { altitudeKm: 0, throttle: 1 } }))!.config).toEqual(dual);
});
it('opens a v3 link as the same engine with the new settings at their defaults', () => {
  // Build the v3 form by hand: the v4 array without its last two entries.
  const cfg = PRESETS.find((p) => p.id === 'merlin-1d')!.config;
  const v4 = JSON.parse(atob(encodeState({ config: cfg, flight: { altitudeKm: 0, throttle: 1 } }).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  const v3 = 'v3.' + btoa(JSON.stringify(v4.slice(0, 20))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  expect(decodeState(v3)!.config).toEqual(cfg);
});
it('opens a link naming an exhaust it does not know as a bell, with the rest intact', () => {
  const cfg = sanitize({ ...starterEngine(), chamberPressureBar: 137 });
  const packed = JSON.parse(atob(encodeState({ config: cfg, flight: { altitudeKm: 0, throttle: 1 } }).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  packed[2] = 'expansion-deflection';
  const link = 'v4.' + btoa(JSON.stringify(packed)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const opened = decodeState(link)!.config;
  expect(opened.exhaust).toBe('bell');
  expect(opened.chamberPressureBar).toBe(137);
});
```

The existing `v1`, `v2` and `v3` link tests must pass unchanged.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/state/state.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the `v4` format in `encodeState` and `unpack`**

- [ ] **Step 4: Run all tests**

Run: `npm test` and `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state
git commit -m "Carry the cone angle and the dual bell's kink in share links, and keep older links working"
```

---

### Task 7: Sliders, labels and the mode readout

**Files:**
- Modify: `src/ui/controls.ts`, `src/ui/copy.ts`, `src/ui/readouts.ts`, `src/ui/controls.test.ts`, `src/ui/copy.test.ts`

**Interfaces:**
- Consumes: `EXHAUSTS[id].sliders`, `EXHAUSTS[id].counts` (Task 2); `SimResult.state === 'held'` (Task 4).
- Produces, in `src/ui/copy.ts`:
  - `TIPS.coneAngleDeg`, `TIPS.innerExitDia`
  - `STATE_COPY.held` (label and text)
  - `COUNT_COPY` keyed by `'chambers' | 'cells'` (was by exhaust id)
  - `expansionText(result: SimResult, exhaust: ExhaustId): string`: the text under the "Nozzle exit vs outside air" state. `STATE_COPY[result.state].text`, and for a dual bell not in `'held'` a sentence appended saying the jet fills the outer bell.
- In `src/ui/controls.ts`: a slider is not shown where its type's `sliders` flag is false. The count slider's range and copy follow `EXHAUSTS[id].counts`, not a test for `'aerospike'`. Two new sliders in the Engine group after "Nozzle exit diameter":
  - `coneAngleDeg`: label "Cone half-angle", step 1, range `RANGES.coneAngleDeg`, format `` `${Math.round(v)}°` ``.
  - `innerExitDia`: label "Inner bell exit", log scale, range `[1.1 * throatDia, 0.95 * exitDia]` of the current engine, format as "Nozzle exit diameter" does (length, then `· ratio` of the inner bell's area ratio).

- [ ] **Step 1: Write the failing tests**

In `src/ui/copy.test.ts`:

```ts
it('has a tip for each new slider and words for a held jet', () => {
  expect(TIPS.coneAngleDeg.length).toBeGreaterThan(20);
  expect(TIPS.innerExitDia.length).toBeGreaterThan(20);
  expect(STATE_COPY.held.label.length).toBeGreaterThan(0);
  expect(STATE_COPY.held.text).toMatch(/kink/i);
});
it('says which mode a dual bell is in', () => {
  const big = { ...starterEngine(), chamberPressureBar: 60, exitDia: 10 * starterEngine().throatDia, exhaust: 'dualBell' as const };
  const low = simulate(big, { altitudeKm: 0, throttle: 1 });
  const high = simulate(big, { altitudeKm: 100, throttle: 1 });
  expect(expansionText(low, 'dualBell')).toBe(STATE_COPY.held.text);
  expect(expansionText(high, 'dualBell')).toMatch(/outer bell/i);
  expect(expansionText(simulate(starterEngine(), { altitudeKm: 0, throttle: 1 }), 'bell')).not.toMatch(/outer bell/i);
});
it('names what the count slider counts for every exhaust', () => {
  for (const id of EXHAUST_IDS) expect(COUNT_COPY[EXHAUSTS[id].counts].label.length).toBeGreaterThan(0);
});
```

In `src/ui/controls.test.ts`, following the way that file already builds the panel and reads which sliders are shown:

```ts
it('shows each exhaust its own sliders', () => {
  const shown = (exhaust: ExhaustId) => visibleSliderIds(panelFor(sanitize({ ...starterEngine(), exhaust })));
  expect(shown('cone')).toContain('coneAngleDeg');
  expect(shown('cone')).not.toContain('nozzleLenPct');
  expect(shown('dualBell')).toEqual(expect.arrayContaining(['exitDia', 'nozzleLenPct', 'innerExitDia']));
  expect(shown('none')).not.toContain('exitDia');
  expect(shown('none')).not.toContain('nozzleLenPct');
  expect(shown('bell')).not.toContain('coneAngleDeg');
  expect(shown('bell')).not.toContain('innerExitDia');
});
it('keeps the kink slider between the throat and the exit', () => {
  const cfg = sanitize({ ...starterEngine(), exhaust: 'dualBell' });
  const range = sliderRange(panelFor(cfg), 'innerExitDia');
  expect(range.min).toBeCloseTo(1.1 * cfg.throatDia, 9);
  expect(range.max).toBeCloseTo(0.95 * cfg.exitDia, 9);
});
```

`panelFor`, `visibleSliderIds` and `sliderRange` stand for whatever helpers `controls.test.ts` already has for these; add them there if it has none.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/ui`
Expected: FAIL.

- [ ] **Step 3: Implement**

The readout's state text comes from `expansionText`. All wording is the implementer's, in the plain style of the existing copy; the cone's tip must say what a wide and a narrow cone each cost.

- [ ] **Step 4: Run all tests**

Run: `npm test` and `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui
git commit -m "Give the cone and the dual bell their sliders, hide the nozzle's with no nozzle, and say which mode a dual bell is in"
```

---

### Task 8: Draw and simulate the new shapes

**Files:**
- Modify: `src/render/plumeParams.ts`, `src/render/plumeParams.test.ts`, `src/sim/runtime.ts`, `src/render/engineView.ts`, `src/render/simFigures.ts` (and its test if its availability rule changes)

**Interfaces:**
- Consumes: `lipSlope(cfg)` (Task 3), `jetLeftWall(state)` (Task 2), `EngineProfile.kink` (Task 3), `'held'` (Task 4).
- Produces:
  - `simInputs` takes the wall's angle at the lip from `lipSlope(cfg)` (an aerospike keeps 0; a caller's `start.wallSlope` still wins).
  - Everywhere the code asks whether the jet has left the wall to lay out geometry (`fixedExitFlow`, `simInputs`, `plumeParams.separated`, the runtime's `wholeNozzle`, wall-curve fit, `extensionInEngine` and `separatesAt`, the engine view's clipped gas), it asks `jetLeftWall(result.state)`.
  - What is only true of a jet torn off untidily stays on `'separated'` alone: the extra turbulence in `plumeParams`, the wobble of the clipped gas in `engineView`.

- [ ] **Step 1: Write the failing tests**

In `src/render/plumeParams.test.ts`, with `vac = { altitudeKm: 100, throttle: 1 }` and `sl = { altitudeKm: 0, throttle: 1 }`:

```ts
it('lets the plume leave a cone along its half-angle, and straight back with no nozzle', () => {
  const cone = sanitize({ ...starterEngine(), exhaust: 'cone', coneAngleDeg: 25 });
  expect(simInputs(cone, simulate(cone, vac), 1).divergence).toBeCloseTo(Math.tan((25 * Math.PI) / 180), 9);
  const none = sanitize({ ...starterEngine(), exhaust: 'none' });
  expect(simInputs(none, simulate(none, vac), 1).divergence).toBe(0);
  expect(simInputs(none, simulate(none, vac), 1).uExit).toBeCloseTo(Math.sqrt(simulate(none, vac).gamma), 6);
});
it('keeps a bell lip slope exactly as it was', () => {
  const bell = starterEngine();
  expect(simInputs(bell, simulate(bell, vac), 1).divergence)
    .toBe((0.45 * Math.tan((15 * Math.PI) / 180) * 100) / bell.nozzleLenPct);
});
it('starts a held dual bell plume from the kink, steady', () => {
  const dual = sanitize({ ...starterEngine(), chamberPressureBar: 60, exitDia: 10 * starterEngine().throatDia, exhaust: 'dualBell' });
  const r = simulate(dual, sl);
  const p = plumeParams(dual, r, sl, 1);
  expect(r.state).toBe('held');
  expect(p.exitRadiusM).toBeCloseTo(dual.innerExitDia / 2, 6);
  const torn = simulate({ ...dual, exhaust: 'bell' }, sl);
  expect(p.turbulence).toBeLessThan(plumeParams({ ...dual, exhaust: 'bell' }, torn, sl, 1).turbulence);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/render/plumeParams.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/sim/runtime.ts`: with no nozzle the engine's grid ends at the throat (`engineExitX` is `profile.throatX` already, since `exitX === throatX`); check that the wall-curve fit, which looks two radii back from the exit, reads the converging section there instead of skipping, so the plume grid's idea of the engine's outside is not a straight tube. For `'held'`, `separatesAt` is the first station at or past the kink (the existing search finds it, since `effectiveExitDia` is the kink's). The engine-sim reset key already includes the exhaust id.

In `src/render/engineView.ts`: the walls come from `profile.points`, so the three shapes draw themselves; make the clipped gas stop at the kink without wobble in `'held'`, and check the nozzle-less engine draws no bell, lip or exit line beyond the throat.

In `src/render/simFigures.ts`: figures are shown for a cone, for no nozzle, and for a dual bell not in `'held'`; in `'held'` the note reads as it does for a separated jet.

- [ ] **Step 4: Run all tests**

Run: `npm test` and `npx tsc --noEmit`
Expected: PASS; regression snapshots unchanged.

- [ ] **Step 5: Look at each in the browser**

Run `npm run dev`. For each of cone, dual bell (with the exit made large) and no nozzle on the starter engine: fire at sea level and in vacuum with Plume and Engine gas both Simulated, then both Drawn. Expected: the wall drawn is the shape chosen, the gas fills it to the wall (or to the kink, held), the plume starts at the lip, and there are no console errors.

- [ ] **Step 6: Commit**

```bash
git add src/render src/sim
git commit -m "Draw and simulate the cone, the dual bell held at its kink and filled, and the engine with no nozzle"
```

---

### Task 9: Light every combination from cold, and record what was built

**Files:**
- Modify: `src/dev/accuracy.ts`, `docs/future-work.md`, and whatever Steps 2 and 3 find broken

- [ ] **Step 1: Extend the measuring tool**

`src/dev/accuracy.ts` reads bell engines against one-dimensional nozzle theory (its header says how to run it). Let it take a cone and an engine with no nozzle the same way (both have a one-dimensional answer), and a dual bell in high mode. Its `joined(..., ramp)` count of cells holding nonsense must run for all three types.

- [ ] **Step 2: Run it, lit from cold**

For each of the four energy sources (`combustion`, `solid`, `reactor`, `saltwater`) with each of `cone`, `dualBell` and `none`, at sea level and in vacuum: `joined(..., ramp)` reports no cells holding nonsense. For the cone and no nozzle, record mass flow along the engine, throat Mach number, and exit Mach number and pressure against theory. For the dual bell, record the total pressure lost at the kink's sharp corner.
Expected: no runaway in any of the 24 cases. Bulk figures for the cone and no nozzle within about 2% of theory, as the bell's are.

- [ ] **Step 3: Sweep them in the browser**

The same 24 cases with both gas simulations on, lit from cold, plus an Ascend sweep of the big dual bell from Task 4 (area ratio 100, 60 bar). Expected: every one shows an engine, gas inside it and a plume; the dual bell's jet is held at the kink low down and snaps out during the climb; no console errors. Fix what is found, with a test where the fault is in testable code.

- [ ] **Step 4: Record it in `docs/future-work.md`**

Under "The engine builder": mark piece 3 as split, 3a built, 3b (expansion-deflection) to do. Add a section "Exhaust types piece (part 3a): what was built and what was left", in the plain style of the chemistry section: what was built; the decisions made during the build that this plan did not settle, each with what it costs if wrong; the measurements from Step 2; what was left (at least: no hysteresis; a separated ordinary bell has no penalty; the dual bell's constants are proposals, not fitted to a real engine; anything Steps 2 and 3 found and did not fix).

- [ ] **Step 5: Run all tests**

Run: `npm test`, `npx tsc --noEmit` and `npm run build`
Expected: PASS; regression snapshots unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/dev docs/future-work.md
git commit -m "Measure the new exhaust types lit from cold, and record what the piece built and left"
```
