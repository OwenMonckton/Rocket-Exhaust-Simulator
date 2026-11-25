# Electric thrusters (engine builder, part 5)

Status: approved and built, 25 November 2026. Changes made while building: the resistojet starts at 0.2 kW; the vacuum failure is titled "Needs a vacuum"; the XR-5's published figures could not be confirmed against a source. `docs/future-work.md`, "Electric thrusters (part 5)", says what was built and why.

## What it is for

The last planned piece of the engine builder. Every engine on the page today gets its energy from
a flame or a reactor. An electric thruster gets it from the spacecraft's power supply, which is
tiny by comparison, so it pushes very gently and wastes very little propellant. The owner asked for
four kinds:

- **Resistojet**: a glowing heater warms a gas, which leaves through an ordinary nozzle.
- **Arcjet**: an electric arc heats the gas far hotter than any heater could, again through an
  ordinary nozzle.
- **Gridded ion thruster**: propellant atoms are stripped of an electron and pulled out through two
  charged grids. No chamber, throat or hot gas.
- **Hall-effect thruster**: the same idea with a ring-shaped channel and a magnetic field in place
  of the grids. More thrust for the power than a gridded ion thruster, at a lower exhaust speed.

A builder (the audience is tinkerers) should be able to pick any of them, see what it is made of,
switch it on, and find the trade these engines live by: at a fixed power, a faster exhaust means
less thrust. They should also meet the reasons these engines are small: push the power up and the
heater melts or the grids overload; try an ion thruster in air and it will not light.

## Words used below

- **Thermal electrics**: the resistojet and the arcjet. Hot gas through a nozzle.
- **Beam thrusters**: the gridded ion and Hall-effect thrusters. Charged atoms thrown out by voltage.
- **Formula**: `simulate` in `src/physics/engine.ts`, which works out every figure on the page.
- **Gas simulation**: the two grids that draw the moving gas (`src/render/engineSim.ts`,
  `src/render/fluidSim.ts`).

## Goals

- Four new entries under "Where the engine gets its energy": Resistojet, Arcjet, Ion thruster,
  Hall thruster. Same page, picker, console, test log and share links as every other engine.
- A **Power** control (kilowatts) on all four, and a **Voltage** control on the beam thrusters.
- Thermal electrics run on the existing machinery: the chemistry solver works out the gas, every
  nozzle shape is available, the gas simulation draws them, and the plume takes its colour from
  what is in the exhaust. What is new is that the gas temperature follows from the power and the
  flow instead of being set directly.
- Beam thrusters get their own formula, their own cutaway drawing and a drawn beam whose colour
  comes from the propellant.
- Readouts suited to each: thrust in millinewtons when small, power, voltage, beam current,
  propellant flow in milligrams a second, exhaust speed, and how much of the electrical power ends
  up as thrust.
- Limits a builder can run into, each with a plain explanation (see "Limits and failures").
- Five real examples in the picker (see "Example engines"), each within 10% of its published
  thrust and efficiency (Isp) at its published power.
- Share links carry the new settings, and every older link still opens.

## Not in this piece

- Other electric thrusters: magnetoplasmadynamic, VASIMR, pulsed plasma, electrospray, colloid.
- The power supply itself: solar panels, their size, the Sun's distance, batteries.
- Wear over time. Real grids and channels erode over thousands of hours; here a thruster either
  runs within its limits or does not.
- A simulated beam. The gas simulation models a fluid, and a beam of charged atoms in vacuum is
  not one. The beam is drawn.
- The neutraliser's own flow and power as separate settings. Their cost is inside the formula's
  efficiency figures.
- A vacuum-chamber drawing. In the first sketch of this piece the test stand was to become a
  vacuum chamber wall. The altitude control already says where the engine is; in space there is
  nothing round it, and a tank would contradict that. (My call. Say if you want it back.)
- Any change to how the existing four energy sources are worked out or drawn.

## What would make it a failure

- Any of the twelve example engines, or any existing energy source, behaving or looking different.
- Numbers that are not honest: a beam thruster whose thrust, power, voltage and exhaust speed do
  not agree with each other by the textbook relations below, or an example that only matches its
  published figures because of a constant made up for that one engine.
