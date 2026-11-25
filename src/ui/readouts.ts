import { ENERGY_SOURCES } from '../physics/parts';
import type { EnergyId, ExhaustId, Limits, SimResult } from '../physics/types';
import type { SimulatedFigures } from '../render/simFigures';
import { colourNote } from '../physics/plumeLook';
import { LIMIT_COPY, SIMULATED_TIP, STATE_COPY, expansionText, exhaustLine, limitCopy, limitNote, showsFigures } from './copy';

export interface ReadoutInfo {
  result: SimResult;
  /** The engine's exhaust type, which the words under the nozzle state depend on */
  exhaust: ExhaustId;
  /** The engine's energy source, which some wording and the gauges shown depend on. Left out, a combustion chamber. */
  energy?: EnergyId;
  /** The unmodified preset at the same altitude and throttle, when the engine has been changed */
  stock: SimResult | null;
  stockName: string | null;
  /** The same figures worked out from the simulated gas, when there are any */
  simulated: SimulatedFigures | null;
  /** Why there are none, in a few words */
  simulatedNote: string;
  /** How far the engine has run up: 0 unlit, 1 at full power. Left out, the engine is taken as running. */
  fire?: number;
}

/** The limit gauges an engine built round `energy` shows: nothing burns in an electric one, so it has no instability. */
export function gaugesFor(energy: EnergyId): (keyof Limits)[] {
  return ENERGY_SOURCES[energy].kind ? ['structural', 'heating'] : ['structural', 'heating', 'instability'];
}

/** Thrust in the unit that suits its size: a number, a space and the unit. */
export function fmtThrust(n: number): string {
  if (n < 0.1) return `${(n * 1000).toFixed(1)} mN`;
  if (n < 1) return `${(n * 1000).toFixed(0)} mN`;
  if (n < 10) return `${n.toFixed(2)} N`;
  if (n < 1000) return `${n.toFixed(0)} N`;
  const kn = n / 1000;
  if (kn >= 10000) return `${(kn / 1000).toFixed(2)} MN`;
  if (kn >= 100) return `${kn.toFixed(0)} kN`;
  return `${kn.toFixed(1)} kN`;
}

function fmtPressure(pa: number): string {
  const bar = pa / 1e5;
  if (bar === 0) return '0 bar';
  if (bar >= 0.1) return `${bar.toFixed(2)} bar`;
  if (bar >= 0.001) return `${(bar * 1000).toFixed(1)} mbar`;
  return `${(bar * 1000).toFixed(3)} mbar`;
}

/** A figure from the simulated gas, with how far it is from the formula's. */
function simulatedLine(text: string, simulated: number, formula: number): string {
  const pct = formula > 0 ? ((simulated - formula) / formula) * 100 : 0;
  const diff = Math.abs(pct) < 0.05 ? 'same' : `${pct > 0 ? '+' : '\u2212'}${Math.abs(pct).toFixed(1)}%`;
  return `${text} (${diff})`;
}

export function fmtFlow(kgs: number): string {
  if (kgs < 1e-3) return `${(kgs * 1e6).toFixed(1)} mg/s`;
  if (kgs < 1) return `${(kgs * 1000).toFixed(2)} g/s`;
  return kgs >= 100 ? `${kgs.toFixed(0)} kg/s` : `${kgs.toFixed(1)} kg/s`;
}

/** What a thrust would hold up against gravity, in words. */
export function fmtPush(n: number): string {
  const kg = n / 9.80665;
  if (kg >= 10000) return `${(kg / 1000).toFixed(0)} tonnes of push`;
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} tonnes of push`;
  if (kg >= 1) return `${kg.toFixed(0)} kg of push`;
  return kg >= 0.01 ? `${(kg * 1000).toFixed(0)} grams of push` : `${(kg * 1000).toFixed(1)} grams of push`;
}

function fmtWatts(w: number): string {
  if (w < 1000) return `${w.toFixed(0)} W`;
  return w < 10000 ? `${(w / 1000).toFixed(2)} kW` : `${(w / 1000).toFixed(1)} kW`;
}

function delta(now: number, stock: number): string {
  const pct = ((now - stock) / stock) * 100;
  if (Math.abs(pct) < 0.05) return 'same as stock';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}% vs stock`;
}

