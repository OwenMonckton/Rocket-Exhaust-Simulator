import { PRESETS } from '../physics/presets';
import type { EngineConfig } from '../physics/types';
import { engineProfile } from '../render/geometry';

/** Value of the picker entry that starts a blank engine. */
export const NEW_ENGINE = '__new';

const W = 132;
const H = 56;

/**
 * The engine's outline as an SVG path, from the same wall the picture draws, fitted to the
 * card with one scale so a long engine and a squat one keep their own proportions.
 */
export function silhouettePath(config: EngineConfig): string {
  const profile = engineProfile(config);
  if (profile.beam) {
    // A beam thruster's card: its body, then the two grids of a gridded thruster standing off its
    // mouth, or the centre pole of a Hall thruster standing in its ring-shaped channel.
    const k = Math.min((W - 40) / profile.length, (H - 10) / (2 * profile.maxRadius));
    const len = profile.length * k;
    const r = profile.maxRadius * k;
    const x = (W - len) / 2;
    const y = H / 2;
    // Absolute points throughout, as the engines' outlines are.
    const box = (bx: number, by: number, bw: number, bh: number) => {
      const [l, t, rt, b] = [bx, by, bx + bw, by + bh].map((n) => n.toFixed(1));
      return `M${l} ${t}L${rt} ${t}L${rt} ${b}L${l} ${b}Z`;
    };
    if (profile.beam === 'ion') return box(x, y - r, len, 2 * r) + box(x + len + 3, y - r, 2, 2 * r) + box(x + len + 8, y - r, 2, 2 * r);
    return box(x, y - r, len * 0.5, 2 * r) + box(x + len * 0.5, y - r, len * 0.5, 0.12 * r) + box(x + len * 0.5, y + 0.88 * r, len * 0.5, 0.12 * r) + box(x + len * 0.5, y - 0.55 * r, len * 0.5, 1.1 * r);
  }
  const { points } = profile;
  const x0 = points[0].x;
  const length = points[points.length - 1].x - x0 || 1;
  const radius = Math.max(...points.map((p) => p.r)) || 1;
  const k = Math.min((W - 8) / length, (H - 6) / (2 * radius));
  const left = (W - length * k) / 2;
  const at = (x: number, r: number) => `${(left + (x - x0) * k).toFixed(1)} ${(H / 2 + r * k).toFixed(1)}`;
  const top = points.map((p) => at(p.x, -p.r));
  const bottom = [...points].reverse().map((p) => at(p.x, p.r));
  return `M${top.join('L')}L${bottom.join('L')}Z`;
}

export interface Picker {
  /** Mark the engine in use; an empty id is the user's own engine */
  setCurrent(id: string): void;
  open(): void;
  close(): void;
}

/** Builds the engine picker: every example with its outline, name and one line, plus a blank engine. */
export function createPicker(
  box: HTMLElement,
  list: HTMLElement,
  opener: HTMLButtonElement,
  closer: HTMLButtonElement,
  choose: (id: string) => void,
): Picker {
  const buttons = new Map<string, HTMLButtonElement>();
  const add = (id: string, name: string, blurb: string, path: string | null) => {
    const b = document.createElement('button');
    b.className = 'engine-card';
    const art = path
      ? `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${path}" /></svg>`
      : `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><path class="blank" d="M${W / 2} 14v28M${W / 2 - 14} 28h28" /></svg>`;
    b.innerHTML = `${art}<span class="engine-name"></span><span class="engine-blurb"></span>`;
    b.querySelector('.engine-name')!.textContent = name;
    b.querySelector('.engine-blurb')!.textContent = blurb;
    b.addEventListener('click', () => {
      choose(id);
      close();
    });
    list.append(b);
    buttons.set(id, b);
  };
  for (const p of PRESETS) add(p.id, p.name, p.blurb, silhouettePath(p.config));
  add(NEW_ENGINE, 'Build your own', 'Start from a blank engine and pick every part yourself.', null);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const onOutside = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!box.contains(t) && !opener.contains(t)) close();
  };
  function open() {
    box.hidden = false;
    opener.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside);
    (list.querySelector<HTMLButtonElement>('[aria-current="true"]') ?? list.querySelector('button'))?.focus();
  }
  function close() {
    if (box.hidden) return;
    box.hidden = true;
    opener.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onOutside);
    opener.focus();
  }
  opener.addEventListener('click', () => (box.hidden ? open() : close()));
  closer.addEventListener('click', close);

  return {
    setCurrent(id) {
      for (const [key, b] of buttons) {
        if (key === id) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      }
    },
    open,
    close,
  };
}
