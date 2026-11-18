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
- **The smallest cells lag.** The engine grid's cells across the throat are far smaller than
  the plume grid's. The engine grid takes up to two steps of its own for each plume step
  (`MAX_ENGINE_SUBSTEPS`); cells that would need more fall behind true time. Steady flow is
  unaffected, but a start-up passes through the throat more slowly than it should. Raising the
  cap costs frame rate in proportion.
- **A sliding extension is still a thick, stair-stepped wall** in the plume grid, with the
  drawing adjusted to hide what that does to the gas beside it (see `EXTENSION_DEPTH` in
  `src/render/plume.frag.ts`). A grid fitted to a moving, free-standing cone would be the
  proper fix.
- **Thrust and the readouts** still come from the formula model, not from the simulated flow.
- **The two grids are still two solvers in two files.** They share their method (and a slope
  limiter that had to be fixed in both at once); the shared parts could be pulled into one
  place.

### Not recommended

A single grid for everything: fine enough for the throat, it needs thousands of cells along
the plume; coarse enough for the plume, it puts one or two cells across the throat of an
RL10B-2 or Merlin Vacuum.
