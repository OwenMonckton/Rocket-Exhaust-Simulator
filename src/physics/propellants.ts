import type { GasProps, Propellant, PropellantId } from './types';

const R_UNIVERSAL = 8314.46;

// Chamber properties from published chemical-equilibrium (NASA CEA) results at
// roughly 70 bar. Gamma is an effective value for the nozzle expansion.
export const PROPELLANTS: Record<PropellantId, Propellant> = {
  kerolox: {
    id: 'kerolox',
    name: 'Kerolox',
    fuel: 'RP-1 kerosene',
    oxidiser: 'liquid oxygen',
    ofMin: 1.8,
    ofMax: 3.4,
    ofDefault: 2.36,
    lStarRef: 1.0,
    instabilityRefDia: 1.15,
    throttleable: true,
    mixKind: 'ratio',
    table: [
      { of: 1.8, tc: 3050, gamma: 1.225, molarMass: 19.3 },
      { of: 2.1, tc: 3350, gamma: 1.21, molarMass: 20.9 },
      { of: 2.4, tc: 3540, gamma: 1.195, molarMass: 22.4 },
      { of: 2.7, tc: 3640, gamma: 1.185, molarMass: 23.7 },
      { of: 3.0, tc: 3670, gamma: 1.18, molarMass: 24.8 },
      { of: 3.4, tc: 3620, gamma: 1.175, molarMass: 26.2 },
    ],
    look: {
      core: [1.0, 0.93, 0.72],
      mid: [1.0, 0.62, 0.2],
      edge: [0.95, 0.33, 0.06],
      richTint: [0.85, 0.3, 0.04],
      opacity: 1.0,
      soot: 0.45,
      smoke: 0.08,
      afterburn: [1.0, 0.5, 0.14],
      afterburnStrength: 0.8,
      particles: 0.3,
    },
  },
  hydrolox: {
    id: 'hydrolox',
    name: 'Hydrolox',
    fuel: 'liquid hydrogen',
    oxidiser: 'liquid oxygen',
    ofMin: 3.5,
    ofMax: 8.0,
    ofDefault: 6.0,
    lStarRef: 0.7,
    instabilityRefDia: 1.15,
    throttleable: true,
    mixKind: 'ratio',
    table: [
      { of: 3.5, tc: 2650, gamma: 1.215, molarMass: 8.9 },
      { of: 4.5, tc: 3050, gamma: 1.195, molarMass: 10.8 },
      { of: 5.5, tc: 3350, gamma: 1.175, molarMass: 12.6 },
      { of: 6.0, tc: 3470, gamma: 1.165, molarMass: 13.4 },
      { of: 7.0, tc: 3600, gamma: 1.155, molarMass: 14.9 },
      { of: 8.0, tc: 3650, gamma: 1.145, molarMass: 16.2 },
    ],
    look: {
      core: [0.86, 0.9, 1.0],
      mid: [0.5, 0.62, 1.0],
      edge: [0.42, 0.36, 0.9],
      richTint: [0.75, 0.5, 0.85],
      opacity: 0.42,
      soot: 0,
      smoke: 0,
      afterburn: [1.0, 0.5, 0.36],
      afterburnStrength: 1.0,
      particles: 0,
    },
  },
  methalox: {
    id: 'methalox',
    name: 'Methalox',
    fuel: 'liquid methane',
    oxidiser: 'liquid oxygen',
    ofMin: 2.6,
    ofMax: 4.2,
    ofDefault: 3.6,
    lStarRef: 0.9,
    instabilityRefDia: 1.15,
    throttleable: true,
    mixKind: 'ratio',
    table: [
      { of: 2.6, tc: 3150, gamma: 1.185, molarMass: 18.3 },
      { of: 3.0, tc: 3400, gamma: 1.175, molarMass: 19.8 },
      { of: 3.4, tc: 3550, gamma: 1.165, molarMass: 21.2 },
      { of: 3.8, tc: 3620, gamma: 1.16, molarMass: 22.4 },
      { of: 4.2, tc: 3610, gamma: 1.155, molarMass: 23.5 },
    ],
    look: {
      core: [0.8, 0.86, 1.0],
      mid: [0.52, 0.5, 1.0],
      edge: [1.0, 0.45, 0.5],
      richTint: [1.0, 0.55, 0.3],
      opacity: 0.6,
      soot: 0.04,
      smoke: 0,
      afterburn: [1.0, 0.52, 0.42],
      afterburnStrength: 0.6,
      particles: 0,
    },
  },
  hypergolic: {
    id: 'hypergolic',
    name: 'Hypergolic',
    fuel: 'UDMH hydrazine',
    oxidiser: 'nitrogen tetroxide',
    ofMin: 1.6,
    ofMax: 3.2,
    ofDefault: 2.6,
    lStarRef: 0.8,
    instabilityRefDia: 1.15,
    throttleable: true,
    mixKind: 'ratio',
    table: [
      { of: 1.6, tc: 2950, gamma: 1.225, molarMass: 20.0 },
      { of: 2.0, tc: 3200, gamma: 1.215, molarMass: 21.5 },
      { of: 2.4, tc: 3380, gamma: 1.205, molarMass: 23.0 },
      { of: 2.8, tc: 3430, gamma: 1.2, molarMass: 24.3 },
      { of: 3.2, tc: 3380, gamma: 1.195, molarMass: 25.4 },
    ],
    look: {
      core: [1.0, 0.86, 0.7],
      mid: [1.0, 0.55, 0.3],
      edge: [0.75, 0.3, 0.14],
      richTint: [0.7, 0.36, 0.16],
      opacity: 0.7,
      soot: 0.15,
      smoke: 0.12,
      afterburn: [0.9, 0.45, 0.2],
      afterburnStrength: 0.5,
      particles: 0.05,
    },
  },
  solid: {
    id: 'solid',
    name: 'Solid (APCP)',
    fuel: 'aluminium + rubber binder',
    oxidiser: 'ammonium perchlorate',
    ofMin: 1,
    ofMax: 1,
    ofDefault: 1,
    lStarRef: 0,
    instabilityRefDia: 4.0,
    throttleable: false,
    mixKind: 'none',
    table: [{ of: 1, tc: 3400, gamma: 1.18, molarMass: 28.5 }],
    look: {
      core: [1.0, 0.98, 0.9],
      mid: [1.0, 0.86, 0.55],
      edge: [1.0, 0.6, 0.25],
      richTint: [1.0, 0.6, 0.25],
      opacity: 1.0,
      soot: 0.1,
      smoke: 1.0,
      afterburn: [1.0, 0.7, 0.4],
      afterburnStrength: 0.7,
      particles: 1.0,
    },
  },
  nuclear: {
    id: 'nuclear',
    name: 'Nuclear thermal',
    fuel: 'liquid hydrogen',
    oxidiser: 'a reactor to heat it',
    // For this propellant the "mixture" setting is the reactor core temperature in kelvin.
    ofMin: 1500,
    ofMax: 3200,
    ofDefault: 2360,
    lStarRef: 0,
    instabilityRefDia: 6.0,
    throttleable: true,
    mixKind: 'temperature',
    table: [
      { of: 1500, tc: 1500, gamma: 1.36, molarMass: 2.016 },
      { of: 2000, tc: 2000, gamma: 1.34, molarMass: 2.016 },
      { of: 2360, tc: 2360, gamma: 1.33, molarMass: 2.016 },
      { of: 2800, tc: 2800, gamma: 1.315, molarMass: 2.01 },
      { of: 3200, tc: 3200, gamma: 1.3, molarMass: 1.99 },
    ],
    look: {
      core: [0.92, 0.88, 1.0],
      mid: [0.72, 0.62, 0.98],
      edge: [0.6, 0.45, 0.9],
      richTint: [0.6, 0.45, 0.9],
      opacity: 0.42,
      soot: 0,
      smoke: 0,
      afterburn: [1.0, 0.55, 0.4],
      afterburnStrength: 1.0,
      particles: 0,
    },
  },
};
export const PROPELLANT_IDS = Object.keys(PROPELLANTS) as PropellantId[];

