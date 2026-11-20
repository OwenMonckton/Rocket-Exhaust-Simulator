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
2. **Fuel and oxidiser chemistry (built).** Any fuel with any oxidiser, worked out live by a
   small chemical-equilibrium solver. The examples keep their hand-typed tables; see "Chemistry
   piece (part 2 of the engine builder)" below.
3. **More exhaust types:** plain cone, dual bell, expansion-deflection, no nozzle.
4. **Plume colour from what is in the exhaust**, replacing hand-picked colours.
5. **Electric thrusters** (ion, Hall effect), which need their own view.

### What is left from the first piece

- **An aerospike's thrust cells are drawn the same whatever feeds them.** A reactor or a solid
  motor behind an aerospike is drawn with the small combustion chambers and feed lines of the
  XRS-2200 (`src/render/aerospikeView.ts`). The gas and the figures are right for the source;
  only the picture of the cell is not.
- **Only hydrogen is still a hand-typed table among the nuclear fluids.** Ammonia, methane, water,
  carbon dioxide and helium are worked out by the chemistry solver of piece 2 (see "Chemistry
  piece: nuclear fluids against published figures" below). Hydrogen keeps its table because the
  NERVA example is pinned to it. The fluids still borrow part 1's hand-picked plume look until
  piece 4.
- **Swapping a part is not allowed to destroy the engine by itself**, with one exception. A
  reactor or salt-water reaction is turned down if the swap would overheat it, and an engine given
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

## Chemistry piece (part 2 of the engine builder): what was built and what was left

The design is in `docs/superpowers/specs/2026-11-20-fuel-chemistry-design.md`.

### What was built

- **A chemical-equilibrium solver** in `src/physics/chem/`, after NASA RP-1311 (Gordon and
  McBride): NASA's thermo data for ten elements (`thermo.json`, `thermo.ts`), the equilibrium of
  gases and condensed products at fixed enthalpy, entropy or temperature (`equilibrium.ts`), and
  the flow from chamber through throat to exit at the chamber's entropy (`rocket.ts`).
- **The fitted gas.** The solver's flame temperature, characteristic velocity and vacuum
  efficiency for the engine's own pressure, mixture and area ratio are handed to the simulator as
  one simple gas that reproduces them (`fitGas` in `pair.ts`), so the nozzle maths, the flow view,
  separation and the aerospike are unchanged. Results are cached; the solver never runs per frame
  for unchanged inputs.
- **Two pickers** for a combustion chamber: 30 fuels (two of them meant to run alone: nitrous
  oxide and 90% peroxide) and 16 oxidisers plus "None (fuel alone)", grouped into everyday,
  storable and exotic, with hover text (`ingredients.ts`). Every fact about an ingredient carries a
  source string.
- **The mixture slider** spans each pair from where the flame cools to 700 K on one side to the
  other, held within a fiftieth and fifty times the most efficient ratio, and starts at the most
  efficient (`pairRange`).
- **Whether it works** (`verdict.ts`): three new failures shown on screen (flame-out below 800 K,
  detonation for liquid ozone, tetranitromethane and acetylene, and "Nothing to burn it with"),
  and warnings beside the pickers (igniter or lights on contact, one propellant freezing the
  other, attacks materials, toxic propellant or exhaust, droplets or soot, hydrazine alone).
- **The exhaust readout**: what leaves the nozzle, by share of molecules, in plain names.
- **No figures without an answer.** When the solve does not settle, or there is nothing to burn,
  every figure shows a dash and the limit bars are hidden.
- **The nuclear fluids** other than hydrogen come from the solver (see the next section).
- **Share links** in a new `v3` format carry fuel, oxidiser and mixture; `v1` and `v2` links open
  as before.
- **The examples are untouched.** All twelve keep their pinned figures. An example's tabled pair
  shows in the pickers; changing either picker makes the engine calculated and marks it modified,
  and Reset brings the table back.

### Rulings made during the build, in order

Each was a choice the plan did not settle. What it costs if it was the wrong choice follows it.

1. **The four solver-against-table figures are recorded here, not printed by a test** (they are
   below). If wrong: they were seen one task later.
2. **A product sitting on its melting point holds both phases.** The plan said to keep whichever
   phase was in hand; that read Example 13's throat 265 K wrong and depended on the starting guess.
   CEA's own rule (RP-1311 sec. 3.5) replaced it: when a phase swap would undo the previous one at
   the same point, both phases are kept and the temperature is held at the melting point. If wrong:
   more solver work, and a throat search that must cope with gamma near 1 there.
3. **A state colder than 200 K reports "no answer".** NASA's data stops at 200 K; below it every
   figure is an extrapolated fit and condensed products cannot be tested. A beryllium-rich mixture
   had "settled" at 23 K. If wrong: a mixture that is simply very cold reads "no answer" instead of
   flame-out. The slider stops at 700 K, so ordinary pairs never get there.
4. **Four extras in the flow solver stand**: one cold retry of a failed warm solve, off-centre
   bisection probes, an exit that cannot step upstream of the throat, and pressure ratios carried as
   first guesses. Each makes a result independent of the starting guess or stops a non-physical
   step. If wrong: extra code with little effect.
5. **Where the flow crosses sonic three times around a melting band** (11 of 288 beryllium
   mixtures tried), the throat is the first sonic point, not the point of greatest mass flow, as
   CEA's own iteration does. Characteristic velocity reads up to 0.36% high there. If wrong: a third
   of a percent on rare beryllium mixtures.
6. **One kilogram of hydrogen per eight of oxygen is 1.984 hydrogen atoms per oxygen atom**; the
   plan's test figure was twice that. No cost.
7. **Nitrous oxide (both entries) is modelled from the data file's gas record**; no cited figure
   for the liquid was found. Its heat content is overstated by the heat of vaporisation (about 16
   kJ/mol of 82), so its efficiency reads a little high. If wrong: a percent or two on nitrous
   pairs.
8. **The 200 K floor applies to the chamber and the throat only.** An exit colder than 200 K is
   reached by frozen flow: equilibrium down to the 200 K station on the chamber's isentrope, then
   composition and specific heat frozen to the exit. Without it, helium in NERVA's nozzle (exit
   near 60 K) and any hydrogen-rich pair in a big nozzle would read "no answer". If wrong: a small
   error in the last few percent of expansion for cold exits; no exhaust condenses below 200 K.