const html = `
  <p class="run" data-r="run" aria-live="polite"></p>
  <div class="gauges" data-r="meters"></div>
  <div class="hero" title="The push the engine produces right now.">
    <span class="k">Thrust</span>
    <span class="v"><span data-r="thrust"></span><small data-r="thrustUnit"></small></span><span class="d" data-r="thrustSub"></span>
  </div>
  <div class="pair">
    <div class="stat" title="Specific impulse: how much push you get per kilogram of propellant each second. Higher is more efficient.">
      <span class="k">Efficiency (Isp)</span><span class="v mid" data-r="isp"></span><span class="d" data-r="ispSub"></span>
    </div>
    <div class="stat" title="Efficiency this engine would have on the ground, and in space.">
      <span class="k">Sea level / vacuum</span><span class="v small" data-r="ispBoth"></span><span class="d" data-r="ispBothSub"></span>
    </div>
  </div>
  <div class="stat nozzle" title="Exhaust pressure at the nozzle exit compared with the surrounding air. The closer they match, the better the nozzle is working.">
    <span class="k">Nozzle</span>
    <span class="state" data-r="state" aria-live="polite"></span><span class="d" data-r="stateText"></span>
  </div>
  <details class="more">
    <summary>Engineer's numbers</summary>
    <div class="stat" title="Exhaust pressure at the nozzle exit compared with the surrounding air.">
      <span class="k">Nozzle exit vs outside air</span><span class="v small" data-r="press"></span>
    </div>
    <div class="stat" title="How much propellant the engine burns every second.">
      <span class="k">Propellant flow</span><span class="v small" data-r="flow"></span><span class="d" data-r="flowSub"></span>
    </div>
    <div class="stat" data-r="powerRow" title="The electrical power the engine is drawing, and the share of it that ends up as thrust. The rest leaves as heat. With hydrazine the share can pass 100%, because hydrazine gives off heat of its own as it breaks down.">
      <span class="k">Power / into thrust</span><span class="v small" data-r="power"></span>
    </div>
    <div class="stat" title="Temperature of the gas inside the chamber, and how fast the exhaust leaves the nozzle.">
      <span class="k" data-r="tempLabel">Flame temp / exhaust speed</span><span class="v small" data-r="temp"></span><span class="d" data-r="tempSub"></span>
    </div>
    <div class="stat" title="${SIMULATED_TIP}">
      <span class="k">From the simulated gas</span>
      <span class="sim" data-r="thrustSim"></span>
      <span class="sim" data-r="ispSim"></span>
      <span class="sim" data-r="flowSim"></span>
    </div>
    <div class="stat exhaust" data-r="exhaustRow" title="What the exhaust is made of where it leaves the nozzle, as a share of its molecules, largest first.">
      <span class="k">Exhaust</span><span class="v small" data-r="exhaust"></span><span class="d" data-r="colour"></span>
    </div>
  </details>
`;

/** Where the redline starts on a limit gauge, as a share of the limit. */
const REDLINE = 0.85;

