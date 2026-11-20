# Future work

Ideas that have been discussed and set aside for later, and what is left over from ones that
have been built.

## One solver, two connected grids (built)

The gas is one flow worked out on two grids, advanced together by `src/render/gasSim.ts`:

- the engine grid (`src/render/engineSim.ts`) is fitted to the engine's walls and covers the
  injector face to the nozzle exit;
- the plume grid (`src/render/fluidSim.ts`) is rectangular and covers everything outside the
  nozzle.

They are stepped on the same clock and read each other across the nozzle exit: the plume grid
takes the gas arriving from the engine grid, and the engine grid's cells just beyond its exit
hold whatever the plume grid has there. It was built in three stages:

1. **Linked stepping.** One loop advances both grids, exchanging at the exit every step.
2. **Separated flow.** An over-expanded nozzle runs through the same linked pair. From the
   station where the jet tears off the wall, the engine grid's wall is open to still outside
   air; the free jet inside the bell, the air beside it and the plume it becomes are all
   simulated.
3. **The nozzle extension.** Seated, the RL10B-2's extension is part of the nozzle, so the
   engine grid carries on through it to the true exit. The plume grid does not move: the two
   overlap, and the plume grid holds the engine grid's gas wherever it lies inside the nozzle,
   so nothing jumps as the extension seats. Sliding or stowed, the extension is a loose cone
   standing in the plume, which only the plume grid can hold.

### What is left

- **Where the jet separates comes from a formula** (the Schmucker criterion in
  `src/physics/engine.ts`), not from the gas simulation. A solver with no friction cannot find
  it: nothing makes the gas let go of the wall, so left alone it stands a shock across the
  whole nozzle with slow gas behind it, which is not what an engine does. Finding the point
  properly needs a boundary layer at the wall, which is a different class of solver.
- **Two kinds of separated jet get less than the full treatment.** A free jet inside the bell
  gives up momentum to the outside air beside it, and in the engine grid some jets break up
  before they reach the exit:
  - a separated jet of very light exhaust (nuclear thermal and salt-water engines, whose gas
    is dozens of times thinner than the air beside it) is not linked at all. The engine grid
    runs alone, the view is clipped to where the formula puts the jet, and the plume starts
    from the formula;
  - the RL10B-2 with its extension seated, while separated, is linked, but the engine grid
    stops at the fixed nozzle as it does for a sliding extension. The jet would otherwise have
    the whole length of a very large bell to cross.
- **The exit is only two-way where the gas is slower than sound.** Supersonic gas is let go
  without looking at the plume grid, and the pressure the plume grid can press back with is
  capped at about twice the still air's. Without both, the front of a starting jet (briefly at
  far higher pressure in the plume grid) stands a shock in the nozzle mouth that the two grids
  then hold in place between them.
- **The smallest cells lag.** The engine grid's cells across the throat are far smaller than
  the plume grid's. The engine grid takes up to two steps of its own for each plume step
  (`MAX_ENGINE_SUBSTEPS`); cells that would need more fall behind true time. Steady flow is
  unaffected, but a start-up passes through the throat more slowly than it should. Raising the
  cap costs frame rate in proportion.
- **A sliding extension is still a thick, stair-stepped wall** in the plume grid, with the
  drawing adjusted to hide what that does to the gas beside it (see `EXTENSION_DEPTH` in
  `src/render/plume.frag.ts`). A grid fitted to a moving, free-standing cone would be the
  proper fix.
- **The readouts' own figures still come from the formula model.** Thrust, efficiency and
  propellant flow worked out from the simulated gas are shown beside them
  (`src/render/simFigures.ts`): thrust where the gas leaves the engine's grid, flow at the
  throat. For attached flow the two agree to about 1% on thrust; the simulation gives about 2%
  less flow and 1% more efficiency. There are none for an aerospike (its flow is in the plume
  grid, which is not read back), for a separated jet of very light exhaust, or with a nozzle
  extension partly seated.
- **The two grids are still two solvers in two files.** They share their method (and a slope
  limiter that had to be fixed in both at once); the shared parts could be pulled into one
  place.

### How accurate it is, as measured

Measured with `src/dev/accuracy.ts`, which runs the solvers and reads the gas state back, against
one-dimensional nozzle theory. (Its header says how to run it.) That theory uses the same
idealised gas the solvers do, so this shows the equations are solved correctly, not that they
describe a real engine. Attached flow only: separated nozzles, solid motors and a seated
extension were not measured.

- **The engine grid is within about 1%** on the bulk numbers, across six engines: mass flow
  constant along the engine to 0.2–1.4%, Mach 1 at the throat, exit Mach and pressure within
  1–2% of theory, and thrust at the exit within 1.2% of the formula readout.
