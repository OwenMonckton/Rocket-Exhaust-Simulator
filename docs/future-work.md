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
3. **More exhaust types**, split in two:
   - **3a (built):** plain cone, dual bell and no nozzle. See "Exhaust types piece (part 3a)"
     below.
   - **3b (to do):** expansion-deflection.
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
  reactor or salt-water reaction is turned down if the swap would overheat it, a flame that a new
  energy source or propellant would make too hot for its throat runs at a lower chamber pressure,
  a spike's cells merge into more than one bell where one chamber would be wide enough to be
  unstable, and an engine given
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

### Words used below

- **CEA**: NASA's Chemical Equilibrium with Applications program, the standard tool for these
  sums. Its manual is NASA RP-1311 (Gordon and McBride); **"Example N"** is one of the worked
  sample problems in that manual, used as test cases here.
- **Isp (efficiency)**: how many seconds a kilogram of propellant could hold up its own weight;
  higher is better. "Vacuum Isp" is with no air outside the nozzle.
- **Characteristic velocity**: a measure of how well the chamber turns propellant into hot gas,
  independent of the nozzle.
- **Gamma**: how a gas's pressure rises when it is squeezed without losing heat. It sets how much
  of the heat a nozzle can turn into speed.
- **Area ratio**: the nozzle exit's area over the throat's. Bigger means the gas expands further.
- **Mixture ratio**: kilograms of oxidiser burned per kilogram of fuel.
- **Equilibrium**: the make-up the hot gas would settle to if its reactions had time to finish.
  **Frozen flow** is the opposite: the make-up is fixed and only the temperature and pressure
  change.
- **Settles**: the solver's repeated corrections stop changing the answer. A solve that does not
  settle has no answer, and the simulator shows none.
- **Warm and cold start**: a warm start begins the solver from a nearby answer already found; a
  cold start begins from a fixed general guess.
- **Tabled and calculated**: a tabled engine reads its gas from a hand-typed table (the four
  original pairs, used by the examples); a calculated one has it worked out by the solver.
- Sources named below: the **NIST** Chemistry WebBook (heat contents of substances) and **CAMEO**
  Chemicals (a US database of chemical hazards).

### What was built

- **A chemical-equilibrium solver** in `src/physics/chem/`, following CEA's method: NASA's
  property data for ten elements (`thermo.json`, `thermo.ts`), the equilibrium of gases and of
  solid and liquid products (`equilibrium.ts`), and the flow from the chamber through the throat to
  the nozzle exit (`rocket.ts`).
- **The fitted gas.** The solver's flame temperature, characteristic velocity and vacuum Isp for
  the engine's own pressure, mixture and area ratio are handed to the simulator as one simple gas
  (one gamma, one molar mass) that reproduces them (`fitGas` in `pair.ts`). So the nozzle maths,
  the flow view, separation and the aerospike are unchanged. Results are kept, so the solver does
  not run again each frame for inputs that have not changed. (Some work around it is still repeated
  each frame, and swapping a part runs one solve to read a fixed figure: see the small things
  below.)
- **Two pickers** for a combustion chamber: 30 fuels (two of them meant to run alone: nitrous
  oxide and 90% hydrogen peroxide) and 16 oxidisers plus "None (fuel alone)", grouped into
  everyday, storable and exotic, with hover text (`ingredients.ts`). Every fact about an
  ingredient carries a source string.
- **The mixture slider** spans each pair from where the flame cools to 700 K on the fuel-rich side
  to the same on the oxidiser-rich side, kept between a fiftieth and fifty times the most
  efficient ratio, and starts at the most efficient (`pairRange`). Its ends are judged from a cold
  start, where a solve after a reload or a shared link begins; where the far side of 700 K gives no
  answer, the end is the last mixture that settled; and it never goes below 0.01, the finest mixture
  the solver tells apart. Where the most efficient ratio lies at the top of the scan that looks for
  it, the slider is held at 100 : 1 and opens with the starting mixture at its top end (six pairs).
  The ends are judged at 70 bar and area ratio 40; at other pressures and nozzles an end can still
  give no answer. At the starter engine's 100 bar and area ratio 16, 12 pairs do: at the fuel-rich
  end lithium with white fuming nitric acid and with tetranitromethane, and beryllium with oxygen,
  with nitrogen tetroxide and with MON-25; at the oxidiser-rich end diborane with FLOX-70, 75%
  ethanol, Jet-A and propane with IRFNA, Jet-A with nitrogen tetroxide, MMH with white fuming nitric
  acid and nitromethane with oxygen.
- **Whether it works** (`verdict.ts`): four new failures shown on screen, and warnings beside the
  pickers (needs an igniter or lights on contact, one propellant freezing the other, attacks
  engine materials, toxic propellant or exhaust, droplets or soot, hydrazine alone). The four
  failures:
  - **flame-out**, when the flame would be below 800 K. The engine stays whole and can be
    relit. Its figures stay on screen: they are real answers, for a gas too cold to keep burning;
  - **detonation**, for liquid ozone, tetranitromethane and acetylene, which destroys the engine;
  - **nothing to burn it with**, a fuel with no oxidiser that cannot break down by itself;
  - **no answer**, when the solve does not settle.
- **No figures without an answer.** For the last two, every figure shows a dash and the limit bars
  are hidden.
- **The exhaust readout**: what leaves the nozzle, by share of molecules, in plain names.
- **The nuclear fluids** other than hydrogen come from the solver (see the next section).
- **Share links** in a new `v3` format carry fuel, oxidiser and mixture; `v1` and `v2` links open
  as before.
- **The examples are untouched.** All twelve keep their pinned figures. An example's tabled pair
  shows in the pickers; changing either picker makes the engine calculated and marks it modified,
  and Reset brings the table back.

### Joined with the first piece's later fixes

After this piece branched off, three review fixes were made to the first piece: a propellant
change now turns an engine down where the new propellant would overheat it, an engine throttled
down keeps its real pressure when given a solid motor, and choosing a whole engine clears the
wreck of the last one. Joining the two, the same rule was carried to the new pickers: picking a
hotter fuel or oxidiser turns the chamber pressure down, with the wall thinned to match, where
the new flame would burn through an engine the old one did not (beryllium with fluorine on the
blank engine at 200 bar comes down to about 136 bar). The mixture slider keeps the first
piece's fix that an arrow key always moves it for a tabled propellant or a temperature; a
calculated pair's slider is still spread by ratio over a thousand positions. Which exhaust is
"light" enough to need the simpler treatment of a separated jet is now read from the calculated
gas, not from a table.

