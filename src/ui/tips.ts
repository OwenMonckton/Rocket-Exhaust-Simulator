/**
 * Explanations that show on hover, on keyboard focus and on touch. Anything with a `title` is
 * picked up as it is met: the title moves to `data-tip`, so the browser's own slow, mouse-only
 * tooltip never shows beside ours.
 */
export function createTips(tip: HTMLElement): void {
  let owner: HTMLElement | null = null;
  let timer: number | undefined;

  const find = (target: EventTarget | null): HTMLElement | null => {
    const node = target instanceof Element ? target.closest<HTMLElement>('[title], [data-tip]') : null;
    if (!node || node instanceof HTMLOptionElement) return null;
    const title = node.getAttribute('title');
    if (title) {
      node.dataset.tip = title;
      node.removeAttribute('title');
    }
    return node.dataset.tip ? node : null;
  };

  const hide = () => {
    clearTimeout(timer);
    owner?.removeAttribute('aria-describedby');
    owner = null;
    tip.hidden = true;
  };

  const show = (node: HTMLElement) => {
    owner = node;
    tip.textContent = node.dataset.tip ?? '';
    tip.hidden = false;
    node.setAttribute('aria-describedby', tip.id);
    // Beside the thing it explains: below it where there is room, above it where there is not.
    const r = node.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const gap = 8;
    const left = Math.min(window.innerWidth - t.width - gap, Math.max(gap, r.left));
    const below = r.bottom + gap + t.height <= window.innerHeight;
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? r.bottom + gap : Math.max(gap, r.top - gap - t.height)}px`;
  };

  const ask = (target: EventTarget | null, delay: number) => {
    const node = find(target);
    if (node === owner) return;
    hide();
    if (node) timer = window.setTimeout(() => show(node), delay);
  };

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'mouse') ask(e.target, 350);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'mouse' && owner && !owner.contains(e.relatedTarget as Node)) hide();
  });
  document.addEventListener('focusin', (e) => {
    // Only a focus that came from the keyboard or a touch; a mouse click has the hover already.
    if (e.target instanceof Element && e.target.matches(':focus-visible')) ask(e.target, 0);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') hide();
    else ask(e.target, 0);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  window.addEventListener('scroll', hide, true);
}