- **The exit hands the plume the right amount of gas**, to within 1–2%, whatever the zoom. A
  cell of the plume grid that the nozzle wall cuts through delivers its share of the flow
  (`nozzleCover` in `src/render/fluidSim.ts`). Before that the exit was a whole number of cells
  across and the plume got from 5% too little to 4% too much.
- **A seated extension's exit is still a whole number of cells across**, so the same error
  remains there.
- **The wall just after the throat picks up a little entropy that is not real**: 3–5% in the
  worst cell, costing about 1% of total pressure by the exit. It was 8–16% and 2–4% while the
  contour had a sharp corner at the throat; the wall now turns out of the throat along an arc
  (`engineProfile` in `src/render/geometry.ts`). What is left is the grid: the arc is only a
  handful of columns long.
- **The plume carries what the nozzle gives it.** Out to four exit radii, thrust stays within
  2% and exhaust within 4%, for every bell engine at sea level and in vacuum. Thrust used to
  grow by 8–26% over that distance at sea level. Holding the surrounding air at ambient density
  (`uRelax`) topped up air that was already moving with the jet, at the speed it had; air added
  now brings no momentum of its own. (Air let out keeps its speed: speeding the rest up instead
  runs away in a vacuum.) Honest mixing with dense air slows the edge of the jet a good deal,
  so the speed below which stray exhaust is cleared away came down to match, or it would have
  taken the plume's own edge.
- **Every bell engine lights from cold without the solver running away**, at sea level and in
  vacuum. `joined(..., ramp)` in the measuring tool counts cells holding nonsense; a change to
  the plume solver should be checked with it, lit from cold, not only already running.
- **Shock diamonds are spaced about right**: 6.4–6.8 exit radii for a Merlin at sea level,
  against 7.1 from the Prandtl–Pack estimate.

### Not recommended

A single grid for everything: fine enough for the throat, it needs thousands of cells along
the plume; coarse enough for the plume, it puts one or two cells across the throat of an
RL10B-2 or Merlin Vacuum.

## The engine builder

The simulator opens on a build-your-own engine made of three parts: an energy source, an
exhaust type and a propellant (`src/physics/parts.ts`, `src/physics/reshape.ts`). The design is
in `docs/superpowers/specs/2026-11-20-engine-builder-design.md`. It is the first of five pieces:

1. **An engine made of parts, and the workshop screen (built).** Includes the fluids a nuclear
   reactor can heat.
2. **Fuel and oxidiser chemistry.** Any fuel with any oxidiser, worked out live by a small
   chemical-equilibrium solver, replacing the hand-typed tables for burning engines.
3. **More exhaust types:** plain cone, dual bell, expansion-deflection, no nozzle.
4. **Plume colour from what is in the exhaust**, replacing hand-picked colours.
5. **Electric thrusters** (ion, Hall effect), which need their own view.

### What is left from the first piece

- **An aerospike's thrust cells are drawn the same whatever feeds them.** A reactor or a solid
  motor behind an aerospike is drawn with the small combustion chambers and feed lines of the
  XRS-2200 (`src/render/aerospikeView.ts`). The gas and the figures are right for the source;
  only the picture of the cell is not.
- **The nuclear fluids' tables are hand-typed estimates** (`src/physics/propellants.ts`), checked
  against published efficiencies rather than worked out. They come out 7 to 19 % under the ideal
  figures for water, methane and carbon dioxide. The chemistry solver of piece 2 should replace
  them.
- **Swapping a part is not allowed to destroy the engine by itself**, with one exception. A
  reactor or salt-water reaction is turned down if the swap would overheat it, a flame that a new
  energy source would make too hot for its throat runs at a lower chamber pressure, and an engine given
  an aerospike gets fewer than twenty cells where twenty would have throats too small to make or
  to keep cool (a Raptor gets two). The exception is honest physics: a very large engine rebuilt
  round a combustion chamber is unstable, as the F-1 nearly was, and says so.
- **A multi-chamber engine is always drawn with a shared turbopump and two feed lines**, even
  where the chambers are solid motors or reactors (`drawTurbopump` in `src/render/engineView.ts`).
- **Nothing tests the workshop screen itself**: the pickers, the count slider and the Examples
  menu were checked in the browser, not by a test.
- **Every source was fired with both exhausts** at sea level and in vacuum, lit from cold, with
  both gas simulations on. All eight run. The measuring tool (`src/dev/accuracy.ts`) only reads
  bell engines, so the new aerospikes were checked by eye and by their readouts, not measured.
