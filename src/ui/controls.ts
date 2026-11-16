import { RANGES } from '../physics/engine';
import { PRESETS } from '../physics/presets';
import { PROPELLANTS, PROPELLANT_IDS } from '../physics/propellants';
import type { PropellantId } from '../physics/types';
import type { AppState, Store } from '../state/store';
import { TIPS } from './copy';

interface SliderSpec {
  id: string;
  label: string;
  tip: string;
  log?: boolean;
  range(s: AppState): { min: number; max: number };
  get(s: AppState): number;
  set(v: number): void;
  format(v: number, s: AppState): string;
  disabled?(s: AppState): boolean;
  /** Label and tooltip that depend on the engine (overrides `label` and `tip`) */
  describe?(s: AppState): { label: string; tip: string };
}

const STEPS = 1000;

export function formatLength(m: number): string {
  if (m >= 1) return `${m.toFixed(2)} m`;
  if (m >= 0.1) return `${(m * 100).toFixed(1)} cm`;
  return `${(m * 100).toFixed(2)} cm`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Builds the left-hand control panel. Returns a function that syncs it to the latest state. */
export function createControls(root: HTMLElement, store: Store): (s: AppState) => void {
  const dim = (key: 'chamberDia' | 'chamberLen' | 'throatDia' | 'exitDia', label: string): SliderSpec => ({
    id: key,
    label,
    tip: TIPS[key],
    log: true,
    range: () => RANGES[key],
    get: (s) => s.config[key],
    set: (v) => store.set({ config: { [key]: v } }),
    format: (v, s) =>
      key === 'exitDia'
        ? `${formatLength(v)} · ratio ${((v / s.config.throatDia) ** 2).toFixed(1)}`
        : formatLength(v),
  });

  const groups: { title: string; sliders: SliderSpec[]; extra?: (box: HTMLElement) => void }[] = [
    {
      title: 'Engine',
      sliders: [
        {
          id: 'scale',
          label: 'Engine scale',
          tip: TIPS.scale,
          log: true,
          range: () => RANGES.scale,
          get: (s) => s.config.scale,
          set: (v) => store.setScale(v),
          format: (v) => `× ${v.toFixed(2)}`,
        },
        dim('chamberDia', 'Chamber diameter'),
        dim('chamberLen', 'Chamber length'),
        dim('throatDia', 'Throat diameter'),
        dim('exitDia', 'Nozzle exit diameter'),
        {
          id: 'nozzleLenPct',
          label: 'Nozzle length',
          tip: TIPS.nozzleLenPct,
          range: () => RANGES.nozzleLenPct,
          get: (s) => s.config.nozzleLenPct,
          set: (v) => store.set({ config: { nozzleLenPct: Math.round(v) } }),
          format: (v) => `${Math.round(v)} %`,
        },
        {
          id: 'chamberPressureBar',
          label: 'Chamber pressure',
          tip: TIPS.chamberPressureBar,
          range: () => RANGES.chamberPressureBar,
          get: (s) => s.config.chamberPressureBar,
          set: (v) => store.set({ config: { chamberPressureBar: Math.round(v) } }),
          format: (v) => `${Math.round(v)} bar`,
        },
      ],
    },
    {
      title: 'Propellant',
      sliders: [
        {
          id: 'mixtureRatio',
          label: 'Mixture ratio',
          tip: TIPS.mixtureRatio,
          range: (s) => {
            const p = PROPELLANTS[s.config.propellant];
            return { min: p.ofMin, max: Math.max(p.ofMax, p.ofMin + 1e-6) };
          },
          get: (s) => s.config.mixtureRatio,
          set: (v) => {
            const kind = PROPELLANTS[store.get().config.propellant].mixKind;
            const rounded = kind === 'temperature' ? Math.round(v / 10) * 10 : Math.round(v * 100) / 100;
            store.set({ config: { mixtureRatio: rounded } });
          },
          format: (v, s) => {
            const kind = PROPELLANTS[s.config.propellant].mixKind;
            if (kind === 'ratio') return `${v.toFixed(2)} : 1`;
            return kind === 'temperature' ? `${Math.round(v)} K` : 'fixed in the grain';
          },
          disabled: (s) => PROPELLANTS[s.config.propellant].mixKind === 'none',
          describe: (s) =>
            PROPELLANTS[s.config.propellant].mixKind === 'temperature'
              ? { label: 'Core temperature', tip: TIPS.coreTemperature }
              : { label: 'Mixture ratio', tip: TIPS.mixtureRatio },
        },
      ],
    },
    {
      title: 'Flight',
      sliders: [
        {
          id: 'altitudeKm',
          label: 'Altitude',
          tip: TIPS.altitudeKm,
          range: () => RANGES.altitudeKm,
          get: (s) => s.flight.altitudeKm,
          set: (v) => store.set({ flight: { altitudeKm: Math.round(v * 10) / 10 } }),
          format: (v) => (v >= 86 ? `${v.toFixed(0)} km · vacuum` : `${v.toFixed(1)} km`),
        },
        {
          id: 'throttle',
          label: 'Throttle',
          tip: TIPS.throttle,
          range: () => RANGES.throttle,
          get: (s) => s.flight.throttle,
          set: (v) => store.set({ flight: { throttle: Math.round(v * 100) / 100 } }),
          format: (v, s) =>
            PROPELLANTS[s.config.propellant].throttleable ? `${Math.round(v * 100)} %` : 'solids cannot throttle',
          disabled: (s) => !PROPELLANTS[s.config.propellant].throttleable,
        },
      ],
    },
  ];

  const syncers: ((s: AppState) => void)[] = [];

  const propellantSelect = el('select');
  propellantSelect.id = 'propellant';
  for (const id of PROPELLANT_IDS) {
    const opt = el('option', undefined, PROPELLANTS[id].name);
    opt.value = id;
    propellantSelect.append(opt);
  }
  const propellantNote = el('p', 'note');
  propellantSelect.addEventListener('change', () =>
    store.set({ config: { propellant: propellantSelect.value as PropellantId } }),
  );
  syncers.push((s) => {
    propellantSelect.value = s.config.propellant;
    const p = PROPELLANTS[s.config.propellant];
    propellantNote.textContent = `${p.fuel} + ${p.oxidiser}`;
  });

  for (const group of groups) {
    const box = el('section', 'group');
    box.append(el('h2', undefined, group.title));
    if (group.title === 'Propellant') {
      const row = el('label', 'row');
      row.title = TIPS.propellant;
      const head = el('span', 'row-head');
      head.append(el('span', 'name', 'Type'));
      row.append(head, propellantSelect, propellantNote);
      box.append(row);
    }
    for (const spec of group.sliders) {
      const row = el('label', 'row');
      row.title = spec.tip;
      const head = el('span', 'row-head');
      const value = el('output');
      const name = el('span', 'name', spec.label);
      head.append(name, value);
      const input = el('input');
      input.type = 'range';
      input.id = spec.id;
      input.min = '0';
      input.max = String(STEPS);
      input.step = '1';
      row.append(head, input);
      box.append(row);

      const toValue = (pos: number, s: AppState) => {
        const { min, max } = spec.range(s);
        const f = pos / STEPS;
        return spec.log ? min * Math.pow(max / min, f) : min + (max - min) * f;
      };
      const toPos = (v: number, s: AppState) => {
        const { min, max } = spec.range(s);
        const f = spec.log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
        return Math.round(Math.min(1, Math.max(0, f)) * STEPS);
      };
      input.addEventListener('input', () => spec.set(toValue(Number(input.value), store.get())));
      syncers.push((s) => {
        const v = spec.get(s);
        const pos = String(toPos(v, s));
        if (input.value !== pos) input.value = pos;
        value.textContent = spec.format(v, s);
        const text = spec.describe?.(s);
        if (text) {
          name.textContent = text.label;
          row.title = text.tip;
        }
        const off = spec.disabled?.(s) ?? false;
        input.disabled = off;
        row.classList.toggle('disabled', off);
      });
    }
    root.append(box);
  }

  const sync = (s: AppState) => syncers.forEach((fn) => fn(s));
  store.subscribe(sync);
  sync(store.get());
  return sync;
}

export function fillPresetSelect(select: HTMLSelectElement): void {
  for (const p of PRESETS) {
    const opt = el('option', undefined, p.name);
    opt.value = p.id;
    select.append(opt);
  }
  const custom = el('option', undefined, 'Custom engine');
  custom.value = '';
  custom.hidden = true;
  select.append(custom);
}