9. **Picking a pair must take well under half a second.** Met: the slowest pair measured
   (aluminium slurry with oxygen) went from about 1 s to about 150 ms.
10. **A condensed product outside its temperature range is dropped and the point solved again, and
    a solve starts warm only from a nearby state.** Started from a distant state, aluminium slurry
    with oxygen had settled at 2,009 K holding a solid far outside its range, where a cold start gives
    3,955 K. If wrong: a few more cold starts, a little slower.
11. **Picking "calculated" sets the mixture to the pair's best** (a change to `store.ts` made with
    the solver hookup). Without it, picking Calculated flamed out at once. If wrong: none seen.
12. **The fuel and oxidiser pickers do nothing unless the engine burns a pair.** They are shown only
    for a combustion chamber, and quietly turning a reactor into a combustion engine would be a
    surprise. No cost.
13. **"Nothing to burn it with" hides the figures too**, as an unsettled solve does: no calculation
    produced them; they came from a cold stand-in gas. No cost.

### What the solver reads against the tables

The same engine, tabled and calculated (70 bar, area ratio 16, each table's own mixture ratio,
vacuum Isp in seconds, the simulator's usual losses applied to both):

| Pair | Mixture | Table | Solver | Difference |
|---|---|---|---|---|
| RP-1 and oxygen | 2.36 | 311.7 | 322.5 | +3.49% |
| Hydrogen and oxygen | 6.0 | 408.3 | 412.5 | +1.03% |
| Methane and oxygen | 3.6 | 326.0 | 332.8 | +2.08% |
| UDMH and nitrogen tetroxide | 2.6 | 296.0 | 309.4 | +4.50% |

Measured twice, the same to the hundredth. The solver is ideal equilibrium flow; the tables were
tuned to real engines, which lose a few percent to incomplete burning, finite reaction rates and
the like that the simulator's own losses do not fully cover. So **an example whose fuel or
oxidiser is re-picked**, even back to the same one, becomes calculated and reads higher than its
stock self: the Merlin 1D goes from 283 to 295 s at sea level (+4.1%), with its mixture moved from
2.36 to the solver's best, 2.76. It is marked modified, and Reset returns it to the table.

### What was left

- **Ingredients left out for want of a sourced heat content:** liquid chlorine pentafluoride (NIST
  has gas-phase data only), turpentine (no record; a mixture anyway), hydrazine hydrate and so
  UH25 (not found by name, CAS or formula), and condensed beryllium hydride (no condensed-phase
  data).
- **Facts left unset for want of a source**, so no note appears for them:
  - freezing and boiling points for gasoline, Jet-A, JP-10, Syntin, beryllium, the aluminium
    slurry and every blend (75% ethanol, Aerozine 50, MON-25, FLOX-70, IRFNA, 98% peroxide); RP-1
    (the source gives only a bound and a range); pentaborane's boiling point (a range);
  - toxicity for liquid ozone, oxygen difluoride, nitrogen trifluoride, perchloryl fluoride and
    nitrous oxide (unrated in CAMEO), for the blends, gasoline, JP-10, Syntin and beryllium;
    lithium's rating rests on a search summary, not an opened page;
  - "attacks materials" is set only for fluorine, FLOX, chlorine trifluoride, the nitric acids and
    the three peroxides; wet nitrogen tetroxide, hydrazine, UDMH, ammonia, tetranitromethane,
    acetylene and molten lithium were not added;
  - "lights on contact" is unknown for oxygen difluoride, nitrogen trifluoride, nitrous oxide,
    tetranitromethane and ozone, and for acetylene, the boranes, the metals, cyanogen,
    nitromethane, and hydrogen with the nitric and tetroxide family.
  Where sources disagreed, the first-named figure was taken (aniline's toxicity, five freezing
  points).
- **Nitrous oxide is modelled from gas data** (ruling 7): a percent or two high.
- **The fitted gas's exit pressure reads 12–25% high.** One gamma and one molar mass reproduce the
  solver's efficiency and characteristic velocity, not its exit pressure, so a separated jet tears
  off later in the bell than it should.
- **No ions.** The species list has none. In the hottest flames (fluorine and hydrogen, near
  5,000 K) a little of the gas would be ionised; that is left out.
- **Melting points hold both phases** (ruling 2), and where the flow crosses sonic three times the
  first crossing is taken, reading characteristic velocity up to 0.36% high (ruling 5).
- **Exits colder than 200 K are frozen flow** (ruling 8): nothing condenses in the exhaust below
  200 K, and the last stretch of expansion is a little off.
- **An over-cold chamber reads "no answer"** rather than flame-out (ruling 3). The slider never
  reaches it for an ordinary pair.
- **Kerosene, the hydrazines and the boranes never flame out at the fuel-rich end.** At equilibrium
  they fall apart and give off heat with almost no oxidiser, so that end of the slider runs cool
  (RP-1 at 0.055 : 1 reads 859 K) but does not go out. Real engines there would leave unburned
  fuel and soot. Only the oxidiser-rich end flames out for them; hydrogen flames out at both.
- **Hydrazine alone runs to full equilibrium**: ammonia breaks down all the way to hydrogen and
  nitrogen. Real thrusters stop that part-way over the catalyst, so the figure differs from a real
  thruster's; the note says so.
- **The solver against the tables** reads 1–4.5% higher (above). A re-picked example shows it.
- **Three-propellant engines** (lithium, fluorine and hydrogen) **and blends made by the user** are
  not done.
- **Plume colour** still comes from a hand-picked look per family, for pairs and fluids alike
  (piece 4).
- **A calculated aerospike's drawn shape** uses the full-throttle gas whatever the throttle.

### Small things deferred during review

- **Parts of the solver that work but are untested or undocumented**: the restart after a singular
  matrix; the iteration limit being per attempt (up to 300 with restarts); warm starts matching
  species by name and seeding the rest at ln(10⁻⁶); a convergence test that divides by the total
  moles with no guard if every gas is zeroed; removal of one phase of a melting pair at a band edge;
  specific heat at a two-phase point being a frozen-split hybrid (said only in a code comment); and
  `equilibrate` being one long function of about 420 lines.
- **Phase edge cases that end in "no answer", never a wrong figure**: water's ice and liquid cross
  at 273.122 K but its data ranges meet at 273.15 K, so a solve landing in that sliver cycles; a
  phase pair can form without checking the phases are neighbours (two forms of beryllium oxide);
  aluminium nitride's solid and liquid have no latent heat in the data.
- **The flow solver's guards**: the exit guard has no test; the throat bisection does not check the
  subsonic side is at the higher pressure; an area ratio between 1 and 2 starts next to the sonic
  singularity; a failed station inside the throat passes does not stop the bisection; a second
  below-floor exit after the 200 K station returns not settled (safe, untested); the cold-exit
  search assumes frozen supersonic flow at the 200 K station (uncommented); a condensing exit at a
  large area ratio is tested only through one CEA example.
- **Shared results are not frozen**: cached gases, the "not settled" result and the exhaust list on
  a result are shared by reference.
- **Tests that are weaker than they look**: the timing budgets have about 3.7 times margin and could
  fail on a loaded machine; one "same basis" test cannot fail (its second call is a cache hit); the
  fit test re-derives the simulator's formula instead of calling it; no test drives a real
  non-convergence through to the gas; the attack note is matched on its exact wording; the species
  test runs at 100 bar and area ratio 16 rather than the literal defaults; only Aerozine 50's blend
  shares are checked by value; Task 1 left `sR` untested and `hRT` checked on one species.
- **Work repeated per frame, without solving**: the verdict (and its notes) is rebuilt about five
  times a frame for a calculated engine; `simulate` still reads the propellant table for a range it
  already has; the chamber-length constant of a fuel family is read by running a solve.
- **Data and wording**: liquid fluorine and FLOX "light everything" where the source says "almost
  anything"; Jet-A inherits kerosene's facts without saying so; the freeze note reads awkwardly ("so
  it would freeze"), writes "C" for "°C", and fires for hydrogen with liquid oxygen (the spec's rule
  asks for it); the data file's notice has no licence text; a comment in `controls.ts` calls a result
  cached that is not; the fluid's richness formula is written out by hand in `gasSource.ts`; one
  test loop calls `run()` twice per temperature.
