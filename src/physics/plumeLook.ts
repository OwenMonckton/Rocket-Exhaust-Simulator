import { SPECIES } from './chem/thermo';
import type { PlumeLook, RGB } from './types';

/**
 * A plume's look, worked out from what the chemistry says leaves the nozzle. Each species in the
 * exhaust belongs to a family that glows a known way; the look is the blend of the families that
 * are there. The colours are the ones each family is known for, turned up enough to see. They are
 * not photometry.
 */

export type FamilyId =
  | 'soot'
  | 'steam'
  | 'carbonOxide'
  | 'boron'
  | 'lithium'
  | 'aluminium'
  | 'beryllium'
  | 'halide'
  | 'chlorine'
  | 'cyanogen'
  | 'nitrogenOxide'
  | 'hydrocarbon'
  | 'none';

export interface ExhaustFamily {
  id: FamilyId;
  /** How the colour line names it, as the main colour and as a lesser one, unless what is listed calls for other words (`wordsFor`) */
  words: { main: string; tinge: string };
  colour: RGB;
  /** How strongly a unit share shows, 0 (nothing) upward */
  strength: number;
  soot: number;
  smoke: number;
  particles: number;
  /** True when it burns where the plume meets the air */
  burns: boolean;
}

const family = (
  id: FamilyId,
  main: string,
  tinge: string,
  colour: RGB,
  strength: number,
  extra: Partial<Pick<ExhaustFamily, 'soot' | 'smoke' | 'particles' | 'burns'>> = {},
): ExhaustFamily => ({ id, words: { main, tinge }, colour, strength, soot: 0, smoke: 0, particles: 0, burns: false, ...extra });

export const FAMILIES: Record<FamilyId, ExhaustFamily> = {
  // Glowing carbon outshines any gas beside it, so a little goes a long way. White-hot droplets of
  // a metal's oxide outshine even that.
  soot: family('soot', 'soot glowing orange', 'an orange glow from soot', [1.0, 0.62, 0.15], 12, { soot: 3, smoke: 0.5, particles: 2, burns: true }),
  steam: family('steam', 'the faint blue of steam', 'a faint blue from steam', [0.5, 0.62, 1.0], 0.42, { burns: true }),
  carbonOxide: family('carbonOxide', 'the blue-violet of burning carbon monoxide', 'a blue-violet tinge from carbon oxides', [0.55, 0.4, 1.0], 0.84, { burns: true }),
  boron: family('boron', 'boron burning green', 'a green tinge from boron', [0.35, 1.0, 0.4], 2.5),
  lithium: family('lithium', 'lithium burning crimson', 'a crimson tinge from lithium', [1.0, 0.15, 0.2], 1.5),
  aluminium: family('aluminium', 'white-hot droplets of aluminium oxide', 'a white glare from aluminium oxide', [1.0, 0.97, 0.9], 30, { smoke: 2, particles: 8 }),
  beryllium: family('beryllium', 'white-hot beryllium oxide', 'a white glare from beryllium oxide', [0.95, 0.98, 1.0], 30, { smoke: 2, particles: 3 }),
  halide: family('halide', 'the pale, nearly clear glow of hydrogen fluoride and chloride', 'a pale haze from hydrogen fluoride or chloride', [0.75, 0.9, 0.85], 0.2, { smoke: 0.3 }),
  chlorine: family('chlorine', 'the yellow-green of chlorine', 'a yellow-green tinge from chlorine', [0.8, 0.95, 0.5], 0.6),
  cyanogen: family('cyanogen', 'the violet of compounds of carbon and nitrogen', 'a violet tinge from compounds of carbon and nitrogen', [0.75, 0.45, 1.0], 3),
  nitrogenOxide: family('nitrogenOxide', 'the orange-brown of nitrogen oxides', 'an orange-brown tinge from nitrogen oxides', [0.9, 0.55, 0.25], 1.2),
  // Unburnt and half-burnt fuel shows nothing itself, but burns where the plume meets the air.
  hydrocarbon: family('hydrocarbon', '', '', [0, 0, 0], 0, { burns: true }),
  none: family('none', '', '', [0, 0, 0], 0),
};