- A beam thruster that appears to work at sea level.
- An electric engine that needs megawatts because the builder's smallest sizes are too big. Real
  arcjets have throats well under a millimetre.

## Constraints

- `src/physics/presets.regression.test.ts` and `src/render/geometry.regression.test.ts` pin the
  twelve examples. Their existing snapshot entries are not regenerated. New examples add new
  entries.
- `SimResult` gains no required field. One optional field, present only for an electric engine,
  carries the electric figures, so the existing snapshots and callers are untouched.
- `EngineConfig` gains `powerKW` and `voltage`. Every engine keeps them (as every exhaust keeps its
  plug size) so a swap away and back does not lose them; only electric engines use them.
- `sanitize` must still turn any config into a valid one.
- Share links move to `v6` (v5 plus power and voltage). v1 to v5 still open.
- The gas simulation's shaders are not changed for this piece.

## Approaches

Three were considered.

1. **Four new energy sources inside the existing builder (chosen by the owner).** Thermal electrics
   reuse the nuclear engine's path. Beam thrusters branch off early in the formula into their own.
   One page, one set of controls, one kind of share link. Costs: the page must cope with an engine
   that has no chamber pressure or exit Mach.
2. **A separate electric bench**, a second mode with its own state and view. Nothing existing has to
   bend, but the console, picker and share links are built twice, and an arcjet, which is half an
   ordinary engine, belongs on neither side.
3. **Treat a beam thruster as very hot gas through a tiny nozzle.** Cheap, and the numbers would be
   wrong. Ruled out by "honest numbers".

## Thermal electrics

### How they are worked out

Each is an energy source like the reactor: nothing burns, the solver heats a fluid to a temperature
and expands it. The difference is where the temperature comes from.