export function isPropellantId(v: unknown): v is PropellantId {
  return typeof v === 'string' && v in PROPELLANTS;
}

export function clampMixture(id: PropellantId, of: number): number {
  const p = PROPELLANTS[id];
  if (!Number.isFinite(of)) return p.ofDefault;
  return Math.min(p.ofMax, Math.max(p.ofMin, of));
}

/** Chamber gas properties at a mixture ratio (linear interpolation, clamped to the table). */
export function gasProps(id: PropellantId, of: number): GasProps {
  const t = PROPELLANTS[id].table;
  const x = clampMixture(id, of);
  let i = 0;
  while (i < t.length - 2 && x > t[i + 1].of) i++;
  const a = t[i];
  const b = t[Math.min(i + 1, t.length - 1)];
  const f = b.of === a.of ? 0 : Math.min(1, Math.max(0, (x - a.of) / (b.of - a.of)));
  const tc = a.tc + (b.tc - a.tc) * f;
  const gamma = a.gamma + (b.gamma - a.gamma) * f;
  const molarMass = a.molarMass + (b.molarMass - a.molarMass) * f;
  return { tc, gamma, molarMass, R: R_UNIVERSAL / molarMass };
}

/** -1 at the oxidiser-rich end of the range, 0 at peak flame temperature, +1 at the fuel-rich end. */
export function richness(id: PropellantId, of: number): number {
  const p = PROPELLANTS[id];
  if (p.table.length < 2) return 0;
  const peak = p.table.reduce((best, row) => (row.tc > best.tc ? row : best)).of;
  const x = clampMixture(id, of);
  if (x < peak) return (peak - x) / Math.max(1e-9, peak - p.ofMin);
  return -(x - peak) / Math.max(1e-9, p.ofMax - peak);
}
