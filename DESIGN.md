---
name: Rocket Engine Simulator
description: A hot-fire test console. The picture is the test stand and every number is test data.
colors:
  ground: "#1f2623"
  panel: "#29322e"
  panel-2: "#323d38"
  well: "#151b18"
  ink: "#141a17"
  line: "#44504a"
  text: "#e9ece6"
  dim: "#aab5ad"
  red: "#e5372b"
  red-fill: "#c92a1f"
  red-text: "#ff7468"
  yellow: "#f2c230"
  green: "#5fd08a"
typography:
  display:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "104px"
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: "0.005em"
    fontFeature: "tnum"
  headline:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.03em"
  title:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.02em"
    fontFeature: "tnum"
  body:
    fontFamily: "'Barlow', 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tnum"
  note:
    fontFamily: "'Barlow', 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.12em"
rounded:
  instrument: "2px"
  control: "3px"
  round: "50%"
spacing:
  gap: "8px"
  inset: "12px"
  gutter: "16px"
components:
  button:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  button-selected:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.yellow}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  button-fire:
    backgroundColor: "{colors.red-fill}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "10px 12px 11px"
    width: "216px"
    height: "60px"
  button-fire-hover:
    backgroundColor: "#b32218"
    textColor: "#ffffff"
  button-fire-firing:
    backgroundColor: "{colors.well}"
    textColor: "{colors.red-text}"
    rounded: "{rounded.control}"
  select:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
    width: "100%"
  callout:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.text}"
    rounded: "{rounded.round}"
    size: "24px"
  callout-lit:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.round}"
    size: "24px"
  gauge-bar:
    backgroundColor: "{colors.well}"
    rounded: "{rounded.instrument}"
    height: "12px"
  state-chip:
    textColor: "{colors.dim}"
    rounded: "{rounded.control}"
    padding: "3px 9px 4px"
  state-chip-ok:
    textColor: "{colors.green}"
  state-chip-attention:
    textColor: "{colors.yellow}"
  state-chip-over:
    textColor: "{colors.red-text}"
  engine-card:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  engine-card-current:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 11px 9px"
---

# Design System: Rocket Engine Simulator

## Overview

**Creative North Star: "The Test-Stand Control Room"**

The whole screen is one hot-fire test. The picture in the middle is the view of the engine on its stand, the column on the left is where the engine is built, the row under the picture is the console you fire it from, and the column on the right is the test data. Nothing is a "settings sidebar" or a "stat tile": every control changes the engine or the test, and every number is a reading from the physics.

The look is a working console, not a film prop. Surfaces are flat grey-green panels with thin dividing lines. There are no bezels, screws, glass, textures or toggle levers, and the controls are ordinary web controls (dropdowns, sliders, buttons, fold-open sections) so they behave the way everyone already expects. The character comes from the condensed engineering lettering, the very large thrust figure, the redline gauges and the timestamped test log.

Colour is kept for meaning. Almost everything is grey-green and off-white; red, yellow and green each have one job and appear nowhere else.

**Key Characteristics:**
- One screen, three columns and a console row; on a desktop nothing scrolls as a page.
- Three signal colours with one job each: red for fire and the redline, yellow for armed, attention and selection, green for within limits.
- Flat panels, thin lines, small corners. No decoration.
- Condensed bold capitals for figures and labels; a plain sans for sentences. Digits never jiggle as they change.
- Numbered marks on the engine match numbered part pickers in the Build column.
- Every reading says whether it is a forecast (engine cold) or live (engine lit).

## Colors

A dark grey-green console with off-white lettering and three signal colours.

