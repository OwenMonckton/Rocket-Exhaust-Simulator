export type PropellantId =
  | 'kerolox'
  | 'hydrolox'
  | 'methalox'
  | 'hypergolic'
  | 'calculated'
  | 'solid'
  | 'ntr-hydrogen'
  | 'ntr-ammonia'
  | 'ntr-methane'
  | 'ntr-water'
  | 'ntr-co2'
  | 'ntr-helium'
  | 'saltwater';

export type EnergyId = 'combustion' | 'solid' | 'reactor' | 'saltwater';
export type ExhaustId = 'bell' | 'cone' | 'dualBell' | 'none' | 'aerospike' | 'expansionDeflection';

export type RGB = [number, number, number];

export interface GasProps {
  /** Chamber temperature, K */
  tc: number;
  /** Ratio of specific heats */
  gamma: number;
  /** kg/kmol */
  molarMass: number;
  /** Specific gas constant, J/(kg K) */
  R: number;
}

export interface PlumeLook {
  core: RGB;
  mid: RGB;
  edge: RGB;
  /** Colour the plume shifts toward when running fuel-rich */
  richTint: RGB;
  /** 0–1, how solid the plume looks (hydrolox is nearly invisible) */
  opacity: number;
  /** 0–1, baseline sootiness; grows when fuel-rich */
  soot: number;
  /** 0–1, trailing smoke (solids) */
  smoke: number;
  /** Colour of unburnt fuel in the exhaust burning where it meets the air */
  afterburn: RGB;
  /** 0–1, how strongly this propellant afterburns */
  afterburnStrength: number;
  /** 0–1, glowing solid particles carried in the exhaust (alumina in solids, soot in kerosene) */
  particles: number;
}

export interface Propellant {
  id: PropellantId;
  /** The energy source this propellant is for */
  energy: EnergyId;
  name: string;
  /** One-line explanation, shown on hover */
  tip: string;
  fuel: string;
  oxidiser: string;
  ofMin: number;
  ofMax: number;
  ofDefault: number;
  /** Characteristic chamber length (m) needed for complete combustion; 0 = always complete */
  lStarRef: number;
  table: { of: number; tc: number; gamma: number; molarMass: number }[];
  look: PlumeLook;
  /** The fuel and oxidiser (ids in chem/ingredients) a tabled burning propellant is made of */
  pair?: { fuel: string; oxidiser: string };
  /** The thermo reactant a reactor heats, for a fluid the solver can work out */
  fluid?: string;
}

export interface EngineConfig {
  presetId: string | null;
  /** Where the engine gets its energy: what heats the propellant */
  energy: EnergyId;
  /**
   * How the gas leaves. With an 'aerospike' (XRS-2200), instead of a bell a ring of small thrust
   * cells fires along a central spike, and the outside of the jet is bounded only by the
   * surrounding air. `chambers` is then the number of thrust cells, and the dimensions below
   * describe one cell, with `exitDia` the share of the spike's base that one cell's flow expands
   * across. `nozzleLenPct` sets how much of a full-length spike is kept before it is cut off flat.
   */
  exhaust: ExhaustId;
  propellant: PropellantId;
  /** Fuel and oxidiser ids (chem/ingredients); what burns when the propellant is 'calculated' */
  fuel: string;
  oxidiser: string;
  /** metres */
  chamberDia: number;
  chamberLen: number;
  throatDia: number;
  exitDia: number;
  /** Bell length as % of an equivalent 15° cone, 60–100 */
  nozzleLenPct: number;
  /** Chamber wall thickness, m. Grows with engine scale; not a user control. */
  wall: number;
  chamberPressureBar: number;
  /** Oxidiser-to-fuel mass ratio; for nuclear thermal engines, the reactor core temperature in K */
  mixtureRatio: number;
  /** Engine scale multiplier already applied to the dimensions above */
  scale: number;
  /**
   * How many identical chambers share the engine's turbopump (the RD-170 has four).
   * Every dimension above describes one chamber; thrust and propellant flow are the total.
   */
  chambers: number;
  /**
   * Deployable nozzle extension (RL10B-2). `extFixedDia` is the exit diameter (m) of the fixed
   * nozzle the extension seats onto, or 0 for an ordinary one-piece nozzle; `exitDia` is then
   * the exit of the extension. `extDeploy` runs from 0 (stowed, slid forward around the engine)
   * to 1 (seated on the fixed nozzle).
   */
  extFixedDia: number;
  extDeploy: number;
  /** Half-angle of a plain cone, degrees */
  coneAngleDeg: number;
  /** Diameter at a dual bell's kink, m; 0 means not set yet */
  innerExitDia: number;
  /**
   * An expansion-deflection nozzle's plug: its diameter as a share of the wall's diameter at the
   * ring it leaves round itself. Every other exhaust carries the default and ignores it.
   */
  plugShare: number;
}

export interface FlightState {
  altitudeKm: number;
  /** 0.4–1 */
  throttle: number;
}

/**
 * 'compensating': an aerospike below its design altitude, its jet shaped by the air to match it;
 * 'held': a dual bell's jet held at the kink on purpose
 */
export type ExpansionState = 'ideal' | 'over' | 'under' | 'separated' | 'compensating' | 'held';
export type Failure =
  | null
  | 'burst'
  | 'burnthrough'
  | 'instability'
  | 'meltdown'
  | 'flameout'
  | 'inert'
  | 'detonation'
  | 'unsolved';

export interface Limits {
  structural: number;
  heating: number;
  instability: number;
}

export interface SimResult {
  /** N */
  thrust: number;
  /** s */
  isp: number;
  ispSeaLevel: number;
  ispVacuum: number;
  /** kg/s */
  massFlow: number;
  /** Pa */
  pc: number;
  pe: number;
  pa: number;
  exitMach: number;
  exitVelocity: number;
  expansionRatio: number;
  /** Diameter of the jet where it leaves the wall; less than exitDia when separated */
  effectiveExitDia: number;
  /** Exit diameter of the nozzle the gas is actually expanding through: the fixed nozzle alone until an extension seats */
  flowExitDia: number;
  tc: number;
  gamma: number;
  cStarEff: number;
  lStar: number;
  combustionEff: number;
  nozzleEff: number;
  state: ExpansionState;
  rough: boolean;
  /** 0–1 */
  shudder: number;
  limits: Limits;
  failure: Failure;
  /** The exhaust's main species and their mole fractions, largest first; empty for a tabled propellant */
  exhaust: { name: string; share: number }[];
  /** Warnings about the fuel and oxidiser; empty for a tabled propellant */
  notes: string[];
  /** True when the gas was worked out by the chemistry solver rather than taken from a table */
  calculated: boolean;
  /** False when no solve settled and the figures come from a stand-in gas; none of them is real */
  settled: boolean;
}
