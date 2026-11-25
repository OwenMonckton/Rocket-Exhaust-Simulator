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
   - **3b (built):** expansion-deflection. See "Expansion-deflection piece (part 3b)" below.
4. **Plume colour from what is in the exhaust**, replacing hand-picked colours.
5. **Electric thrusters (built):** resistojet, arcjet, gridded ion and Hall effect. See "Electric
   thrusters (part 5)" below.

### What is left from the first piece

- **An aerospike's thrust cells are drawn the same whatever feeds them.** A reactor or a solid
  motor behind an aerospike is drawn with the small combustion chambers and feed lines of the
  XRS-2200 (`src/render/aerospikeView.ts`). The gas and the figures are right for the source;
  only the picture of the cell is not.
- **Only hydrogen is still a hand-typed table among the nuclear fluids.** Ammonia, methane, water,
  carbon dioxide and helium are worked out by the chemistry solver of piece 2 (see "Chemistry
  piece: nuclear fluids against published figures" below). Hydrogen keeps its table because the
  NERVA example is pinned to it. Since piece 4 those fluids take their plume's look from their own
  exhaust (see "Plume colour piece" below).
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
- **Plume colour** came from a hand-picked look per family, for pairs and fluids alike. Piece 4
  has since worked it out from the exhaust (see "Plume colour piece" below).
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
6. **The still gas in an unlit engine is held to at most 3% of chamber pressure in thin air** (found in this
   check; `engineRestPressure` in `src/render/plumeParams.ts`). The gas simulation cannot start from
   a true vacuum, so in thin air the engine begins full of cold gas at 30% of the pressure its gas
   will leave at. With no nozzle that pressure is about half the chamber's, so the engine began full
   of cold gas ten times as dense as its flame. A reactor's wide chamber with no nozzle then took
   well over a thousand frames to push it out, and all that time the simulated figures were far out
   (seen in the browser: two minutes after lighting at 12 frames a second, thrust within 1% but Isp
   still 27–44% low and flow 36–79% high). With the limit the same engine's simulated figures came within
   3% of the readouts about 75 seconds after lighting at 12 frames a second (about 900 frames), at
   sea level and in vacuum. Near the ground the outside air is the floor, as before, and can be more
   than 3%. Every example is unchanged (a test checks them at sea level and at 100 km), and so is
   any nozzle whose gas leaves at less than a tenth of the chamber pressure: the limit only bites
   above that, at area ratios below about 2, so a very short bell starts with less still gas in it
   too. If wrong: none seen in the 24 cases; the limit is still far above
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
number. Each was read from 410 frames after lighting, four times 50 frames apart; by then every
case but one had settled. The reactor with no nozzle was still clearing the cold gas it began with,
even after decision 6: in the browser its simulated figures took about 900 frames to come within
3% of the readouts. The starter engine's dual bell runs
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
  slope) and its exit slope (0.6 times), and the inner bell's default size. The steeper start makes
  a sharp kink: the wall turns outward there by about 16 degrees at 80% nozzle length (from about 9
  degrees to 25), about 20 at 60% and about 13 at full length, whatever the area ratios. The
  total pressure lost from the kink to the exit (5.5 to 8.8%, above) follows from it.
- **A dual bell with a huge outer bell is held near the ground at very little thrust, and the
  simulated thrust reads 0 kN there.** At area ratio 1,060 (kink at about 33) and 60 bar the
  readout gives 89 kN at sea level against 350 kN just below the switch at 26 km: the 5% suction
  acts over the outer bell's whole 33 square metres of mouth and takes about 170 kN. The gas
  simulation goes further. It measures thrust across the mouth of the outer bell, where the still air
  round the narrow jet sits a little below the outside pressure; over that much area the deficit
  outweighs the jet, and the figure, which is never allowed below zero, reads 0 (flow reads +4.7%,
  so the jet itself is there). A plain bell torn off at the same size was not checked. Whether a real dual bell this large would lose so much to suction is not known:
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
  - `src/physics/exhausts.ts`: the cone works out the throat arc's radius again instead of reusing
    `arcRadius`, and the dual bell's `lipSlope` repeats the outer bell's slope sum that
    `divergingWall` does.
  - `PlumeParams.separated` in `src/render/plumeParams.ts` is set but nothing reads it.
  - No unit test pins the steady, unwobbled clip of a held jet in the engine view, or the wall-curve
    fit for no nozzle.
  - `src/physics/chem/pair.test.ts`, "quickly enough for a click" (600 ms limit), failed now and then
    when the machine was busy. Fixed on 24 November 2026: see "The page that publishes the site"
    under the interface redesign below.

## Interface redesign (the test-stand control room): what was built and what was left

Who the simulator is for is written down in `PRODUCT.md`, and the look as built in `DESIGN.md`. The
direction that was agreed is in `.impeccable/surfaces/index-html.md`. The simulation, the physics
and every figure were left alone: this piece is the page round the picture.

### Why it was done

A review of the old page scored it 26 out of 40. Its findings, in short: it was a general-purpose
dark dashboard that any tool could have worn; firing the engine and climbing to space, the two
best moments, were worked like settings (Fire was a small button in a corner, altitude the eleventh
of twelve sliders); the example engines were hidden in a dropdown with their descriptions cut off;
every explanation was a hover tooltip, so there was none on a touch screen or from the keyboard;
and on a phone the picture was 160 pixels wide.

The owner then settled four things. The audience is tinkerers and builders, on a desktop first,
with a phone that must work. The look is a test-stand control room. Every figure shown must come
from the physics. Every control that existed must stay reachable.

### Words used below

- **The stage**: the picture of the engine and its plume.
- **The console row**: the strip under the stage with Fire, throttle and altitude.
- **Run state**: whether the engine is unlit, running up, or running. The figures are a forecast
  for an unlit engine and readings from a lit one.
- **Callout**: a numbered disc on the engine that matches a numbered part picker.

### What was built

- **A stand and the ground.** The engine sits on a braced steel tower with a strut back to a thrust
  wall at the picture's left edge, over solid ground. Both fade and drop away over the first 2 km of
  altitude. They are drawn in an SVG layer between the plume and the engine (`src/ui/stand.ts`),
  from the engine's place on screen, which `src/sim/runtime.ts` now reports with each frame
  (`layout`). No solver file was touched.
