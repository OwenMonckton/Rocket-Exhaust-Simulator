# Engine builder, part 2: fuel and oxidiser chemistry — Design

Date: 2026-11-20
Status: Built

## Intent

A burning engine today can use one of four fixed fuel and oxidiser pairs, each a hand-typed
table. The user wants to choose **any fuel and any oxidiser independently**, from a long list,
and get a real answer back: how it performs, and whether it would work at all.

**Why (the user's words):** "The ability to see any crazy design they might have play out in real
time for them to see and read performance numbers." And of the fuels: "mix and match any and get
a real result back on if they would even work".

So the numbers have to be worked out, not looked up, and a pair that cannot work has to be seen
failing, not refused.

This is part 2 of the five in `2026-11-20-engine-builder-design.md`. Part 1 (an engine made of
parts) is built, on the `engine-parts` branch.

## Goals

- A combustion engine has two pickers, **fuel** and **oxidiser**. Any fuel goes with any
  oxidiser.
- The lists are wide: the ordinary propellants and the exotic ones (fluorine, chlorine
  trifluoride, boranes, lithium, aluminium slurries).
- Flame temperature, gas properties and efficiency for a pair come from a
  chemical-equilibrium calculation run in the browser, for the engine's own chamber pressure,
  mixture ratio and nozzle size.
- A pair that would not work **fails on screen** where the simulator can show the failure, and
  carries a plain warning where it cannot.
- A readout says what the exhaust is made of.
- A nuclear engine's working fluids (other than hydrogen) are worked out the same way, replacing
  part 1's estimates.

## Non-goals (this part)

- Plume colour from the exhaust's make-up (part 4). A calculated pair borrows a hand-picked look
  for now.
- Three-propellant engines (lithium, fluorine and hydrogen) and user-defined blends.
- Solid motor chemistry. The solid keeps its table.
- Changing how the nozzle, the flow view or the shock diamonds are calculated.
- Propellant density, tank size or vehicle performance.

## Anti-goals

- A fuel and oxidiser the pickers refuse, grey out or answer with an error.
- An example engine whose published-matching figures move.
- A number on screen that came from a calculation that did not settle. If the solver cannot
  find an answer, the engine says so; it never shows a wrong figure as if it were right.
- A fact about a propellant (lights on contact, detonates, toxic) that has no cited source.
- A frame-rate drop while the engine is running, or a stutter while a slider is dragged.

## Approaches

How the solver's answer reaches the rest of the simulator, which treats the exhaust as one
simple gas (one gamma, one molar mass) from chamber to exit:

1. **Chamber only.** The solver gives flame temperature and gas properties; the existing nozzle
   maths does the rest. Smallest change, but efficiency is off by several percent, because real
   exhaust keeps reacting as it expands and one fixed gamma cannot follow it (measured before
   planning: hydrogen and oxygen read 499 s where NASA's program gives 481 s).
2. **Chamber and nozzle, fitted back (chosen by the user).** The solver also follows the gas to
   the throat and the exit, then hands the simulator a simple gas that reproduces that result.
   The flow view, shock diamonds, separation and aerospike keep working unchanged. This is what
   the hand tables already do by tuning ("gamma is an effective value for the nozzle
   expansion"). The fit depends on nozzle size, so it is redone when the nozzle is resized.
3. **Replace the nozzle maths** with the solver's chemistry everywhere, the flow view included.
   Most faithful; rewrites the parts measured to about 1% and is several times the work.

Decided earlier with the user: a live solver, not a longer hand-typed list of pairs.

## Decided with the user

- **Fail on screen** (user's choice over "only warn"): where the simulator can show a pair not
  working, it does; the rest is a warning.
- **Approach 2** above.

## Claude's calls (not objected to when proposed, or made since)

- **The wild list from the start**, with liquid and solid droplets in the exhaust handled by
  the solver (boron oxide, alumina, lithium fluoride, soot).
- **Every engine is assumed to have an igniter.** Lighting on contact is a note, not a
  requirement; otherwise kerosene and oxygen would fail to light.
- **Fluorine-type oxidisers warn; they do not fail.** (A change from what was proposed in
  conversation, where exhaust eating the nozzle was listed as an on-screen failure.) Fluorine
  engines have been test-fired successfully in suitable materials, so failing every one would
  be a wrong answer.
- **Everything picked in the builder is calculated; only the examples keep their hand-tuned
  tables.** (Changed after the builder check.) Comparing RP-1 with gasoline has to be on one
  basis, and a tabled pair could never be pushed to flame-out. An example engine loads with its
  tuned table, shown in the pickers as its fuel and oxidiser with a note, "Tuned to the real
  engine's published figures". Changing its fuel or oxidiser, even back to the same one, moves
  it onto the calculation and marks it modified; "Reset to stock" restores the table. So a
  re-picked Merlin may read a little differently from the stock Merlin. A test reports how far
  the solver is from each of the four tables (RP-1, hydrogen and methane with liquid oxygen;
  UDMH with nitrogen tetroxide); moving the examples onto the solver is a later decision.
  The blank engine the simulator opens on is calculated RP-1 and liquid oxygen.
- **Hydrogen in a reactor keeps its table** (the NERVA example is pinned to it). The other five
  fluids move to the solver.
- **One-liquid engines are in**: choosing "None" as the oxidiser. A propellant runs alone only
  if its record says, with a source, that it is used that way (hydrazine, hydrogen peroxide,
  nitrous oxide, nitromethane; peroxide and nitrous oxide sit in the fuel list as well for
  this). Those break down over a catalyst, so the flame-out temperature does not apply to
  them. Any other fuel with "None" fails with its own message, "nothing to burn it with",
  whatever the solver says: equilibrium would have ethanol or a borane falling apart and
  giving off heat, which they do not do in a chamber.

## The solver

NASA's method, as documented in its CEA program's manual (Gordon and McBride, NASA RP-1311):
minimise the free energy of the mixture, subject to the atoms being conserved. Written here in
TypeScript; no browser version exists to reuse. The GPL-licensed ports (cpropep, RocketCEA) must
not be copied; NASA's own code (Apache-2.0) and equilibrium-c (MIT) may be read as references.

What it must do:

- **Chamber:** given the two propellants, their mixture ratio and the chamber pressure, find the
  flame temperature and what the gas is made of, starting from the propellants' own heat content
  at their storage temperature.
- **Liquid and solid products** appear and disappear as the calculation proceeds (graphite,
  alumina, boron oxide, lithium fluoride and the rest), as RP-1311 describes.
- **Nozzle:** follow the gas at constant entropy, still reacting, to the throat and to the exit
  for the engine's area ratio, giving characteristic velocity and vacuum efficiency.
- **Fixed temperature:** for a reactor, find what a fluid becomes at the core temperature and
  chamber pressure.
- **Report failure:** if it does not settle within RP-1311's iteration limit, it says so.

**Data.** NASA Glenn's `thermo.inp`, from `github.com/nasa/cea` (Apache-2.0; keep the NOTICE
attribution). A script turns the part needed into a data file checked into the repository:
products containing only C, H, O, N, F, Cl, B, Li, Al and Be, without ions, about 500 species
and roughly 75 KB compressed. The same file carries the heat content of about 67 propellants, which is where the ingredient lists start.

**Handing the result back.** For the engine as it stands, the fit produces the simple gas the
rest of the simulator uses (temperature, gamma, molar mass):

- temperature is the solver's real flame temperature, since the heat limits read it;
- gamma and molar mass are chosen so that the existing nozzle maths gives the solver's
  characteristic velocity and vacuum efficiency at the engine's area ratio.

The rough-running penalty near the ends of a tabled pair's slider does not apply to a
calculated pair either; flame-out replaces it. The pressure fudge applied to tabled pairs (`(pressure/70)^0.03` in `simulate`) does not apply to
a calculated pair; the solver already has the pressure.

**Droplets in the exhaust** cost efficiency beyond what equilibrium predicts, because droplets
lag the gas. A loss scaled from the share of the exhaust that is liquid or solid, anchored on
published figures (about 2% for an aluminised gel, about 4% for a solid with 20% aluminium).

**When it runs.** Never per frame. It runs when the fuel, oxidiser, mixture ratio, chamber
pressure or nozzle area ratio changes, and its results are kept. `simulate` stays a plain
function that returns at once.

## The ingredients

Each fuel and oxidiser is a record: name, one-line hover text, what it is made of, heat content
and storage temperature, and the facts below. A blend (Aerozine 50, MON, 75% ethanol, 90%
peroxide, FLOX) is a record that names its parts and their shares.

Target lists. An ingredient ships only if its heat content comes from NASA's file or another
cited source; any that cannot be sourced is left out and listed in `docs/future-work.md`.

- **Oxidisers (about 18):** liquid oxygen, liquid fluorine, FLOX, liquid ozone, oxygen
  difluoride, nitrogen trifluoride, chlorine trifluoride, chlorine pentafluoride, perchloryl
  fluoride, nitrogen tetroxide, MON-25, white and red fuming nitric acid, hydrogen peroxide (90%
  and 98%), nitrous oxide, tetranitromethane, and None.
- **Fuels (about 35):** hydrogen, methane, ethane, propane, acetylene, RP-1, gasoline, jet fuel,
  JP-10, Syntin, turpentine, ethanol (100% and 75%), methanol, isopropanol, ammonia, hydrazine,
  MMH, UDMH, Aerozine 50, UH25, aniline, furfuryl alcohol, diborane, pentaborane, lithium,
  aluminium slurry in kerosene, beryllium hydride slurry, cyanogen, nitromethane.

Facts per ingredient, each with its source noted beside it as the existing tables do:

| Fact | Used for |
|---|---|
| Chemical family (hydrocarbon, amine, alcohol, borane, metal, hydrogen; oxygen, nitrogen oxide or acid, peroxide, halogen) | whether a pair lights on contact; the borrowed plume look; chamber length needed |
| Detonates when shocked or decomposes explosively, and any safe dilution | on-screen failure |
| Freezing and boiling point | storage note; one freezing the other |
| Attacks ordinary engine materials | warning |
| Toxicity, on a short scale, and whether the exhaust is toxic | warning |

Whether a pair lights on contact comes from family-against-family rules plus named exceptions,
each rule sourced (Clark, *Ignition!*; Sutton, *Rocket Propulsion Elements*).

## Whether it works

**Fails on screen** (the engine stops or is destroyed, with a message, as bursting and burning
through do now):

- **Will not sustain a flame.** The calculated flame temperature at this mixture is below what
  keeps a two-liquid flame burning (one threshold for all pairs; one-liquid engines are exempt). New failure. This is how a mixture slider pushed to either extreme ends, and
  how a pair with nothing to burn ends.
- **Detonates.** A propellant that explodes when shocked or pumped (pure liquid ozone,
  acetylene, tetranitromethane) destroys the engine when fired. New failure.
- **Burns through, bursts, unstable:** existing failures, with the heat model unchanged. A
  hotter flame (fluorine and hydrogen, cyanogen and ozone) runs closer to the heat limit and
  burns through at a lower chamber pressure than a cooler one; it is not made to fail at
  ordinary pressures, and the heat limit is not retuned.

**Warns** (a note beside the pickers; the engine runs):

- needs an igniter, or lights on contact;
- one propellant would freeze the other in neighbouring plumbing;
- attacks ordinary engine materials;
- toxic propellant, toxic exhaust;
- a large share of the exhaust is droplets, or soot;
- hydrazine alone: real thrusters stop the breakdown of ammonia part-way, so the equilibrium
  figure is not what a real thruster gives.

## On screen

```
Parts
 Energy     [Combustion chamber ▾]
 Exhaust    [Bell nozzle ▾]
 Fuel       [Pentaborane ▾]
 Oxidiser   [Oxygen difluoride ▾]
 Lights on contact.  ⚠ Extremely toxic.  ⚠ Attacks ordinary metals.
 ⚠ 9% of the exhaust is liquid boron oxide.

 Mixture ratio  ────●──────  3.1

Exhaust
 Hydrogen fluoride 41% · Boron oxyfluoride 22% · Hydrogen 14% · …
```

- The single Propellant picker becomes Fuel and Oxidiser when the energy source is a combustion
  chamber. Other sources keep one picker. Both lists are grouped (everyday, storable, exotic),
  each option with hover text.
- Changing either puts the mixture ratio at the pair's most efficient setting. The slider's
  range reaches flame-out at the oxidiser-rich end, and at the fuel-rich end for fuels that
  go cold there (hydrogen). Kerosene, hydrazines and boranes do not: at equilibrium they fall
  apart and give off heat with almost no oxidiser, so that end runs cool but does not go out.
  (Found while planning; recorded as a known limit.)
- The exhaust readout lists the main things in the exhaust at the nozzle exit by share, with
  plain names.
- Loading an example shows its fuel and oxidiser in the two pickers.

## Constraints

- **Regression:** the twelve examples' pinned figures (`presets.regression.test.ts`) do not
  change.
- **Accuracy:** against NASA CEA output published with full conditions (RocketCEA's
  documentation: a nitrogen tetroxide and MMH sweep, and hydrogen and oxygen figures), flame
  temperature, molar mass, characteristic velocity and vacuum efficiency within 1%. Against the
  1971 Huzel and Huang table (eleven pairs, fluorine and chlorine pentafluoride among them),
  within 3%. At least one test pair with droplets in the exhaust.
- **The fit:** the simulator's vacuum efficiency and characteristic velocity for a calculated
  pair are within 0.5% of the solver's own, before the simulator's usual losses.
- **Speed:** measure the solver first. Dragging the mixture, pressure or nozzle sliders must
  stay smooth, and the frame rate with the engine running must not drop. If one solve is too
  slow for that, run it off the main thread and show the previous figures until it returns.
- **Share links** get a new version carrying fuel and oxidiser. Links in the two older formats
  still open exactly as they do now.
- **Always made valid:** an unknown fuel or oxidiser id becomes the first in its list.
- **Nuclear fluids:** ammonia, methane, water, carbon dioxide and helium come from the solver.
  The solver's answer wins. As a check, its ideal vacuum efficiency (before the simulator's
  losses) at 2,800 K is compared with Zubrin's published ideal figures (methane 606 s, water
  370 s, carbon dioxide 283 s). Those are for an infinitely large nozzle; the study gives about
  93% of them at an area ratio of 100, states no pressure, and does not cover ammonia. So the
  check is at area ratio 100 against 93% of each figure: each should be nearer than part 1's
  estimate was, and any still more than 5% out is explained in `docs/future-work.md`. Soot from methane lags the gas
  like any other droplet, so the droplet loss applies to reactor fluids too. Helium is added to
  the data file's elements.
- Existing conventions hold: plain-English labels with hover text, tests beside the code,
  no new runtime dependencies.

## Left to the builder

- How a fuel and oxidiser are held in the engine's settings, and how the four tabled pairs are
  recognised.
- The species list within the ten elements, and whether to trim it for speed.
- The flame temperature below which a mixture will not sustain, from a cited source. (Found
  before planning: 800 K. NASA SP-8081 lists working gas generators burning at 811 K, so the
  1,500 K rule of thumb would wrongly put out the F-1's own.)
- The mixture slider's range and step for a calculated pair.
- The chamber length each fuel family needs to burn completely (`lStarRef`), from the existing
  four as anchors.
- Which hand-picked plume look each family borrows until part 4.
- Where results are kept, and at what spacing of pressure and nozzle size they are reused.
- Layout and wording of the notes and the exhaust readout.
- Whether to generate extra reference figures by running NASA's CEA locally.