### Decisions made during the build, in order

Each was a choice the plan did not settle. What it costs if it was the wrong choice follows it.

1. **The four solver-against-table figures are recorded here, not printed by a test** (they are
   below), so that the test output stays clean. If wrong: the figures were seen at the end of the
   build instead of when the test was written.
2. **A product sitting on its melting point holds both phases.** The plan said to keep whichever
   phase (solid or liquid) was in hand; on CEA's Example 13 that put the throat 265 K out and
   depended on where the solver started. CEA's own rule (RP-1311 section 3.5) replaced it: when
   switching phase would undo the previous switch at the same point, both phases are kept and the
   temperature is held at the melting point. If wrong: more solver work, and a throat search that
   must cope with the gas behaving oddly there (gamma near 1).
3. **A state colder than 200 K reports "no answer".** NASA's data stops at 200 K; below it every
   figure is stretched past its data, and solid and liquid products cannot be checked. A
   beryllium-rich mixture had "settled" at 23 to 86 K. If wrong: a mixture that is simply very cold
   reads "no answer" instead of flame-out. The slider stops at 700 K, so ordinary pairs never get
   there.
4. **Four additions to the flow solver stand**: one cold-start retry of a failed warm start;
   off-centre trial points in the throat search; an exit search that cannot step back upstream of
   the throat; and the previous answer's pressure ratios used as first guesses. Each makes a result
   independent of where the solver started, or stops a step that makes no physical sense. If wrong:
   extra code with little effect.
5. **Where the flow passes the speed of sound three times around a melting point** (11 of 288
   beryllium mixtures tried), the throat is taken at the first crossing, not where the most gas can
   pass, as CEA's own method does. Characteristic velocity reads up to 0.36% high there. If wrong:
   a third of a percent on rare beryllium mixtures. (Superseded in the final review: the iteration
   could stop on the later crossing, 4 to 7.5% high, so stations between chamber and throat are now
   checked and the first crossing is found; see the list at the end of this section.)
6. **One kilogram of hydrogen per eight of oxygen is 1.984 hydrogen atoms per oxygen atom**; the
   plan's test figure was twice that, a slip in the plan. No cost.
7. **Nitrous oxide (both entries) is modelled from NASA's data for the gas**; no cited figure for
   the liquid was found. Its heat content is overstated by the heat needed to boil it (about 16
   kJ/mol of 82), so its efficiency reads a little high. If wrong: a percent or two on nitrous
   pairs.
8. **The 200 K floor applies to the chamber and the throat only.** An exit colder than 200 K is
   reached by frozen flow: equilibrium while the gas expands down to 200 K, then the make-up and
   the gas's heat capacity are held fixed out to the exit. Without it, helium in NERVA's nozzle
   (exit near 60 K) and any hydrogen-rich pair in a big nozzle would read "no answer". If wrong: a
   small error in the last few percent of expansion for cold exits, and condensation below 200 K is
   not modelled.
9. **Picking a pair must take well under half a second.** Met when written: the slowest pair
   measured (aluminium slurry with oxygen) went from about 1 s to about 150 ms. Since the slider's
   ends are judged from a cold start it is slower: over all 480 pairs the median is about 94 ms and
   the 95th percentile about 210 ms, and eight pairs, all aluminium slurry, take over 300 ms; the
   slowest, aluminium slurry with IRFNA, takes about 550 ms the first time it is picked, so the page
   pauses for about half a second. Accepted.
10. **A solid or liquid product outside its temperature range is dropped and the point solved
    again, and a solve starts warm only from a nearby state.** Warm-started from a distant state,
    aluminium slurry with oxygen had settled at 2,009 K holding a solid far outside its range,
    where a cold start gives 3,955 K. If wrong: a few more cold starts, a little slower.
11. **Picking "calculated" sets the mixture to the pair's most efficient** (a change to `store.ts`
    made with the solver hookup). Without it, picking Calculated flamed out at once. No cost was
    named.
12. **The fuel and oxidiser pickers do nothing unless the engine burns a pair.** They are shown
    only for a combustion chamber, and quietly turning a reactor into a combustion engine would be
    a surprise. No cost.
13. **"Nothing to burn it with" hides the figures too**, as "no answer" does: no calculation
    produced them; they came from a cold stand-in gas. No cost.

### What the solver reads against the tables

The same engine, tabled and calculated (70 bar, area ratio 16, each table's own mixture ratio,
vacuum Isp in seconds, the simulator's usual losses applied to both):

| Pair | Mixture | Table | Solver | Difference |
|---|---|---|---|---|
| RP-1 and oxygen | 2.36 | 311.7 | 322.5 | +3.49% |
| Hydrogen and oxygen | 6.0 | 408.3 | 412.5 | +1.03% |
| Methane and oxygen | 3.6 | 326.0 | 332.8 | +2.08% |
| UDMH (unsymmetrical dimethylhydrazine) and nitrogen tetroxide | 2.6 | 296.0 | 309.4 | +4.50% |

Measured twice, the same to the hundredth. The solver is ideal equilibrium flow, and the tables
were tuned to real engines' published figures. The likely cause of the gap, not measured, is that
real engines lose a few percent more than the simulator's own losses allow for (burning not quite
finishing, reactions not keeping up in the nozzle). So **an example whose fuel or oxidiser is
re-picked**, even back to the same one, becomes calculated and reads higher than its stock self:
the Merlin 1D goes from 283 to 295 s at sea level (+4.1%), with its mixture moved from 2.36 to the
solver's most efficient, 2.76. It is marked modified, and Reset returns it to the table.

### What was left

- **Ingredients left out for want of a sourced heat content:** liquid chlorine pentafluoride (NIST
  has data for the gas only), turpentine (no record; a mixture anyway), hydrazine hydrate and so
  UH25 (75% UDMH, 25% hydrazine hydrate; not found by name, registry number or formula), and solid
  beryllium hydride (no data for the solid).
