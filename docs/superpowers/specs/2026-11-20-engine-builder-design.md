# Engine builder, part 1: an engine made of parts — Design

Date: 2026-11-20
Status: Draft, awaiting approval

## Intent

Today the simulator opens on a real engine (Merlin 1D) and you tweak it. The user wants it to
open on a **build-your-own engine**, assembled from independent parts, with the real engines kept
as examples.

**Why (the user's words):** "The ability to see any crazy design they might have play out in real
time for them to see and read performance numbers."

So the builder never refuses a design. Any combination fires; a bad one shows why it is bad (it
barely pushes, it melts, it bursts) through the picture and the numbers, using the failure
messages the simulator already has.

## The whole request, and where this part sits

The full request is five pieces of work. They are designed and built one at a time, in this
order. This document covers **only part 1**.

1. **An engine made of parts, and the workshop screen** (this document). Includes choosing the
   working fluid of a nuclear engine, ammonia among them.
2. **Fuel and oxidiser chemistry.** Any fuel with any oxidiser, worked out live in the browser by
   a small chemical-equilibrium solver, replacing the hand-typed tables for burning engines.
   Decided with the user: live solver, not a longer hand-typed list.
3. **More exhaust types:** plain cone, dual bell, expansion-deflection, no nozzle.
4. **Plume colour from what is in the exhaust**, replacing hand-picked colours.
5. **Electric thrusters** (ion, Hall effect), which need their own view: no chamber, throat or
   hot gas.

Part 1 must leave the code shaped so that parts 2–5 each add or replace one part, without
another restructuring.

## Goals

- An engine is described by three independent choices: **energy source**, **exhaust type**,
  **propellant**. Each is a separate record in the code and a separate picker on screen.
- The simulator opens on a blank custom engine, not a real one.
- Every energy source works with every exhaust type (a nuclear aerospike, a solid-motor
  aerospike).
- A nuclear thermal engine can run on a choice of working fluids, including ammonia, with honest
  numbers for each.
- Real engines are examples: loading one fills in the three parts and the dimensions, and
  everything about it can then be changed.
- Every real engine gives exactly the numbers it gives today.

## Non-goals (this part)

- Mixing any fuel with any oxidiser. Burning engines keep today's four propellant pairs until
  part 2.
- New nozzle shapes, chemistry-driven colour, electric thrusters (parts 3–5).
- Changes to the gas solvers.

## Anti-goals

- A combination that the simulator refuses, greys out or answers with an error.
- A real engine whose thrust or efficiency shifts because of the restructuring.
- A picker that needs propulsion knowledge to use. Every option has a plain name and a one-line
  hover explanation, as every control does today.

## Approaches

1. **Three part records, three ids in the engine's settings (chosen).** Energy source, exhaust
   type and propellant each get their own table of records. The engine's settings hold one id
   for each. Behaviour that today hangs off "propellant" moves to whichever part really owns it.
   Parts 2–5 then each extend one table. Costs a pass through about twenty files that read
   `propellant` or `aerospike` today.
2. **Keep the bundle, add more bundles.** Add entries such as "nuclear, ammonia" to the existing
   propellant table and have the pickers map onto them. Cheapest now, but the entries multiply
   with every new fluid and exhaust, and part 2 (free mixing) would have to undo it.
3. **A plug-in interface**, each part supplying its own physics and drawing code. Over-built:
   the sources share one nozzle model and one gas solver, and there are four sources and two
   exhausts.

The user handed over how it is built; approach 1 is Claude's call.

## Decided with the user

- **The builder never refuses a design** (proposed by Claude from the user's stated purpose; not
  objected to).
- **The screen is one workshop**, not a step-by-step start page (user picked "option A"): the
  current screen, opening on a blank engine, with part pickers at the top of the left panel,
  sliders below that change to suit, and the engine redrawing as parts are swapped. Real engines
  move to an "Examples" menu.

```
[Energy: Combustion ▾] [Exhaust: Bell ▾]        Examples ▾
[Propellant: Kerolox ▾]
 sliders…                         (engine + plume)
```

## The parts

### Energy source (new record)

Four sources. Each owns what today is spread across `Propellant` in `src/physics/types.ts`:
whether it throttles, what the "mixture" slider means (`mixKind`, `mixLabel`), the core
temperature limit, the wall heat factor, the instability reference diameter, and whether the
chamber needs a characteristic length to burn in.

| Source | What it is | Propellants offered |
|---|---|---|
| Combustion chamber | burns a liquid fuel with a liquid oxidiser | kerolox, hydrolox, methalox, hypergolic |
| Solid motor | a cast grain burning from the inside | APCP |
| Nuclear reactor | a reactor core heats a fluid; nothing burns | hydrogen, ammonia, methane, water, carbon dioxide, helium |
| Nuclear salt water | uranium salt water fissions in the nozzle | uranium salt water |

The characteristic length a liquid needs (`lStarRef`) stays with the propellant, since it
differs between kerosene and hydrogen.

### Exhaust type (replaces the `aerospike` on/off flag)

Two types for now, bell and aerospike, as an id rather than a flag so that part 3 can add to
it. What an aerospike changes (cell count instead of chamber count, slider labels, no nozzle
extension) is unchanged.

### Propellant

A propellant keeps its name, its table of temperature, gamma and molar mass, its plume look,
and the range and default of its slider. It records which energy source it belongs to.

**Nuclear working fluids.** For each, the gas temperature is the core temperature, and the table
gives gamma and molar mass against temperature, allowing for the fluid breaking apart as it is
heated (ammonia into nitrogen and hydrogen, so about 8.5 kg/kmol; methane into hydrogen and
carbon; water and carbon dioxide partly dissociating at the hot end). Figures from published
nuclear-thermal propellant studies, with the source noted beside each table as the existing
tables do. Expected vacuum efficiency in the NERVA example's shape, as a sanity check for the
tests: ammonia roughly half of hydrogen's (around 400 s against 841 s), water and carbon dioxide
lower still, helium around 60% of hydrogen's. Each fluid gets a hand-picked plume look until
part 4.

## Behaviour

- **Opening the simulator** with no shared link shows a custom engine: combustion chamber, bell,
  kerolox, at mid-range proportions that run comfortably inside every limit. It is not tied to
  any example, so "Reset to stock" is disabled and the blurb reads as a custom engine.
- **Changing the energy source** switches the propellant to that source's first one, sets the
  slider to its default, and reshapes the chamber to that source's usual proportions (a solid
  motor's long grain, a reactor's wide core, the salt-water engine's feed pipe) while keeping
  the throat and exit diameters and the chamber pressure. These proportions are the ones the
  examples in `src/physics/presets.ts` already use. (Claude's call: without it, switching a
  combustion engine to a reactor gives a reactor the size of an injector.) The wall thickness is
  re-derived so the engine sits at the same fraction of its structural limit as before the
  change; the wall is not a user control, and a wider chamber on the old wall would burst the
  moment the source was picked. (Claude's call.)
- **Changing the exhaust type** keeps the engine's total throat area and total exit area, so
  thrust stays about the same. Switching to an aerospike sets 20 cells and shrinks the per-cell
  dimensions to match (diameters divided by √20, wall thinned in proportion); switching back to
  a bell merges them into one chamber the same way. A nozzle extension is dropped on switching
  to an aerospike, as `sanitize` already does. (Claude's call.)
- **A count slider** (new control, Claude's call): "Chambers", 1–4, for a bell; "Thrust cells",
  1–40, for an aerospike. It changes the count only, so thrust and flow rise and fall with it.
  Today the count can only arrive with an example, which would leave every home-built aerospike
  at 20 cells. Nozzle extensions stay example-only in this part.
- **Changing the propellant** behaves as now: the slider goes to the new propellant's default.
- **Changing any part of a loaded example** leaves it marked as a modified version of that
  example, as changing its propellant does today, and "Reset to stock" restores all three parts.
- **Examples menu.** The existing preset menu, relabelled "Examples". Its first entry, "New
  engine", is selectable and loads the blank opening engine, so there is always a way back to
  a clean start. An engine tied to no example shows as "Your engine". (Claude's call.)
- **Failures** read from the energy source instead of the propellant (a meltdown belongs to a
  reactor whatever fluid is in it).

## Constraints

- **Regression:** for each of the twelve examples, at sea level and in vacuum, `simulate` returns
  the same thrust, efficiency, flow and limits after the change as before, to floating-point
  tolerance. Capture the figures before restructuring.
- **Old share links keep working.** The link format gets a new version carrying the three part
  ids. A link in the old format still opens: its propellant id maps to an energy source and a
  propellant (`nuclear` to reactor + hydrogen, `saltwater` to salt water, `solid` to solid
  motor + APCP, the rest to combustion), and its aerospike flag to an exhaust type.
- **A part combination is always made valid, never rejected:** `sanitize` in
  `src/physics/engine.ts` swaps a propellant that doesn't belong to the energy source for that
  source's first one, as it already clamps numbers.
- Existing conventions hold: plain-English labels with hover text in `src/ui/copy.ts`, tests
  beside the code, 60 fps.

## Left to the builder

- Names and file layout of the new records, and whether `PropellantId` stays a union or becomes
  a string checked against the table.
- The exact proportions of the opening engine, within "comfortably inside every limit".
- The nuclear fluids' table values and looks, within the sources and sanity figures above.
- Whether the aerospike drawing and the gas grids need any change to accept a solid motor or a
  reactor behind the thrust cells. They are expected to work as they are, since they take gas
  properties and dimensions, not a propellant name; check each new combination lit from cold
  with `src/dev/accuracy.ts` and in the browser, and fix what is found.
- Layout of the pickers within the left panel.