export function createReadouts(root: HTMLElement): (info: ReadoutInfo) => void {
  root.innerHTML = html;
  const get = (name: string) => root.querySelector<HTMLElement>(`[data-r="${name}"]`)!;
  const meters = get('meters');
  const meterEls = {} as Record<keyof Limits, { fill: HTMLElement; value: HTMLElement; box: HTMLElement }>;
  for (const key of Object.keys(LIMIT_COPY) as (keyof Limits)[]) {
    const box = document.createElement('div');
    box.className = 'meter';
    box.title = LIMIT_COPY[key].tip;
    box.setAttribute('role', 'meter');
    box.setAttribute('aria-label', LIMIT_COPY[key].label);
    box.setAttribute('aria-valuemin', '0');
    box.setAttribute('aria-valuemax', '100');
    box.innerHTML = `<span class="k">${LIMIT_COPY[key].label}</span><span class="pct"></span><span class="bar"><span class="redline"></span><span class="fill"></span></span>`;
    box.style.setProperty('--redline', String(REDLINE));
    meters.append(box);
    meterEls[key] = { box, fill: box.querySelector('.fill')!, value: box.querySelector('.pct')! };
  }
  const notes = document.createElement('p');
  notes.className = 'notes';
  notes.dataset.r = 'notes';
  meters.append(notes);

  const set = (name: string, text: string) => {
    const node = get(name);
    if (node.textContent !== text) node.textContent = text;
  };

  const exhaustRow = get('exhaustRow');
  const powerRow = get('powerRow');
  const dash = '—';
  const gasFigures = ['thrust', 'thrustSub', 'isp', 'ispSub', 'ispBoth', 'ispBothSub', 'flow', 'flowSub', 'temp', 'tempSub', 'press', 'state', 'stateText'];

  return ({ result: r, exhaust: exhaustId, energy = 'combustion', stock, stockName, simulated: sim, simulatedNote, fire = 1 }) => {
    const shown = gaugesFor(energy);
    powerRow.hidden = !r.electric;
    set('tempLabel', r.electric ? 'Gas temp / exhaust speed' : 'Flame temp / exhaust speed');
    // Unlit, the figures are what the engine would do; they run up with it as it lights.
    root.dataset.run = fire <= 0 ? 'unlit' : fire < 1 ? 'starting' : 'running';
    const exhaust = exhaustLine(r.exhaust);
    set('exhaust', exhaust);
    // What in that make-up is colouring the plume. Empty, like the make-up, for a hand-picked look.
    set('colour', colourNote(r.exhaust));
    exhaustRow.hidden = exhaust === '';

    // With no settled chemistry every figure from the gas would be made up, so none is shown.
    const figures = showsFigures(r);
    for (const key of Object.keys(meterEls) as (keyof Limits)[]) meterEls[key].box.hidden = !figures || !shown.includes(key);
    if (!figures) {
      for (const name of gasFigures) set(name, name.endsWith('Sub') || name === 'stateText' ? '' : dash);
      delete get('state').dataset.state;
      for (const name of ['thrustSim', 'ispSim', 'flowSim', 'power']) set(name, '');
      set('thrustUnit', '');
      set('run', '');
      set('notes', limitNote(r));
      return;
    }

    // While the engine runs up or down, the thrust shown is the share of full thrust it has reached.
    const thrustNow = fire > 0 && fire < 1 ? r.thrust * fire : r.thrust;
    const [thrustNumber, thrustUnit] = fmtThrust(thrustNow).split(' ');
    set('thrust', thrustNumber);
    set('thrustUnit', thrustUnit);
    // One line says what every figure below it is: a forecast for a cold engine, or readings from a lit one.
    set('run', fire <= 0 ? 'Forecast: the engine is unlit' : fire < 1 ? 'Running up' : 'Live readings');
    set('thrustSub', stock ? delta(r.thrust, stock.thrust) : fmtPush(thrustNow));
    set('power', r.electric ? `${fmtWatts(r.electric.power)} / ${(r.electric.thrustEfficiency * 100).toFixed(0)}%` : '');
    set('isp', `${r.isp.toFixed(0)} s`);
    set('ispSub', stock ? delta(r.isp, stock.isp) : stockName ? `stock ${stockName}` : 'custom engine');
    set('ispBoth', `${r.ispSeaLevel.toFixed(0)} s / ${r.ispVacuum.toFixed(0)} s`);
    set('ispBothSub', stock ? `stock ${stock.ispSeaLevel.toFixed(0)} s / ${stock.ispVacuum.toFixed(0)} s` : '');
    set('flow', fmtFlow(r.massFlow));
    // Each line is the figure from the gas and how far it is from the calculated one.
    set('thrustSim', sim ? `Thrust ${simulatedLine(fmtThrust(sim.thrust), sim.thrust, r.thrust)}` : `No figures yet: ${simulatedNote || 'nothing to measure'}`);
    set('ispSim', sim ? `Efficiency ${simulatedLine(`${sim.isp.toFixed(0)} s`, sim.isp, r.isp)}` : '');
    set('flowSim', sim ? `Flow ${simulatedLine(fmtFlow(sim.massFlow), sim.massFlow, r.massFlow)}` : '');
    set('flowSub', stock ? delta(r.massFlow, stock.massFlow) : `chamber at ${(r.pc / 1e5).toFixed(r.pc < 1e6 ? 1 : 0)} bar`);
    set('temp', `${r.tc.toFixed(0)} K / ${(r.exitVelocity / 1000).toFixed(2)} km/s`);
    set('tempSub', `Mach ${r.exitMach.toFixed(1)} at the exit`);
    set('press', `${fmtPressure(r.pe)} vs ${fmtPressure(r.pa)}`);
    const state = get('state');
    set('state', STATE_COPY[r.state].label);
    state.dataset.state = r.state;
    set('stateText', expansionText(r, exhaustId));

    for (const key of Object.keys(meterEls) as (keyof Limits)[]) {
      const v = r.limits[key];
      const m = meterEls[key];
      const tip = limitCopy(key, energy).tip;
      if (m.box.title !== tip) m.box.title = tip;
      m.fill.style.width = `${Math.min(100, v * 100)}%`;
      m.value.textContent = `${Math.round(v * 100)}%`;
      m.box.setAttribute('aria-valuenow', String(Math.round(Math.min(1, v) * 100)));
      m.box.dataset.level = v >= 1 ? 'red' : v >= REDLINE ? 'amber' : 'ok';
    }
    const msgs: string[] = [];
    if (r.failure) msgs.push(limitNote(r));
    if (r.shudder > 0 && !r.failure) msgs.push('The chamber is shuddering, close to combustion instability.');
    if (r.rough) msgs.push('Running rough: the mixture is at the edge of what will burn.');
    if (r.combustionEff < 0.95 && r.shudder === 0 && !r.rough) {
      msgs.push('Chamber too small: propellant is leaving before it finishes burning.');
    }
    const text = msgs.join(' ');
    if (notes.textContent !== text) notes.textContent = text;
  };
}