- **Facts left unset for want of a source**, so no note appears for them:
  - freezing and boiling points for gasoline, Jet-A, JP-10, Syntin, beryllium, the aluminium
    slurry and every blend: 75% ethanol, Aerozine 50 (half hydrazine, half UDMH), MON-25
    (nitrogen tetroxide with 25% nitric oxide), FLOX-70 (70% fluorine, 30% oxygen), IRFNA
    (inhibited red fuming nitric acid) and 98% peroxide; RP-1 (the source gives only a bound and
    a range); pentaborane's boiling point (a range);
  - toxicity for liquid ozone, oxygen difluoride, nitrogen trifluoride, perchloryl fluoride and
    nitrous oxide (unrated in CAMEO), and for 75% ethanol, gasoline, JP-10, Syntin and beryllium
    (Aerozine 50, FLOX-70, MON-25 and IRFNA take their most toxic component's rating);
    lithium's rating rests on a search summary, not the database page itself;
  - "attacks materials" is set only for fluorine, FLOX, chlorine trifluoride, the nitric acids and
    the three peroxides; wet nitrogen tetroxide, hydrazine, UDMH, ammonia, tetranitromethane,
    acetylene and molten lithium were not added;
  - "lights on contact" is unknown for oxygen difluoride, nitrogen trifluoride, nitrous oxide,
    tetranitromethane and ozone, and for acetylene, the boranes, the metals, cyanogen,
    nitromethane, and hydrogen with the nitric and tetroxide family.
  Where sources disagreed, the first-named figure was taken (five freezing points); aniline's
  toxicity is CAMEO's (health 3), one step above the HSDB figure first used. Syntin is a mixture of forms of one molecule in reality; it is modelled as one of them
  (the trans form), as its source string says.
- **Nitrous oxide is modelled from gas data** (decision 7): a percent or two high.
- **The fitted gas's exit pressure reads 12–25% high.** One gamma and one molar mass reproduce the
  solver's efficiency and characteristic velocity, not its exit pressure, so a jet tears off the
  nozzle wall later in the bell than it should.
- **No ions.** Electrically charged molecules are left out of the solver's list. The one CEA
  example that includes them (Example 11, lithium and fluorine) still came within 0.24% on
  characteristic velocity and 0.07% on Isp.
- **Melting points hold both phases** (decision 2), and where the flow passes the speed of sound
  three times the first crossing is taken (decision 5): checked against a scan of the mass flux for
  beryllium and peroxide at 5 bar, it lands within 0.1% of the greatest flux.
- **Oxidisers that give off heat breaking down, or burn hot with little fuel,** are held at fifty
  times the default mixture and do not flame out at the oxidiser-rich end: nitrous oxide, both
  peroxides and MON-25, and also tetranitromethane (28 fuels, 2,225–2,378 K there), ozone (28
  fuels, 2,624–2,887 K), oxygen difluoride (14 fuels, up to 1,355 K) and perchloryl fluoride (16
  fuels, up to 1,370 K). At that end they are still hot at equilibrium (kerosene with 90% peroxide
  at 400 : 1 runs at about 1,090 K). About 60 further pairs (with IRFNA, FLOX-70, oxygen
  difluoride, perchloryl fluoride and some with fluorine) end at the last mixture that settled, at
  886–1,263 K, neither flamed out nor at the hold.
- **Perchloryl fluoride and cyanogen still get the freeze note**: perchloryl fluoride with seven
  fuels that freeze above about −52 °C, cyanogen with 90% peroxide, nitrogen tetroxide and
  tetranitromethane. Both are kept liquid by pressure at room temperature, like nitrous oxide and
  propane (cyanogen's critical point is about 127 °C), but neither is marked as such: no sourced
  critical temperature was found for perchloryl fluoride (NIST lists none), and cyanogen's was not
  added.
- **The cold-start ends moved the fuel-rich end of every lithium and beryllium pair.** All 32 now
  start hot, at 2,400–3,980 K, where a chamber solve started from scratch stops settling, though one
  walked down from a neighbouring mixture still does. 24 of them start later than before: with
  lithium, every oxidiser but fluorine, FLOX-70, ozone and oxygen difluoride (nitrogen tetroxide
  1.0 : 1, was 0.53; tetranitromethane 1.08, was 0.29; 90% peroxide 0.72, was 0.38); with beryllium,
  every oxidiser but oxygen, nitrogen tetroxide, MON-25 and ozone (90% peroxide 0.85, was 0.115;
  fluorine 1.14, was 0.64; chlorine trifluoride 1.66, was 0.93). The other eight start a little
  earlier. Aluminium slurry with oxygen starts at 0.098 (was 0.036), with chlorine trifluoride at
  0.197 (was 0.062).
- **Some mixtures inside a slider give no answer**, between neighbours that settle. Lithium with
  oxygen has a band from about 30.8 : 1 to 37.9 : 1 at 70 bar and area ratio 40 (30.2 to 37.9 at
  100 bar and 16). Single positions near the oxidiser-rich end do too: ethanol with IRFNA (15.7),
  ethane with IRFNA (32.1), Aerozine 50 with IRFNA (15.75), aniline with nitrogen tetroxide (48.8),
  and ethanol, gasoline, propane, ethane and syntin with perchloryl fluoride (128 to 214); these
  were the same before the final review. Beryllium with oxygen (1.80) and with ozone (1.85) miss
  one position each at 100 bar and 16. Pentaborane with nitrogen tetroxide at 79.7 : 1, 100 bar
  and area ratio 16, misses because its exit lands in the 273.122–273.15 K sliver where water's
  ice and liquid data disagree (see the phase edge cases below); it settled before the coldest
  solid phases were kept down to 200 K, which moved its exit there; it misses at 30 bar and area
  ratio 150 too. In a big nozzle at low pressure (30 bar, area ratio 150) the fuel-rich ends of
  the borane pairs, mixture ratios about 0.04 to 0.24, give no answer, and so do a few
  oxidiser-rich positions: aluminium slurry with fluorine at 71.7 and 86.2, pentaborane with
  fluorine at 125 and 151, diborane with 90% peroxide at 78.65, among others found in a sample of
  the metal and borane pairs (aluminium slurry with oxygen at 22 to 49, beryllium with oxygen at 75
  and 84). Hydrogen with oxygen at its oxidiser-rich end (140 : 1) gives no answer at area ratio
  300.
- **The fitted gas's gamma still steps at area ratio 3** for an exhaust with droplets (1.13 below,
  1.31 above, aluminium slurry with oxygen), and changes where the fit falls back for a reactor
  fluid (methane at area ratio 10). Isp and thrust do not step: what the one-gamma gas cannot carry
  of the solver's Isp is passed on as one thrust factor. Exit pressure and exit Mach readouts do.
- **The exhaust-names guarantee is a sample for gases.** Every liquid and solid in the data has a
  name, checked against the data itself. For gases, a test names every gas that sweeps of every
  pair across its slider (13 mixtures, five engines) have met, 85 of the 427, and a 6 s sweep of
  about 280 pairs around each one's balanced mixture (from the ingredients' valences, at 0.3 to 1.8
  times it, in two engines) guards the common ones. A gas met nowhere in those reads as its
  formula, tidied (AlCl rather than ALCL).