/** Species that are soot or turn straight into it, beyond plain carbon. */
const SOOT_FORMERS = new Set(['C2H2,acetylene', 'C10H8,naphthale']);
/** What is left unburnt in the exhaust and burns in the air round the plume. */
const AFTERBURNERS = new Set(['H2', 'H', 'CO', 'CH4']);

/** The family of a species from what it is made of. A metal decides it, whatever else is bound to it. */
function familyFromElements(name: string, elements: Record<string, number>): FamilyId {
  const has = (e: string) => (elements[e] ?? 0) > 0;
  const only = (...allowed: string[]) => Object.keys(elements).every((e) => !has(e) || allowed.includes(e));
  if (has('Li')) return 'lithium';
  if (has('Al')) return 'aluminium';
  if (has('Be')) return 'beryllium';
  if (has('B')) return 'boron';
  if (SOOT_FORMERS.has(name) || only('C')) return 'soot';
  if (has('Cl') && only('Cl', 'F')) return 'chlorine';
  if (has('N') && has('O') && only('N', 'O', 'F')) return 'nitrogenOxide';
  if (has('F') || has('Cl')) return 'halide';
  if (has('C') && has('N')) return 'cyanogen';
  if (has('C') && only('C', 'O')) return 'carbonOxide';
  // Fuel that is unburnt or half-burnt: methane, alcohols, acids and their fragments.
  if (has('C') && has('H')) return 'hydrocarbon';
  if (has('N') && has('O')) return 'nitrogenOxide';
  if (only('H', 'O')) return 'steam';
  return 'none';
}

const FAMILY_BY_SPECIES = new Map<string, FamilyId>(SPECIES.map((s) => [s.name, familyFromElements(s.name, s.elements)]));

/** The family of a species, by the solver's own name for it ("H2O", "AL2O3(L)"). One it has never heard of shows nothing. */
export function familyOf(species: string): FamilyId {
  return FAMILY_BY_SPECIES.get(species) ?? 'none';
}

