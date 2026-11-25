# Plume colour from the exhaust's make-up (engine builder, part 4)

Status: approved and built, 25 November 2026. What was built, and where it departed from this, is in `docs/future-work.md` under "Plume colour piece".

## What it is for

An engine built from a fuel and an oxidiser should look like itself. Today a calculated pair borrows
the hand-picked look of the nearest tabled propellant, so pentaborane with oxygen, or aluminium
slurry with oxygen, burns the same orange as kerosene. The chemistry already knows what leaves the
nozzle. This piece makes the picture read it.

## Goals

- A calculated pair's plume takes its colours, brightness, soot, smoke and sparks from the exhaust's
  make-up at the nozzle exit, the flame temperature, and how much of the exhaust is solid or liquid.
- The same for the reactor fluids the solver works out: ammonia, methane, water, carbon dioxide and
  helium.
- The look follows the mixture slider as the make-up changes: richer kerosene gets sootier, without
  a separate rule.
- One line of plain words says what is colouring the plume, beside the exhaust's make-up under
  "Engineer's numbers" (for example "Colour: soot glowing orange, with a green tinge from boron").

## Not in this piece

- The twelve example engines. They keep their hand-picked looks exactly (owner's decision). So do
  the tabled propellants they use, the solid motor, tabled hydrogen in a reactor, and salt water.
- The shader, the gas simulation and the plume's shape. Only the look handed to them changes.
- Real spectroscopy. Colours are the ones each family of exhaust is known for, turned up enough to
  see.

## What would make it a failure

- An example engine that looks different afterwards.
- A plume that is invisible, black, or the same for every exotic pair.
- A colour that contradicts the make-up line beside it.

## Approaches considered

1. **A recipe by family of exhaust (chosen).** Each species in the exhaust belongs to a family that
   glows a known way: soot orange-yellow, steam and hydrogen a faint pale blue, carbon monoxide and
   dioxide blue, boron oxides green, lithium crimson, alumina and beryllia brilliant white and
   smoky, hydrogen fluoride and chloride nearly clear, cyanogen violet, nitrogen oxides
   orange-brown, helium and nitrogen nothing. The look is the blend of those, weighted by each
   family's share and how strongly it shows, then brightened by temperature. Cheap, explainable in
   one line of words, and easy to tune against the hand-picked looks.
2. **Physics of light.** Black-body glow from the exit temperature and soot, plus spectral lines per
   species. Truer, but a real hydrogen plume is almost invisible and most exotic differences are
   faint, so it would be much more work for a duller picture.
3. **A tint per ingredient.** Blend a colour chosen for the fuel with one for the oxidiser. Simplest,
   but it ignores the mixture and is not "from the make-up", which is the point of the piece.

Chosen: 1, by the owner handing the choice over ("go with your pick").

## The design

- **One new function**, `lookFromExhaust`, in a new file `src/physics/plumeLook.ts` (first written here as `src/render/`; the physics has to call it, and physics does not import from the drawing code). It takes the
  exhaust's make-up (species and share), the flame temperature and the share of the exhaust that is
  solid or liquid, and returns the same `PlumeLook` record the hand-picked looks use, plus the line
  of words.
- **A table of families**: for each, which species belong to it, its colour, how strongly it shows
  per unit share, and what it adds to soot, smoke and sparks. Every species the solver can return
  belongs to a family or is listed as showing nothing; a test checks none is forgotten.
- **Where it is used**: `src/physics/gasSource.ts`, in the two places a look is borrowed today (a
  calculated pair, and a solver-worked reactor fluid). When the solver has no settled gas, the
  borrowed look stands, as now.
- **Afterburn** (unburnt fuel burning where the plume meets the air) comes from the share of
  hydrogen, carbon monoxide, methane and soot left in the exhaust.
- **No double counting.** The existing rule that tints a plume by how fuel-rich it is stays for
  hand-picked looks and is skipped for a derived one, whose make-up already carries the mixture.
- **Tuning target.** At their usual mixtures, calculated kerosene, methane and hydrogen with oxygen
  come out recognisably like the hand-picked kerolox, methalox and hydrolox looks: the same order of
  colour, opacity and soot. Close, not identical.

## How it will be checked

- Every example engine's look is the same record as before.
- Signature tests: pentaborane with oxygen is greener than kerosene with oxygen; hydrogen with
  fluorine is fainter than kerosene with oxygen; aluminium slurry is smokier and whiter; lithium
  shows red; richer kerosene is sootier than lean; helium in a reactor is nearly invisible.
- Every fuel against oxygen, and hydrogen against every oxidiser, gives a look whose every number is
  finite and within range, and whose plume is not invisible unless the make-up says so.
- The tuning target above, as a test with a stated tolerance.
- In a browser: the three everyday pairs beside their example engines, and five exotic pairs.

## Left to the builder

- The exact colours and strengths in the family table, within the tuning target.
- How temperature brightens and whitens the core.
- The wording of the colour line, in the page's plain voice.

## Calls made without asking

- Colours are turned up enough to see; they are not photometrically true.
- The solver-worked reactor fluids are included, since they borrow looks the same way.
- The colour line is added to the page. It can be dropped without affecting the rest.
