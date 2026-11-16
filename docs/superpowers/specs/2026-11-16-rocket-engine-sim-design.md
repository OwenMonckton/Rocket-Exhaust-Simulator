# Rocket Engine Simulator — Design

Date: 2026-11-16
Status: Approved 2026-11-16

## Intent

A 2D, browser-based rocket engine sandbox in the spirit of Engine Simulator
(realenginesimulator.com), but for liquid/solid rocket engines. The screen shows
a cross-section through the engine centreline; pressing **Fire** lights it and a
plume streams out of the nozzle. The plume responds visibly and plausibly to the
engine's geometry, propellant, mixture ratio, throttle and altitude.

**Who it's for:** rocket enthusiasts, not engineers. Every control should do
something you can see and understand. It must be fun to poke at without any
background in propulsion.

**What "fun" means (from the user):**
1. Scaling an engine up to see how powerful it can get.
2. Changing altitude to watch an engine's performance and plume evolve as it
   climbs through the atmosphere.
3. Seeing distinct plume colours for different propellants.
4. Adjusting the fuel (mixture) ratio and seeing what happens.
5. Loading real engines and tweaking them to make them more powerful or more
   efficient.

## Goals

- Real-time cross-section view of the engine (chamber, converging section,
  throat, bell nozzle) with a live, animated plume.
- Plume shape driven by real nozzle physics: over-/under-expanded behaviour,
  shock diamonds (Mach diamonds), flow separation in a too-large nozzle at sea
  level, vacuum bloom.
- Plume colour/brightness driven by propellant, mixture ratio, and throttle.
- Live readouts: thrust, specific impulse (Isp), mass flow, chamber pressure,
  exit vs ambient pressure, chamber temperature, expansion state.
- Real-engine presets that can be tweaked, with a "stock vs yours" comparison.
- Limits that can be exceeded: push too far and the engine fails, so tinkering
  has a boundary to play against.
- Numbers for the real presets land within roughly ±10% of published thrust and
  Isp, so the sim feels credible.

## Non-goals

- CFD or any true flow-field solve. The plume is a physically-informed visual,
  not a simulation of gas dynamics.
- Running a chemical-equilibrium solver at runtime. Propellant properties come
  from precomputed tables.
- Modelling turbopumps, engine cycles (gas generator, staged combustion, etc.),
  injectors, or cooling-channel design.
