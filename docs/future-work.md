# Future work

Ideas that have been discussed and set aside for later.

## One solver, two connected grids

**Today.** The gas is worked out by two separate simulations that run one after the other each
frame and meet at the nozzle exit:

- the engine simulation (`src/render/engineSim.ts`) covers the injector face to the nozzle exit,
  on a grid fitted to the engine's walls;
- the plume simulation (`src/render/fluidSim.ts`) covers everything outside the nozzle, on a
  rectangular grid, and reads the last column of the engine simulation as its inflow.

The link is one-way: the engine feeds the plume, and nothing in the plume reaches back into the
engine. That is physically right while the gas leaves the nozzle supersonic, but it leaves three
seams:

- **Separated flow.** When the nozzle is too big for the altitude (Merlin Vacuum at sea level),
  outside air really pushes up into the bell. The engine simulation never sees that air, so the
  view is clipped to the jet and the plume falls back to its formula-based inflow.
- **Start-up timing.** The engine simulation lets each cell advance at its own pace so it settles
  quickly; the plume runs in true time. The ignition front crossing from one to the other is not
  time-accurate.
- **The RL10B-2 extension.** The engine simulation stops at the end of the fixed nozzle, and the
  extension is a wall inside the plume simulation.

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

**A smaller first step.** Keep the two solvers, but give the engine simulation's exit boundary
the pressure and gas just outside the nozzle from the plume simulation, and put both on the same
clock. That fixes separated flow and ignition timing without the rewrite.

**Not recommended.** A single grid for everything: fine enough for the throat, it needs thousands
of cells along the plume; coarse enough for the plume, it puts one or two cells across the throat
of an RL10B-2 or Merlin Vacuum.
