# Expansion-deflection nozzle (engine builder, part 3b)

Status: awaiting approval, 25 November 2026.

## What it is for

The last of the exhaust types planned for the engine builder. An expansion-deflection nozzle
(ED nozzle below) has a plug in the middle of its throat. The gas leaves through the ring between
the plug and the wall and runs out along a bell. Behind the plug is a hollow. Near the ground the
outside air reaches up into that hollow and the gas hugs only the wall, so the nozzle acts like a
smaller one. Higher up the hollow closes over and the gas fills the whole bell. It adjusts to
altitude as an aerospike does, inside a short bell.

A builder should be able to pick it, see the plug, fire it, and watch the hollow behind the plug
open near the ground and close as the engine climbs. The owner chose to have the gas simulation
work that out, not a drawing.

## Words used below

- **Plug**: the solid body on the centreline at the throat.
- **Ring**: the gap between the plug's rim and the wall, where the gas comes through. It is the
  throat.
- **Wake**: the hollow behind the plug's flat base.
- **Open wake / closed wake**: open when outside air reaches into it from the nozzle's mouth; closed
  when the gas from the ring has met on the centreline and sealed it off.
- **The engine grid and the plume grid**: the two gas simulations (see "One solver, two connected
  grids" in `docs/future-work.md`). The engine grid runs from the centreline to the wall with
  nothing in between. The plume grid is a plain rectangle that can hold solid bodies.

## Goals

- A new exhaust type, "Expansion-deflection", in the Exhaust picker, with a "Plug size" slider.
- Thrust, efficiency and nozzle state from a formula: it compensates for altitude while its wake is
  open and runs as a bell once it is closed. It never separates.
- The cutaway shows the plug.
- With the plume simulated, the whole nozzle (ring, plug, bell and wake) is simulated in the plume
  grid, and the wake opens and closes with altitude because of the flow, not because of a rule.
- "Show inside" (gas speed, gas temperature) colours the gas in the nozzle from that simulation.
- The measuring tool (`src/dev/accuracy.ts`) can light an ED nozzle from cold and measure its thrust
  at the mouth, so the formula's constants can be checked against the simulation and recorded.
- Share links carry the new type and its plug size, and every older link still opens.

## Not in this piece

- A new example engine. No ED nozzle has flown, and the twelve examples are fixed.
- Simulated thrust, flow and efficiency on the page for an ED nozzle. They need the plume grid read
  back in the app, which nothing does today. The page says so, as it does for an aerospike.
- The plug's cooling. A real plug in the throat is very hard to keep cool. The heat-load limit is
  left as it is for a bell, and the record says so.
- More than one chamber feeding one ED nozzle, and a nozzle extension on one.
- Any change to how every other exhaust type is simulated or drawn.

## What would make it a failure

- An example engine, or any existing exhaust type, that behaves or looks different afterwards.
- A wake that is pinned at the outside pressure by the solver's own housekeeping, so that it "opens
  and closes" only because a rule says so.
- Runaway or not-a-number cells when an ED nozzle is lit from cold at any altitude.
- An ED nozzle that reads better than an aerospike of the same size at every altitude. Real ones do
  not.

## Constraints

- The twelve example engines are pinned by `src/physics/presets.regression.test.ts` and
  `src/render/geometry.regression.test.ts`. Neither snapshot is regenerated.
- The plume grid's shader (`src/render/fluidSim.ts`) has to change. Every change is behind a switch
  that is off unless an ED nozzle is being simulated, so that all other engines run the same
  instructions as before.
- The engine grid (`src/render/engineSim.ts`) and the link between the grids (`src/render/gasSim.ts`)
  are not changed. The engine grid is switched off for an ED nozzle, as it is for an aerospike.
- The plume grid is 384 by 162 cells and at most 24 entry radii long. An ED nozzle's bell must fit
  inside it with room for the plume.
- Words on the page are plain English for an enthusiast.

## Approaches considered

1. **Figures and picture only.** Formula, cutaway and a drawn wake; the plume simulated from the
   mouth as for a bell. Smallest, but the wake, which is the point of the nozzle, is not simulated.
2. **Simulate the whole nozzle in the plume grid (chosen).** The plume grid already holds a solid
   body on the centreline with gas arriving as a ring (the aerospike's spike) and, separately, a
   curved outer wall (the RL10B-2's extension). An ED nozzle is both at once.
3. **A hollow jet.** As 1, but feed the plume grid a ring-shaped jet near the ground. Cheap, and
   the wake is still a rule.

The owner chose 2 ("go with your pick").

Within 2, two ways to bring the gas in were weighed. The real nozzle turns the gas outward through
the ring. Feeding the grid gas that is heading outward makes its speed along the grid's axis
subsonic, and the grid's inflow then feels what is downstream of it, which is unstable. So the gas
is fed in straight along the axis, just past the speed of sound (Mach 1.1), through a ring of the
right area. The fan of expansion round the plug's rim and the wall's own curve do the turning. This
is a simplification and is recorded as one.

## The design

### The part and its shape

- `ExhaustId` gains `'expansionDeflection'`. Its record in `src/physics/exhausts.ts`: name
  "Expansion-deflection", counts chambers, has a nozzle, no extension, sliders: exit diameter,
  nozzle length, and plug size.
- `EngineConfig` gains `plugShare`: the plug's diameter as a share of the wall's diameter at the
  ring. Range 0.4 to 0.8, default 0.7. It is a share, not a length, so that engine scale and
  chamber count need no rule for it. `sanitize` clamps it and gives every other exhaust type the
  default.
- **When the sizes do not fit, the plug gives way first and the exit second.** A bigger plug pushes
  the wall at the ring outward (1.4 times the throat's radius at 0.7, 1.67 times at 0.8). For an ED
  nozzle only, `sanitize` lowers `plugShare` until the wall at the ring is no wider than 95% of the
  chamber and the exit is at least 1.15 times as wide as the wall at the ring. If that would take
  the plug below 0.4, it holds the plug at 0.4 and raises the exit diameter instead. No other
  exhaust type's rules change, and a swap between types keeps the sizes as it does today.
- The ring's area is the throat area the engine already has (`throatDia`), so swapping to or from
  an ED nozzle keeps the propellant flow. The wall at the ring is therefore wider than a plain
  throat: its radius is `throatDia / 2 / sqrt(1 - plugShare^2)`.
- The bell beyond the ring is the ordinary bell contour, started from the wall's radius at the
  ring. `divergingWall` and `lipSlope` get their case.
- `EngineProfile` (`src/render/geometry.ts`) gains `plug`: where the plug's rim is, its radius, and
  how far its stalk runs back into the chamber. It is null for every other type.

### The formula

In the thrust block of `simulate` (`src/physics/engine.ts`):

- **Base drag, at every altitude.** The plug's flat base drags on the flow whether the wake is open
  or closed, so the momentum term is always multiplied by `1 - 0.02 * plugShare^2` (0.99 at the
  default plug; first proposed as `1 - 0.04 * plugShare^2`, see the note below). Applying it at every altitude keeps thrust from stepping down as the wake closes.
- **Wake open** (the outside pressure is above what the full bell would expand the gas to): the
  state is `'compensating'`, as an aerospike's is. The rule has the aerospike's shape, at the same
  place in the code: start from the figure the same bell would give at this altitude (its
  separation included, exactly as the aerospike's rule starts), take the gas to leave at the
  outside pressure, and pull thrust part of the way toward a matched nozzle's. The share is
  `0.1 + 0.7 * plugShare` (0.59 at the default plug, 0.66 at the biggest; an aerospike's is 0.7;
  first proposed as `0.3 + 0.3 * plugShare`).
- **Why the first numbers were changed during the build.** In this simulator a bell that has torn
  its jet off the wall loses little: at an area ratio of 36 at sea level a matched nozzle beats it
  by only about 6%. With the first numbers the plug's drag ate nearly all of what the open wake
  won back (the nozzle beat the same bell by 1.4% at sea level), and a bigger plug was worse at
  every altitude, so the slider offered no choice. With these the default nozzle beats the same
  bell by about 3% at sea level and gives up about 1% in vacuum.
- **Wake closed**: it runs as the bell it is, with the base drag above.
- It never reads `'separated'`.
- **So the plug size is a real choice.** A bigger plug compensates better near the ground and drags
  more in vacuum. The reasoning: a bigger plug makes a thinner ring further out, which holds to the
  wall better and leaves a bigger hollow for the air to fill; and a bigger base is more drag.
- The numbers in both rules are proposals. The measuring tool's figures (below) are set beside them
  in the record for the three plug sizes it runs. If the simulation's thrust at the default plug
  differs from the formula's by more than a tenth at any altitude, the builder changes the numbers
  to fit, says so in the record, and the owner is told.

### The simulation

All in the plume grid, switched on only for an ED nozzle:

- **Units**: lengths are in wall radii at the ring, and x = 0 is the plane of the ring.
- **The grid's size is set by the bell, not by the zoom.** For every other engine the grid's length
  follows the zoom (`gridLength` in `src/render/plume.ts`). For an ED nozzle it is fixed: long
  enough for 2.2 bell lengths, and tall enough (the grid is 162 cells high) for 1.25 times the
  mouth's radius, whichever asks for more. Zooming then changes only the view. At the default
  engine this makes a cell about 0.036 ring radii, so the default ring (0.3 wide) is about eight
  cells and the narrowest ring the slider allows (0.2) about five.
- **The ring**: gas enters at x = 0 between the plug's rim and the wall, straight along the axis at
  Mach 1.1, with the ring's width set so the mass flow matches the engine's. Today the ring's edges
  are fixed (from the spike's radius to 1); they become inputs.
- **The plug**: a solid body from the left edge to x = 0 with a flat base, using the spike's
  machinery with a spike of no length. (That machinery divides by the spike's length in three
  places, so it needs a guard or a length of one cell.)
- **The bell**: a solid wall from the ring to the mouth, using the extension wall's machinery
  (a slope and a curvature fitted to the bell contour).
- **The wake**: inside the bell the solver's housekeeping is turned off. Today, any cell with almost
  no exhaust in it is pulled toward the outside pressure, and slow exhaust beside air is turned
  into air. Both are right for open air and wrong inside a nozzle, where they would hold the wake
  at the outside pressure whatever the flow did. Inside the bell, air arrives only by flowing in
  through the mouth.
- **Start-up**: the bell starts full of still outside air. The gas in the ring comes up with the
  ignition ramp as an aerospike's does.
- **When it does not fit**: if the size rule above asks for a grid longer than the longest allowed
  (24 ring radii), the nozzle is not simulated whole. That happens at an area ratio of about 40 for
  a bell of usual length. The plume is then simulated from the mouth with the jet the formula
  describes at that altitude (`simInputs` with the current result: narrower and already at the
  outside pressure while the wake is open), the gas inside is drawn, and the page says the nozzle
  is too long to simulate whole.

`src/sim/runtime.ts` routes an ED nozzle as it routes an aerospike: engine grid off, plume grid
given the ring, plug and wall, and no simulated figures.

### The picture

- The cutaway (`src/render/engineView.ts`) draws the plug and its stalk in the same metal as the
  wall, and leaves the inside of the bell unpainted when the gas is simulated.
- With the plume drawn, not simulated, the gas in the bell is painted from the formula: a band
  along the wall and an empty wake while the wake is open, the whole bell once it is closed.
- "Show inside" colours the simulated gas in the bell by speed or temperature, the way the
  aerospike's spike is coloured.

### The page

- Exhaust picker: "Expansion-deflection", with a tip in the page's voice.
- A "Plug size" slider, shown only for this type, reading as a percentage.
- The words under the nozzle state for `'compensating'` now depend on the exhaust type: an
  aerospike's air squeezes the outside of its jet; an ED nozzle's air fills the hollow behind its
  plug.
- The note where simulated figures would be: "not for expansion-deflection nozzles".

### Links

- A new share format `v5` (today's is `v4`) adds `plugShare` and can name the new type. Older
  links open as before; a link naming an exhaust type this build does not know opens as a bell.

## How it will be checked

- Unit tests for the record, the shape (ring area equals throat area at every plug size; the wall
  is continuous at the ring), `sanitize`, the swap to and from every other type, and links.
- Unit tests for the formula: compensating below the closing altitude and a bell above it; thrust
  never above an aerospike's of the same throat and exit at any altitude from 0 to 100 km; thrust
  rises steadily with altitude; never `'separated'`.
- The example engines' regression tests, untouched and passing.
- The measuring tool lights an ED nozzle from cold at 0, 5, 10, 20, 40 and 100 km for three plug
  sizes: no runaway, nothing that is not a number, and at each altitude the wake's pressure on the
  centreline just behind the plug and the thrust across the mouth. The record says at what altitude
  the wake closed in the simulation and how the measured thrust sits against the formula.
- **Proof that nothing else moved.** The measuring tool has no case today for an aerospike's ring
  or for the RL10B-2's extension wall in the plume grid. The builder writes both first, before the
  shader is touched, and records for each a fingerprint of the whole grid after a fixed number of
  frames from cold (a sum over every cell's four numbers). After the shader changes, the same two
  cases, and one ordinary bell, must give the same fingerprints to the last digit on the same
  machine. This is the check on "every change is behind a switch".
- In a browser: the default ED engine lit at sea level and swept to vacuum, with the wake seen to
  open and close; the three "Show inside" views; a swap to an aerospike and back; a link.

## Risks, and what happens if they bite

- **The wake will not settle.** A blunt base with a recirculating wake is the hardest thing this
  grid has been asked to do. If, after the housekeeping is turned off inside the bell, the wake
  still cannot be lit from cold without runaway at every altitude, the builder stops and reports.
  The fallback is approach 3 (a hollow jet), which the owner would have to agree to.
- **The ring is narrow.** The grid's size rule and the plug range (0.4 to 0.8) are chosen so the
  ring is at least five cells wide at the default engine. A longer bell makes the cells bigger; the
  builder checks the ring's width in cells at the longest bell that still fits and, if it falls
  under four, lowers the top of the plug range or the length at which the nozzle stops being
  simulated whole.
- **The two solid bodies have never been used together.** The code that decides whether a cell is
  solid already allows both; the code that brings gas in does not. This is the main change to the
  shader.
- **The bell is fitted by a slope and a curvature**, which a short bell follows well and a long one
  less well. The measuring tool reports the worst gap between the fitted wall and the drawn one.

## Left to the builder

- The plug's drawn shape and the stalk's thickness.
- The exact names of the new shader inputs.
- The tip and slider wording, in the page's voice.
- The order of the work, provided two things hold. The formula and the picture land before the
  shader changes, so there is a working ED nozzle with the plume drawn before the simulation is
  touched. And the fingerprints of the existing cases are recorded before the shader changes.

## Calls made without asking

- The plug's size is stored as a share of the wall's diameter, not as a length.
- The plug size changes the figures: bigger compensates better near the ground and drags more in
  vacuum. The alternative was a slider that changed only the picture.
- The gas enters the grid straight along the axis at Mach 1.1, not turned outward.
- No simulated figures on the page for this type, and no new example engine.
- The numbers in the two formula rules are proposals to be checked against the simulation.
- A nozzle too long for the grid (area ratio above about 40) falls back to being simulated from
  its mouth.
- For this type the grid's size is fixed by the bell, so zooming does not re-size it.
- When sizes clash, the plug shrinks first and the exit grows second.