- **Exits colder than 200 K are frozen flow** (decision 8): condensation below 200 K is not
  modelled, and the last stretch of expansion is a little off.
- **An over-cold chamber reads "no answer"** rather than flame-out (decision 3). The slider never
  reaches it for an ordinary pair.
- **Some fuels never flame out at the fuel-rich end.** Read in the browser: RP-1 with oxygen at its
  fuel-rich end (0.055 : 1) runs at 859 K and does not go out, while its oxidiser-rich end
  flames out; hydrogen flames out at both ends. At equilibrium kerosene falls apart and gives off
  heat with almost no oxidiser. The hydrazines and boranes should behave the same for the same
  reason (found while planning), but were not read in the browser. Real engines there would leave
  unburned fuel and soot.
- **Hydrazine alone breaks down as far as equilibrium allows**: at the default about a quarter of
  the exhaust is still ammonia (read in the browser: hydrogen 45%, nitrogen 29%, ammonia 26%).
  Real thrusters stop the breakdown of ammonia earlier, over the catalyst, so the figure differs
  from a real thruster's; the note says so.
- **The solver against the tables** reads 1–4.5% higher (above). A re-picked example shows it.
- **Frame rate on a real display was never measured.** The final browser checks ran with the
  browser pane hidden, where the page drew one frame a second, so they ran under a stand-in 16 ms
  timer. The only figures are the main-thread work per frame: 0.39 ms for a tabled engine against
  0.41 ms for a calculated one while firing, and at worst 8.9 ms while dragging the mixture slider
  every frame. Time spent by the graphics card was not measured.
- **Three-propellant engines** (lithium, fluorine and hydrogen) **and blends made by the user** are
  not done.
- **Plume colour** still comes from a hand-picked look per family, for pairs and fluids alike
  (piece 4).
- **A calculated aerospike's drawn shape** uses the full-throttle gas whatever the throttle.

### Found and fixed in the final review

- A solid or liquid product was deleted where the exit cooled below 300 K, the start of most of
  NASA's solid data, so lean lithium and beryllium mixtures lost Isp as the nozzle grew; the coldest
  phase of a substance is now kept down to 200 K, as the gases already were.
- Steam meeting its own liquid or ice gave no figures (or nonsense heat capacities) at the cool end
  of the water reactor's slider with a vacuum nozzle; the derivatives there are taken with the
  make-up frozen, and the water sweeps now all settle.
- Where the one-gamma gas could not carry the solver's Isp (area ratios below 3, droplet-laden
  exhausts, reactor methane), the simulator showed 5 to 13% too much and Isp stepped down as the
  nozzle grew; the remainder is now carried as one thrust factor.
- The throat could be taken on the later of two sonic points near a melting product (4 to 7.5%
  high on characteristic velocity); the first is now found.
- An exit guess landing on vapour colder than 200 K made peroxide alone fail at 70 bar (and water
  at large area ratios); the exit is now walked to from the warmest station first.
- Relight or Rebuild threw away a correction made while the failure box was up; the engine as it
  stands is kept when it would run.
- The freeze note fired for propellants kept liquid by pressure and for near-equal temperatures,
  and did not say which one freezes.
- The four blends carried no toxicity; aniline's was a step low.
- A reactor fluid's droplet note was never shown; it is now under the Propellant picker.
- Flames hotter than 6,000 K, the top of the data, now carry a note.
- An engine that never lit showed a flame for 0.6 s first; a detonation's line under the limit bars
  said the chemistry would not settle; fuels named "... alone" kept the word beside an oxidiser.
- About 70 species had no plain name; every liquid and solid in the data now has one, and a sweep
  of every fuel and oxidiser guards the rest.
- The data's licence text was missing; it sits beside the notice, and the README names the data.
- The slider's ends could sit where only a solve walked in from a neighbouring mixture settled, below
  0.01, or with the hottest mixture off the slider; see the slider entry above.
- Tests that could not fail were made real, a real unsettled solve is now driven through to the
  hidden figures, and the reactor-fluid test is named for what it pins. The hold of peroxide at fifty
  times its best mixture, still hot there, is pinned, and the ends tested for hydrogen and
  kerosene with oxygen must flame out, not merely fail to settle.
- A reactor's failure box spoke of relighting beside a button that reads "Restart engine"; the
  button and, later, the text now say restarting.
- Keeping the coldest solid down to 200 K made three borane pairs give no answer over bands of
  oxidiser-rich mixtures (diborane with nitrogen tetroxide at 65–72 : 1, pentaborane with oxygen at
  51.5–59, with nitrogen tetroxide at 58.25–68.5): boric oxide, metaboric acid and ice, all kept
  below 300 K, are made of the same two building blocks, so holding all three made the sums
  singular. A solid or liquid built from those already held now takes the place of the one it uses
  up first; the three bands settle as before (992, 1,040 and 1,058 K at the points first seen).
