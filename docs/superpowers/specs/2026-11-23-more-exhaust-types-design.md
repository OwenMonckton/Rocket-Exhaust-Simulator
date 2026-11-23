# Engine builder, part 3a: cone, dual bell and no nozzle — Design

Date: 2026-11-23
Status: Draft, awaiting approval

## Intent

The Exhaust picker has two entries today, bell and aerospike. The user wants more ways for an
engine to turn hot gas into a jet, so that a builder can see how the shape of the nozzle changes
the jet and the numbers.

**Why (the user's words, from part 1):** "The ability to see any crazy design they might have play
out in real time for them to see and read performance numbers."

So, as with every other part, no combination is refused. Every exhaust type fires behind every
energy source, at every altitude, and shows honestly what it does.

## Where this sits

Part 3 of the engine builder (`docs/superpowers/specs/2026-11-20-engine-builder-design.md`) is
four exhaust types: plain cone, dual bell, expansion-deflection, no nozzle. Agreed with the user:
**it is split in two.**

- **3a (this document): plain cone, dual bell, no nozzle.** All three have a single wall running
  from the centreline outwards, which is what the engine's gas grid follows, so each is a new
  contour plus its own rules.
- **3b (later, its own design): expansion-deflection.** It has a plug in the middle of the nozzle
  and the gas flows round it, so the passage is a ring. It needs the kind of special handling the
  aerospike got, and is most of the work of part 3.

3a must leave the code shaped so that 3b adds one more exhaust type without another pass through
every file.

## Goals

- Three new entries in the Exhaust picker: **Plain cone**, **Dual bell**, **No nozzle**.
- Each works with every energy source (combustion, solid motor, reactor, salt water), with a
  tabled or a calculated gas, at sea level and in vacuum, drawn and simulated.
- Each has its own honest figures: a cone's loss from gas leaving at an angle, a dual bell's two
  modes, the poor efficiency of no nozzle.
- Each is drawn as what it is, and the simulated gas follows its real wall.
- An exhaust type is one record that supplies its own shape and rules.

## Non-goals

- Expansion-deflection (3b).
- New example engines. No dual-bell or bare-throat engine has flown that would make a useful one.
- A nozzle extension on anything but a bell. It stays an example-only feature of the RL10B-2.
- Hysteresis in the dual bell (a real one switches modes at a slightly different altitude going up
  than coming down).
- Any new penalty or failure for a jet that has torn off the wall of an ordinary bell. A real one
  is shaken hard, and avoiding that is half the point of a dual bell; here the dual bell's gain
  shows in thrust and in a steady jet only.
- Plume colour from the exhaust's make-up (part 4).
- Changes to the method of either gas solver.

## Anti-goals

- An example engine whose figures move. The twelve examples are pinned by
  `src/physics/presets.regression.test.ts` and must stay exactly as they are.
- A combination that is refused, greyed out, or shows `NaN`, a blank plume, or a solver that has
  run away.
- A new slider that needs propulsion knowledge to use. Each has a plain name and hover text.
- A share link made before this change that no longer opens, or opens as a different engine.

## Approaches

1. **Each exhaust type is a record that supplies its own shape and rules (chosen by the user).**
   A type provides: the wall contour after the throat; its thrust loss; where and whether the jet
   leaves the wall; which sliders it shows; how it reshapes when swapped in. The contour builder,
   the thrust formula, the controls and the runtime ask the record instead of testing the id.
   Expansion-deflection then arrives as one more record.
2. **Test the id wherever it matters**, as `exhaust === 'aerospike'` does today across about 37
   files. Quick for one type; with five, the same checks are scattered everywhere and 3b repeats
   the pass.
3. **Treat the new types as a bell with different slider settings.** Cheapest, but a dual bell (a
   kink, two modes) and no nozzle (no diverging wall at all) cannot be expressed as a bell.

The aerospike keeps its own geometry and view (`aerospikeProfile`, `src/render/aerospikeView.ts`);
it becomes a record like the others only as far as that is cheap. It is not rewritten.

## The three types

Figures in this section are the model's, to be met by tests. Where a constant is given it is
Claude's proposal and may be tuned by the builder within the stated behaviour.

### Plain cone

A straight-sided nozzle. Cheap to make, which is why early rockets and many solid motors use one.

- **Shape.** The wall turns out of the throat along the same short arc a bell uses, then runs
  straight at the cone's half-angle to the exit radius. Its length follows from the angle.
- **Slider.** "Nozzle length" is replaced by **"Cone half-angle"**, 8° to 30°, opening at 15°.
- **Thrust.** Gas leaving a cone fans out, and only the part of its speed pointing straight back
  pushes. The momentum part of the thrust is multiplied by (1 + cos α) / 2 for half-angle α, in
  place of the bell's length-based factor, with the bell's best factor (0.99) for everything else
  a nozzle loses. So 15° gives about 0.973, 30° about 0.924, 8° about 0.985.
- **Separation** works as for a bell: the same criterion, the same handling.
- **What the user sees:** a wide cone is short and loses thrust; a narrow one is efficient and
  long. The simulated jet fans out more than a bell's of the same size.

### Dual bell

A small bell that opens abruptly, at a kink in the wall, into a larger one. The idea is to get a
small nozzle's behaviour near the ground and a big nozzle's in space, with no moving parts.

- **Shape.** A bell from the throat to the kink, then a second bell from the kink to the exit
  that starts several degrees steeper than the first one ended. The kink is a sharp corner.
- **Sliders.** Exit diameter and nozzle length as for a bell, plus **"Inner bell exit"**: the
  diameter at the kink. It lies between the throat and the exit; when the type is first chosen it
  is set so the inner bell has about the square root of the full nozzle's area ratio.
- **Two modes.**
  - *Low mode.* Whenever an ordinary bell of the full size would have its jet torn off the wall
    somewhere past the kink, the dual bell's jet lets go at the kink instead, cleanly and all the
    way round. The engine then runs as the inner bell. The big bell's wall, standing in still air
    drawn along by the jet, costs a little thrust: the pressure on it is taken as 5% below the
    outside air's.
  - *High mode.* Once an ordinary bell of the full size would hold its jet all the way to the
    exit, the dual bell's jet snaps out to fill the big bell. It then runs as the full bell, less
    1.5% of the momentum part of its thrust for the imperfect shape a kink leaves.
  - If the outside pressure is so high that the jet would tear off *before* the kink, it does,
    exactly as in an ordinary bell.
- **State.** A new expansion state for low mode, alongside 'under', 'over', 'ideal', 'separated'
  and 'compensating'. The "Nozzle exit vs outside air" readout says which mode the nozzle is in,
  in plain words, and that the jet is held at the kink on purpose.
- **What it is worth, in the model's own figures.** The separation rule in
  `src/physics/engine.ts` lets an ordinary bell over-expand to roughly 0.2 to 0.4 of the outside
  pressure before its jet lets go, well past the best point, so a separated bell is losing thrust.
  Held at a kink nearer the best point, the dual bell does better. Worked through with these
  rules (gamma 1.2, 60 bar, area ratio 100, kink at area ratio 10, thrust coefficient):

  | Outside pressure | Plain bell | Dual bell | Dual bell against plain |
  |---|---|---|---|
  | 1 bar | 1.351 (separated) | 1.485 (low mode) | +9.9% |
  | 0.7 bar | 1.400 (separated) | 1.557 (low mode) | +11.2% |
  | 0.4 bar | 1.470 (separated) | 1.630 (low mode) | +10.9% |
  | 0.2 bar | 1.600 (attached) | 1.572 (high mode) | −1.75% |

  So tests assert a gain of several percent over the same-size bell in low mode and a loss of
  about 1.5 to 2% in high mode.
- **Thrust drops at the switch**, by about 3.5% in the case above: the moment the jet fills the
  big bell it is as over-expanded as it will ever be. Real dual bells show the same dip. It
  recovers as the air thins.
- **A small nozzle never enters low mode.** Low mode needs a full bell big enough to lose its jet
  at that altitude. At 100 bar with area ratio 16 or 40, or 200 bar with area ratio 69, a full
  bell holds its jet at sea level, so a dual bell there runs full from the ground and only pays
  its 1.5%. Choosing a dual bell does not resize the nozzle to hide this. The readout says the
  nozzle is running full, and the type's hover text says a dual bell pays off on a nozzle too big
  for the ground.
- **What the user sees:** with a nozzle big enough for space, an Ascend sweep starts with the jet
  narrow, held at the kink, and at some altitude it snaps out to fill the bell, with a dip in
  thrust. In low mode the jet is steady: it has none of the wobble the drawing gives a jet torn
  off an ordinary bell.

### No nozzle

The engine ends at the throat. It is the baseline that shows what a nozzle is worth.

- **Shape.** Chamber, converging section, throat, and nothing after it.
- **Sliders.** "Nozzle exit diameter" and "Nozzle length" are not shown. The engine keeps its exit
  diameter setting unused, so that choosing another exhaust type afterwards brings the nozzle
  back as it was.
- **Thrust.** The gas leaves at the speed of sound, at about half the chamber pressure. Thrust is
  the ordinary formula at an area ratio of 1. There is no wall for the jet to tear off, so it
  never separates; at any ordinary chamber pressure it is far under-expanded.
- **What the user sees:** efficiency roughly a third lower than with a good nozzle, and a jet that
  balloons out the moment it leaves, at sea level as well as in vacuum.

## Behaviour common to all three

- **Chambers.** All three count chambers as a bell does (1 to 4, "Chambers"). The count slider's
  copy and range follow the exhaust record.
- **Swapping the exhaust type** (`withExhaust` in `src/physics/reshape.ts`):
  - between bell, cone, dual bell and no nozzle, the engine's dimensions, chamber count and
    pressure are kept. Only the nozzle's shape changes;
  - to or from an aerospike, each of the three behaves as a bell does today (cells merged into
    chambers and back, keeping total throat and exit area);
  - a nozzle extension is dropped on leaving a bell, as it is for an aerospike;
  - the rule from part 1 holds: a swap is not allowed to destroy the engine by itself.
- **Heat, structure and instability limits** are unchanged: they depend on the chamber and throat.
- **The simulated gas.**
  - The engine's grid follows whatever contour the type supplies. For no nozzle it ends at the
    throat.
  - The plume starts where the engine's grid ends, taking the wall's angle at the lip from the
    type (a cone's half-angle; the outer bell's exit angle; straight back for no nozzle).
  - Dual bell, low mode: the jet leaves the wall at the kink using the mechanism already built for
    a separated jet, with the kink as the station where the wall opens to outside air. The
    existing exception for very light exhaust applies as it does for an ordinary bell.
  - The figures worked out from the simulated gas (`src/render/simFigures.ts`) are shown for a
    cone, for no nozzle and for a dual bell in high mode, where they can be measured as for a
    bell; otherwise the readout says why there are none, as it does today.
- **The drawn (non-simulated) views** show the same shapes: the engine's cross-section, the
  painted gas inside it stopping where the jet leaves the wall, and the drawn plume starting from
  the jet's real width.

## Constraints

- **Regression.** The twelve examples give exactly today's figures
  (`src/physics/presets.regression.test.ts`).
- **Share links.** The two new settings (cone half-angle, inner bell exit) need a new link
  version. Links in every earlier format still open as the same engine, with the new settings at
  their defaults.
- **`sanitize` makes any configuration valid, never rejects it:** an unknown exhaust id becomes a
  bell; the inner bell exit is kept between the throat and the exit; the cone angle within its
  range.
- **A calculated gas at an area ratio of 1.** No nozzle asks the chemistry solver for a nozzle
  with no expansion. `docs/future-work.md` records that area ratios between 1 and 2 are touchy
  for the flow solver and that the fitted gas falls back below 3. No nozzle must give a settled
  answer for every pair that settles with a bell. How (asking the solver for its throat state, or
  a guarded case) is the builder's choice.
- **Lit from cold.** Every energy source with each of the three types, at sea level and in vacuum,
  with both gas simulations on, lights from cold without the solver running away. Check with
  `src/dev/accuracy.ts` (`joined(..., ramp)`), extended to read these contours where it can, and
  in the browser.
- Existing conventions hold: plain-English labels and hover text in `src/ui/copy.ts`, tests beside
  the code, the record of what was built and left kept in `docs/future-work.md`.

## Decided with the user

- Split part 3: these three first, expansion-deflection after.
- Approach 1: one record per exhaust type.
- The three types' behaviour as sketched to the user: a half-angle slider for the cone; a kink
  slider, two modes and a mode readout for the dual bell; no exit sliders and poor efficiency for
  no nozzle; all with every source; the extension stays bell-only; no new examples.

## Decided by Claude

Each is a call the user did not make. They are listed so the user can overrule them.

- **A dual bell is not resized when it is chosen**, so on a small nozzle it shows no low mode
  (above). The alternative, growing the exit when a dual bell is picked so there is always
  something to see, would break the rule that swapping the exhaust keeps the engine's dimensions.
- **Separated ordinary bells get no new penalty** (non-goals). The dual bell's gain is the thrust
  the model already gives it, plus a steady jet.
- **The mode switch has no hysteresis** and is decided by the existing separation criterion
  applied to the full-size bell.
- **The constants:** 8° to 30° for the cone; 0.99 as its non-divergence factor; 5% suction on the
  dual bell's outer wall in low mode; 1.5% loss in high mode; the inner bell's default size.
- **No nozzle keeps the exit diameter setting** so the nozzle comes back when another type is
  chosen.
- **No new examples.**

## Left to the builder

- The record's exact fields, where it lives, and how far the aerospike is folded into it.
- Names of the new settings in `EngineConfig`, the new state's name, and the link format's layout.
- The exact contour of the dual bell's second bell and the angle of its kink, within "several
  degrees steeper"; how the kink's sharp corner is handled by the engine grid (the throat's corner
  once cost total pressure and was replaced by an arc; a kink is meant to be sharp, so measure
  what it costs and say so in `docs/future-work.md`).
- How the plume grid's idea of the nozzle's outside wall (`uDiverge`, `uWallCurve` in
  `src/render/fluidSim.ts`) is fitted for a cone and for no nozzle, where the engine's body is
  wider than the exit just upstream of it.
- Whether the engine grid's linked exit, which lets supersonic gas go without consulting the
  plume, needs anything for an exit that is exactly sonic.
- How `src/dev/accuracy.ts` is extended.
- The wording of every label, tip and readout line.
