import type { StageLayout } from '../sim/runtime';

/** By this altitude the ground and the stand have dropped out of the picture. */
export const STAND_GONE_KM = 2;

/** How much of the stand shows at an altitude: all of it on the ground, none once it has fallen away. */
export function standShare(altitudeKm: number): number {
  return Math.min(1, Math.max(0, 1 - altitudeKm / STAND_GONE_KM));
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
      x: Math.max(16, l.originX - l.frontSpace - FEED_GAP),
      y: l.centreY + side * 15,
      toX: l.originX - l.frontSpace,
      toY: l.centreY + side * Math.min(chamberEdge * 0.5, 15),
    };
  });
}

/** How far ahead of the engine the marks for its feeds stand, px. */
const FEED_GAP = 40;

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
  stand.append(earth, ground, frame);
  const leaders = document.createElementNS(NS, 'path');
  leaders.setAttribute('class', 'leaders');
  svg.append(stand, leaders);

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
      // The engine is held well clear of the ground, which stays a strip along the foot of the picture.
      const groundY = Math.max(l.centreY + l.halfHeight + 30, h - Math.max(44, h * 0.09));
      const key = [w, h, l.originX, l.chamberEndX, l.throatX, l.centreY, l.halfHeight, chamberEdge].map((v) => v.toFixed(1)).join(',');
      if (key !== lastKey) {
        lastKey = key;
        earth.setAttribute('x', '0');
        earth.setAttribute('y', String(groundY));
        earth.setAttribute('width', String(w));
        earth.setAttribute('height', String(Math.max(0, h - groundY)));
        ground.setAttribute('d', `M0 ${groundY}H${w}`);
        // A bench under the engine: a beam on two braced legs, with saddles up to the chamber.
        const len = l.chamberEndX - l.originX;
        const beamY = l.centreY + l.halfHeight + 12;
        const x1 = l.originX - 4;
        const x2 = Math.max(x1 + 40, l.throatX);
        const splay = Math.min(26, (groundY - beamY) * 0.12);
        const saddle = (x: number) => `M${x - 7} ${l.centreY + chamberEdge}H${x + 7}M${x} ${l.centreY + chamberEdge}V${beamY}`;
        frame.setAttribute(
          'd',
          `M${x1 - 10} ${beamY}H${x2 + 10}` +
            `M${x1} ${beamY}L${x1 - splay} ${groundY}M${x2} ${beamY}L${x2 + splay} ${groundY}` +
            `M${x1} ${beamY}L${x2 + splay} ${groundY}M${x2} ${beamY}L${x1 - splay} ${groundY}` +
            `M${x1 - splay - 12} ${groundY}H${x2 + splay + 12}` +
            saddle(l.originX + len * 0.25) +
            saddle(l.originX + len * 0.8),
        );
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
