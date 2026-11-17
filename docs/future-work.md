# Future work

Ideas that have been discussed and set aside for later.

## One solver, two connected grids

**Progress.**

- Stage 1 (done): with both simulated and the jet filling the nozzle, the two solvers are
  stepped together on one clock and read each other across the nozzle exit. The engine's exit
  cells hold whatever the plume solver has just outside the nozzle, so the outside can reach
  back in wherever the gas is not leaving faster than sound. See the loop in
  `src/render/plume.ts`.
- Stage 2 (done): separated flow runs through the linked solvers too. The formula still says
  where the jet tears off the wall, because a solver with no friction cannot find that for
  itself: left alone it stands a shock across the whole nozzle with slow gas behind it, which
  is not what an engine does. From that station on, the engine grid's wall is open to still
  outside air. Everything after that is simulated: the free jet inside the bell, the air
  beside it, and the plume it becomes.
- Stage 3 (to do): move the RL10B-2 extension into one place, and fold the two solvers into a
  single module.

**How it stands.** The gas is worked out on two grids:

- the engine grid (`src/render/engineSim.ts`) covers the injector face to the nozzle exit, and
  is fitted to the engine's walls;
- the plume grid (`src/render/fluidSim.ts`) covers everything outside the nozzle, and is
  rectangular.

What is left of the old one-way arrangement:

- **Where the jet separates.** The station comes from a formula (the Schmucker criterion in
  `src/physics/engine.ts`), not from the gas simulation. Finding it properly needs friction at
  the wall: a boundary layer, which is a different class of solver.
- **The smallest cells lag.** The engine's cells across the throat are far smaller than the
  plume's. The engine takes up to two steps of its own for each plume step; cells that would
  need more fall behind true time instead. Steady flow is unaffected, but a start-up passes
  through the throat more slowly than it should.
- **The RL10B-2 extension.** The engine grid stops at the end of the fixed nozzle, and the
  extension is a wall inside the plume grid.

**The idea.** Rewrite the two as one solver that advances both grids together, on the same clock,
and exchanges gas across the nozzle exit in both directions every step. Physically that is a
single simulation; the two grids are only how it is stored. It would give real flow separation,
a true ignition transient, and one home for the nozzle extension.

**What makes it hard.**

- The join between a wall-fitted grid and a rectangular one is where artefacts tend to appear,
  and a lot of work has already gone into removing artefacts at exactly that spot.
- Running the engine in true time means every cell moves at the pace of the smallest ones at the
  throat: roughly 10 to 20 times more steps for the big-nozzle engines. It would likely need a
  coarser engine grid, or true time only where it matters (start-up, over-expanded nozzles).

**Not recommended.** A single grid for everything: fine enough for the throat, it needs thousands
of cells along the plume; coarse enough for the plume, it puts one or two cells across the throat
of an RL10B-2 or Merlin Vacuum.