- The fix for steam over its own liquid treated any equilibrium gamma at or below 1 as nonsense and
  put frozen values in its place; such a gamma is real where a vapour sits over its own liquid
  (lithium oxide and hydroxide), and the throat moved off the greatest mass flux, giving lithium
  with peroxide above about 150 bar a characteristic velocity up to 2.6% high. Frozen values are now
  used only where the derivative solve fails or gives a heat capacity absurdly large against the
  frozen one. Such a state can still serve as a nozzle exit, but no longer as a throat: where two
  condensates together (liquid lithium with liquid lithium oxide, say) left the throat on frozen
  values, the throat sat where the speed meets the frozen sound speed and characteristic velocity
  read high as a settled figure (lithium with oxygen at 0.65 : 1 and area ratio 16: 5% at 300 bar,
  18% at 400; lithium with fluorine at 0.48 : 1, 4% at 100 bar; beryllium with oxygen at 0.78 : 1,
  10% at 300 bar). The cost: fuel-rich lithium and beryllium mixtures, at very high pressure and
  some at ordinary pressure, read "No answer". The fuel-rich ends of three sliders moved in
  (lithium with fluorine from 0.48 to 0.96 : 1, beryllium with oxygen from 0.78 to 1.10, with
  nitrogen tetroxide from 1.11 to 1.28); on a 3,000-point sample of the metal and borane pairs, 24
  points went from settled to no answer, every one with its throat on frozen values and none at a
  pair's starting mixture, and no settled figure moved.
- Four gases were still shown by their data names (aluminium monochloride, beryllium
  monohydroxide, chlorotrifluoromethane, difluoroboric acid); Li3AlF6 was called cryolithionite,
  which is another mineral. The 30 s names sweep became the 6 s one above.
- The detonation line said "one of these propellants" with one propellant picked; lithium beside a
  propellant stored at ordinary temperature read as if that propellant were kept cold.
- The data notice and the licence were not part of the built site; they are now copied into it.

### Small things deferred during review

- **Parts of the solver that work but are untested or undocumented**: the restart when its sums
  cannot be solved at a step; the step limit counting per attempt (up to 300 steps with
  restarts); a warm start matching products by name and starting any others at a tiny trace; a
  convergence check that divides by the total amount of gas with no guard if it is zero; dropping
  one phase of a melting pair at the edge of its range; the heat capacity at a melting point being
  a mix of two methods (said only in a code comment); and `equilibrate` being one long function of
  about 420 lines.
- **Phase edge cases that end in "no answer", never a wrong figure**: water's ice and liquid swap
  at 273.122 K but its data ranges meet at 273.15 K, so a solve landing exactly in that sliver could
  go round in circles (none was met in the final review's water sweeps, which now all settle, but one
  pentaborane exit lands there: see the mixtures with no answer above); a pair of phases can form without checking they are next to each other (two forms of
  beryllium oxide); aluminium nitride's solid and liquid have no melting heat in the data.
- **The flow solver's guards**: the exit guard has no test; the throat search does not check its
  slower side is at the higher pressure; an area ratio between 1 and 2 starts very close to the
  throat, where the sums are touchy; a failed point inside the throat search does not stop it; a
  second too-cold exit after the 200 K point returns "no answer" (safe, untested); the cold-exit
  search assumes the gas is faster than sound at its 200 K point (not commented); an exit where
  products condense, at a large area ratio, is tested only through one CEA example.
- **The mixture and the slider's range**: the function that builds a mixture accepts a negative or
  missing ratio (a ratio of −1 divides by zero); the callers guard against it. A comment in
  `pair.ts` overstates how close a warm start must be in `pairRange`.
- **Shared results are not locked**: kept results, the "no answer" result and the exhaust list on a
  result are the same objects everywhere they are used, so one careless change would alter all.
- **Tests that are weaker than they look**: the timing limits have about 2 times margin (finding
  aluminium slurry and oxygen's mixtures takes about 280 ms against a 600 ms limit) and could fail
  on a loaded machine; the fit test re-derives the simulator's formula instead of calling it;
  the "attacks materials" note is matched on
  its exact wording; the exhaust-names sweep runs at 10 bar and area ratio 3 and at 30 bar and
  area ratio 150 rather than the defaults; only Aerozine 50's blend shares are checked by value; one of the property-data
  functions (entropy) has no test of its own and another (heat content) is checked on one
  substance only.
- **Work repeated each frame, with no solving**: the verdict and its notes are rebuilt about five
  times a frame for a calculated engine; `simulate` still reads the propellant table for a range it
  already has. Swapping a part runs one solve only to read a fixed figure for the fuel family (how
  long a chamber it needs).
- **Data and wording**: liquid fluorine and FLOX "light everything" where the source says "almost
  anything"; Jet-A inherits kerosene's facts without saying so; a comment in `controls.ts` says the
  notes cost nothing because "the result is cached", but only the solver's result is kept and the
  notes are rebuilt each time; the fluid richness formula is written out by hand in `gasSource.ts`;
  one test loop runs the simulation twice per temperature.
- **Small behaviour**: below a mixture of about 0.05 the slider shows three figures but results step
  in 0.01 (it no longer goes below 0.01); the modified mark counts fuel and oxidiser picks left over on a propellant with no pair;
  an unknown fuel id becomes the first fuel (as the design asks).
- **Seen in the browser at the end**: at phone width the readout grid is wider than its column (172
  px in 145), so some labels are cut, as before this piece; the exhaust readout itself wraps and can
  be scrolled to. Helium's exhaust read "He 100%"; it now reads as a plain name. Frame rate on a real
  display was not measured (see "What was left").

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
  582 s); both solves settle at 10,000 (re-checked with `rocket` directly: 276.4 s and 582.4 s,
  exits at 491 K and 498 K). Water's solve also settles out to 10,000 since the final review (it
  once stopped at 5,000); from 100 to 10,000 it adds 8% (364 → 391 s).
- **No pressure is stated.** At 10 bar instead of 55 every fluid dissociates a little more and gains
  1 to 3% at area ratio 100 (water 374, carbon dioxide 256, methane 538 s). Neither pressure brings
  all three to 93%.
- **Water comes out above Zubrin.** At area ratio 10,000 and 55 bar the solver's water gives 391 s,
  already 6% above Zubrin's infinite-expansion 370 s; how his figure was reached is not stated.
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

## Exhaust types piece (part 3a): what was built and what was left

The design is in `docs/superpowers/specs/2026-11-23-more-exhaust-types-design.md`. Part 3 was split:
the plain cone, the dual bell and the engine with no nozzle were built here; expansion-deflection
(part 3b) is still to do.

### Words used below

- **Exhaust type**: how the engine turns hot gas into a jet. Before this piece there were two, the
  bell and the aerospike.