- The builder sets **power**. The engine's size and chamber pressure set the flow, as now.
- The gas temperature is the one at which the heat the gas has taken up equals the power that
  reaches it: `flow × (heat content of the gas at that temperature − heat content of the cold
  propellant) = heating share × power`. The flow itself depends on temperature, so this is solved
  by search. The solver's result has to expose the gas's heat content for this (a field on the
  solver's own result, not on `SimResult`).
- **The cold propellant is the liquid in the tank.** The power has to boil it before it can warm
  it, which is why water is a poor choice at low power. Hydrazine is the odd one out: it breaks
  down by itself and gives off heat, so with the power at nothing it still leaves as gas at
  roughly 900 K, and the electrical power adds to that. This is how real hydrazine resistojets and
  arcjets work.
- **Heating share** is one constant per source: how much of the electrical power ends up as heat
  that the nozzle can turn into speed. A resistojet keeps most of it. An arcjet loses much of it to
  the electrodes and to gas that leaves torn into atoms without giving that energy back; the
  solver assumes the atoms recombine, so the arcjet's share must also cover that. Starting
  proposals: resistojet 0.8, arcjet 0.4. The arcjet's is tuned once, against its example, and
  recorded with what it was tuned to. The resistojet has no example, so its share stays the
  textbook figure and the record says it is untuned.
- **Throttle** turns the flow and the power down together, so the temperature holds.
- The mixture control is not shown. In its place the readouts show the gas temperature reached.

### Propellants

- Resistojet: hydrazine, ammonia, hydrogen, water.
- Arcjet: hydrazine, ammonia, hydrogen.

Hydrazine is new as a heated fluid; the solver already knows it as a fuel (`N2H4(L)`). The others
are the reactor's fluids. How the propellant records are shared between sources is left to the
builder.

### Size

Electric engines may be much smaller than the builder allows today: throat down to 0.3 mm, chamber
pressure down to 0.5 bar, with the chamber, exit and wall limits lowered to suit. The smaller
limits apply only to thermal electrics. Dimensions shown on the page read in millimetres when
they are small.

### Limits and failures

- **Resistojet: the heater melts.** The heater has to be hotter than the gas it heats. It fails
  when the gas passes 2,400 K. Too much power for the flow does it.
- **Arcjet: the electrodes erode.** The arc's limit is far higher: it fails when the average gas
  temperature passes 6,000 K. If the solver proves unable to settle that hot for a propellant, the
  limit for that propellant is the hottest it does settle at, and the record says so.
- **Too little power to boil the propellant:** if the power cannot bring the propellant to a gas
  the solver can settle (in practice a few hundred kelvin), the engine will not start, and says
  that it needs more power or less flow. A refusal to start, not a destroyed engine.
- **Barely enough power:** the gas is only warm and the engine is a weak jet. Not a failure. A note
  says the heater is adding little. The note is not shown for hydrazine, whose own breakdown
  already makes hot gas.
- Wall stress applies as on any engine. Instability does not apply (nothing burns) and its gauge is
  not shown.
- The nozzle wall of an arcjet sees a cooler layer than the arc's core, so the throat heat limit
  uses a share of the gas temperature, as the salt-water engine's does. Proposal: 0.4.
- In air they work, as any nozzle does, and the nozzle states (over-expanded, separated and so on)
  apply unchanged.

## Beam thrusters

### How they are worked out

The builder sets power `P`, voltage `V`, the propellant (which gives the mass `m` of one atom) and
the thruster's diameter. `e` is the charge of one electron and `g0` is 9.80665 m/s².

- Speed of an atom leaving: `v = sqrt(2 × e × Vnet / m)`.
- Beam current: `I = electrical share × P / V`.
- Thrust: `beam share × I × sqrt(2 × m × Vnet / e)`.
- Propellant flow: `I × m / (e × used share)`.
- Efficiency (Isp): `thrust / (flow × g0)`. The same at every altitude at which it runs.
- Thrust efficiency: `thrust² / (2 × flow × P)`, shown as a percentage.

The shares differ by type. These are textbook figures (Goebel and Katz, *Fundamentals of Electric
Propulsion*) and starting proposals, tuned once against the examples and then recorded:

| | Gridded ion | Hall effect |
|---|---|---|
| `Vnet` | `V` | `V` less about 50 V lost in the channel |
| Electrical share | `V / (V + cost of making an ion)`, the cost about 200 V for xenon and growing with how hard the propellant is to ionise | about 0.75 (the rest of the current is electrons going the wrong way) |
| Beam share (spread, and atoms that lost two electrons) | about 0.96 | about 0.88 |
| Used share (propellant that actually gets ionised) | about 0.88 | about 0.9 for xenon, lower for lighter propellants |

Voltage ranges: gridded ion 300 to 5,000 V; Hall 100 to 1,000 V. Power: 0.05 to 100 kW.
Diameter: 3 cm to 1 m, stored in the engine's existing exit diameter.

**Throttle** turns the power down at the same voltage, so thrust and flow fall together and Isp
holds.

### Propellants

Xenon, krypton, argon and iodine, each with its atom's mass, how hard it is to ionise, and a beam
colour. Lighter atoms leave faster at the same voltage and cost more power per atom to ionise, so
they give higher Isp and less thrust. The figures above must show that without a rule saying so.

### Limits and failures

- **Will not light in air.** A beam thruster needs a vacuum. Below about 80 km (outside pressure
  above 1 Pa) switching it on does nothing but report why. This is a refusal to light, like an
  inert mixture, not a destroyed engine. The page says that real thrusters need a harder vacuum
  still.
- **Gridded ion: the grids cannot pass the current.** Two grids a set distance apart can only pull
  so much current through each square centimetre, and the limit rises steeply with voltage
  (current per area proportional to voltage to the power 1.5). High power at low voltage through a
  small thruster overloads them: the beam strikes the grids. Shown as a gauge; at the limit the
  thruster trips off.
- **Hall: the channel overheats.** The power that does not become thrust heats the channel walls.
  The gauge is waste power per area of the channel; at the limit the thruster trips off.
- Both gauges' constants are set so that the examples sit at believable shares of their limits
  (between a third and two thirds), and the record says so. Tripping off is not destruction: the
  builder changes a setting and relights.
- Wall stress and instability do not apply and their gauges are not shown.

### What it looks like

- **Cutaway.** Gridded ion: a short can (the discharge chamber), two thin grids across its mouth,
  and the small neutraliser beside it. Hall: a ring-shaped channel round a centre pole, with the
  neutraliser beside it. Both scale with the diameter setting. Chamber, throat and nozzle are not
  drawn and their callouts are not shown.
- **Beam.** A faint, steady, straight-edged glow widening from the thruster's face: narrow for a
  gridded ion thruster (about 12° either side), wide for a Hall thruster (about 35°). Brightness
  follows power for the thruster's size. No shock diamonds, no flicker, no smoke.
- **Colour** by propellant: xenon blue-violet, krypton pale lilac-white, argon pink-violet, iodine
  yellow-green. The readout's colour line names it ("xenon glowing blue-violet").
- **Switching on** is a soft fade-up. No ignition flash, no shudder.
- "Show inside" and the gas simulation switch are unavailable for a beam thruster, with a note
  saying why, as for other engines the simulation cannot cover.
- The picker's silhouette cards need a shape for each beam thruster.

## The page

- **Controls.** Power appears for all four. Voltage and diameter appear for beam thrusters, which
  hide the exhaust picker, the chamber, throat, nozzle and chamber-pressure controls. Thermal
  electrics keep all the ordinary engine controls except mixture.
- **Readouts.** Thrust switches unit by size (mN, N, kN). An electric engine's panel shows power,
  voltage and beam current (beam thrusters), gas temperature reached (thermal), propellant flow,
  exhaust speed, Isp and thrust efficiency. Figures that mean nothing for the engine in hand are
  not shown, never shown as zero.
- **Run-state line.** A beam thruster reads "Running" or "Will not light in air" in place of the
  nozzle states.
- **Tips.** Every new control and readout has a plain-language tip, in the voice of the existing
  ones.
- **Altitude.** Picking a beam-thruster example, or changing the energy source to a beam thruster,
  moves the altitude to 100 km and the test log says why, so the first thing a builder sees is a
  thruster that can run. Dragging the altitude down shows it refuse. A beam thruster that is
  running when the air gets too thick shuts down with the same explanation. Nothing else on the
  page moves the altitude, and no existing engine's behaviour changes.
- **Changing energy source** to or from an electric one rebuilds the engine to a sensible starter
  of that kind (as changing source does today), with a starter power that runs within limits.

## Example engines

Published figures are from memory of the makers' data sheets and must be checked against a source
by the builder before they are pinned; where a source disagrees, the source wins and the record
names it.

| Example | Type | Propellant | Power | Voltage | Thrust | Isp |
|---|---|---|---|---|---|---|
| NSTAR (Deep Space 1, Dawn) | Gridded ion | Xenon | 2.3 kW | 1,100 V | 92 mN | 3,100 s |
| NEXT (DART) | Gridded ion | Xenon | 6.9 kW | 1,800 V | 236 mN | 4,190 s |
| SPT-100 | Hall | Xenon | 1.35 kW | 300 V | 83 mN | 1,600 s |
| XR-5 (was BPT-4000) | Hall | Xenon | 4.5 kW | 300 V | 290 mN | 1,790 s |
| MR-510 (commsat station-keeping) | Arcjet | Hydrazine | 2 kW | n/a | about 250 mN | about 600 s |

No resistojet example: I could not name one whose figures I trust enough to pin. If the builder
finds a sourced one (the MR-501B is the likely candidate), it may be added.

SpaceX's argon Starlink thruster was considered and left out. Its published figures (4.2 kW,
170 mN, 2,500 s) cannot be reached by a formula that also fits the SPT-100 without a constant made
up for that one engine, and its voltage and size are not published. Argon stays a propellant a
builder can pick; the record notes that the real thruster does better than this formula's argon.

## Order of building

Two stages, each leaving a working app:

1. Thermal electrics: power setting, share links, the small sizes, the two sources, the arcjet
   example.
2. Beam thrusters: formula, limits, cutaway, beam, controls, readouts, four examples.

## Left to the builder

- Names of new fields, failure kinds and functions.
- How propellant records are shared between the reactor and the thermal electrics.
- Whether the beam is drawn by the existing drawn-plume shader with new settings or by a small new
  one, so long as the gas simulation's shaders are untouched.
- The exact constants, within the rule that each is tuned once against the examples, never per
  example, and written down with its source.
- Layout of the electric readouts within the existing panel.

## Record

When built, `docs/future-work.md` gets a section "Electric thrusters (part 5)" saying what was
built, every constant and what it was tuned to, how close each example comes to its published
figures, and what was left out.