- **The console row.** A large red Fire button on the picture's centreline, with a label above it
  reading Armed, Firing or Failed. Throttle is to its left. Altitude is to its right, with marks at
  sea level, 10 km, 40 km and vacuum, and Ascend and Descend under it.
- **A curved altitude scale.** The slider's range and values are unchanged, but its track is spread
  by the square of its position, so the first 10 km take about a third of the travel
  (`curvePosition` and `curveValue` in `src/ui/controls.ts`).
- **Test data.** Three redline gauges for wall stress, heat load and instability, ticked every
  tenth with the last 15% marked red. Thrust is the largest thing on the page. Efficiency and the
  nozzle state follow. The less-used figures fold under "Engineer's numbers".
- **One run state for every figure.** A line at the head of the test data reads "Forecast: the
  engine is unlit", "Running up" or "Live readings". Unlit, the figures, gauges and nozzle state all
  sit back at half strength.
- **A clock on the stage**: Standby, then Hot-fire with the time since ignition, then Test ended.
- **A test log** (`src/ui/testlog.ts`): timestamped lines for ignition, full power, each change in
  what the nozzle is doing, passing 10 km, vacuum, shutdown and failures.
- **Numbered parts.** The part pickers are numbered, and callouts with the same numbers sit on the
  engine: the energy source on the chamber, the exhaust on the nozzle, and what the engine is fed
  at the injector. Clicking a callout goes to its picker.
- **An engine picker** (`src/ui/picker.ts`). "Change engine" opens cards with each example's
  outline, name and description. The outline is drawn from the same wall the picture uses. The page
  opens on Merlin 1D unless a link carries another engine.
- **Tune the engine.** The size, pressure and mixture sliders fold away under one heading, which
  remembers whether it was left open.
- **Tips on focus and touch** (`src/ui/tips.ts`). Anything with a tooltip now shows it on hover, on
  keyboard focus and on a tap.
- **Ignition.** One flash from the nozzle exit and a short shudder of the whole stand. Neither plays
  for someone who has asked their device for reduced motion.
- **Phones and narrow windows** (900 pixels wide and under): the picture and console row stay on
  screen and the test data, log and Build panel scroll under them.
- **Fonts.** Barlow and Barlow Condensed, kept in `assets/fonts` (SIL Open Font License).

### Decisions made during the build, in order

1. **Unlit figures are shown, dimmed, and called a forecast.** The first plan was to show dashes
   until the engine was lit, so a cold engine could not be mistaken for a running one. That would
   have hidden the numbers from someone tuning a cold engine, which is most of what a builder does.
2. **Thrust runs up with the engine.** While the engine lights, the thrust shown is full thrust
   times the simulation's own ignition ramp (`fire`, 0 to 1), and "tonnes of push" follows it. This
   is the one figure on the page that is not the formula's steady answer, and it is labelled
   "Running up" while it happens.
3. **The stand is a tower with a thrust wall, not a wall alone.** The engine sits about 45 pixels
   from the picture's left edge, so there is no room ahead of it for a free-standing wall.
4. **The sweeps sit under the altitude scale.** They were tried beside throttle, to make room, and
   read as throttle controls there.
5. **Red is for Fire and the redline only.** "Rebuild engine" was red and is now outlined in yellow.
6. **A phone stacks its sections; it has no tabs.** Simpler, and nothing is hidden behind a tab.
7. **The ignition flash is a deliberate exception to the design checker**, which flags a glow drawn
   with a gradient. It is recorded in `.impeccable/config.json`.

### How it was checked

- 452 tests, 14 of them new (`src/ui/console.test.ts`): the altitude scale, the stand's fade, where
  the callouts go, the log's clock, and that every example's outline fits its card.
- Driven in a browser at 1440, 950, 910, 768 and 390 pixels wide, unlit and firing, with Merlin 1D,
  RS-25 in vacuum, the solid booster, the aerospike, and NERVA pushed until its chamber burst.
- An independent design review, in two rounds of fixes. Its last finding (the clock overlapping the
  view switch between 901 and 943 pixels wide) was fixed afterwards and checked in a 910-pixel
  capture, but the reviewer did not score that fix.

### What was left

- **The motion was never captured.** The flash, the shudder, the thrust running up and the stand
  dropping away were reviewed from the code and watched in a browser, not recorded.
- **The second review of the whole page was not run**, so there is no new score to set against 26.
- **A thrust trace.** The reviewer suggested a small chart of thrust against time or altitude during
  a run, with ignition marked. The data is there; nothing draws it.
- **Other engines on the first screen.** Nothing but the "Change engine" button says there are
  eleven more. The Build panel is empty below "Tune the engine" when that is folded.
- **The aerospike's outline in the picker is a plain rectangle.** An aerospike's wall points are the
  outline of its jet, not of its spike, so the card does not look like the engine.
- **The stand under a long engine.** The solid booster's case runs off the left of the picture, so
  its tower is wide and low and its front saddle is out of sight.
- **Small things**
  - Four pop-over shadows with slightly different numbers do the same job.
  - Small text uses many near-identical sizes (12, 12.5, 13, 13.5, 14 and 15 pixels).
  - Spacing is set element by element, not from a scale.
  - A few colours are typed in where a variable exists (the ground, its line, the Fire hover).
  - The chevrons' turn and the readouts' fade still play under reduced motion.
- **Not part of this piece, but seen in it:** the plume shows hard vertical seams and a rectangular
  "curtain" at sea level on some engines, where the gas simulation's regions meet.

### The page that publishes the site

Publishing runs the tests first, and stops if one fails. One test timed a single cold chemistry
solve against 600 ms. On the shared machine that publishes the site it took 1,034 ms after the
exhaust-types merge and 787 ms after this one, so neither was published and the site stayed on the
chemistry piece from 21 to 24 November 2026. The test now takes the best of three cold runs and
allows a build machine three times as long (1,800 ms); a person's own machine is still held to
600 ms.

## Plume colour piece (part 4): what was built and what was left

The design is in `docs/superpowers/specs/2026-11-25-plume-colour-design.md`.

### Words used below

- **Look**: the handful of numbers the picture draws a plume from: three colours (its heart, its
  body and its ragged edge), how solid it is, and how much soot, smoke, sparks and afterburn it has.
- **Hand-picked look**: a look typed in by eye for one of the tabled propellants.
- **Derived look**: a look worked out from what the chemistry says leaves the nozzle.
- **Family**: a group of exhaust species that glow the same way, such as everything containing
  boron.
