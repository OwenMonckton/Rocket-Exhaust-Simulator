// Builds src/physics/chem/thermo.json from NASA's thermo.inp.
// Usage: node scripts/build-thermo.mjs <path to thermo.inp>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_SHA256 = 'fa7746572952d74e249e818a82a35c113829742fb421a308e167185528884363';
const ELEMENTS = new Set(['C', 'H', 'O', 'N', 'F', 'Cl', 'B', 'Li', 'Al', 'Be', 'He']);
const PRODUCT_REACTANTS = ['NO', 'N2O', 'H2O(L)', 'Li(cr)', 'AL(cr)', 'Be(a)', 'CO2', 'He'];
const T_CUTOFF = 6000;
const T_REF = 298.15;
const R = 8.31451; // J/(mol K), only used to turn H/RT into J/mol

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/build-thermo.mjs <path to thermo.inp>');
  process.exit(1);
}
const raw = readFileSync(path);
const sha = createHash('sha256').update(raw).digest('hex');
if (sha !== EXPECTED_SHA256) {
  console.error(`thermo.inp sha256 is ${sha}, expected ${EXPECTED_SHA256}. Refusing to build.`);
  process.exit(1);
}

const lines = raw.toString('latin1').split(/\r?\n/).map((l) => l.padEnd(80));
const num = (s) => Number(s.replace(/D/gi, 'E'));
const symbol = (s) => s[0].toUpperCase() + s.slice(1).toLowerCase();

function parse(startLine) {
  const records = [];
  let i = startLine;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('END')) return { records, next: i };
    if (l.startsWith('!') || l.trim() === '') { i++; continue; }
    const name = l.slice(0, 18).trim();
    const h2 = lines[i + 1];
    const n = parseInt(h2.slice(0, 2), 10);
    const elements = {};
    let hasElectron = false;
    for (let k = 0; k < 5; k++) {
      const sym = h2.slice(10 + 8 * k, 12 + 8 * k).trim();
      if (!sym) continue;
      const count = num(h2.slice(12 + 8 * k, 18 + 8 * k));
      if (count === 0) continue;
      if (sym.toUpperCase() === 'E') hasElectron = true;
      elements[symbol(sym)] = (elements[symbol(sym)] ?? 0) + count;
    }
    const phase = parseInt(h2.slice(50, 52), 10);
    const molarMass = num(h2.slice(52, 65));
    const hf = num(h2.slice(65, 80));
    const rec = { name, elements, hasElectron, phase, molarMass, hf, intervals: [], t: 0 };
    if (n === 0) {
      rec.t = num(lines[i + 2].slice(0, 11));
      i += 3;
    } else {
      for (let k = 0; k < n; k++) {
        const a = lines[i + 2 + 3 * k], b = lines[i + 3 + 3 * k], c = lines[i + 4 + 3 * k];
        const co = [];
        for (let m = 0; m < 5; m++) co.push(num(b.slice(16 * m, 16 * m + 16)));
        co.push(num(c.slice(0, 16)), num(c.slice(16, 32)));
        rec.intervals.push({
          tMin: num(a.slice(0, 11)),
          tMax: num(a.slice(11, 22)),
          a: co,
          b: [num(c.slice(48, 64)), num(c.slice(64, 80))],
        });
      }
      i += 2 + 3 * n;
    }
    records.push(rec);
  }
  throw new Error('ran off the end of the file');
}

const keeps = (r) => !r.hasElectron && Object.keys(r.elements).every((e) => ELEMENTS.has(e));

const first = lines.findIndex((l) => l.trim().toLowerCase() === 'thermo') + 2;
const products = parse(first);
const reactantRecords = parse(products.next + 1).records;

const hRT = (iv, t) => {
  const [a1, a2, a3, a4, a5, a6, a7] = iv.a;
  return -a1 / (t * t) + (a2 * Math.log(t)) / t + a3 + (a4 * t) / 2 + (a5 * t * t) / 3 +
    (a6 * t ** 3) / 4 + (a7 * t ** 4) / 5 + iv.b[0] / t;
};

const dist = (v, t) => (t < v.tMin ? v.tMin - t : t > v.tMax ? t - v.tMax : 0);
const nearestInterval = (ivs, t) => ivs.reduce((best, v) => (dist(v, t) < dist(best, t) ? v : best));

const species = products.records
  .filter((r) => !r.name.startsWith('Inert') && !r.name.startsWith('Air') && keeps(r))
  .map((r) => ({
    name: r.name,
    elements: r.elements,
    phase: r.phase,
    molarMass: r.molarMass,
    intervals: r.intervals.filter((iv) => iv.tMin < T_CUTOFF),
  }))
  .filter((s) => s.intervals.length > 0);

// Records with a polynomial give their enthalpy at 298.15 K from it; assigned-enthalpy records (no polynomial)
// carry their own enthalpy and temperature. Rounded to 1 mJ/mol so reference elements read exactly 0.
const asReactant = (r) => {
  if (r.intervals.length === 0) {
    return { name: r.name, elements: r.elements, molarMass: r.molarMass, h: r.hf, t: r.t };
  }
  const iv = nearestInterval(r.intervals, T_REF);
  const h = Math.round(hRT(iv, T_REF) * R * T_REF * 1000) / 1000 + 0;
  return { name: r.name, elements: r.elements, molarMass: r.molarMass, h, t: T_REF };
};
const reactants = {};
for (const r of reactantRecords) {
  if (r.name.startsWith('Inert') || r.name.startsWith('Air') || !keeps(r)) continue;
  reactants[r.name] = asReactant(r);
}
for (const name of PRODUCT_REACTANTS) {
  const r = products.records.find((p) => p.name === name);
  if (!r) throw new Error(`product record ${name} not found`);
  reactants[name] = asReactant(r);
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'physics', 'chem', 'thermo.json');
writeFileSync(out, JSON.stringify({ species, reactants }) + '\n');
const gases = species.filter((s) => s.phase === 0).length;
console.log(`${species.length} species (${gases} gas), ${Object.keys(reactants).length} reactants -> ${out}`);