export interface ExhaustInput {
  exhaust: readonly { name: string; share: number }[];
  /** Flame temperature, K */
  tc: number;
  /** Share of the exhaust's mass that is solid or liquid */
  condensedShare: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (lo: number, hi: number, v: number) => {
  const t = clamp01((v - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clampRGB = (c: RGB): RGB => [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];

const WHITE: RGB = [1, 1, 1];
/** What an exhaust with nothing that glows is drawn in: a trace of warm haze. */
const BARE: RGB = [0.9, 0.86, 0.8];
/** Where a carbon flame's ragged edge burns in the air, and where a sooty one does. */
const CARBON_EDGE: RGB = [1.0, 0.4, 0.3];
const SOOT_EDGE: RGB = [0.95, 0.33, 0.06];
const AFTERBURN: RGB = [1.0, 0.5, 0.3];

/**
 * The share of each family, and of soot the make-up implies without listing.
 *
 * The solver works out the exhaust at equilibrium, where carbon is burnt to its oxides and there
 * is no soot at any ordinary mixture. A real hydrocarbon flame is not at equilibrium: where carbon
 * is left half-burnt it makes soot, which is what turns a kerosene plume orange. Carbon monoxide is
 * the make-up's mark of half-burnt carbon, so the more of it there is past a tenth of the exhaust, the more soot it stands for, provided there
 * is hydrogen about: carbon burnt with no hydrogen (cyanogen) makes none.
 *
 * Each family's share comes in gently over its first two percent, so nothing steps when a species
 * first appears. Every figure of the look is worked from these shares, so they all move together.
 */
function shares(exhaust: readonly { name: string; share: number }[]) {
  const raw = {} as Record<FamilyId, number>;
  const lead = {} as Record<FamilyId, { name: string; share: number } | undefined>;
  for (const id of Object.keys(FAMILIES) as FamilyId[]) raw[id] = 0;
  let co = 0;
  let hydrogen = 0;
  let burning = 0;
  for (const { name, share } of exhaust) {
    if (!(share > 0)) continue;
    const id = familyOf(name);
    raw[id] += share;
    if (!lead[id] || share > lead[id]!.share) lead[id] = { name, share };
    if (name === 'CO') co += share;
    if (id === 'steam' && name !== 'O2' && name !== 'O') hydrogen += share;
    if (AFTERBURNERS.has(name) || id === 'soot') burning += share;
  }
  const byFamily = {} as Record<FamilyId, number>;
  for (const id of Object.keys(FAMILIES) as FamilyId[]) byFamily[id] = raw[id] * smooth(0, 0.02, raw[id]);
  const impliedSoot = 0.25 * smooth(0.1, 0.34, co) * clamp01(hydrogen / 0.2);
  return { byFamily, lead, impliedSoot, burning };
}

interface Source {
  id: FamilyId;
  /** Soot the make-up implies but does not list */
  implied: boolean;
  /** The species of this family there is most of */
  lead: string;
  weight: number;
}

/** Each family's weight in the blend: its share times how strongly it shows. Implied soot counts as soot. */
function weights(exhaust: readonly { name: string; share: number }[]) {
  const { byFamily, lead, impliedSoot, burning } = shares(exhaust);
  const list: Source[] = [];
  for (const id of Object.keys(FAMILIES) as FamilyId[]) {
    if (byFamily[id] > 0 && FAMILIES[id].strength > 0) {
      list.push({ id, implied: false, lead: lead[id]?.name ?? '', weight: byFamily[id] * FAMILIES[id].strength });
    }
  }
  if (impliedSoot > 0) list.push({ id: 'soot', implied: true, lead: 'CO', weight: impliedSoot * FAMILIES.soot.strength });
  list.sort((a, b) => b.weight - a.weight);
  return { list, byFamily, impliedSoot, burning, total: list.reduce((sum, w) => sum + w.weight, 0) };
}

/** The plume's look from its exhaust's make-up, the flame temperature and how much of it is solid or liquid. */
export function lookFromExhaust({ exhaust, tc, condensedShare }: ExhaustInput): PlumeLook {
  const { list, byFamily, impliedSoot, burning, total } = weights(exhaust);
  const condensed = clamp01(Number.isFinite(condensedShare) ? condensedShare : 0);
  const heat = Number.isFinite(tc) ? tc : 0;

  let mid: RGB = BARE;
  if (total > 0) {
    mid = [0, 0, 0];
    for (const w of list) {
      const c = FAMILIES[w.id].colour;
      mid = [mid[0] + (c[0] * w.weight) / total, mid[1] + (c[1] * w.weight) / total, mid[2] + (c[2] * w.weight) / total];
    }
  }
  const sootShare = byFamily.soot + impliedSoot;
  const sootWeight = sootShare * FAMILIES.soot.strength;
  const sootPart = total > 0 ? sootWeight / total : 0;
  const carbonPart = total > 0 ? (byFamily.carbonOxide * FAMILIES.carbonOxide.strength) / total : 0;
  const oxides = byFamily.aluminium + byFamily.beryllium;

  // A hotter flame is whiter at its heart; white-hot oxide droplets whiten it further.
  const whiten = 0.72 * clamp01((heat - 1500) / 2100);
  const core = mix(mix(mid, WHITE, whiten), WHITE, clamp01(oxides * 8));
  const edge = mix(mix([mid[0] * 0.8, mid[1] * 0.8, mid[2] * 0.8], CARBON_EDGE, clamp01(1.4 * carbonPart)), SOOT_EDGE, clamp01(sootPart));

  // A cool gas glows less than a hot one however much of it there is.
  const glow = Math.min(1, Math.max(0.25, (heat - 800) / 2000));
  const sum = (key: 'soot' | 'smoke' | 'particles') =>
    (Object.keys(FAMILIES) as FamilyId[]).reduce((acc, id) => acc + byFamily[id] * FAMILIES[id][key], 0) + impliedSoot * FAMILIES.soot[key];

  // An exhaust with next to nothing in it that glows is drawn dim as well as thin.
  const lit = Math.min(1, 0.4 + 2.6 * total * glow);
  const dimmed = (c: RGB): RGB => clampRGB([c[0] * lit, c[1] * lit, c[2] * lit]);

  return {
    core: dimmed(core),
    mid: dimmed(mid),
    edge: dimmed(edge),
    // The make-up already carries the mixture, so there is no further tint for running rich.
    richTint: clampRGB(mid),
    // The more there is glowing the more solid the plume, with less and less gained: it never
    // snaps to solid as soot comes in.
    opacity: Math.min(1, Math.max(0.15, 1 - Math.exp(-1.2 * total * glow) + 1.5 * condensed)),
    soot: clamp01(sum('soot')),
    smoke: clamp01(sum('smoke') + 2.5 * condensed),
    afterburn: clampRGB(mix(AFTERBURN, mid, 0.25)),
    afterburnStrength: clamp01(2.5 * burning + sootShare * FAMILIES.soot.soot),
    particles: clamp01(sum('particles')),
  };
}

/** Below this much glow in all, the exhaust is said to have no colour to speak of. */
const BARELY = 0.02;

/**
 * What the colour line names, strongest first: the family that shows most and, if another shows at
 * least a quarter as much, that one too.
 */
export function colourSources(exhaust: readonly { name: string; share: number }[]): { id: FamilyId; implied: boolean; lead: string }[] {
  const { list, total } = weights(exhaust);
  if (!(total > BARELY)) return [];
  const [first, second] = list;
  const named = second && second.weight >= 0.25 * first.weight ? [first, second] : [first];
  return named.map(({ id, implied, lead }) => ({ id, implied, lead }));
}

/**
 * How a source is named, as the main colour and as a lesser one. A family is wider than any one
 * name for it, so the words follow what is actually in the list beside them: hot hydrogen is not
 * called steam, and carbon dioxide is not called carbon monoxide.
 */
function wordsFor(source: { id: FamilyId; implied: boolean; lead: string }, exhaust: readonly { name: string; share: number }[]): { main: string; tinge: string } {
  const listed = (test: (name: string) => boolean) => exhaust.some((e) => e.share > 0 && test(e.name));
  // Soot the make-up implies is named for what the make-up does list: carbon that has not finished burning.
  if (source.implied) return { main: 'unburnt carbon glowing orange', tinge: 'an orange glow from unburnt carbon' };
  switch (source.id) {
    case 'steam': {
      const what = source.lead.startsWith('H2O') ? 'steam' : source.lead === 'H2' || source.lead === 'H' ? 'hot hydrogen' : 'hot oxygen';
      return { main: `the faint blue of ${what}`, tinge: `a faint blue from ${what}` };
    }
    case 'carbonOxide':
      return source.lead === 'CO'
        ? { main: 'the blue-violet of burning carbon monoxide', tinge: 'a blue-violet tinge from carbon monoxide' }
        : { main: 'the blue-violet glow of hot carbon dioxide', tinge: 'a blue-violet tinge from carbon dioxide' };
    case 'halide': {
      const hf = listed((n) => n === 'HF');
      const hcl = listed((n) => n === 'HCL');
      const what = hf && hcl ? 'hydrogen fluoride and chloride' : hf ? 'hydrogen fluoride' : hcl ? 'hydrogen chloride' : 'halogen compounds';
      return { main: `the pale, nearly clear glow of ${what}`, tinge: `a pale haze from ${what}` };
    }
    case 'aluminium': {
      const what = listed((n) => n.startsWith('AL2O')) ? 'aluminium oxide' : 'aluminium compounds';
      return { main: what === 'aluminium oxide' ? 'white-hot droplets of aluminium oxide' : 'the white glare of aluminium compounds', tinge: `a white glare from ${what}` };
    }
    case 'beryllium': {
      const what = listed((n) => /^Be\d?O/.test(n)) ? 'beryllium oxide' : 'beryllium compounds';
      return { main: `white-hot ${what}`, tinge: `a white glare from ${what}` };
    }
    default:
      return FAMILIES[source.id].words;
  }
}

/** "Colour: soot glowing orange, with a green tinge from boron." Empty when there is no make-up. */
export function colourNote(exhaust: readonly { name: string; share: number }[]): string {
  if (exhaust.length === 0) return '';
  const [first, second] = colourSources(exhaust);
  if (!first) return 'Colour: almost none. This exhaust barely glows.';
  return `Colour: ${wordsFor(first, exhaust).main}${second ? `, with ${wordsFor(second, exhaust).tinge}` : ''}.`;
}
