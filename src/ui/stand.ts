import { RANGES } from '../physics/engine';
import type { StageLayout } from '../sim/runtime';
import { curvePosition } from './controls';

/** By this altitude the ground and the stand have dropped out of the picture. */
export const STAND_GONE_KM = 2;

/** How much of the stand shows at an altitude: all of it on the ground, none once it has fallen away. */
export function standShare(altitudeKm: number): number {
  return Math.min(1, Math.max(0, 1 - altitudeKm / STAND_GONE_KM));
}

/** The heights marked on the picture's altitude scale: the same as the altitude slider's. */
export const ALTITUDE_MARKS = [
  { at: 0, label: 'Sea level' },
  { at: 10, label: '10 km' },
  { at: 40, label: '40 km' },
  { at: 86, label: 'Vacuum' },
];

/** The altitude slider's spread: nearly all the air is in the first tens of kilometres. */
const ALTITUDE_CURVE = 2;

/** Where an altitude sits on the picture's scale, between its foot (the ground) and its top. */
export function altitudeY(km: number, top: number, bottom: number): number {
  return bottom - curvePosition(km, RANGES.altitudeKm, ALTITUDE_CURVE) * (bottom - top);
}

/** Room the scale leaves above it (the view switch) and below it (the zoom buttons), px. */
const SCALE_TOP = 72;
const SCALE_FOOT = 64;

/** False for a picture too short to read a scale in: it is left out there. */
export function altitudeScaleFits(heightPx: number): boolean {
  return heightPx - SCALE_TOP - SCALE_FOOT >= 160;
}

/** A numbered mark on the engine: where its disc sits and the point on the engine it names. */
export interface Callout {
  /** The id of the control it belongs to */
  id: string;
  x: number;
  y: number;
  toX: number;
  toY: number;
}

/**
 * Where the numbered marks go for a set of part pickers, in the order the Build panel lists them.
 * The energy source is the chamber, the exhaust the nozzle, and what the engine is fed comes in
 * at the injector face.
 */
export function calloutsFor(ids: string[], l: StageLayout): Callout[] {
  const lift = 26;
  // Two chambers side by side fill the height, so the marks stand clear of all of it.
  const chamberEdge = l.chambersDrawn > 1 ? l.halfHeight : Math.min(l.chamberRadius, l.halfHeight);
  const top = l.centreY - l.halfHeight - lift;
  const chamberLen = l.chamberEndX - l.originX;
  const feeds = ids.filter((id) => id !== 'energy' && id !== 'exhaust');
  return ids.map((id) => {
    if (id === 'energy') {
      const x = l.originX + chamberLen * 0.5;
      return { id, x, y: top, toX: x, toY: l.centreY - chamberEdge };
    }
    if (id === 'exhaust') {
      const x = (l.throatX + l.exitX) / 2;
      // Halfway down the nozzle the wall is roughly halfway out to the exit's radius.
      const edge = l.chambersDrawn > 1 ? l.halfHeight : l.exitRadius * 0.6;
      return { id, x: Math.max(x, l.originX + chamberLen * 0.5 + 30), y: top, toX: x, toY: l.centreY - edge };
    }
    // What the engine is fed arrives at the injector face, so those marks stand ahead of it,
    // one above the centreline and one below.
    const n = feeds.indexOf(id);
    const side = feeds.length > 1 ? (n === 0 ? -1 : 1) : 0;
    return {
      id,
      // Never over the thrust wall at the picture's edge, even where the engine runs off it.
      x: Math.max(WALL + 4 + 12, l.originX - l.frontSpace - FEED_GAP),
      y: l.centreY + side * 15,
      toX: l.originX - l.frontSpace,
      toY: l.centreY + side * Math.min(chamberEdge * 0.5, 15),
    };
  });
}

/** How far ahead of the engine the marks for its feeds stand, px. */
const FEED_GAP = 40;

/** Width of the thrust wall at the picture's left edge, px. */
const WALL = 16;

const NS = 'http://www.w3.org/2000/svg';

/**
 * Draws what sits over the picture: the test stand and the ground it is bolted to, which drop away
 * as the engine climbs, and the numbered marks that tie each part picker to its place on the engine.
 */