- **Small behaviour**: below a mixture of about 0.05 the slider shows three figures but results step
  in 0.01; the modified mark counts fuel and oxidiser picks left over on a propellant with no pair;
  an unknown fuel id becomes the first fuel (as the spec asks).
- **Seen in the browser at the end**: helium's exhaust reads "He 100%", not a plain name (the
  names list has no entry for it); at phone width the readout grid is wider than its column (172
  px in 145), so some labels are cut, as before this piece; the exhaust readout itself wraps and
  can be scrolled to.

## Chemistry piece: nuclear fluids against published figures

Ammonia, methane, water, carbon dioxide and helium are now worked out by the chemistry solver
(`solveFluid` in `src/physics/chem/pair.ts`, reached through `resolveGas`); hydrogen keeps its table,
because the NERVA example is pinned to it.

The published figures are Zubrin's (NIMF study, NTRS 19910012833, Table 1): a reactor at 2,800 K,
infinite expansion, carbon dioxide 283 s, water 370 s, methane 606 s, "about 93%" of those at area
ratio 100. The study states no chamber pressure and has no ammonia.

The solver directly (`rocket`, a 2,800 K chamber at 55 bar, area ratio 100, no droplet loss), in
vacuum seconds:

| Fluid | Solver | Zubrin, infinite | Share | Zubrin × 0.93 | Solver against that |
|---|---|---|---|---|---|
| Water | 363.9 | 370 | 98% | 344 | +5.8% |
| Carbon dioxide | 247.2 | 283 | 87% | 263 | −6.0% |
| Methane | 531.9 | 606 | 88% | 564 | −5.7% |