### Primary
- **Fire Red** (#e5372b, `red`): the edge of the redline zone on every gauge, a gauge's fill once it passes its limit, and the border of anything that is firing or has failed (the clock while firing, the Shut down button, the failure notice).
- **Fire Button Red** (#c92a1f, `red-fill`): the fill of the Fire button. It is a deeper red than Fire Red so that white lettering on it is easy to read.
- **Red Lettering** (#ff7468, `red-text`): red words on a dark surface, where Fire Red would be too dim to read: "Firing", the firing clock, a gauge percentage past its limit, a failure line in the log, a separated nozzle.

### Secondary
- **Safety Yellow** (#f2c230, `yellow`): armed, attention and selection. The Armed label and the Standby clock; the forecast and running-up line above the readings; a gauge between 85% and its limit; a nozzle that is over- or under-expanded; warning lines in the log and under the gauges; the border of a notice. It also marks what is selected or switched on: the keyboard focus ring, the current engine in the picker, a callout under the pointer, Sound when on, a running Ascend or Descend.

### Tertiary
- **Within-Limits Green** (#5fd08a, `green`): a gauge's fill while it is below 85% of its limit, and a nozzle that is working as designed. Nothing else.

### Neutral
- **Console Ground** (#1f2623, `ground`): the page behind everything, the test log's background, and engine cards in the picker.
- **Panel** (#29322e, `panel`): the top bar, the Build column, the console row, the Test data column and pop-over panels.
- **Raised Panel** (#323d38, `panel-2`): the fill of buttons and dropdowns, and the current engine's card.
- **Well** (#151b18, `well`): the darkest green. The empty track of a gauge, the Shut down button, and (slightly see-through) the labels that sit on the picture.
- **Ink** (#141a17, `ink`): lettering on yellow, the fill of the numbered callouts, the tooltip, and the steel of the test stand.
- **Line** (#44504a, `line`): every divider and control border, and the slider track.
- **Off-White** (#e9ece6, `text`): all main lettering and figures, the slider handle, the ring around a callout.
- **Dim** (#aab5ad, `dim`): labels, notes under a control, units, and anything whose test has ended.

### Named Rules
**The One Job Rule.** Red means fire or past the redline. Yellow means armed, look here, or selected. Green means within limits. If a new element does not mean one of those things, it is grey-green or off-white.

**The Three Reds Rule.** Red has three shades because it has three surfaces: `red-fill` under white lettering, `red-text` for red lettering on dark, `red` for lines and gauge fills. Do not use `red` for small text or as a button fill.

## Typography

**Display Font:** Barlow Condensed 700 (with Arial Narrow, sans-serif)
**Body Font:** Barlow 400 and 700 (with Segoe UI, sans-serif)

Both are self-hosted in `assets/fonts` under the SIL Open Font License. Only weights 400 and 700 are loaded.

**Character:** Barlow Condensed in bold capitals reads like stencilled plant signage and instrument faces; plain Barlow keeps the explanations friendly and easy to read. Two weights only: regular for sentences, bold for anything that is a figure, a label or a name.

### Hierarchy
- **Display** (700, 104px, line-height 0.9): the thrust figure, the single largest thing on the screen. It drops to 88px below 1240px wide and 84px on a phone. Its unit sits beside it at about a third of the size, in Dim.
- **Headline** (700, 28px, uppercase, 0.03em): the engine's name in the top bar. The efficiency figure (34px) and the Fire button's word (32px, 0.1em) are in the same family of sizes.
- **Title** (700, 19 to 21px): mid-sized figures and names: throttle and altitude readings, gauge percentages, the nozzle state, engine names in the picker.
- **Body** (400, 15px, line-height 1.4): control names, dropdown text, buttons, sentences.
- **Note** (400, 13px, line-height 1.35, Dim): the line of explanation under a part picker or under a figure. The test log and tooltips use 13.5px.
- **Label** (700, 13px, uppercase, 0.12em, Dim): the name of a reading, a control or a panel ("Thrust", "Wall stress", "Parts", "Test log"). A label always names the thing directly beneath or beside it.

### Named Rules
**The Two Voices Rule.** Figures, labels and names are Barlow Condensed 700; sentences are Barlow in ordinary case. Capitals are kept for what is on the stand itself: the product's and engine's names, the gauges, the console's Throttle and Altitude, the clock, the Fire button, the nozzle state and the Armed line. Everything else is named in ordinary case, sections and readings alike ("Parts", "Test log", "Efficiency (Isp)"), so a capital label always means an instrument. Never write a sentence in condensed capitals, and never set a figure in the body face. In running text, paired figures take a slash ("283 s / 313 s") and lists take commas, not middle dots.

**The Steady Digits Rule.** Tabular figures are on for the whole page, so a number that changes many times a second does not shift sideways. Any element that shows a changing number must keep them on.

## Layout

On a desktop the page is a fixed grid that fills the window and does not scroll: a top bar across the full width, then three columns. The Build column on the left is 290px, the Test data column on the right is 320px, and the picture takes whatever is left. Under the picture, in the middle column, sits the console row. The Build column and the readings scroll inside themselves if they are too tall.

- **Top bar:** product name, the engine's name and one-line description, Change engine, then Display, Sound and Share pushed to the right.
- **Build column:** numbered part pickers, each a label, a dropdown and one line in condensed type saying what the part is doing to this engine now, from the physics ("Over-expanded here", "Flame at 3,549 K"). The part's description shows under it only while it is being picked; its tooltip carries it otherwise. Warnings from the physics always show, in Yellow. Then a fold-open "Tune the engine" section of sliders.
- **Picture:** the engine on its stand with the ground line. Small labels sit in its corners, 12px in from the edge: the run clock top left, the view switch top right, zoom bottom right.
- **Console row:** the Fire button sits on the picture's centreline with the Armed label above it; throttle to its left, the altitude scale to its right with the Ascend and Descend buttons under it, because they drive altitude.
- **Test data column:** the forecast/live line, the three limit gauges, thrust, efficiency, nozzle state, a fold-open "Engineer's numbers", then the test log on a darker ground at the bottom.

Spacing is tight and even: 16px from a panel's edge to its contents, 12px for things placed on the picture, 8px between neighbouring controls. Panels are separated by a single 1px Line, never by gaps or cards.

**Below 1240px** the side columns narrow to 250px and 280px, and the console takes two rows: altitude beside Fire, then Ascend and Descend beside throttle beneath. Below 1040px the altitude scale keeps three marks, not four.

**Below 900px** the page becomes one scrolling column. The picture (32% of the screen height, at least 190px) and the console stay pinned to the top, with a line of thrust and Isp at the head of the console; the test data, then the Build column, scroll underneath, and the column's thrust figure steps down to 52px since it is already pinned. The picture's altitude scale is left out where the picture is under 296px tall. Buttons and dropdowns get taller to be easier to tap.

## Elevation & Depth

The console is flat. Panels sit side by side on the same level and are told apart by a slightly different grey-green and a 1px line. Nothing at rest has a shadow, a bevel, a gloss or a blur.

The only things that cast a shadow are the few that float over the console for a moment and need to be seen as on top of it.

### Shadow Vocabulary
- **Pop-over** (`box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45)`): the Display menu.
- **Dialog** (`box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55)`): the engine picker.
- **Notice** (`box-shadow: 0 14px 40px rgba(0, 0, 0, 0.6)`): the failure notice over the picture.
- **Tooltip** (`box-shadow: 0 10px 24px rgba(0, 0, 0, 0.5)`): the hover tip.

### Named Rules
**The Flat Panel Rule.** If it is part of the console, it has no shadow. A soft dark shadow is only for something that opens over the console and closes again.

**The Solid Label Rule.** Labels on the picture (clock, view switch, zoom, notices) are the Well colour at 86 to 96% strength with a 1px border. They are nearly solid, never frosted or blurred.

## Shapes

Corners are barely rounded: 3px on every button, dropdown, panel, notice and chip, and 2px on the small instrument parts (gauge bars, the slider track and handle). The only round things are the numbered callouts and the small dot before the Armed label.

Borders are always 1px. A border's colour carries state: Line at rest, Dim on hover, Yellow when selected or asking for attention, Red when firing or failed. A dashed border means "forecast, not yet real".

Icons are simple line or solid shapes drawn as inline SVG (plus, minus, up and down triangles, pause bars). The fold-open chevron is two borders of a small square, turned.

## Components

### Buttons
Plain and flat; the border does the talking.
- **Shape:** gently squared (3px), 1px Line border, Raised Panel fill, Off-White body text, padding 6px 10px.
- **Hover:** the border brightens to Dim. Disabled buttons drop to 45% strength.
- **Switched on** (Sound on, a running sweep): border and lettering turn Yellow; the fill does not change.
- **Focus:** a 2px Yellow outline, 2px away from the control. The same ring is used on everything that can take focus.

### The Fire button
The one red button, and the largest control on the screen.
- **Armed:** Fire Button Red fill, white Barlow Condensed 700 at 32px in capitals with wide spacing, 216px wide and at least 60px tall. It is wide enough for its longer word so nothing beside it moves when the engine lights.
- **Hover / press:** the fill deepens slightly; pressing nudges it down 2px.
- **Firing:** it reads "Shut down" and inverts: Well fill, Red border, Red Lettering.
- **Armed label:** above it, a small yellow label with a dot: "Armed" (yellow), "Firing" (red), "Failed" (dim).

### Dropdowns and sliders
- **Dropdown:** the browser's own select, styled like a button and filling its column. A Dim label sits above it and, for part pickers, a Dim note sits below.
- **Slider:** a 4px Line track with a flat Off-White block for a handle (12px wide, 20px tall), in a 24px tall touch area. Its name and bold current value sit on one line above.
- **Altitude scale:** a slider with marks beneath it at sea level, 10 km, 40 km and vacuum (the 10 km mark drops out when the scale is short), each a short 1px tick with a small Dim caption.

### Fold-open sections
"Tune the engine", "Engineer's numbers" and the Display menu are the browser's own details element: a full-width bold row with a chevron on the right that turns over when open, separated by a 1px Line.

### Numbered callouts (signature)
Each part picker in the Build column carries a number in a small ring (20px) before its name. The same number sits on the engine in the picture as a 24px round button, Ink fill with an Off-White ring, joined to its part by a thin off-white leader line. Hovering a picker or a callout turns the number solid Yellow with Ink lettering. Clicking a callout takes you to its picker.

**The Same Number Rule.** A number on the engine and a number in the Build column always mean the same part. Numbers are counted from the pickers that are showing, so they never skip.

**The altitude scale.** Down the picture's right edge runs a thin Off-White rail marked Sea level, 10 km, 40 km and Vacuum, spread as the altitude slider is. A marker with the altitude in a Well-coloured label rides it, so the climb shows once the stand has fallen away. The fixed marks give way where the marker stands over them.

### Redline gauges (signature)
One gauge per limit (wall stress, heat load, instability): a label on the left, a bold percentage on the right, and a 12px Well bar beneath.
- The bar is ticked every tenth with faint off-white lines.
- The last stretch, from 85% to the end, is the redline: a see-through red zone with a solid 2px Red line where it starts.
- The fill is Green below 85%, Yellow from 85% up to the limit, and Red at or past the limit. The percentage turns Yellow, then Red Lettering, with it.

### Readings and the run state (signature)
- **A reading** is a Dim label, a bold condensed figure, and an optional Dim line of explanation.
- **The run-state line** at the top of the column says what every figure below it is: "Forecast: the engine is unlit" (yellow), "Running up" (yellow), or "Live readings" (off-white).
- **The Forecast Rule.** While the engine is unlit, every figure, gauge fill and the nozzle chip are shown at half strength and the chip's border is dashed. They come up to full strength as the engine lights, and the thrust figure counts up with it.
- **Nozzle state chip:** an uppercase condensed word in a 1px outlined box with no fill. Its colour is its meaning: Green when working as designed, Yellow when over- or under-expanded, Red Lettering when the flow has separated, Dim otherwise.

### Run clock
A small solid label on the top left of the picture: "Standby" in Yellow, "Hot-fire T+00:07" in Red Lettering with a Red border while firing, "Test ended" in Dim.

### Test log (signature)
A running list on the darker Console Ground at the foot of the Test data column. Each line is a condensed bold timestamp in Dim (STANDBY before the first ignition, then T+mm:ss since ignition) in a fixed 68px column, followed by a short plain sentence. Ignition and full power are bold; warnings are Yellow; a failure is bold Red Lettering. New lines slide up 4px and fade in.

### Notices
- **Toast:** a solid Well label with a Yellow border, centred near the top of the picture, for a one-line heads-up.
- **Failure notice:** a wider solid label with a Red border at the bottom centre of the picture: a condensed red title, a plain sentence saying what happened and what to change, and a button to rebuild.
- **Tooltip:** Ink fill, Line border, up to 300px wide, plain 13.5px text.

### Engine picker
A panel that opens under the top bar with a grid of engine cards. Each card is a button on Console Ground with a small line drawing of the engine on the left, its name in condensed capitals and a Dim description of up to three lines. The current engine has a Yellow border and a Raised Panel fill.

### Ignition
When the engine lights, a warm flash spreads from the nozzle exit and fades over 0.7 seconds, and the picture, the stand and the callouts shake together for half a second. For anyone who has asked their device for reduced motion there is no flash, no shake and no sliding: things simply change.

## Do's and Don'ts

### Do:
- **Do** follow the One Job Rule: red for fire and the redline, yellow for armed, attention and selection, green for within limits.
- **Do** keep surfaces flat: a solid grey-green fill, a 1px Line border where needed, 3px corners.
- **Do** set every figure, label and name in Barlow Condensed 700 capitals, and every sentence in Barlow.
- **Do** keep tabular figures on wherever a number changes.
- **Do** give every reading a Dim label that names it (in capitals only on a gauge), and a plain-English line beneath when the figure needs explaining.
- **Do** use the browser's own controls (select, range, button, details) and restyle them lightly.
- **Do** show state with the border and lettering colour, not with a new fill.
- **Do** say whether figures are a forecast or live, and show forecasts at half strength.
- **Do** switch off the flash, the shake and any sliding for reduced motion.
- **Do** use the colour variables on `:root` in `src/style.css` rather than typing a colour in.

### Don't:
- **Don't** use red, yellow or green as decoration, for a brand accent, or for an ordinary button.
- **Don't** add bezels, screws, glass, brushed-metal textures, glows or toggle levers. It is a console, not a prop.
- **Don't** put shadows on anything that is part of the console; shadows are for things that open over it.
- **Don't** blur or frost anything. Labels on the picture are nearly solid.
- **Don't** round corners beyond 3px, apart from the round numbered callouts and the status dot.
- **Don't** separate things with cards or boxes inside a panel; use a label, spacing and a 1px line.
- **Don't** add a third typeface or a third weight.
- **Don't** use an uppercase label as decoration above a heading. A label names a reading, a control or a panel, and nothing else.
- **Don't** show a figure that is not from the physics, or hide whether it was simulated or calculated.
