import { getPreset } from './physics/presets';
import type { FlowOverlay } from './render/engineView';
import { createRuntime } from './sim/runtime';
import { decodeState, encodeState } from './state/share';
import { createStore, defaultState, isModified } from './state/store';
import { createControls, fillPresetSelect } from './ui/controls';
import { FAILURE_COPY, TIPS } from './ui/copy';
import { createReadouts } from './ui/readouts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const store = createStore(decodeState(location.hash) ?? defaultState());

// --- Header ---------------------------------------------------------------
const presetSelect = $<HTMLSelectElement>('preset');
const resetBtn = $<HTMLButtonElement>('reset');
const blurb = $('blurb');
fillPresetSelect(presetSelect);
presetSelect.addEventListener('change', () => store.loadPreset(presetSelect.value));
resetBtn.addEventListener('click', () => {
  const id = store.get().config.presetId;
  if (id) store.loadPreset(id);
});

const syncHeader = () => {
  const cfg = store.get().config;
  const preset = getPreset(cfg.presetId);
  const modified = preset ? isModified(cfg) : false;
  presetSelect.value = preset ? preset.id : '';
  resetBtn.disabled = !modified;
  blurb.textContent = preset ? (modified ? `Modified ${preset.name}. ` : '') + preset.blurb : 'Custom engine.';
};
store.subscribe(syncHeader);
syncHeader();

// --- Controls, readouts, simulation --------------------------------------
createControls($('controls'), store);
const updateReadouts = createReadouts($('readouts'));

const fireBtn = $<HTMLButtonElement>('fire');
const ascentBtn = $<HTMLButtonElement>('ascent');
const failureBox = $('failure');
ascentBtn.title = TIPS.ascent;

const runtime = createRuntime(store, $('stage'), $<HTMLCanvasElement>('gl'), $<HTMLCanvasElement>('overlay-canvas'), (info) => {
  updateReadouts(info);
  fireBtn.textContent = info.firing ? 'Shut down' : 'Fire';
  fireBtn.classList.toggle('firing', info.firing);
  fireBtn.disabled = info.failure !== null;
  ascentBtn.textContent = info.ascent ? '❚❚ Pause ascent' : '▲ Ascent';
  ascentBtn.disabled = info.failure !== null;
  if (info.failure) {
    const copy = FAILURE_COPY[info.failure];
    failureBox.querySelector('h2')!.textContent = copy.title;
    failureBox.querySelector('p')!.textContent = copy.text;
  }
  failureBox.hidden = info.failure === null;
});
$('nogl').hidden = runtime.hasPlume;

fireBtn.addEventListener('click', () => runtime.toggleFire());
ascentBtn.addEventListener('click', () => runtime.toggleAscent());
$('rebuild').addEventListener('click', () => runtime.rebuild());
$<HTMLSelectElement>('overlay').title = TIPS.overlay;
$<HTMLSelectElement>('overlay').addEventListener('change', (e) =>
  runtime.setOverlay((e.target as HTMLSelectElement).value as FlowOverlay),
);

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (e.code === 'Space' && tag !== 'BUTTON' && tag !== 'SELECT') {
    e.preventDefault();
    runtime.toggleFire();
  }
});

const soundBtn = $<HTMLButtonElement>('sound');
let muted = true;
soundBtn.addEventListener('click', () => {
  muted = !muted;
  runtime.setMuted(muted);
  soundBtn.textContent = muted ? 'Sound off' : 'Sound on';
  soundBtn.setAttribute('aria-pressed', String(!muted));
});

// --- Shareable URL --------------------------------------------------------
let urlTimer: number | undefined;
const writeUrl = () => history.replaceState(null, '', `#${encodeState(store.get())}`);
store.subscribe(() => {
  clearTimeout(urlTimer);
  urlTimer = window.setTimeout(writeUrl, 250);
});
window.addEventListener('hashchange', () => {
  const next = decodeState(location.hash);
  if (next && encodeState(next) !== encodeState(store.get())) store.replace(next);
});

const toast = $('toast');
let toastTimer: number | undefined;
const showToast = (text: string) => {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 2200);
};
$('share').addEventListener('click', async () => {
  clearTimeout(urlTimer);
  writeUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    showToast('Link copied. Anyone who opens it gets this exact engine.');
  } catch {
    showToast('Copy the address from the address bar to share this engine.');
  }
});
