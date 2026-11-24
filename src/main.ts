import { destroys } from './physics/limits';
import { getPreset } from './physics/presets';
import type { FlowOverlay } from './render/engineView';
import { createRuntime, type FrameInfo, type PlumeMode } from './sim/runtime';
import { decodeState, encodeState } from './state/share';
import { createStore, defaultState, isModified } from './state/store';
import { createControls } from './ui/controls';
import { STATE_COPY, TIPS, failureCopy } from './ui/copy';
import { NEW_ENGINE, createPicker } from './ui/picker';
import { createReadouts } from './ui/readouts';
import { createStand } from './ui/stand';
import { createTestLog } from './ui/testlog';
import { createTips } from './ui/tips';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// A link opens the engine it carries; otherwise a famous engine is waiting on the stand.
const linked = decodeState(location.hash);
const store = createStore(linked ?? defaultState());
if (!linked) store.loadPreset('merlin-1d');

createTips($('tip'));
const log = createTestLog($('log'));

// --- Header ---------------------------------------------------------------
const resetBtn = $<HTMLButtonElement>('reset');
const engineName = $('engine-name');
const blurb = $('blurb');
// Choosing a whole engine clears away the wreck of the last one. The store tells the runtime
// about the new engine, which becomes the one Rebuild goes back to.
const picker = createPicker($('picker'), $('picker-list'), $<HTMLButtonElement>('change-engine'), $<HTMLButtonElement>('picker-close'), (id) => {
  runtime.clearFailure();
  if (id === NEW_ENGINE) store.newEngine();
  else store.loadPreset(id);
  announceEngine();
});
resetBtn.addEventListener('click', () => {
  const id = store.get().config.presetId;
  if (!id) return;
  runtime.clearFailure();
  store.loadPreset(id);
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
  picker.setCurrent(preset ? preset.id : '');
  resetBtn.hidden = !modified;
  engineName.textContent = preset ? (modified ? `Modified ${preset.name}` : preset.name) : 'Your engine';
  blurb.textContent = preset ? preset.blurb : 'Your own engine. Pick its parts in the Build panel, or change to an example.';
};
/** The name the log calls the engine on the stand. */
const articleName = () => getPreset(store.get().config.presetId)?.name ?? 'Your engine';
const announceEngine = () => {
  log.reset();
  log.add(`${articleName()} on the stand. Ready to fire.`);
};
store.subscribe(syncHeader);
syncHeader();

// --- Controls, readouts, simulation --------------------------------------
createControls($('controls'), $('flight'), store);
const updateReadouts = createReadouts($('readouts'));

// The numbered marks on the engine follow the part pickers the Build panel shows, in its order.
const partIds = () =>
  [...document.querySelectorAll<HTMLSelectElement>('#controls .group.parts .row:not([hidden]) select')].map((el) => el.id);
const stand = createStand(document.getElementById('stand') as unknown as SVGSVGElement, $('callouts'), (id) => $(id).focus());
const partsBox = document.querySelector<HTMLElement>('#controls .group.parts')!;
const partOf = (t: EventTarget | null) => (t instanceof Element ? (t.closest('.row')?.querySelector('select')?.id ?? null) : null);
partsBox.addEventListener('pointerover', (e) => stand.highlight(partOf(e.target)));
partsBox.addEventListener('pointerleave', () => stand.highlight(null));
partsBox.addEventListener('focusin', (e) => stand.highlight(partOf(e.target)));
partsBox.addEventListener('focusout', () => stand.highlight(null));

const fireBtn = $<HTMLButtonElement>('fire');
const arm = $('arm');
const stage = $('stage');
const failureBox = $('failure');
const rebuildBtn = $<HTMLButtonElement>('rebuild');

// The two altitude sweeps. Each button shows a pause sign while its own sweep is running.
const sweeps = ([
  { id: 'ascent', direction: 1, label: 'Ascend', tip: TIPS.ascent },
  { id: 'descent', direction: -1, label: 'Descend', tip: TIPS.descent },
] as const).map((s) => {
  const button = $<HTMLButtonElement>(s.id);
  button.title = s.tip;
  return { ...s, button, labelEl: button.querySelector('.label')! };
});

// What the log has already said, so each moment of a test is written down once.
const seen = { firing: false, full: false, state: '', altitude: 0, failed: false, soundAsked: false };
/** Write down what changed since the last look: ignition, full power, the nozzle, the climb, the end. */
const record = (info: FrameInfo) => {
  const altitude = store.get().flight.altitudeKm;
  if (info.firing && !seen.firing) {
    log.ignite();
    log.add('Ignition.', 'fire');
    seen.full = false;
    seen.state = '';
    // The flash and the shake of the stand as it lights.
    stage.classList.remove('ignite');
    void stage.offsetWidth;
    stage.classList.add('ignite');
    if (muted && !seen.soundAsked) {
      seen.soundAsked = true;
      showToast('Sound is off. Use the Sound button to hear the engine.');
    }
  }
  if (info.firing && info.fire >= 1 && !seen.full) {
    seen.full = true;
    log.add(`Full power: ${(info.result.thrust / 1000).toFixed(0)} kN.`, 'fire');
  }
  if (info.firing && seen.full && info.result.state !== seen.state) {
    seen.state = info.result.state;
    const calm = info.result.state === 'ideal' || info.result.state === 'compensating';
    log.add(`Nozzle: ${STATE_COPY[info.result.state].label.toLowerCase()}.`, calm ? 'note' : 'warn');
  }
  if (info.firing) {
    for (const [km, text] of [[10, '10 km. The air is thinning.'], [86, 'Vacuum.']] as const) {
      if (seen.altitude < km && altitude >= km) log.add(km === 86 ? text : `Passing ${text}`);
      if (seen.altitude >= km && altitude < km) log.add(km === 86 ? 'Back in the air.' : 'Below 10 km.');
    }
  }
  if (info.failure && !seen.failed) log.add(`${failureCopy(info.failure, store.get().config.energy).title}.`, 'fail');
  else if (!info.firing && seen.firing && !info.failure) log.add('Shutdown.');
  if (!info.failure && seen.failed) log.add('Engine back on the stand.');
  seen.firing = info.firing;
  seen.failed = info.failure !== null;
  seen.altitude = altitude;
};

const runtime = createRuntime(store, stage, $<HTMLCanvasElement>('gl'), $<HTMLCanvasElement>('overlay-canvas'), (info) => {
  updateReadouts(info);
  record(info);
  const ids = partIds();
  stand.update(info.layout, store.get().flight.altitudeKm, ids);
  for (const id of ids) {
    const name = document.getElementById(id)?.closest('.row')?.querySelector('.name')?.textContent ?? id;
    stand.label(id, `${name}: go to its picker`);
  }
  fireBtn.textContent = info.firing ? 'Shut down' : 'Fire';
  fireBtn.classList.toggle('firing', info.firing);
  fireBtn.disabled = info.failure !== null;
  const armState = info.failure ? 'failed' : info.firing ? 'firing' : 'armed';
  if (arm.dataset.state !== armState) {
    arm.dataset.state = armState;
    arm.textContent = armState === 'failed' ? 'Failed' : armState === 'firing' ? 'Firing' : 'Armed';
  }
  for (const s of sweeps) {
    const running = info.sweep === s.direction;
    const label = running ? 'Pause' : s.label;
    if (s.labelEl.textContent !== label) {
      s.labelEl.textContent = label;
      // The word is hidden on a phone, where the button is only its arrow.
      s.button.setAttribute('aria-label', label);
    }
    s.button.classList.toggle('running', running);
    s.button.disabled = info.failure !== null;
  }
  if (info.failure) {
    const copy = failureCopy(info.failure, store.get().config.energy);
    failureBox.querySelector('h2')!.textContent = copy.title;
    failureBox.querySelector('p')!.textContent = copy.text;
    // A flame that went out leaves the engine whole: it only needs lighting again.
    // Nothing is lit in a reactor: it is started again, not relit.
    const relight = store.get().config.energy === 'combustion' ? 'Relight engine' : 'Restart engine';
    rebuildBtn.textContent = destroys(info.failure) ? 'Rebuild engine' : relight;
  }
  failureBox.hidden = info.failure === null;
});
$('nogl').hidden = runtime.hasPlume;

fireBtn.addEventListener('click', () => runtime.toggleFire());
for (const s of sweeps) s.button.addEventListener('click', () => runtime.toggleSweep(s.direction));
rebuildBtn.addEventListener('click', () => runtime.rebuild());

// The Display menu closes when you click away from it.
const displayMenu = $<HTMLDetailsElement>('display-menu');
document.addEventListener('pointerdown', (e) => {
  if (displayMenu.open && !displayMenu.contains(e.target as Node)) displayMenu.open = false;
});
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

const engineGas = $<HTMLSelectElement>('engine-gas');
if (runtime.hasEngineSim) {
  // Simulated wherever the browser can run it, like the plume.
  engineGas.value = 'sim';
  runtime.setEngineGas('sim');
} else {
  engineGas.value = 'drawn';
  engineGas.disabled = true;
  engineGas.title = "This browser can't run the gas simulation, so the gas inside the engine is drawn instead.";
}
engineGas.addEventListener('change', () => runtime.setEngineGas(engineGas.value as PlumeMode));

$('zoom-out').addEventListener('click', () => runtime.setZoom(runtime.getZoom() / 1.25));
$('zoom-in').addEventListener('click', () => runtime.setZoom(runtime.getZoom() * 1.25));
stage.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    runtime.setZoom(runtime.getZoom() * Math.exp(-e.deltaY * 0.0015));
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (e.code === 'Space' && tag !== 'BUTTON' && tag !== 'SELECT' && tag !== 'SUMMARY') {
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
  if (next && encodeState(next) !== encodeState(store.get())) {
    // A link is a whole engine too.
    runtime.clearFailure();
    store.replace(next);
    announceEngine();
  }
});

const toast = $('toast');
let toastTimer: number | undefined;
const showToast = (text: string) => {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  // Long enough to read: a couple of seconds, and more for a longer line.
  toastTimer = window.setTimeout(() => (toast.hidden = true), 2000 + text.length * 45);
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

announceEngine();