- **Kink**: the sharp corner in a dual bell's wall where its short inner bell opens into the wider
  outer one.
- **Low mode and high mode**: near the ground a dual bell lets its jet go at the kink and runs as
  the small inner bell ("held at the kink"; the state `'held'` in the code). Higher up the jet
  snaps out to fill the whole bell.
- **Mach number**: speed over the local speed of sound. A nozzle's throat is where it reaches 1.
- **Total pressure**: the pressure the gas would reach if it were brought to a stop without loss.
  Smooth flow keeps it; a shock, or a sharp corner that the solver smears out, loses some, and what
  is lost cannot be turned into thrust.
- **The engine grid and the plume grid**: the two gas simulations, one inside the engine from the
  injector to the exit, one for the plume outside (see "One solver, two connected grids" above).
- **Lit from cold**: the engine is chosen while it is not firing, then Fire is pressed, so the gas
  simulation starts from still, cold gas and lights up over its first 60 frames.

### What was built

- **Three new exhaust types**, each described by one record in `src/physics/exhausts.ts`: its name
  and hover text, what the count slider counts, whether it has a nozzle wall, whether an extension
  fits, and which shape sliders it shows.
  - **Plain cone**: the wall turns out of the throat along a short arc, then runs straight at the
    cone's half-angle (8 to 30 degrees, opening at 15) to the exit. The gas leaving it fans out, and
    only the part of its speed pointing straight back pushes: at 15 degrees that costs about 1.7%
    of the momentum thrust against a perfect nozzle, at 30 degrees about 6.7%.
  - **Dual bell**: a bell to the kink, then a second, wider bell that leaves the kink more steeply.
    A new slider, "Inner bell exit", sets the kink's width; it opens at the square root of the full
    area ratio. In low mode the engine runs as the inner bell, less a little suction on the outer
    bell's wall (taken as 5% below the outside pressure). In high mode it runs as the full bell, less
    1.5% of its momentum thrust for the imperfect shape. The switch comes where an ordinary bell of
    the full size would just hold its jet, with no lag either way.
  - **No nozzle**: the engine ends at the throat. The gas leaves at the speed of sound at a little
    over half the chamber pressure, far denser than any outside air, and balloons out as it leaves.
    Efficiency is about a quarter to a third lower than with a good nozzle. The exit diameter
    setting is kept, unused, so choosing a nozzle again brings it back.
- **The readout "Nozzle exit vs outside air"** says which mode a dual bell is in, in plain words.
- **Swapping between a bell, a cone, a dual bell and no nozzle** keeps the engine as it is: only
  the nozzle changes. A nozzle extension stays a bell's alone and is dropped on leaving one.
- **Share links** in a new `v4` format carry the cone angle and the kink. Links in `v1`, `v2` and
  `v3` open as before.
- **The drawing and both gas simulations** follow each contour. A dual bell's held jet leaves the
  wall at the kink by the mechanism already built for a jet torn off an ordinary bell, and is drawn
  steady, without the wobble a torn-off jet has. The figures worked out from the simulated gas are
  shown for a cone, for no nozzle and for a dual bell in high mode; for a held jet only with the
  plume simulated too, as for a torn-off one.
- **The measuring tool** (`src/dev/accuracy.ts`) takes any engine, not only an example
  (`built(energy, exhaust)` gives the engine the app opens on with those two parts). It reads cones,
  dual bells and engines with no nozzle, follows a solid motor's grain as the app does, gives a
  held or torn-off jet its separation point as the app does, and has `exhaustTable()` for the 24
  cases below and `lightUp(...)`, which counts bad cells every few frames as an engine lights.

### Decisions made during the build, in order

Each was a choice the plan did not settle. What it costs if it was the wrong choice follows it.

1. **The dual bell's thrust drops by about a tenth at the switch, not by 3.5%.** Measured: 11.9%
   for the starter engine's kerosene and oxygen at 60 bar, area ratio 100, kink at area ratio 10.
   The design first said 3.5%, but that figure compared two rows of its table that are not either
   side of the switch. The moment the jet fills the big bell it is as over-expanded as it will ever
   be, so the drop is large; real dual bells dip at the switch too. The design was corrected, and
   the test allows up to 15%. If wrong: the dip on screen is larger than a real engine's.
2. **A link naming an exhaust type this version does not know opens as a bell**, with the rest of
   the engine as the link gives it. That is for `v4` links only; `v2` and `v3` links naming an
   unknown type are still refused, as before. If wrong: a link from a later version opens as a
   slightly different engine instead of not opening at all.
3. **With no nozzle, the chemistry solver's exit is the throat it has already found**: one guarded
   branch in `src/physics/chem/rocket.ts`, for an area ratio of 1. If wrong: none seen; every pair
   that settles with a bell settles with no nozzle (a test checks this).
4. **Swapping between two exhausts that count chambers is `sanitize` alone**: the dimensions, the
   chamber count, the pressure and the wall are all kept. If wrong: a swap could leave an engine
   nearer a limit than it was; the cone and no nozzle change no limit, so this has not been seen.
5. **`wholeNozzleFlow` takes its radius from the gas's own exit diameter**, not the nozzle's. With
   no nozzle that is the throat; before, the plume was handed the unused exit diameter. No cost.
6. **The still gas in an unlit engine is held to at most 3% of chamber pressure** (found in this
   check; `engineRestPressure` in `src/render/plumeParams.ts`). The gas simulation cannot start from
   a true vacuum, so in thin air the engine begins full of cold gas at 30% of the pressure its gas
   will leave at. With no nozzle that pressure is about half the chamber's, so the engine began full
   of cold gas ten times as dense as its flame. A reactor's wide chamber with no nozzle then took
   well over a thousand frames to push it out, and all that time the simulated figures were far out
   (seen in the browser: two minutes after lighting at 12 frames a second, thrust within 1% but Isp
   still 27–44% low and flow 36–79% high). With the limit the same engine's simulated figures came within
   3% of the readouts about 75 seconds after lighting at 12 frames a second (about 900 frames), at
   sea level and in vacuum. Every example and every ordinary bell is unchanged (a test checks the
   examples): the limit only bites where the gas leaves at more than a tenth of the chamber pressure
   (area ratios below about 2). If wrong: none seen in the 24 cases; the limit is still far above
   what the solver needs, which is something above a true vacuum.
