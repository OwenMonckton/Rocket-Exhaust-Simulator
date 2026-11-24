# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Tinkerers and builders: space enthusiasts who want to build rocket engines from parts, push them to their limits, compare the numbers and share what they made. They are comfortable with some jargon but are not rocket engineers, and neither is the owner.

They use it on a laptop or desktop screen. A phone must work, with a simpler layout, so that a shared link is not broken.

## Product Purpose

A 2D rocket engine simulator that runs in the browser. You pick an example engine or build your own, fire it, and watch a simulated exhaust plume change as the engine climbs from sea level to vacuum, while the readouts show thrust, efficiency and what the nozzle is doing.

Success is enthusiast-level fun: someone builds an engine they are curious about, sees it behave believably, and understands why.

## Positioning

The plume is not a drawing. A gas simulation runs from the combustion chamber through the nozzle and out into the air, and the figures beside it come from the same physics and chemistry, so what you build is what you see.

## Operating Context

- Twelve example engines (Merlin 1D, RS-25, Raptor, F-1, RD-180, NERVA, a solid booster, an aerospike and others), each pinned by a regression test so it always behaves the same.
- An engine builder: energy source (combustion chamber, solid motor, nuclear reactor, nuclear salt water), exhaust type (bell, plain cone, dual bell, aerospike, no nozzle), fuel and oxidiser.
- A fire control, a throttle, and an altitude control from sea level to 1000 km with an automatic ascent and descent.
- Views inside the engine: flame, gas speed, gas temperature.
- Limits that can be exceeded: wall stress, heat load and instability, with failures that explain themselves and a rebuild.
- A share link that carries the whole engine in the URL.
- Published as a static site on GitHub Pages.

## Capabilities and Constraints

- TypeScript, Vite, Vitest and WebGL2. No framework and no backend.
- The gas simulation needs WebGL2 and a reasonable graphics card; there is a fallback message without it.
- Every figure shown comes from the physics. Nothing is faked or rounded for show, and the difference between a simulated figure and a calculated one stays visible somewhere.
- Every control that exists today stays reachable. Controls may move or be tucked away, but nothing a user can do now is removed.
- Not established as binding by the owner: the exact current wording of labels and tips, and the current share-link behaviour. (Old share links are covered by tests in the code today.)
- Planned but not built: an expansion-deflection nozzle, plume colour from exhaust make-up, electric thrusters.

## Evidence on Hand

- The running simulation itself, and the example engines modelled on real ones.
- `docs/future-work.md`: the plain-English record of what was built, what was left and the known limits.
- A measuring tool in `src/dev/accuracy.ts` that compares simulated figures against calculated ones.
- No testimonials, users counts, press or logo exist. Do not invent any.

## Product Principles

1. Building is the point. The first minute should be easy, but the depth for someone who stays and tinkers is the product, not an advanced mode.
2. Honest numbers over impressive ones.
3. Show why, not only what: when an engine misbehaves or fails, say what happened and what to change.
4. Nothing is taken away. Simplifying means arranging and tucking, never removing.
5. Desktop is where it is designed; a phone must not be broken.