- Vehicle flight, trajectories, staging, or multiple engines.
- 3D rendering.
- Mobile-first layout (desktop browser is the primary target; it should not
  break on a tablet, but phones aren't a design target).

## Anti-goals (would make it a failure even if it works)

- Needing propulsion knowledge to get anything to work, e.g. the engine
  refusing to fire because of an "invalid configuration" a novice can't decode.
  Every failure must explain itself in plain language.
- Plumes that look basically the same regardless of settings.
- Real presets producing numbers wildly off from reality.
- A wall of sliders with jargon labels. Every control has a plain-English label
  and a one-line hover explanation.

## Constraints

- Runs in current desktop Chrome, Edge, Firefox, Safari. Needs WebGL2.
- 60 fps on a typical laptop integrated GPU.
- Builds to a static site (deployable anywhere as plain files). Users can
  share individual engine builds as links (see Sharing builds).
- Developed with Node.js (v24 available on the dev machine).

## Approaches considered

1. **Web app — TypeScript + Vite, WebGL plume (chosen).** Plume drawn by a GPU
   fragment shader, which suits glowing, flickering exhaust and shock diamonds.
   Shareable as a link. Needs Node to develop, nothing to use.
2. **Single HTML file.** Zero tooling, but physics, presets and rendering in one
   file gets unwieldy, and the plume would likely look flatter.
3. **Desktop app (Python/C++).** Closest to the original Engine Simulator, but
   needs installing, is harder to share, and visuals take more work.

The user picked option 1.

## Design

### Tech stack (builder's call, stated here)

- Vite + TypeScript, no UI framework. Plain HTML/CSS controls.
- Raw WebGL2 for the plume (no three.js). Canvas2D or WebGL for the engine
  cross-section — builder's choice.
- Vitest for unit tests of the physics module.
- Physics lives in a pure, framework-free module (`src/physics/`) with no DOM or
  rendering dependencies, so it can be tested in isolation.

### Screen layout

```
+-------------------------------------------------------------+
| [Preset: Merlin 1D v]        ROCKET ENGINE SIMULATOR   [?]  |
+-----------------+-------------------------------------------+
| ENGINE          |                                           |
|  Chamber dia    |   sky / space background (altitude-tinted)|
|  Chamber length |     ____                                  |
|  Throat dia     |    |    \___                              |
|  Nozzle exit dia|    | ⊙  |___>  ≈≈≈◇≈≈◇≈≈◇≈≈ plume ≈≈≈≈>   |
|  Nozzle length  |    |____/                                 |
|  Chamber press. |                                           |
| PROPELLANT      |                                           |
|  Type [v]       +-------------------------------------------+
|  Mixture ratio  | THRUST 845 kN (stock 845, +0%)            |
| FLIGHT          | Isp 282 s   Mass flow 305 kg/s             |
|  Altitude ====  | Exit 0.7 bar vs ambient 1.0 bar            |
|  Throttle ====  | ► Over-expanded (plume pinched)            |
|  [▶ Ascent]     | Chamber temp ▓▓▓▓░  Pressure limit ▓▓▓░░   |
| [ 🔥 FIRE ]     |                                           |
+-----------------+-------------------------------------------+
```

The engine is drawn horizontally, firing left to right, as a half-cutaway
centreline section with the wall thickness visible. When firing, the interior
glows (hottest in the chamber, cooling through the nozzle). An optional overlay
toggle colours the interior flow by Mach number or temperature.

### Controls

All sliders show their value with units and have a short tooltip.

| Group | Control | Notes |
|---|---|---|
| Preset | Engine dropdown | Loads a real engine; any change afterwards marks it "modified". "Reset to stock" button. |
| Engine | Engine scale | 0.25× – 5×. Multiplies all geometry (chamber, throat, exit, lengths) together. The individual sliders below show the scaled values; editing one after scaling edits that dimension only. |
| Engine | Chamber diameter | Visual + affects chamber volume. |
| Engine | Chamber length | Visual + affects combustion completeness (via L*). |
| Engine | Throat diameter | Main driver of mass flow → thrust. |
| Engine | Nozzle exit diameter | Sets expansion ratio (shown as a derived readout). |
| Engine | Nozzle length | Bell length as % of an equivalent 15° cone (60–100%); small efficiency effect. |
| Engine | Chamber pressure | Main "power" knob. |
| Propellant | Type | Kerolox (LOX/RP-1), Hydrolox (LOX/LH2), Methalox (LOX/CH4), Hypergolic (N2O4/UDMH-type), Solid (APCP). |
| Propellant | Mixture ratio (O/F) | Range per propellant; disabled for solid. |
| Flight | Altitude | 0 – 100 km (100 km treated as vacuum). |
| Flight | Throttle | 40 – 100% (scales chamber pressure). Solid: no throttle. |
| Flight | Ascent | Sweeps altitude 0 → 100 km over ~30 s while firing; stop/pause. |
| — | Fire / Shut down | Ignition has a short start-up transient (~1 s); shutdown fades the plume. |

### Physics model

Quasi-1D isentropic nozzle flow with simple corrections. All steady-state;
transients are visual only.

**Propellant tables.** For each propellant, a small table of chamber
temperature Tc, ratio of specific heats γ, and molar mass M at several O/F
values across its usable range, linearly interpolated. Values taken from
standard published equilibrium results (e.g. NASA CEA outputs at ~70 bar);
pressure dependence of these is ignored. The table also carries plume-colour
parameters (see Plume).

**Chain of calculations:**
1. Throat area At, exit area Ae → expansion ratio ε = Ae/At.
2. Effective chamber pressure Pc = Pc_set × throttle.
3. Characteristic velocity c* from (γ, R, Tc), multiplied by a combustion
   efficiency η_c* that drops when L* (chamber volume / At) is too short for
   that propellant (e.g. full efficiency above a propellant-specific L*, sliding
   down to ~85% at a third of it).
4. Mass flow ṁ = Pc·At / c*.
5. Exit Mach Me solved numerically from the area–Mach relation for ε.
6. Exit pressure Pe and exit velocity Ve from isentropic relations.
7. Ambient pressure Pa(h) from the US Standard Atmosphere (piecewise to 86 km,
   ~0 above).
8. Thrust F = λ·ṁ·Ve + (Pe − Pa)·Ae, where λ is the nozzle divergence/length
   efficiency (≈0.98–0.99 for a full bell, lower for short nozzles).
9. Isp = F / (ṁ·g0). Also report sea-level and vacuum Isp regardless of current
   altitude.

**Expansion state** (drives plume shape and a plain-English label):
- Pe ≈ Pa (within ±10%): "Ideally expanded".
- Pe < Pa: "Over-expanded — plume pinched in by the air".
- Pe > Pa: "Under-expanded — plume balloons outward".
- Pe < ~0.4·Pa (Summerfield criterion): "Flow separation!" — the jet detaches
  inside the nozzle. Thrust is recomputed using the separation point as the
  effective exit (which also raises effective Pe), and the plume visibly
  detaches from the bell wall with a ragged edge and a warning.

**Failure limits** (the boundary to tinker against). Each has a meter on the
readout panel that turns amber at 85% and red at 100%:
- **Structural:** chamber hoop stress ∝ Pc × chamber diameter / wall
  thickness. Wall thickness is not a user control: it is the preset's wall
  thickness × Engine scale (walls grow with the engine). So uniform scaling
  leaves the structural meter unchanged; it rises with chamber pressure, and
  with widening the chamber *alone* via its individual slider. Exceeding →
  "Chamber burst".
- **Throat heating:** heat-flux proxy (Bartz-like scaling ∝ Pc^0.8 / Dt^0.2,
  times a Tc factor) against a fixed allowable. Exceeding → "Throat burn-through".
  (Bigger throats genuinely run cooler; that's fine.)
- **Combustion instability:** the size ceiling. Risk rises with chamber
  diameter (absolute, e.g. negligible below ~0.5 m, steep past the F-1's
  ~1 m), with a smaller contribution from chamber pressure. From ~70% the
  engine shudders (cross-section vibrates, plume pulses, small efficiency
  loss); at 100% it shakes itself apart → "Combustion instability destroyed the
  engine". The F-1 preset sits near 80% as a nod to its history.
- **Mixture ratio:** O/F beyond the propellant's table range is not allowed by
  the slider; at the slider's extremes the engine runs "rough" (flickery plume,
  reduced efficiency) but does not fail.

Limits are calibrated so that every real preset sits comfortably below 100%,
with the most aggressive preset (Raptor) near 85–90%. On failure: the plume cuts
out, a short burst/burn-through animation plays on the cross-section, a plain
message explains what happened and which knob to back off, and a "Rebuild"
button restores the engine to its last non-failing settings.

### Plume rendering

A WebGL2 fragment shader draws the plume in screen space downstream of the
nozzle exit, driven by uniforms from the physics:

- **Exit radius** and **pressure ratio Pe/Pa** set the plume envelope: necks
  inward when over-expanded, flares outward when under-expanded, wide soft
  bloom at vacuum (Pa→0) that fades with distance.
- **Shock diamonds**: visible when the plume is not ideally expanded and there
  is meaningful ambient pressure. Spacing ≈ 1.3·De·√(Me² − 1) (Prandtl's
  approximation), with brightness scaled by |Pe − Pa|. They fade out as
  altitude rises.
- **Length/brightness** scale with mass flow and throttle.
- **Colour** from propellant + O/F + Tc:
  - Kerolox: bright orange-yellow, sootier and darker-orange when fuel-rich;
    sometimes a dark soot-rich core at the exit.
  - Hydrolox: faint, nearly transparent blue-violet, with bright diamonds at
    sea level.
  - Methalox: clean blue core with orange-pink edges, sootless.
  - Hypergolic: orange-reddish with a slight brown tint.
  - Solid (APCP): very bright white-yellow, dense, with a trailing smoke
    effect.
  Oxidiser-rich mixtures shift whiter/bluer and slightly fainter; fuel-rich
  shifts toward each propellant's "rich" colour.
- **Turbulence**: animated noise for flicker and shear-layer breakup; more
  turbulent at sea level, smoother in vacuum.
- **Background**: sky gradient that darkens from blue to black with altitude.

Visual exaggeration is allowed for readability (e.g. diamonds brighter than in
reality), but the direction of every effect must match the physics.

### Readouts

- Thrust (kN) with "stock vs yours" delta % when a preset is loaded and
  modified.
- Isp now, Isp sea level, Isp vacuum (s), each with stock delta.
- Mass flow (kg/s), expansion ratio, chamber temperature (K).
- Exit pressure vs ambient pressure (bar) with expansion-state label.
- Thrust-to-engine-size isn't modelled (no mass model); "power" = thrust.
- Three limit meters: structural, throat heating, combustion instability.

### Sharing builds

A **Share** button copies a link that encodes the full setup in the URL
(fragment or query string): base preset id, every engine/propellant/flight
setting, and Engine scale. Opening the link loads that exact engine, with
"stock vs yours" comparing against the recorded base preset (or no comparison
if built from scratch). Settings state is therefore a single serialisable
object from the start; the URL is updated (without page reloads) as settings
change so the address bar is always shareable. A version number in the encoded
state guards against future format changes.

### Presets

Approximate published values; throat diameter for each is back-solved by the
builder so that the computed sea-level (or vacuum, for vacuum engines) thrust
matches the published figure.

| Engine | Propellant | Pc (bar) | O/F | ε | Notes |
|---|---|---|---|---|---|
| Merlin 1D | Kerolox | ~97 | ~2.36 | ~16 | Sea level |
| Merlin Vacuum | Kerolox | ~97 | ~2.36 | ~165 | Separates at sea level — nice demo |
| Raptor 2 | Methalox | ~300 | ~3.6 | ~40 | Highest Pc preset |
| RS-25 | Hydrolox | ~206 | ~6.0 | ~69 | |
| RD-180 | Kerolox | ~257 | ~2.72 | ~37 | |
| F-1 | Kerolox | ~70 | ~2.27 | ~16 | Biggest |
| RL10B-2 | Hydrolox | ~44 | ~5.88 | ~280 | Vacuum, huge nozzle |
| Generic solid booster | Solid | ~60 | — | ~10 | |

Chamber diameter/length for each are chosen to look right and give a
reasonable L*.

### Sound (stretch)

A simple Web Audio rumble (filtered noise whose loudness/pitch follow thrust
and throttle, muffled with altitude), muted by default. Do this only after
everything else works.

## Left to the builder

- Exact propellant table values (from published CEA results).
- Exact limit allowables and calibration constants, within the rules above.
- Slider ranges, provided all presets fit inside them with room to push
  further (roughly 3× for size, up to ~400 bar for Pc).
- Shader implementation details and visual tuning.
- File/module structure beyond the physics/rendering split.
- Styling of the UI (dark theme suits the subject).
- Whether the cross-section uses Canvas2D or WebGL.
- Edge cases such as a throat drawn wider than the chamber (clamp it),
  solid-motor behaviour (no throttle, burns until shut down), and how the
  plume is drawn inside a separated nozzle.