7. **The measuring tool waits for the graphics card every five frames.** Run flat out, hundreds of
   frames of work piled up before anything was read back, and on a slow card the browser took that
   for a hung card and reset it. Every cell then read as zero, and the tool reported every cell
   "gone wild" for the rest of that run and every later one (it now starts afresh). The app gives the card one frame at a time and is
   not affected. No cost but time.

### What was measured, lit from cold

Each energy source with each new exhaust type, on the engine the simulator opens on (100 bar,
throat 20 cm, exit area ratio 16; kerosene and oxygen for the flame, a solid motor's own propellant,
a reactor heating hydrogen, salt water), at sea level and at 100 km: 24 cases. Measured with
`exhaustTable()` in `src/dev/accuracy.ts` on an Intel UHD 730 graphics chip, against
one-dimensional nozzle theory for the same idealised gas: so this shows the equations are solved
correctly, not that they describe a real engine.

**No case ran away.** In none of the 24 did a cell of either grid hold something that is not a
number, and every case was steady 410 frames after lighting. The starter engine's dual bell runs
full from the ground (area ratio 16 is too small for low mode), so all of these are high mode; the
held jet was checked in the browser (below).

The engine grid on its own against theory, ranges over the four sources:

| | Cone (15 degrees) | Dual bell, high mode | No nozzle |
|---|---|---|---|
| Mass flow against ideal | 96–101% | 96–101% | 98.5–102% |
| Change in mass flow along the engine | 0.4–1.5% (reactor 6.6%) | 0.3–1.3% (reactor 7.2%) | 0.3–1.1% (reactor 9.4%) |
| Mach number at the throat | 0.98–1.03 | 0.94–1.09 | 0.97–1.07 (the throat is the exit) |
| Exit Mach number against theory | 99.4–100.1% | 98.3–99.2% | 96.6–106.5% |
| Exit pressure against theory | 98–104% | 103.5–112% | 94–108% |
| Thrust at the exit against the readout | 98.6–100.9% (salt water 96%) | 98.3–100.6% (salt water 96.4%) | 100.2–104.9% |
| Total pressure kept to the exit | 98.8–99.9% | 89–93% | 87–91% |

- **The cone is as good as a bell**: within about 2% on mass flow, Mach number and thrust and 4% on
  exit pressure, except that salt water's mass flow and thrust read 4% low. A salt-water bell reads the same (96% and 97%), so it is the
  salt-water gas, not the cone, and it was there before this piece. The reactor's flow changes by
  6.6% along the engine, as it does with a bell (7.2%): its chamber is six throats across and the
  gas in it nearly still, where this measurement is least sure.
- **The dual bell's kink costs total pressure, as a sharp corner should.** Across the corner itself
  (two columns before it to four after) 1.3–2.7% is lost; from the kink to the exit 5.5–8.8% in
  all, as the corner sends a weak shock down the outer bell. A cone keeps 99% or more. In thrust that
  comes to about a point: the dual bell's efficiency against ideal is 96.5–97% where the cone's is
  97.4–98.1%, and the model charges 1.5% for the same thing. The exit pressure reads 3.5–12% high
  because the shock leaves the gas a little less expanded than theory.
- **With no nozzle the gas is not at Mach 1 all the way across the exit, and nor is a real one.**
  The throat is a sharp-edged hole, so the gas reaches the speed of sound on a curved surface that
  bulges out past the exit: on the centreline it leaves a little slower than sound, at the edge up to
  1.3 times it. One-dimensional theory says exactly 1 everywhere, so the exit Mach number and
  pressure differ from it by up to 8%. Thrust, which is what matters, agrees with the readout to
  0.2% for the flame and 1% for salt water. For the solid motor and the reactor the engine grid on
  its own reads 4–5% high; joined to the plume grid, as the app runs it, the browser's simulated
  thrust agreed to within 3% once settled (below).

Both grids joined, as the app runs them, comparing what the plume carries with what leaves the
engine:

- **Thrust is carried to one exit radius within 2%** in every case. By four exit radii in vacuum
  it has fallen by 1–3% for the cone and the dual bell and by about 11% with no nozzle: in vacuum a
  jet leaving at the speed of sound turns through more than a right angle at the lip, and part of
  it leaves the plume grid sideways.
- **Exhaust is carried to one exit radius within 3%** in every case but one. The reactor with no
  nozzle carried only half its exhaust after 410 frames until decision 6: the cold gas it began
  with was still leaving. It now carries 97%.
- **While it lights, the reactor with no nozzle squeezes its cold gas into a thin layer** against the
  narrowing wall before the throat, briefly more than ten times as dense as the chamber's flame: 718
  cells of 18,432 at frame 200, none by frame 250 (before decision 6, up to 4,800 cells from frame
  225 to 550). None are nonsense numbers, and it clears by itself. The tool counts any cell that
  dense as "gone wild", so `lightUp` and `exhaustTable` also count cells that are not numbers at
  all, separately.