export function createStand(svg: SVGSVGElement, marks: HTMLElement, focus: (id: string) => void) {
  const stand = document.createElementNS(NS, 'g');
  stand.setAttribute('class', 'stand');
  const ground = document.createElementNS(NS, 'path');
  ground.setAttribute('class', 'ground');
  const earth = document.createElementNS(NS, 'rect');
  earth.setAttribute('class', 'earth');
  const frame = document.createElementNS(NS, 'path');
  frame.setAttribute('class', 'frame');
  const wall = document.createElementNS(NS, 'rect');
  wall.setAttribute('class', 'wall');
  stand.append(earth, ground, wall, frame);
  const leaders = document.createElementNS(NS, 'path');
  leaders.setAttribute('class', 'leaders');
  // Down the picture's right edge: how high the engine is, so the climb shows once the stand has gone.
  const scale = document.createElementNS(NS, 'g');
  scale.setAttribute('class', 'altscale');
  const rail = document.createElementNS(NS, 'path');
  rail.setAttribute('class', 'rail');
  const tickLabels = ALTITUDE_MARKS.map((m) => {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('class', 'tick-label');
    t.setAttribute('text-anchor', 'end');
    t.textContent = m.label;
    return t;
  });
  const marker = document.createElementNS(NS, 'g');
  marker.setAttribute('class', 'marker');
  const pointer = document.createElementNS(NS, 'path');
  const tag = document.createElementNS(NS, 'rect');
  const reading = document.createElementNS(NS, 'text');
  reading.setAttribute('text-anchor', 'end');
  marker.append(tag, reading, pointer);
  scale.append(rail, ...tickLabels, marker);
  scale.setAttribute('aria-hidden', 'true');
  svg.append(stand, leaders, scale);
  let lastScale = '';

  const discs = new Map<string, HTMLButtonElement>();
  let lastKey = '';

  return {
    update(l: StageLayout, altitudeKm: number, ids: string[]) {
      const w = svg.clientWidth;
      const h = svg.clientHeight;
      const share = standShare(altitudeKm);
      stand.style.opacity = String(share);
      stand.style.transform = `translateY(${((1 - share) * 60).toFixed(1)}px)`;
      const chamberEdge = l.chambersDrawn > 1 ? l.halfHeight : Math.min(l.chamberRadius, l.halfHeight);
      // The engine is held clear of the ground, which is a solid strip along the foot of the picture.
      const groundY = Math.max(l.centreY + l.halfHeight + 40, h - Math.max(60, h * 0.17));
      const key = [w, h, l.originX, l.chamberEndX, l.throatX, l.centreY, l.halfHeight, l.frontSpace, chamberEdge].map((v) => v.toFixed(1)).join(',');
      if (key !== lastKey) {
        lastKey = key;
        earth.setAttribute('x', '0');
        earth.setAttribute('y', String(groundY));
        earth.setAttribute('width', String(w));
        earth.setAttribute('height', String(Math.max(0, h - groundY)));
        ground.setAttribute('d', `M0 ${groundY}H${w}`);
        // A tower under the engine: a deck on two splayed legs, tied and cross-braced in two bays,
        // with saddles up to the chamber. Its base is at least half as wide as it is tall.
        const len = l.chamberEndX - l.originX;
        const deckY = l.centreY + l.halfHeight + 14;
        const drop = groundY - deckY;
        const splay = drop * 0.14;
        // The whole tower stays in the picture, clear of the wall, however hard the engine sits to the left.
        const x1 = Math.max(l.originX - 14, WALL + 8 + splay);
        const x2 = Math.max(l.throatX, x1 + drop * 0.5);
        const midY = deckY + drop / 2;
        const saddle = (x: number) => `M${x} ${l.centreY + chamberEdge - 2}V${deckY}`;
        // What takes the push: a strut from the injector head back to a thrust wall at the picture's edge.
        const headX = l.originX - l.frontSpace;
        const wallTop = l.centreY - Math.max(chamberEdge, 20) - 30;
        wall.setAttribute('x', '0');
        wall.setAttribute('y', String(wallTop));
        wall.setAttribute('width', String(WALL));
        wall.setAttribute('height', String(Math.max(0, groundY - wallTop)));
        frame.setAttribute(
          'd',
          `M${x1 - 16} ${deckY}H${x2 + 16}` +
            `M${x1} ${deckY}L${x1 - splay} ${groundY}M${x2} ${deckY}L${x2 + splay} ${groundY}` +
            `M${x1 - splay / 2} ${midY}H${x2 + splay / 2}` +
            `M${x1} ${deckY}L${x2 + splay / 2} ${midY}L${x1 - splay} ${groundY}` +
            `M${x2} ${deckY}L${x1 - splay / 2} ${midY}L${x2 + splay} ${groundY}` +
            saddle(l.originX + len * 0.25) +
            saddle(l.originX + len * 0.8) +
            (headX > WALL ? `M${headX} ${l.centreY}H${WALL}` : ''),
        );
      }

      // The altitude scale: rail and marks only when the picture changes size, the marker every frame.
      const fits = altitudeScaleFits(h);
      scale.style.display = fits ? '' : 'none';
      if (fits) {
        const x = w - 22;
        const top = SCALE_TOP;
        const foot = h - SCALE_FOOT;
        const scaleKey = `${w},${h}`;
        if (scaleKey !== lastScale) {
          lastScale = scaleKey;
          rail.setAttribute('d', `M${x} ${top}V${foot}` + ALTITUDE_MARKS.map((m) => `M${x - 5} ${altitudeY(m.at, top, foot).toFixed(1)}h10`).join(''));
          ALTITUDE_MARKS.forEach((m, i) => {
            tickLabels[i].setAttribute('x', String(x - 10));
            tickLabels[i].setAttribute('y', (altitudeY(m.at, top, foot) + 4).toFixed(1));
          });
        }
        const y = altitudeY(altitudeKm, top, foot);
        const text = altitudeKm >= 86 ? `${altitudeKm.toFixed(0)} km` : `${altitudeKm.toFixed(1)} km`;
        if (reading.textContent !== text) reading.textContent = text;
        pointer.setAttribute('d', `M${x - 1} ${y.toFixed(1)}l-8 -5v10z`);
        reading.setAttribute('x', String(x - 16));
        reading.setAttribute('y', (y + 4.5).toFixed(1));
        const tw = 7.6 * text.length + 10;
        tag.setAttribute('x', (x - 16 - tw + 5).toFixed(1));
        tag.setAttribute('y', (y - 9).toFixed(1));
        tag.setAttribute('width', tw.toFixed(1));
        tag.setAttribute('height', '18');
        // The fixed marks give way where the reading stands over them.
        ALTITUDE_MARKS.forEach((m, i) => {
          tickLabels[i].style.opacity = Math.abs(altitudeY(m.at, top, foot) - y) < 14 ? '0' : '';
        });
      }

      const list = calloutsFor(ids, l);
      leaders.setAttribute('d', list.map((c) => `M${c.x.toFixed(1)} ${c.y.toFixed(1)}L${c.toX.toFixed(1)} ${c.toY.toFixed(1)}`).join(''));
      for (const [id, disc] of discs) {
        if (!ids.includes(id)) {
          disc.remove();
          discs.delete(id);
        }
      }
      list.forEach((c, i) => {
        let disc = discs.get(c.id);
        if (!disc) {
          disc = document.createElement('button');
          disc.className = 'callout';
          disc.dataset.for = c.id;
          disc.addEventListener('click', () => focus(c.id));
          marks.append(disc);
          discs.set(c.id, disc);
        }
        const n = String(i + 1);
        if (disc.textContent !== n) disc.textContent = n;
        disc.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px)`;
      });
    },
    /** Light the mark for a part while its picker is in use */
    highlight(id: string | null) {
      for (const [key, disc] of discs) disc.classList.toggle('lit', key === id);
    },
    /** Name each mark after its part, for a screen reader */
    label(id: string, text: string) {
      discs.get(id)?.setAttribute('aria-label', text);
    },
  };
}
