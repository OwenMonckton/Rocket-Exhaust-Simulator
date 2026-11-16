import type { Limits, SimResult } from '../physics/types';
import { LIMIT_COPY, STATE_COPY } from './copy';

export interface ReadoutInfo {
  result: SimResult;
  /** The unmodified preset at the same altitude and throttle, when the engine has been changed */
  stock: SimResult | null;
  stockName: string | null;
}

function fmtThrust(n: number): string {
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

function delta(now: number, stock: number): string {
  const pct = ((now - stock) / stock) * 100;
  if (Math.abs(pct) < 0.05) return 'same as stock';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}% vs stock`;
}

const html = `
  <div class="stat big" title="The push the engine produces right now.">
    <span class="k">Thrust</span><span class="v" data-r="thrust"></span><span class="d" data-r="thrustSub"></span>
  </div>
  <div class="stat big" title="Specific impulse: how much push you get per kilogram of propellant each second. Higher is more efficient.">
    <span class="k">Efficiency (Isp)</span><span class="v" data-r="isp"></span><span class="d" data-r="ispSub"></span>
  </div>
  <div class="stat" title="Efficiency this engine would have on the ground, and in space.">
    <span class="k">Isp sea level / vacuum</span><span class="v small" data-r="ispBoth"></span><span class="d" data-r="ispBothSub"></span>
  </div>
  <div class="stat" title="How much propellant the engine burns every second.">
    <span class="k">Propellant flow</span><span class="v small" data-r="flow"></span><span class="d" data-r="flowSub"></span>
  </div>
  <div class="stat" title="Flame temperature inside the chamber, and how fast the exhaust leaves the nozzle.">
    <span class="k">Flame temp / exhaust speed</span><span class="v small" data-r="temp"></span><span class="d" data-r="tempSub"></span>
  </div>
  <div class="stat wide" title="Exhaust pressure at the nozzle exit compared with the surrounding air. The closer they match, the better the nozzle is working.">
    <span class="k">Nozzle exit vs outside air</span><span class="v small" data-r="press"></span>
    <span class="state" data-r="state"></span><span class="d" data-r="stateText"></span>
  </div>
  <div class="meters" data-r="meters"></div>
`;

export function createReadouts(root: HTMLElement): (info: ReadoutInfo) => void {
  root.innerHTML = html;
  const get = (name: string) => root.querySelector<HTMLElement>(`[data-r="${name}"]`)!;
  const meters = get('meters');
  const meterEls = {} as Record<keyof Limits, { fill: HTMLElement; value: HTMLElement; box: HTMLElement }>;
  for (const key of Object.keys(LIMIT_COPY) as (keyof Limits)[]) {
    const box = document.createElement('div');
    box.className = 'meter';
    box.title = LIMIT_COPY[key].tip;
    box.innerHTML = `<span class="k">${LIMIT_COPY[key].label}</span><span class="bar"><span class="fill"></span></span><span class="pct"></span>`;
    meters.append(box);
    meterEls[key] = { box, fill: box.querySelector('.fill')!, value: box.querySelector('.pct')! };
  }
  const notes = document.createElement('p');
  notes.className = 'notes';
  meters.append(notes);

  const set = (name: string, text: string) => {
    const node = get(name);
    if (node.textContent !== text) node.textContent = text;
  };

  return ({ result: r, stock, stockName }) => {
    set('thrust', fmtThrust(r.thrust));
    const tonnes = r.thrust / 9806.65;
    const lift = tonnes >= 10 ? `${tonnes.toFixed(0)} tonnes of push` : `${tonnes.toFixed(1)} tonnes of push`;
    set('thrustSub', stock ? delta(r.thrust, stock.thrust) : lift);
    set('isp', `${r.isp.toFixed(0)} s`);
    set('ispSub', stock ? delta(r.isp, stock.isp) : stockName ? `stock ${stockName}` : 'custom engine');
    set('ispBoth', `${r.ispSeaLevel.toFixed(0)} s / ${r.ispVacuum.toFixed(0)} s`);
    set('ispBothSub', stock ? `stock ${stock.ispSeaLevel.toFixed(0)} s / ${stock.ispVacuum.toFixed(0)} s` : '');
    set('flow', r.massFlow >= 100 ? `${r.massFlow.toFixed(0)} kg/s` : `${r.massFlow.toFixed(1)} kg/s`);
    set('flowSub', stock ? delta(r.massFlow, stock.massFlow) : `chamber at ${(r.pc / 1e5).toFixed(0)} bar`);
    set('temp', `${r.tc.toFixed(0)} K / ${(r.exitVelocity / 1000).toFixed(2)} km/s`);
    set('tempSub', `Mach ${r.exitMach.toFixed(1)} at the exit`);
    set('press', `${fmtPressure(r.pe)} vs ${fmtPressure(r.pa)}`);
    const state = get('state');
    set('state', STATE_COPY[r.state].label);
    state.dataset.state = r.state;
    set('stateText', STATE_COPY[r.state].text);

    for (const key of Object.keys(meterEls) as (keyof Limits)[]) {
      const v = r.limits[key];
      const m = meterEls[key];
      m.fill.style.width = `${Math.min(100, v * 100)}%`;
      m.value.textContent = `${Math.round(v * 100)}%`;
      m.box.dataset.level = v >= 1 ? 'red' : v >= 0.85 ? 'amber' : 'ok';
    }
    const msgs: string[] = [];
    if (r.failure) msgs.push('Past a limit: this engine will fail when fired.');
    if (r.shudder > 0 && !r.failure) msgs.push('The chamber is shuddering, close to combustion instability.');
    if (r.rough) msgs.push('Running rough: the mixture is at the edge of what will burn.');
    if (r.combustionEff < 0.95 && r.shudder === 0 && !r.rough) {
      msgs.push('Chamber too small: propellant is leaving before it finishes burning.');
    }
    const text = msgs.join(' ');
    if (notes.textContent !== text) notes.textContent = text;
  };
}
