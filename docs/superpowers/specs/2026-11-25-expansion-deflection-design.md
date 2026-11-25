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
  ring. Range 0.4 to 0.85, default 0.7. It is a share, not a length, so that engine scale and
  chamber count need no rule for it. `sanitize` clamps it and gives every other exhaust type the
  default.
- The ring's area is the throat area the engine already has (`throatDia`), so swapping to or from
  an ED nozzle keeps the propellant flow. The wall at the ring is therefore wider than a plain
  throat: its radius is `throatDia / 2 / sqrt(1 - plugShare^2)`.
- The bell beyond the ring is the ordinary bell contour, started from the wall's radius at the
  ring. `divergingWall` and `lipSlope` get their case.
- `EngineProfile` (`src/render/geometry.ts`) gains `plug`: where the plug's rim is, its radius, and
  how far its stalk runs back into the chamber. It is null for every other type.

### The formula

In the thrust block of `simulate` (`src/physics/engine.ts`):

- **Wake open** (the outside pressure is above what the full bell would expand the gas to): the
  state is `'compensating'`, as an aerospike's is. The gas is taken to leave at the outside
  pressure, and thrust is pulled part of the way from the over-expanded bell's figure toward a
  matched nozzle's. The share is `ED_COMPENSATION = 0.5` (an aerospike's is 0.7): the wake sits a
  little below the outside pressure and drags on the plug's base.
- **Wake closed**: it runs as the bell it is, with `ED_CLOSED_LOSS = 0.98` on its momentum for the
  drag of the closed wake.
- It never reads `'separated'`.
- Both constants are proposals. The measuring tool's figures (below) are set beside them in the
  record; they are changed only if the simulation disagrees by more than a tenth of thrust, and
  the owner is told.

### The simulation

All in the plume grid, switched on only for an ED nozzle:

- **Units**: lengths are in wall radii at the ring, and x = 0 is the plane of the ring.
- **The ring**: gas enters at x = 0 between the plug's rim and the wall, straight along the axis at
  Mach 1.1, with the ring's width set so the mass flow matches the engine's. Today the ring's edges
  are fixed (from the spike's radius to 1); they become inputs.
- **The plug**: a solid body from the left edge to x = 0 with a flat base, using the spike's
  machinery with a zero-length spike.
- **The bell**: a solid wall from the ring to the mouth, using the extension wall's machinery
  (a slope and a curvature fitted to the bell contour).
- **The wake**: inside the bell the solver's housekeeping is turned off. Today, any cell with almost
  no exhaust in it is pulled toward the outside pressure, and slow exhaust beside air is turned
  into air. Both are right for open air and wrong inside a nozzle, where they would hold the wake
  at the outside pressure whatever the flow did. Inside the bell, air arrives only by flowing in
  through the mouth.
- **Start-up**: the bell starts full of still outside air. The gas in the ring comes up with the
  ignition ramp as an aerospike's does.
- **When it does not fit**: if the bell is longer than 60% of the longest grid (24 ring radii), the
  nozzle is not simulated. The plume is then simulated from the mouth as a bell's is, the gas inside
  is drawn, and the page says the nozzle is too long to simulate whole.

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
- The measuring tool re-runs the cases it already has for the aerospike's kind of ring and the
  RL10B-2's extension, to show they are unchanged.
- In a browser: the default ED engine lit at sea level and swept to vacuum, with the wake seen to
  open and close; the three "Show inside" views; a swap to an aerospike and back; a link.

## Risks, and what happens if they bite

- **The wake will not settle.** A blunt base with a recirculating wake is the hardest thing this
  grid has been asked to do. If, after the housekeeping is turned off inside the bell, the wake
  still cannot be lit from cold without runaway at every altitude, the builder stops and reports.
  The fallback is approach 3 (a hollow jet), which the owner would have to agree to.
- **The ring is narrow.** At the coarsest grid a small ring is two or three cells wide. The plug
  size range (0.4 to 0.85) is chosen so the default ring is at least five cells at the grid length
  an ED nozzle uses. The builder checks this and narrows the range if not.
- **The two solid bodies have never been used together.** The code that decides whether a cell is
  solid already allows both; the code that brings gas in does not. This is the main change to the
  shader.
- **The bell is fitted by a slope and a curvature**, which a short bell follows well and a long one
  less well. The measuring tool reports the worst gap between the fitted wall and the drawn one.

## Left to the builder

- The plug's drawn shape and the stalk's thickness.
- The exact names of the new shader inputs.
- The tip and slider wording, in the page's voice.
- The order of the work, provided the formula and the picture land before the shader changes, so
  there is a working ED nozzle with the plume drawn before the simulation is touched.

## Calls made without asking

- The plug's size is stored as a share of the wall's diameter, not as a length.
- The gas enters the grid straight along the axis at Mach 1.1, not turned outward.
- No simulated figures on the page for this type, and no new example engine.
- The two formula constants (0.5 and 0.98) are proposals to be checked against the simulation.
- A nozzle too long for the grid falls back to being simulated from its mouth.