- **Equilibrium**: the make-up the exhaust would settle to if every reaction had time to finish.
  This is what the solver works out.

### What was built

- **`src/physics/plumeLook.ts`** turns an exhaust's make-up, flame temperature and the share of it
  that is solid or liquid into a look, and into one line of words. It is in `src/physics/`, not
  `src/render/` as the design first said, because the physics has to call it.
- **Twelve families**, each with a colour and a strength (how brightly a given share of it shows):
  - soot: orange, very strong
  - steam, hydrogen and oxygen: faint pale blue
  - carbon monoxide and dioxide: blue-violet
  - boron and its compounds: green
  - lithium and its compounds: crimson
  - aluminium and its compounds: brilliant white, smoky, with sparks; strongest of all
  - beryllium and its compounds: white and smoky
  - hydrogen fluoride and chloride, and other fluorine and chlorine compounds: pale, nearly clear
  - chlorine and its fluorides: yellow-green
  - anything with carbon and nitrogen together: violet
  - nitrogen oxides: orange-brown
  - unburnt and half-burnt fuel (methane, alcohols, acids): shows nothing, but burns in the air
  - Helium, nitrogen and nitrogen bound only to hydrogen show nothing at all.
- **A species' family comes from the elements it is made of**, which the solver already records for
  all 511 species it knows, so none can be missed. A metal decides the family whatever else is bound
  to it.
- **The blend.** The body colour is the families' colours mixed by share times strength. The heart
  is the body pulled toward white by the flame temperature, and further by white-hot oxide
  droplets. The edge is the body darkened, reddened for a carbon flame and browned for a sooty one.
  How solid the plume looks rises with how much is glowing, levelling off smoothly.
- **Where it is used.** An engine built from a fuel and an oxidiser, and a reactor on ammonia,
  methane, water, carbon dioxide or helium, get a derived look whenever the solver has a settled
  gas. When it has none, the look they used to borrow stands.
- **The gas drawn inside the engine matches the plume.** It uses the look last worked out for that
  pair or fluid.
- **The look follows the mixture slider** through the make-up itself, so the old rule that tinted a
  plume for running rich is skipped for a derived look.
- **A line of words** under the exhaust's make-up in "Engineer's numbers", such as "Colour: boron
  burning green." It names the family that shows most and, if another shows at least a quarter as
  much, that one too.

### Decisions made during the build, in order