All three are more than 5% from Zubrin's area-ratio-100 figure, in different directions, so a single
93% does not hold fluid by fluid. Why, as far as the solver shows:

- **The share kept at area ratio 100 depends on the gas.** Carbon dioxide's gamma is low (about 1.13
  at the throat), so more of its heat is still in the gas at area ratio 100. Taking the area ratio
  from 100 to 10,000 at 55 bar adds 12% for carbon dioxide (247 → 276 s) and 9% for methane (532 →
  582 s); both solves settle at 10,000 (re-checked with `rocket` directly: 276.4 s and 582.4 s, exits
  at 491 K and 498 K). Water's solve settles only up to area ratio 5,000 (tried 1,000 to 10,000; from 5,500 up
  it does not settle at the exit); from 100 to 5,000 it adds 7% (364 → 389 s).
- **No pressure is stated.** At 10 bar instead of 55 every fluid dissociates a little more and gains
  1 to 3% at area ratio 100 (water 374, carbon dioxide 256, methane 538 s). Neither pressure brings
  all three to 93%.
- **Water comes out above Zubrin.** At area ratio 5,000 and 55 bar, the largest at which the
  solver's water settles, it gives 389 s, already 5% above Zubrin's infinite-expansion 370 s. Beyond
  that the solve does not settle, so the solver gives no infinite-expansion figure for water to set
  beside his; how his figure was reached is not stated.
- **Methane leaves solid carbon.** About 70% of the exhaust's mass is graphite at the exit (the
  solver at 2,800 K, 55 bar, area ratio 100). In the simulator that costs a further 7% as droplet
  loss and shows the droplet note. Whether Zubrin's 606 s allows for the carbon is not stated.

On the NERVA example (38.6 bar, area ratio 100, the simulator's nozzle and combustion losses,
droplet loss applied), vacuum Isp in seconds:

| Fluid | 2,360 K (default) | 2,800 K |
|---|---|---|
| Hydrogen (table) | 819.2 | 904.1 |
| Helium | 480.5 | 523.3 |
| Methane | 424.8 | 472.5 |
| Ammonia | 398.1 | 441.1 |
| Water | 308.6 | 350.4 |
| Carbon dioxide | 208.6 | 238.5 |

The order is the one expected: hydrogen, helium, methane, ammonia, water, carbon dioxide. Helium
leaves the nozzle far below 200 K (62 K at 2,800 K and 55 bar), so its last stretch is expanded
frozen, as `rocket` does for any cold exit.
