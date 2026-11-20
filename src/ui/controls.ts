import { RANGES } from '../physics/engine';
import { mixRange } from '../physics/gasSource';
import { ENERGY_IDS, ENERGY_SOURCES, EXHAUSTS, EXHAUST_IDS, propellantsFor } from '../physics/parts';
import { PRESETS } from '../physics/presets';
import { PROPELLANTS } from '../physics/propellants';
import type { EnergyId, ExhaustId, PropellantId } from '../physics/types';
import { FUELS, FUEL_IDS, NO_OXIDISER, OXIDISERS, OXIDISER_IDS, type Ingredient } from '../physics/chem/ingredients';
import { simulate } from '../physics/engine';
import type { AppState, Store } from '../state/store';
import { AEROSPIKE_DIMS, COUNT_COPY, TIPS } from './copy';

interface SliderSpec {
  id: string;
  label: string;
  tip: string;
  /** Spread the slider's range evenly by ratio rather than by difference */
  log?: boolean | ((s: AppState) => boolean);
  range(s: AppState): { min: number; max: number };
  get(s: AppState): number;
  set(v: number): void;
  format(v: number, s: AppState): string;
  disabled?(s: AppState): boolean;
  /** Label and tooltip that depend on the engine (overrides `label` and `tip`) */
  describe?(s: AppState): { label: string; tip: string };
}

/** A menu that picks one of the engine's parts. */
interface SelectSpec {
  id: string;
  label: string;
  tip: string;
  /** Options with a `group` are listed under that heading */
  options(s: AppState): { value: string; label: string; tip?: string; group?: string }[];
  get(s: AppState): string;
  set(v: string): void;
  /** A line of small print under the menu */
  note?(s: AppState): string;
  /** Hide the menu, and its note, for engines it does not apply to */
  hidden?(s: AppState): boolean;
}

/** A fuel or oxidiser as a menu option, under its group's heading. */
const ingredientOption = (i: Ingredient) => ({ value: i.id, label: i.name, tip: i.tip, group: i.group });

/** True when the gas comes from a fuel and an oxidiser picked by name (or an example's pair of them). */
const burnsPair = (s: AppState) => s.config.energy === 'combustion';
/** True when the solver works the gas out from the picked fuel and oxidiser. */
const calculatedBurn = (s: AppState) => burnsPair(s) && s.config.propellant === 'calculated';

