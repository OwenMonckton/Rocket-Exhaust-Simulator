---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# Surface: the simulator (index.html)

Mode: Operate. Audience: tinkerers and builders on desktop; phone must work. Job: build an engine and run a hot-fire test of it. Primary action: Fire. Constraints: every current control stays reachable; every figure is from the physics; share links keep working; simulation code untouched.

Memorable moment: pressing Fire on the stand, thrust counting up, the test log recording ignition; then the stand falling away as altitude rises to vacuum.

Unresolved: none blocking. Sound stays off by default with an invitation on first fire.

## Direction contract

THESIS: A hot-fire test. The picture is the view of the test stand and every number is test data; it refuses the settings-sidebar-plus-stat-tiles dashboard where firing is a toggle.

OWN-WORLD: Console grey-green ground (#1f2623) with lighter panels, off-white type, condensed engineering sans with tabular figures, small uppercase labels. Red only for Fire and redline zones, safety yellow for armed and attention, green for within limits. Flat, dense, precise: no bezels, screws, glass or levers. Standard web controls.

STORY: The builder sees their engine on the stand, picks numbered parts whose numbers sit on the engine, arms and fires, reads thrust, efficiency and nozzle state, watches limits against a redline, and sweeps altitude until the stand falls away.

FIRST VIEWPORT: Top bar with engine nameplate, description and Change engine. Left 280px Build column: four numbered part pickers, collapsed Tune the engine. Centre: stage with engine on a stand and ground line, numbered callouts. Under it a console row: throttle, altitude scale with sea level / 10 km / vacuum marks and play, large red Fire with Armed label, bottom centre. Right 300px: three redline gauges, thrust very large, efficiency, nozzle state chip. Test log beneath.

FORM: User's stated direction, test-stand control room, chosen on the decision page round over the assigned candidate 3 (press-kit cutaway), whose numbered callouts are carried over. seed:521c3ae6125ad82a. Signature move: redline gauges plus the timestamped test log. Motion grammar: ignition flash, brief shake, thrust count-up, log lines arriving; reduced motion snaps.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