1. **The twelve example engines keep their hand-picked looks** (the owner's decision), and a test
   checks that each one's look is the very same record as before. So do every tabled propellant,
   the solid motor, tabled hydrogen in a reactor, and salt water.
2. **Carbon monoxide stands for soot.** The solver's equilibrium exhaust for kerosene with oxygen
   holds no soot at all: steam 43%, carbon dioxide 28%, carbon monoxide 23%, hydrogen 6%. Methane
   with oxygen is nearly the same list. A real kerosene flame is orange because carbon left
   half-burnt makes soot before the reactions finish. So carbon monoxide counts as soot, coming in
   from a tenth of the exhaust and fully in at 34%, provided there is hydrogen about (carbon burnt
   with no hydrogen, as in cyanogen, makes none). Kerosene's 23% gives a sooty orange plume and
   methane's 13% a nearly clean blue one. The line of words calls this "unburnt carbon", not soot,
   so it never names something the make-up beside it does not list.
3. **White-hot oxide outshines soot.** Aluminium in kerosene is only 5% aluminium oxide by count of
   molecules, and at first its plume was indistinguishable from kerosene's. Aluminium's and
   beryllium's strengths were raised until the white shows through.
4. **A family comes in gently over its first 2% of the exhaust**, and soot comes in over a wide
   span of carbon monoxide, so the look never steps as the mixture slider is dragged. A test walks
   kerosene with oxygen from half to twice its usual mixture in 60 steps and allows no number of the
   look to move by more than 0.12 in a step.
5. **An exhaust with almost nothing in it that glows is drawn dim as well as thin.** Helium from a
   reactor first drew as a bright white plume beside the words "barely glows", because the picture
   draws a pale colour brightly however thin it is.
6. **The look uses the whole make-up; the words use the list.** The readout lists at most six
   species, each at least half a percent. The final review found two faults in building on that
   list. The look could step when a species slipped from sixth place to seventh (aluminium in
   kerosene on a stub nozzle did, by 0.125 in one step), so the solver now also hands over
   everything at the exit and the look is worked from that. And the line of words could name
   something the list did not hold ("burning carbon monoxide" beside an exhaust that was all carbon
   dioxide, "steam" beside ammonia's hydrogen), so its words now follow the species actually listed.
7. **The every-pair check lives with the existing one.** `src/physics/gasSource.test.ts` already
   solves every fuel with oxygen and hydrogen with every oxidiser; it now also checks each plume's
   look. Solving them all a second time in another test file slowed the machine enough to fail the
   chemistry speed test.

### What was measured

At their usual mixtures, 70 bar and area ratio 16, the derived looks sit this far from the
hand-picked ones (straight-line distance between colours, where 0 is identical and 1.7 is black
against white); the test allows 0.35 for the heart and body, 0.45 for the edge, 0.3 for how solid
and 0.25 for soot:

- Kerosene, methane and hydrogen with oxygen all pass, so each is recognisably its example engine's
  colour. In the browser, derived kerosene is a paler, pinker orange than Merlin's.

Seen in a browser, lit at sea level: methane blue-violet, hydrogen pale blue, pentaborane with
oxygen green (and still green at 60 km), lithium with fluorine crimson, aluminium in kerosene
orange with a white glare, hydrogen with fluorine a faint haze, cyanogen with oxygen blue-violet,
a reactor on ammonia the faint blue of hot hydrogen, on methane sooty orange (the solver gives real soot there, 32%),
and on helium a dim grey haze. The gas inside the engine matched the plume each time, and there
were no console errors. An example engine shows no colour line, as it has no make-up to show.

### What was left

- **It is not physically true.** The colours are the ones each family is known for, turned up to
  be seen. Real hydrogen and hydrogen-fluorine plumes are fainter still, and real boron and lithium
  colours depend on which compound is glowing.
- **Soot is a rule of thumb.** Carbon monoxide standing for soot is right for kerosene and methane
  and is a guess for everything else. A fuel that is rich in carbon monoxide but burns clean in
  life (methanol run rich, say) will look too orange.
- **Cyanogen does not look like cyanogen.** Its real flame is a famous hot violet-white. Its
  equilibrium exhaust is carbon monoxide, carbon dioxide and nitrogen, with none of the carbon and
  nitrogen compounds that give the violet, so it draws blue-violet like any carbon flame.
- **Traces the solver does not know cannot tint the flame.** The look is worked out from
  everything at the exit down to one part in ten thousand, but only from the elements the solver
  has (no sodium or potassium, which colour many real flames).
- **The first frame after choosing a new pair** draws the gas inside the engine in the borrowed
  colour, until the gas has been solved once.
- **The example engines and the engines built from the same parts do not quite match.** Merlin's
  hand-picked orange is richer than derived kerosene's. This is the cost of keeping the examples
  exactly as they were.

## Expansion-deflection piece (part 3b): what was built and what was left

The design is in `docs/superpowers/specs/2026-11-25-expansion-deflection-design.md`. Several of its
choices did not survive meeting the gas simulation; they are listed under the decisions below.

### Words used below

- **Plug**: the solid body on the centreline at the throat. **Cap**: the part of it past the
  throat, which flares outward beside the wall and ends in a flat back.
- **Ring**: the gap between the plug's rim and the wall, where the gas comes through.
- **Hollow** (or wake): the space behind the cap's flat back.
- **Open and sealed**: the hollow is open when outside air has come in through the nozzle's mouth
  and fills it, at the outside pressure. It is sealed when the gas from the ring has closed over it
  and it holds its own pressure, whatever the outside is.
- **The engine grid and the plume grid**: the two gas simulations (see "One solver, two connected
  grids" above).
- **Fingerprint**: the sum of every number in the plume grid, and of their squares, after a fixed
  case has run from cold. Two runs that did the same arithmetic give the same fingerprint.

### What was built

- **A sixth exhaust type**, "Expansion-deflection", with a "Plug size" slider (0.5 to 0.8 of the
  wall's width at the ring). The ring has the throat's area, so swapping to it keeps the propellant
  flow; the wall at the ring is therefore wider than a plain throat.
- **The plug in the cutaway**: a stalk down the chamber, flaring to a rim at the throat, and a cap
  past it.
- **The whole nozzle in the plume grid.** The engine grid runs from the centreline to the wall and
  cannot hold a plug, so it is switched off for this nozzle, as for an aerospike. The plume grid
  takes the nozzle from the ring onward: the plug's cap as a solid body on the centreline (the
  machinery an aerospike's spike uses), the bell as a solid wall (the machinery the RL10B-2's
  extension uses), and the gas arriving through the ring. The two had never been used together;
  the solver already allowed it.
- **One change to the solver's shader.** Inside the bell, two pieces of housekeeping are switched
  off: the pull that holds open air at the outside pressure, and the rule that turns slow exhaust
  beside air into air. Both are right for open air and would have pinned the hollow at the outside
  pressure. The switch is off for every other engine.
- **The grid is sized by the bell, not by the zoom**: 2.2 bell lengths long and at least 1.25
  mouth radii tall. A bell that would need more than the longest grid (about area ratio 40 at the
  usual length) is not simulated whole: the plume is simulated from its mouth, the gas inside is
  drawn, and the page says the nozzle is too long to simulate whole.
- **A thrust rule** (below), a sentence for each of its states, and a new share-link format, `v5`,
  which carries the plug. Older links open as before.
- **In the measuring tool**: `fingerprint()`, `edCase()` and `edProbe()`.

### Decisions made during the build, in order

1. **Every exhaust keeps its plug setting**, as it keeps its cone angle, so swapping away and back
   does not lose it. The design said both that other exhausts get the default and that a swap keeps
   the plug; they could not both hold.
2. **The gas is not fed in straight.** The design fed it along the axis at Mach 1.1 and expected
   the plug's rim and the wall's curve to turn it. Measured, that gas filled the bell like an
   ordinary nozzle's at every altitude and pressure: at an area ratio of 36 at sea level it reached
   the mouth at 0.13 of the outside pressure with the hollow sealed. The nozzle's defining
   behaviour never appeared. A real one throws the gas outward onto the wall, so the plug was given
   a cap that flares beside the wall for 0.6 ring radii, and the gas now enters at Mach 1.3 heading
   outward at the cap's angle (the angle the bell leaves the ring at, up to 30 degrees). Its speed
   along the grid's axis is still past the speed of sound (1.3 times the cosine of 30 degrees is
   1.13), which was the reason for feeding it straight.
3. **The smallest plug is 0.5, not 0.4.** The ring must be wide enough in the grid's plane to carry
   the throat's flow at that speed and heading, and below about 0.5 there is not room inside the
   wall.
4. **The hollow seals by pressure, not by the bell's size.** The design's formula had the hollow
   open whenever the bell was too big for the altitude. The simulation shows it open only while the
   outside pressure is above what the sealed hollow settles to, which is a fixed share of chamber
   pressure: 2.2% at a plug of 0.7 or 0.8, 4% at 0.5. So at sea level the hollow is open on an
   engine below about 46 bar and sealed on one above it; at 100 bar it is sealed on the ground.
   The formula now follows that (`edWakeSeals` in `src/physics/engine.ts`). The help the open
   hollow gives fades in from that pressure to four times it, so thrust does not step.
5. **The first formula numbers were changed before the simulation was built.** With base drag
   `1 - 0.04 x plug^2` and a compensation share of `0.3 + 0.3 x plug`, the nozzle beat the same
   bell by only 1.4% at sea level and a bigger plug was worse everywhere. They are now
   `1 - 0.02 x plug^2` and `0.1 + 0.7 x plug` (always under an aerospike's 0.7).
6. **Sealed and too big, it reads "over-expanded", never "separated".** Its jet is thrown onto the
   wall at the ring and stays there.
7. **The cap is shorter on a very short bell**: its usual 0.6 ring radii, but never more than half
   the bell's length. At the smallest exit the bell is shorter than the cap, which would have
   poked out of the mouth and squeezed the gas a second time. (Found in the final review.)
8. **Sealed and far too big, it reports the gas leaving the whole mouth.** Its thrust there is the
   same bell's, tearing off included, less the plug's drag; but the pressure, speed and width it
   reports are the full bell's, so the plume is drawn as wide as the mouth, as "over-expanded"
   says. (Found in the final review: it used to report the torn-off jet's.)
9. **The drawn cap follows the drawn wall** where a straight flare would pinch the passage between
   them (the drawn wall is still coming round its throat arc there).
10. **The chamber is painted, not simulated.** The cutaway's window onto the simulated gas opens
   onto the bell only. No grid holds the chamber's gas for this nozzle, so it is a plain glow in
   the flame's colour in every "Show inside" view.

### Proof that nothing else moved

Four fingerprints were taken before the shader was touched and again after, on the same machine
(Intel UHD 730) and browser: Merlin 1D at sea level, the XRS-2200 aerospike at sea level, and the
RL10B-2 at 60 km with its extension seated and halfway along. Each repeated exactly when run twice,
and all four were identical after the change. They are in
`docs/superpowers/plans/2026-11-25-expansion-deflection-fingerprints.md`.

### What was measured, lit from cold

`edCase()`: the starter engine with this nozzle at an area ratio of 16, lit from cold over 60
frames, settled for 240 more, then read three times 25 frames apart and averaged. Thrust is taken
across the plane of the mouth. The hollow's pressure is read on the centreline two cells behind
the cap.

No run had a cell that was not a number or had run away. Twenty-two runs were made before
decision 4 and seven after it; the table gathers them, with runs of the same plug and pressure
that read alike set on one line.

| Chamber | Plug | Altitude | Hollow, over outside pressure | Hollow, % of chamber pressure | Thrust, simulation over formula |
|---|---|---|---|---|---|
| 100 bar | 0.7 | 0 km | 2.1 | 2.1 | 0.900 |
| 100 bar | 0.7 | 5 km | 4.0 | 2.2 | 0.905 |
| 100 bar | 0.7 | 10 km | 12.6 | 3.3 | 0.904 |
| 100 bar | 0.7 | 20 km | 59 | 3.3 | 0.902 |
| 100 bar | 0.7 | 40 km | over 1,000 | 3.3 | 0.903 |
| 100 bar | 0.7 | 100 km | over 1,000 | 3.3 | 0.903 |
| 100 bar | 0.5 | 0 km | 4.0 | 4.0 | 0.896 |
| 100 bar | 0.5 | 5 to 100 km | 7.5 and up | 4.0 | 0.900 to 0.904 |
| 100 bar | 0.8 | 0 km | 2.3 | 2.3 | 0.945 |
| 100 bar | 0.8 | 5 to 100 km | 3.8 and up | 2.1 to 3.7 | 0.937 to 0.944 |
| 40 bar | 0.7 | 0 km | 1.01 | 2.6 | 0.902 |
| 40 bar | 0.7 | 5 km | 1.6 | 2.2 | 0.899 |
| 40 bar | 0.7 | 10 km | 3.4 | 2.2 | 0.902 |
| 15 bar | 0.7 | 0 km | 0.90 | 6.1 | 1.159 |
| 15 bar | 0.8 | 0 km | 0.71 | 4.8 | 1.044 |
| 15 bar | 0.5 | 0 km | 0.88 | 5.9 | 1.188 |

(The 100-bar rows other than 0 and 100 km at plug 0.7 were measured against the formula before
decision 4; the formula's figure for them did not change with it. The 100 bar, 40 bar and 15 bar
rows at 0 km, and 100 bar at 100 km, were measured after.)

What this shows:

- **The hollow opens and seals because of the flow.** At 40 bar at sea level it sits at 1.01 times
  the outside pressure and holds outside air: open. By 5 km it is at 1.6 times and by 10 km 3.4
  times: sealed. At 100 bar it is sealed even on the ground. At 15 bar it sits a little under the
  outside pressure (0.7 to 0.9), as an open hollow that the jet is drawing on should.
- **Sealed, the simulation reads 10% under the formula** (6% under at the biggest plug). The
  formula charges about 1% for the plug. The rest is most likely the shocks where this crude cap
  throws the gas onto a wall that was shaped as an ordinary bell: a real nozzle of this kind is
  contoured to avoid them. The design said to change the formula's numbers where the simulation
  differed by more than a tenth. Two rows are just past that (0.896 and 0.899). They were not
  changed: charging this nozzle 10% for a crude cap would make the formula describe this
  simulation's plug, not the part. That is the owner's call to overturn.
- **Open at 15 bar, the simulation reads 16 to 19% above the formula** at plugs of 0.7 and 0.5,
  about what a perfectly matched nozzle would give. The formula was not raised to meet it, because
  it is not allowed to beat an aerospike, and because thrust read across the mouth of an open,
  unsteady hollow is the least trustworthy figure in the table.
- **The simulation does not show the formula's rule about plug size.** The formula says a bigger
  plug helps near the ground and costs in vacuum. In the simulation the biggest plug is the best
  when sealed (0.94 against 0.90) and the worst when open (1.04 against 1.16 and 1.19). The rule
  was reasoned, not measured, and the simulation contradicts it.

### Seen in a browser

A 17-bar engine with this nozzle, lit and sent on an ascent: the log read "altitude compensating",
then "over-expanded" as the hollow sealed, then "ideally expanded" and "under-expanded". "Show
inside: Gas speed" showed a fast jet along the wall and slow, turning gas in the hollow, at sea
level and at altitude. Widening the exit to an area ratio of 541 gave the note "this nozzle is too
long to simulate whole" and carried on. The link was a `v5` one. No console errors.

### What was left

- **No simulated figures on the page for this nozzle.** They need the plume grid read back in the
  app, which only the measuring tool does.
- **The formula and the simulation disagree** in the three ways listed above. The page shows the
  formula's figures.
- **The flame view draws the whole bell as one bright glow.** The gas near the ring is tens of
  times denser than at the mouth, and the glow is judged against the mouth. Judging it against a
  middling density dimmed the plume outside too much and was undone. "Show inside" by speed or
  temperature shows the structure.
- **The plume beyond the mouth is short.** The grid is 2.2 bell lengths long, so the plume has
  about one bell length before it fades out at the grid's end.
- **"Show inside" colours exhaust outside the bell too**, where a little curls back round the lip
  in thin air.
- **Air trapped at start-up stays in a sealed hollow.** With the housekeeping off inside the bell,
  the air that was there before ignition is swept round and round and only slowly carried away, so
  how much of the hollow is exhaust is not a reliable sign of whether it is open. Its pressure is.
- **The bell is fitted by a slope and a curvature.** It is within 5% of the drawn bell's radius
  along its length at the default engine (a test checks that).
- **The plug's cooling is not modelled.** A real plug in the throat is very hard to keep cool; the
  heat limit is the same as a bell's.
- **Nozzles above an area ratio of about 40 are not simulated whole.**
- **One chamber only**, and no nozzle extension.
- **In the narrowest chamber the wall opens out to the ring.** With the smallest plug the wall at
  the ring is 1.155 throats wide, and the narrowest chamber allowed is 1.11, so on such an engine
  the chamber flares to its throat instead of narrowing to it.
- **With the gas drawn, "Show inside" ignores the plug**: the drawn speed jumps at the ring, and
  the throat's heat glow is drawn at a plain throat's radius, inside the passage.
- **The plume grid is not cleared when the exhaust is changed while firing**, so the first moments
  after a swap to or from this nozzle show the old gas in the new shape.
- **Small things**
  - The drawn cap is a little slimmer than the simulated one where it follows the drawn wall.
  - The simulated ring is a little wider than the drawn one, because the gas enters the grid
    already past the speed of sound and heading outward, which takes more room than the throat.
  - `isModified` in `src/state/store.ts` does not look at the plug size (or the cone angle or the
    dual bell's kink), which only matters for an example engine whose exhaust has not been changed.

## Electric thrusters (part 5): what was built and what was left

Built 25 November 2026. Design: `docs/superpowers/specs/2026-11-25-electric-thrusters-design.md`.
Plan: `docs/superpowers/plans/2026-11-25-electric-thrusters.md`. This was the last planned piece
of the engine builder.

### Words used below

- **Heated-gas electrics**: the resistojet and the arcjet. Electricity heats a gas, which leaves
  through an ordinary nozzle.
- **Beam thrusters**: the gridded ion thruster and the Hall-effect thruster. Atoms are stripped of
  an electron and thrown out by a voltage. No chamber, throat or hot gas.
- **Heating share**: how much of a heated-gas engine's electrical power ends up as heat the nozzle
  can turn into speed.
- **Isp**: efficiency, in seconds. Thrust divided by the weight of propellant used each second.

### What was built

- **Four new energy sources**: Resistojet, Arcjet, Ion thruster, Hall thruster. Every engine now
  carries a power (kW) and a voltage, which only electric engines use, and share links moved to
  `v6` to carry them. Links from v1 to v5 still open.
- **Heated-gas electrics run on the existing machinery.** The chemistry solver gained
  `solveHeated`: a fluid given a set amount of heat per kilogram, where the nuclear engine's
  `solveFluid` heats it to a set temperature. The engine's power and flow set that heat. The flow
  falls as the gas gets hotter, so the heat per kilogram is searched for (`heated` in
  `src/physics/gasSource.ts`). Every nozzle shape, the gas simulation and the plume colour work
  for them unchanged.
- **Their propellants**: hydrazine, ammonia, hydrogen and water for the resistojet; hydrazine,
  ammonia and hydrogen for the arcjet. The propellant starts as the liquid in its tank, so the
  power has to boil it first. Hydrazine breaks down by itself into gas at about 1,000 K, and the
  electricity adds to that.
- **They may be far smaller than any other engine**: throat down to 0.3 mm, chamber pressure down
  to 0.5 bar (`rangesFor` in `src/physics/engine.ts`). The page shows millimetres, millinewtons,
  milligrams a second and grams of push where figures are small.
- **Beam thrusters have a formula of their own** (`src/physics/electric.ts`), which `simulate`
  hands over to before anything about gas is worked out. It follows from power, voltage and the
  mass of one atom. Propellants: xenon, krypton, argon, iodine.
- **Beam thrusters have a picture of their own** (`src/render/beamView.ts`): a cutaway of the
  discharge chamber and two grids, or of the ring-shaped channel and its magnet coils, the small
  neutraliser beside it, and a faint steady beam coloured by the propellant. It is drawn on the 2D
  layer. The plume layer draws only the sky. None of the gas simulation's shaders was changed.
- **Their controls** are Power, Voltage and Thruster diameter. Everything to do with a chamber,
  throat or nozzle is hidden. The gas simulation menus and "Show inside" stand greyed out, with
  a note saying why.
- **Five examples** joined the twelve: the MR-510 arcjet, the NSTAR and NEXT ion thrusters, and
  the SPT-100 and XR-5 Hall thrusters.

### Limits and failures added

| Engine | What stops it | How it shows |
|---|---|---|
| Resistojet | The heater melts when the gas passes 2,400 K | "Heater burnt out". Destroys the engine. |
| Arcjet | The electrodes erode when the average gas passes 6,000 K | "Electrodes eroded". Destroys the engine. |
| Either | Too little power to turn the propellant into gas | "Not enough power to boil the propellant". The engine never starts, unharmed. |
| Ion or Hall | Outside pressure above 1 Pa (below about 80 km) | "Needs a vacuum". Never starts, or shuts down if brought down while running. Unharmed. |
| Ion | More current than the grids can pass | "Grids overloaded". Trips off, unharmed. |
| Hall | More waste heat than the channel can shed | "Channel overheated". Trips off, unharmed. |

Picking an ion or Hall thruster, as an energy source or as an example, moves the altitude to
100 km, and the test log says so. Nothing else moves the altitude.

### Every constant, and what it rests on

Heated-gas electrics (`src/physics/parts.ts`, `src/physics/gasSource.ts`):

| Constant | Value | Rests on |
|---|---|---|
| Resistojet heating share | 0.8 | Textbook (Sutton gives 65 to 90%). **Not tuned: there is no resistojet example.** |
| Arcjet heating share | 0.41 | Tuned to the MR-510: 0.40 gave an Isp of 567 s against a published 585 s. |
| Resistojet heater limit | 2,400 K | The design. |
| Arcjet electrode limit | 6,000 K | The design. The solver settles for hydrazine well past it (7,300 K), so the fallback in the design was not needed. |
| Arcjet wall share of gas temperature | 0.4 | The design. |
| Flow efficiency of the chamber | 0.98 | The same figure `simulate` uses for a chamber where nothing burns. |
| Coldest usable gas | 300 K | Chosen. A settled result colder than this is not treated as gas. |
| "Heater is adding little" note | below 700 K | Chosen. |

Beam thrusters (`src/physics/electric.ts`). The relations are Goebel and Katz, *Fundamentals of
Electric Propulsion* (2008), chapter 2. The shares were set once, by hand, so that the four
examples together come out near their published figures. None is set per example.

| Constant | Value | Meaning |
|---|---|---|
| Ion: cost of an ion | 200 V for xenon, scaled by how hard the atom is to ionise | Power spent making each ion, on top of the voltage that throws it out |
| Ion: beam share | 0.96 | The part of the push that points straight back |
| Ion: used share | 0.84 | The part of the propellant that leaves as ions |
| Ion: grid limit | 1.18e-3 A/m² per V^1.5 | About a quarter of the Child-Langmuir figure for grids 1 mm apart |
| Hall: volts lost | 40 V | |
| Hall: electrical share | 0.8 | The part of the current that is ions leaving |
| Hall: beam share | 0.9 | |
| Hall: used share | 0.9 for xenon, times (atom mass / xenon's) to the power 0.15 | Lighter atoms are likelier to escape un-ionised |
| Hall: channel's share of the face | 0.4 | |
| Hall: channel heat limit | 450 kW/m² | Set so the two examples sit near half |
| Vacuum needed | below 1 Pa | About 80 km. Real thrusters need a far harder vacuum; the page says so. |

### How close each example comes

All at 100 km, full throttle, at the published power (and voltage, for beam thrusters).

| Example | Published | The model | Nearest limit |
|---|---|---|---|
| MR-510 arcjet, 2 kW | 258 mN, 585 s | 257.9 mN, 574 s (sized to the thrust) | Heat 63% |
| NSTAR, 2.3 kW, 1,100 V | 92 mN, 3,100 s | 92.9 mN, 3,306 s | Grid current 58% |
| NEXT, 6.9 kW, 1,800 V | 236 mN, 4,190 s | 231.8 mN, 4,230 s | Grid current 38% |
| SPT-100, 1.35 kW, 300 V | 83 mN, 1,600 s | 86.2 mN, 1,615 s | Channel heat 47% |
| XR-5, 4.5 kW, 300 V | 290 mN, 1,790 s | 287.3 mN, 1,615 s | Channel heat 54% |

Where the published figures came from:

- **MR-510**: the L3Harris electric propulsion data sheet gives 222 to 258 mN, 585 to 615 s and
  1.53 to 2.04 kW. Taken at the high-thrust end. Its chamber pressure and nozzle are not
  published; 4 bar and an area ratio of 100 are assumed.
- **NSTAR**: NASA comparison tables (NTRS 20080010688) give 0.5 to 2.3 kW, 92 mN and "over
  3,100 s". The Deep Space 1 report gives 92 mN on 2.9 mg/s, which is about 3,230 s; the model's
  2.87 mg/s agrees with that. The 1,100 V is from a reference giving the screen grid at about
  1,090 V.
- **NEXT**: NASA long-duration test reports (NTRS 20130000079, 20140016766): 6.9 kW, 1,800 V,
  3.52 A, 236 mN, 4,190 s, 36 cm. The model's beam current is 3.45 A.
- **SPT-100**: Wikipedia's SPT-100 and Hall-effect thruster articles: 1,350 W, 300 V, 1,600 s,
  and 80 or 83 mN depending on the table.
- **XR-5 (BPT-4000): not confirmed.** A search confirmed only the 4.5 kW rating and the 300 to
  400 V range. The 290 mN and 1,790 s at 300 V are the commonly quoted data-sheet figures, from
  memory, and the 170 mm width is a guess. The model's Isp is 9.8% under the quoted one, the
  widest gap of the five. If a data sheet is found, check these three numbers first.

### Decisions made during the build, in order

1. **The resistojet starts at 0.2 kW**, not the 0.5 kW first planned. On the starter's 0.6 mm
   throat 0.5 kW takes hydrazine to 3,000 K and burns the heater out.
2. **Throttling holds the gas temperature to within about 5%**, not exactly. At half the pressure
   a little more of the gas is torn into atoms, which takes heat.
3. **"Power into thrust" can pass 100% on hydrazine.** Hydrazine brings heat of its own, so its
   jet can carry more than the heater gave it. The readout's tip says so.
4. **Changing to or from an electric source does not keep the throat.** An electric engine is
   nothing like the size of one that burns, so going to one starts from a small engine of that
   kind, and coming back starts from the blank engine. It also stops being "the Merlin, modified".
5. **Too little power is "underpowered" wherever the search finds no usable gas**, including a
   stretch where a propellant would boil but condense again in the nozzle.
6. **The Starlink argon thruster was left out** at the design stage: its published figures cannot
   be reached by a formula that also fits the SPT-100, short of a constant made up for it. Argon
   stays as a propellant. A real argon thruster does better than this formula's argon.
7. **No vacuum-chamber drawing.** The altitude control already says the thruster is in space.
8. **The failure is titled "Needs a vacuum"**, because it also covers a running thruster brought
   down into air. The line above the gauges reads "Will not light in air" for one that is off.
9. **A group of controls with nothing to show is hidden.** An electric engine has no mixture, and
   the empty "Mixture" heading was left standing.
10. **A heated-gas electric engine rumbles at 15% of an ordinary engine's volume**, and a beam
    thruster makes no sound. A quarter of a newton does not roar.
11. **The beam is drawn on the 2D canvas, so no shader changed.** At first it was 32 faint wedges
    laid over one another; each was so faint that its fade rounded to steps, which showed as
    vertical bands and a hard end. In the polish pass it became one gradient swept across the
    beam, painted once at full strength and then thinned out with distance.
12. **An electric example counts as changed when its power or voltage is changed.** (Found in the
    final review: the header went on calling a 10 kW thruster "NSTAR" with no "Undo changes".)
13. **No "vs stock" line against a stock figure of nothing.** A changed beam example brought down
    into air has no thrust, and neither has its stock: the line read "NaN% vs stock". (Final
    review.)
14. **A small electric engine's chamber pressure is spread by ratio along its slider**, in tenths
    of a bar below ten. Spread evenly, the few bar these engines run at were a sliver at the end
    of a track that reaches 400. (Final review.)
15. **Changing a heated-gas engine's propellant raises the power to the least that starts it.**
    Ammonia, hydrogen and water all take more to boil than hydrazine, and each refused to start at
    the resistojet's starting power. Where no power in range would do, the power is left alone.
    (Final review.)
16. **"Power into thrust" reads "over 100%"**, not a figure, when hydrazine's own heat puts more
    into the jet than the electricity supplied. At 50 W it had read 483%. (Final review.)

### Proof that nothing else moved

- The twelve examples' entries in both snapshot files are untouched: each file gained five entries
  and lost no line.
- Three older tests assumed every example is hand-tabled, every energy source keeps the throat on
  a swap, and every example has a nozzle. Each was narrowed to the engines it is true of, with a
  comment, and a new test pins that the tabled examples still number twelve.

### Seen in a browser

At 1440 by 900: an arcjet with the gas simulated inside it and its sizes in millimetres; an ion
and a Hall thruster lit at 100 km with their beams; an ion thruster refusing at 9 km with the
"Needs a vacuum" box and its "Switch on again" button; the picker with all seventeen cards; the
SPT-100 example lit. No console errors.

### What was left

- **No resistojet example**, so its heating share is untuned.
- **The XR-5's published figures and width are unconfirmed** (above).
- **Other electric thrusters**: magnetoplasmadynamic, VASIMR, pulsed plasma, electrospray.
- **The power supply**: solar panels, their size, distance from the Sun, batteries. Power is
  simply a setting.
- **Wear.** Real grids and channels erode over thousands of hours. Here a thruster runs within
  its limits or it does not.
- **The neutraliser's own flow and power** are inside the efficiency figures, not settings.
- **The beam is drawn, not simulated**, and the gas simulation's figures are not offered for a
  beam thruster.
- **A heated-gas electric engine is drawn as an ordinary small engine.** There is no heater coil
  or arc in the cutaway.
- **An arcjet's solver assumes the atoms recombine in the nozzle.** Real ones mostly do not. The
  heating share covers the loss on average, tuned at one point (hydrazine, 2 kW); other
  propellants and powers are not checked against anything.
- **Checked at phone width in the polish pass** (375 wide): the picker, an ion thruster lit, and
  its controls all fit. Nothing needed changing.
- **The test-log line about the altitude** is written when the energy source is changed, but is
  cleared straight away when an example is picked, because picking an example starts a new log.
- **An altitude sweep with a beam thruster** starts on the ground and so stops at once with
  "Needs a vacuum".
- **`src/dev/accuracy.ts`** still lists only the four original energy sources.
- **The grid limit is xenon's.** The law it comes from lets a lighter atom carry more current
  (by one over the square root of its mass), so an argon thruster's grid gauge reads about 1.8
  times too high. (Final review, left.)
- **The altitude log line can be written falsely**: it is inferred from any jump to 100 km with a
  beam thruster on the stand, so clicking the far end of the altitude slider writes it too.
  (Final review, left.)
- **In air a beam thruster's panel shows zeros** (0.0 mN, 0 s, 0.00 A). They are true, but dashes
  might read better. (Final review, left.)
- **Small wording changes reached existing engines.** The log's "Full power" line now picks its
  unit by size, so the salt-water example reads "12.90 MN" where it read "12900 kN". A custom
  engine under a kilonewton, a kilogram a second or a tonne of push now reads in N, g/s and kg.
  None of the twelve examples' figures moved. (Final review; the owner may want them back.)
- **The search for the gas temperature assumes more heat per kilogram always means more heat
  taken up.** Where boiling or breaking down dominates that is not quite so, and the temperature
  can jump (ammonia goes from 795 K to 1,031 K in one step of the power slider). No wrong failure
  was found from it. (Final review, not judged.)
- **Water in a resistojet has a narrow window**: on the starter it goes from "not enough power"
  at 0.56 kW to a burnt-out heater at 0.70 kW.

## Polish pass after part 5

Done 25 November 2026, across the page at 1440, 1024 and 375 wide.

- **The beam's bands and hard end are gone** (see decision 11 above).
- **The gas-speed and temperature legend sits below the clock.** It was drawn in the picture's top
  left corner, where the Standby and Hot-fire clock covered it.
- **"Sea level / vacuum" keeps to one line at laptop width.** Between 901 and 1240 pixels wide the
  data column is at its narrowest and the label wrapped, which pushed its figure a line lower
  than the efficiency figure beside it. The two labels are set a little tighter there.

Looked at and left: the design detector's advisories about font sizes and colours outside
DESIGN.md are all on lines from before this pass. The first-fire "Sound is off" notice can sit
over the end of the legend for the few seconds it shows.

## After the second UI critique: the run state and accessibility

The critique of 25 November 2026 scored the page 29/40, up from 26
(`.impeccable/critique/2026-11-25T16-06-33Z__index-html.md`). Its two P1 issues were fixed the
same day; its three P2 issues were left (below).

### What changed

- **Picking another engine, or opening a link, while firing shuts the stand down first.** The
  plume used to stay lit under a "Standby" clock, with a log reading "Ready to fire" and no
  Ignition line. Now the run ends, the log starts afresh and the clock reads Standby.
- **At a failure the readings hold the moment it came**, under a red "Readings at the moment of
  failure" line: the failing engine's figures at the power the run had reached, with the gauge
  that broke it at full strength. They used to fall back to a calm unlit forecast. Settings moved
  while the notice shows do not change what is held. An engine that never lit has nothing to hold
  and shows the forecast as before. (`nextLive` and `readingsFor` in `src/ui/runState.ts`.)
- **The line logged when the engine is put right says what happened**: "Engine rebuilt and back
  on the stand." below 2 km, "Engine rebuilt." above it, and "Ready to fire again." (or "switch
  on", for a beam thruster) after a failure that did no damage. It used to say "Engine back on
  the stand." at any height.
- **Every slider has a name and a spoken value with its unit** ("Throttle", "100 %"). Each one sat
  inside a label whose first labelable element was its read-out, so none had a name.
- **Forecast figures are readable.** They sat back by fading to half strength, which measured
  2.7:1 on the panel; they now sit back in the Dim colour (6.2:1). A gauge's percentage keeps its
  own colour while unlit, so a forecast already past a limit reads in red at 5.0:1 rather than at
  half strength. The detector no longer reports low contrast.
- **Space no longer fires the engine while a slider or text box has focus.** The Fire button says
  that Space is its shortcut, in its tip and to a screen reader.
- **When a failure notice opens, the keyboard's focus moves to its button.**

### Left from that critique

- The test log is squeezed when "Engineer's numbers" is open (P2).
- The engine picker is 18 equal cards, ungrouped, with text cut mid-word (P2).
- On a phone the thrust figure is below the fold, and the numbered marks crowd the left edge (P2).
- Fire is still the 32nd of 33 tab stops; Space is the way to it from the keyboard.
- Thrust and the gauges are not read out as they change; only the log is.