/** Value of the Examples menu entry that starts a blank engine. */
export const NEW_ENGINE = '__new';

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
    format: (v, s) => {
      // An aerospike's sliders size one thrust cell; its exit is the whole ring of cells.
      const shown = key === 'exitDia' && s.config.exhaust === 'aerospike' ? v * Math.sqrt(s.config.chambers) : v;
      return key === 'exitDia'
        ? `${formatLength(shown)} · ratio ${((v / s.config.throatDia) ** 2).toFixed(1)}`
        : formatLength(v);
    },
    describe: (s) => (s.config.exhaust === 'aerospike' ? AEROSPIKE_DIMS[key] : { label, tip: TIPS[key] }),
  });

  const groups: { title: string; selects?: SelectSpec[]; sliders: SliderSpec[] }[] = [
    {
      title: 'Parts',
      selects: [
        {
          id: 'energy',
          label: 'Energy source',
          tip: TIPS.energy,
          options: () => ENERGY_IDS.map((id) => ({ value: id, label: ENERGY_SOURCES[id].name, tip: ENERGY_SOURCES[id].tip })),
          get: (s) => s.config.energy,
          set: (v) => store.setEnergy(v as EnergyId),
          note: (s) => ENERGY_SOURCES[s.config.energy].tip,
        },
        {
          id: 'exhaust',
          label: 'Exhaust',
          tip: TIPS.exhaust,
          options: () => EXHAUST_IDS.map((id) => ({ value: id, label: EXHAUSTS[id].name, tip: EXHAUSTS[id].tip })),
          get: (s) => s.config.exhaust,
          set: (v) => store.setExhaust(v as ExhaustId),
          note: (s) => EXHAUSTS[s.config.exhaust].tip,
        },
        {
          id: 'propellant',
          label: 'Propellant',
          tip: TIPS.propellant,
          // Only what this energy source can use.
          options: (s) => propellantsFor(s.config.energy).map((id) => ({ value: id, label: PROPELLANTS[id].name, tip: PROPELLANTS[id].tip })),
          get: (s) => s.config.propellant,
          set: (v) => store.set({ config: { propellant: v as PropellantId } }),
          note: (s) => {
            if (s.config.propellant === 'calculated') return '';
            const p = PROPELLANTS[s.config.propellant];
            return `${p.fuel} + ${p.oxidiser}`;
          },
          // A combustion chamber picks its fuel and oxidiser separately instead.
          hidden: burnsPair,
        },
        {
          id: 'fuel',
          label: 'Fuel',
          tip: TIPS.fuel,
          options: () => FUEL_IDS.map((id) => ingredientOption(FUELS[id])),
          get: (s) => s.config.fuel,
          set: (v) => store.setFuel(v),
          note: (s) => (calculatedBurn(s) ? FUELS[s.config.fuel].tip : "Tuned to the real engine's published figures"),
          hidden: (s) => !burnsPair(s),
        },
        {
          id: 'oxidiser',
          label: 'Oxidiser',
          tip: TIPS.oxidiser,
          options: () => OXIDISER_IDS.map((id) => ingredientOption(OXIDISERS[id])),
          get: (s) => s.config.oxidiser,
          set: (v) => store.setOxidiser(v),
          // The physics' warnings about this pair. The result is cached, so this costs nothing new.
          note: (s) => simulate(s.config, s.flight).notes.join(' · '),
          hidden: (s) => !burnsPair(s),
        },
      ],
      sliders: [],
    },
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
        {
          id: 'chambers',
          label: COUNT_COPY.bell.label,
          tip: COUNT_COPY.bell.tip,
          range: (s) => (s.config.exhaust === 'aerospike' ? RANGES.cells : RANGES.chambers),
          get: (s) => s.config.chambers,
          set: (v) => store.set({ config: { chambers: Math.round(v) } }),
          format: (v) => String(Math.round(v)),
          describe: (s) => COUNT_COPY[s.config.exhaust],
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
          format: (v, s) =>
            s.config.exhaust === 'aerospike' ? `${Math.round(20 + (80 * (v - 60)) / 40)} % of a full spike` : `${Math.round(v)} %`,
          describe: (s) =>
            s.config.exhaust === 'aerospike'
              ? AEROSPIKE_DIMS.nozzleLenPct
              : { label: 'Nozzle length', tip: TIPS.nozzleLenPct },
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
          // A burning pair's ratio can span a hundredfold, so it is spread by ratio.
          log: (s) => calculatedBurn(s) && mixRange(s.config).ofMin > 0,
          range: (s) => {
            const p = mixRange(s.config);
            return { min: p.ofMin, max: Math.max(p.ofMax, p.ofMin + 1e-6) };
          },
          get: (s) => s.config.mixtureRatio,
          set: (v) => {
            const p = mixRange(store.get().config);
            // Temperatures step in round numbers suited to their range: 10 K for a reactor core,
            // 10,000 K for a fission plasma.
            const step = Math.pow(10, Math.floor(Math.log10(p.ofMax - p.ofMin)) - 2);
            const rounded = ENERGY_SOURCES[store.get().config.energy].mixKind === 'temperature' ? Math.round(v / step) * step : Math.round(v * 100) / 100;
            store.set({ config: { mixtureRatio: rounded } });
          },
          format: (v, s) => {
            const kind = ENERGY_SOURCES[s.config.energy].mixKind;
            if (kind === 'ratio') return `${v.toFixed(2)} : 1`;
            return kind === 'temperature' ? `${Math.round(v).toLocaleString('en-US')} K` : 'fixed in the grain';
          },
          disabled: (s) =>
            ENERGY_SOURCES[s.config.energy].mixKind === 'none' || (calculatedBurn(s) && s.config.oxidiser === NO_OXIDISER),
          describe: (s) =>
            ENERGY_SOURCES[s.config.energy].mixLabel ?? { label: 'Mixture ratio', tip: TIPS.mixtureRatio },
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
            ENERGY_SOURCES[s.config.energy].throttleable ? `${Math.round(v * 100)} %` : 'solids cannot throttle',
          disabled: (s) => !ENERGY_SOURCES[s.config.energy].throttleable,
        },
      ],
    },
  ];

  const syncers: ((s: AppState) => void)[] = [];

  for (const group of groups) {
    const box = el('section', 'group');
    box.append(el('h2', undefined, group.title));
    for (const spec of group.selects ?? []) {
      const row = el('label', 'row');
      row.title = spec.tip;
      const head = el('span', 'row-head');
      head.append(el('span', 'name', spec.label));
      const select = el('select');
      select.id = spec.id;
      const note = el('p', 'note');
      row.append(head, select, note);
      box.append(row);
      select.addEventListener('change', () => spec.set(select.value));
      // The menu is only rebuilt when what it offers changes, so it stays open while in use.
      let offered = '';
      syncers.push((s) => {
        const hide = spec.hidden?.(s) ?? false;
        row.hidden = hide;
        if (hide) return;
        const options = spec.options(s);
        const key = options.map((o) => `${o.group ?? ''}:${o.value}`).join('|');
        if (key !== offered) {
          offered = key;
          // Options with a group go under its heading, the headings in the order they first appear.
          const loose: HTMLOptionElement[] = [];
          const headings = new Map<string, HTMLOptGroupElement>();
          for (const o of options) {
            const opt = el('option', undefined, o.label);
            opt.value = o.value;
            if (o.tip) opt.title = o.tip;
            if (!o.group) {
              loose.push(opt);
              continue;
            }
            let heading = headings.get(o.group);
            if (!heading) {
              heading = el('optgroup');
              heading.label = o.group;
              headings.set(o.group, heading);
            }
            heading.append(opt);
          }
          select.replaceChildren(...loose, ...headings.values());
        }
        if (select.value !== spec.get(s)) select.value = spec.get(s);
        const text = spec.note?.(s) ?? '';
        if (note.textContent !== text) note.textContent = text;
      });
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

      const isLog = (s: AppState) => (typeof spec.log === 'function' ? spec.log(s) : (spec.log ?? false));
      const toValue = (pos: number, s: AppState) => {
        const { min, max } = spec.range(s);
        const f = pos / STEPS;
        return isLog(s) ? min * Math.pow(max / min, f) : min + (max - min) * f;
      };
      const toPos = (v: number, s: AppState) => {
        const { min, max } = spec.range(s);
        const f = isLog(s) ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
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
  const fresh = el('option', undefined, 'New engine');
  fresh.value = NEW_ENGINE;
  fresh.title = 'Start again from a blank engine.';
  select.append(fresh);
  for (const p of PRESETS) {
    const opt = el('option', undefined, p.name);
    opt.value = p.id;
    select.append(opt);
  }
  const custom = el('option', undefined, 'Your engine');
  custom.value = '';
  custom.hidden = true;
  select.append(custom);
}