**The plume with no nozzle at sea level is very wide, and that is right.** Task 8 saw it in the
browser, and a bell with area ratio 1.1 does the same: the plume swells out at once, wider than the
view. Measured with the grid zoomed out, the edge of the exhaust is 2.3 exit radii from the
centreline half a radius downstream, 3 at one radius, 5 at three and 7.3 at eight; the same when
the engine starts already running, so it is the steady flow, not the start. The gas leaves at 58 bar
into 1 bar of air. A bell made for the ground (the starter's own, area ratio 16) would have let it
expand to 4 exit radii across inside the nozzle; set free, a jet overshoots that before the air
pinches it back.

**The fine cross-hatch in that plume is in the drawing, not the gas.** The plume grid was read back:
the part of the gas that flips from cell to cell (the sign of the two grids fighting) is 0.07% of
the density with no nozzle, against 0.02% for a bell, so there is next to none. The pattern comes
from how the plume is drawn (`src/render/plume.frag.ts`): each pixel samples the gas at 16 depths,
starting at an offset that follows a fixed fine pattern across the screen and moves on every frame.
Through a plume this deep the samples are far apart, so a single frame shows the pattern; it should
average away in motion. Task 8 saw it in a browser pane that was barely drawing, which holds one
frame for a long time.

**In the browser** all 24 cases were lit from cold with both gas simulations on, in a separate
browser with the graphics card to itself, at about 12 frames a second (a fifth of a normal
display's rate, so every time below is about five times what it would be). Every one shows the
engine, gas inside it and a plume, and none logged a console error. Twenty seconds after Fire the
simulated thrust was within 2% of the readout in 14 cases and within 3.5% in three more. The other
seven were still settling: within a minute the reactor's cone in vacuum came to 0.5% and salt
water's cone and dual bell to 3.3–4% low, at sea level and in vacuum (salt water reads 4% low with
a bell too, above). The reactor with no nozzle took two minutes and was still far out on efficiency,
which led to decision 6; since then it comes within 3% in about 75 seconds.

**The big dual bell** (the starter engine at 60 bar, area ratio 100, kink at area ratio 10), lit
from cold at sea level with both gas simulations on: the jet leaves the wall cleanly at the kink and
runs as a narrow, steady column the width of the inner bell; the outer bell stands dark and empty
around it. The readout says "Held at the kink"; thrust 284 kN, simulated 293 kN (+3.2%). Stepped up
by the altitude slider it stays held to 8.5 km (315 kN, simulated −0.5%) and at 9.3 km has snapped
out: the jet fills the whole bell and the plume leaves it as wide as the bell's mouth, with thrust
down to 282 kN (simulated −2.7%), the dip of decision 1. Brought back down to 5 km it is held again.
An Ascend sweep at this browser's frame rate climbs about 3 km a second, so it passes the switch
(8.9 km by the formula) between two readings; at 11.7 km the jet already filled the bell and by 26
km the simulated thrust had settled 2% under the readout. No console errors.

### What was left

- **No hysteresis.** A dual bell switches modes at the same altitude going up and coming down. Real
  ones switch back lower than they switched up, which stops them flapping between modes.
- **A separated ordinary bell has no penalty.** Its jet tears off cleanly and the model charges
  nothing for the side loads and roughness a real one suffers; the dual bell's advantage near the
  ground is only what the model already gave it.
- **The dual bell's constants are proposals, not fitted to a real engine**: 5% suction on the outer
  wall in low mode, 1.5% loss in high mode, the outer bell's steeper start (1.4 times its average
  slope) and its exit slope (0.6 times), and the inner bell's default size.
- **A dual bell with a huge outer bell is held near the ground at very little thrust, and the
  simulated thrust reads 0 kN there.** At area ratio 1,060 (kink at about 33) and 60 bar the
  readout gives 89 kN at sea level against 350 kN just below the switch at 26 km: the 5% suction
  acts over the outer bell's whole 33 square metres of mouth and takes about 170 kN. The gas
  simulation goes further. It measures thrust across the mouth of the outer bell, where the still air
  round the narrow jet sits a little below the outside pressure; over that much area the deficit
  outweighs the jet, and the figure, which is never allowed below zero, reads 0 (flow reads +4.7%,
  so the jet itself is there). A plain bell torn off at the same size is said to read the same; that
  was not checked. Whether a real dual bell this large would lose so much to suction is not known:
  the 5% is a proposal (above).
- **The cross-hatch drawn in a very deep plume** (no nozzle at sea level, and any very
  under-expanded jet): more depth samples, or an offset pattern that moves less visibly, would hide
  it. It is the drawing only (see the measurements above). Not changed.
- **With no nozzle the jet leaves on the centreline a little slower than sound** (0.86 of it once
  settled, for the reactor) and wavers there as the engine settles. As explained above this is what
  a sharp-edged throat does; it means the outside reaches back into the middle of the exit, which
  `outflow` in `src/render/engineSim.ts` allows for. Nothing was needed for the "exactly sonic"
  exit the design asked about; it was watched lit from cold in all eight no-nozzle cases.
- **The measuring tool's thresholds**: it counts as "gone wild" any engine cell more than ten times
  the chamber's density, which a reactor with no nozzle briefly reaches while lighting (above). The
  count of cells that are not numbers at all is the one that says a solver has run away.
- **Seen only in the tool**: a solid motor's engine with no grain (a straight combustion chamber 3 m
  long and 60 cm across, fed through its head) and no nozzle ran into nonsense in the engine grid
  about 400 frames after lighting. The app always draws a solid motor's grain, so it cannot reach
  this; with the grain, as the tool now does, it runs clean.
- **Frame rate was not measured.** The browser checks ran on a slow graphics chip at about 12 frames
  a second, so the times above (20 seconds, two minutes) are about five times what a 60-frame
  display would take.
- **Small things deferred during the reviews**:
  - `src/physics/chem/pair.ts`: the last settled result (`lastOk`) can be an area-ratio-1 result,
    which then warm-starts a solve at an area ratio of 1.1 to 1.5. That is fragile, though a failure
    falls back to a cold start. Suggested fix: do not keep it when the area ratio is 1.
  - No test drives the area-ratio-1 branch of `rocket.ts` directly, and none pins `nozzleEff`,
    including the 0.985 for a dual bell in high mode.
  - `src/physics/exhausts.ts`: the cone works out the throat arc's radius again instead of reusing
    `arcRadius`, and the dual bell's `lipSlope` repeats the outer bell's slope sum that
    `divergingWall` does.
  - `src/physics/reshape.ts`: `withExhaust` works out `heatLoad` before the early return for two
    chamber-counting exhausts and never uses it there; its comment still describes only the
    aerospike.
  - `src/state/state.test.ts`: no test that `v2` and `v3` links naming an unknown exhaust are still
    refused, or that a `v4` link of 20 entries is.
  - `src/ui/copy.ts`: the hover text for "Inner bell exit" reads awkwardly ("nearer the right size for
    the ground, less thrust is wasted low down").
  - `src/render/engineView.ts`: the comment on `wholeNozzle` still speaks of a separated jet only.
  - `PlumeParams.separated` in `src/render/plumeParams.ts` is set but nothing reads it.
  - No unit test pins the steady, unwobbled clip of a held jet in the engine view, or the wall-curve
    fit for no nozzle.
  - `src/physics/chem/pair.test.ts`, "quickly enough for a click" (600 ms limit), fails now and then
    when the machine is busy (see the chemistry piece's small things).
