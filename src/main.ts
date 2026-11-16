import { getPreset } from './physics/presets';
import type { FlowOverlay } from './render/engineView';
import { createRuntime, type PlumeMode } from './sim/runtime';
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

// Deployable nozzle extension (RL10B-2): slides between its stowed and deployed sizes.
const deployBtn = $<HTMLButtonElement>('deploy');
deployBtn.title = TIPS.deploy;
// It travels slowly enough to watch the plume meet it on the way.
const DEPLOY_MS = 6000;
let deployAnim = 0;
let deployTarget: number | null = null;
deployBtn.addEventListener('click', () => {
  const cfg = store.get().config;
  if (!(cfg.extFixedDia > 0)) return;
  cancelAnimationFrame(deployAnim);
  // Reverse if already moving; otherwise head for the other end.
  const to = deployTarget !== null ? 1 - deployTarget : cfg.extDeploy > 0.5 ? 0 : 1;
  deployTarget = to;
  let last = performance.now();
  const tick = (now: number) => {
    const step = (now - last) / DEPLOY_MS;
    last = now;
    const at = store.get().config.extDeploy;
    const next = to > at ? Math.min(to, at + step) : Math.max(to, at - step);
    store.set({ config: { extDeploy: next } });
    if (next !== to && store.get().config.extFixedDia > 0) deployAnim = requestAnimationFrame(tick);
    else {
      deployTarget = null;
      syncHeader();
    }
  };
  deployAnim = requestAnimationFrame(tick);
});

const syncHeader = () => {
  const cfg = store.get().config;
  const preset = getPreset(cfg.presetId);
  const modified = preset ? isModified(cfg) : false;
  deployBtn.hidden = !(cfg.extFixedDia > 0);
  // While it is moving the button offers to send it back the other way.
  const heading = deployTarget ?? (cfg.extDeploy > 0.5 ? 1 : 0);
  deployBtn.textContent = heading === 1 ? 'Stow nozzle' : 'Deploy nozzle';
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
const failureBox = $('failure');

// The two altitude sweeps. Each button shows a pause sign while its own sweep is running.
const sweeps = ([
  { id: 'ascent', direction: 1, icon: '▲', label: ' Ascend', tip: TIPS.ascent },
  { id: 'descent', direction: -1, icon: '▼', label: ' Descend', tip: TIPS.descent },
] as const).map((s) => {
  const button = $<HTMLButtonElement>(s.id);
  button.title = s.tip;
  button.setAttribute('aria-label', s.label.trim());
  return { ...s, button, iconEl: button.querySelector('.icon')!, labelEl: button.querySelector('.label')! };
});

const runtime = createRuntime(store, $('stage'), $<HTMLCanvasElement>('gl'), $<HTMLCanvasElement>('overlay-canvas'), (info) => {
  updateReadouts(info);
  fireBtn.textContent = info.firing ? 'Shut down' : 'Fire';
  fireBtn.classList.toggle('firing', info.firing);
  fireBtn.disabled = info.failure !== null;
  for (const s of sweeps) {
    const running = info.sweep === s.direction;
    s.iconEl.textContent = running ? '❚❚' : s.icon;
    s.labelEl.textContent = running ? ' Pause' : s.label;
    s.button.classList.toggle('firing', running);
    s.button.disabled = info.failure !== null;
  }
  if (info.failure) {
    const copy = FAILURE_COPY[info.failure];
    failureBox.querySelector('h2')!.textContent = copy.title;
    failureBox.querySelector('p')!.textContent = copy.text;
  }
  failureBox.hidden = info.failure === null;
});
$('nogl').hidden = runtime.hasPlume;

fireBtn.addEventListener('click', () => runtime.toggleFire());
for (const s of sweeps) s.button.addEventListener('click', () => runtime.toggleSweep(s.direction));
$('rebuild').addEventListener('click', () => runtime.rebuild());
$<HTMLSelectElement>('overlay').title = TIPS.overlay;
$<HTMLSelectElement>('overlay').addEventListener('change', (e) =>
  runtime.setOverlay((e.target as HTMLSelectElement).value as FlowOverlay),
);

const plumeMode = $<HTMLSelectElement>('plume-mode');
const applyPlumeMode = (mode: PlumeMode) => {
  plumeMode.value = mode;
  runtime.setPlumeMode(mode);
  // Real shock diamonds sit several nozzle widths apart, so the simulated plume needs a wider view.
  runtime.setZoom(mode === 'sim' ? 0.5 : 1);
};
if (runtime.hasSim) {
  // The simulated plume is the default wherever the browser can run it.
  applyPlumeMode('sim');
} else {
  applyPlumeMode('drawn');
  plumeMode.disabled = true;
  plumeMode.title = "This browser can't run the gas simulation, so the plume is drawn instead.";
}
plumeMode.addEventListener('change', () => applyPlumeMode(plumeMode.value as PlumeMode));

$('zoom-out').addEventListener('click', () => runtime.setZoom(runtime.getZoom() / 1.25));
$('zoom-in').addEventListener('click', () => runtime.setZoom(runtime.getZoom() * 1.25));
$('stage').addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    runtime.setZoom(runtime.getZoom() * Math.exp(-e.deltaY * 0.0015));
  },
  { passive: false },
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
