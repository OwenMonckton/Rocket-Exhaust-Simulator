export type PropellantId = 'kerolox' | 'hydrolox' | 'methalox' | 'hypergolic' | 'solid' | 'nuclear' | 'saltwater';

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
  name: string;
  fuel: string;
  oxidiser: string;
  ofMin: number;
  ofMax: number;
  ofDefault: number;
  /** Characteristic chamber length (m) needed for complete combustion; 0 = always complete */
  lStarRef: number;
  /** Chamber diameter (m) at which combustion instability destroys the engine */
  instabilityRefDia: number;
  throttleable: boolean;
  /**
   * What the engine's `mixtureRatio` setting means for this propellant:
   * 'ratio' is oxidiser-to-fuel mass ratio, 'temperature' is the temperature in K the propellant
   * is heated to (nuclear engines: nothing burns), 'none' is fixed.
   */
  mixKind: 'ratio' | 'temperature' | 'none';
  /** Name and one-line explanation of the temperature setting, for 'temperature' propellants */
  mixLabel?: { label: string; tip: string };
  /** Temperature (K) at which a solid reactor core fails; absent where there is no core to melt */
  coreTempLimit?: number;
  /**
   * Fraction of the gas temperature the nozzle wall is exposed to (default 1). Far below 1 where
   * the reaction is held away from the walls, as in a nuclear salt-water rocket.
   */
  wallHeatFactor?: number;
  table: { of: number; tc: number; gamma: number; molarMass: number }[];
  look: PlumeLook;
}

export interface EngineConfig {
  presetId: string | null;
  propellant: PropellantId;
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
  /**
   * Aerospike (XRS-2200): instead of a bell, a ring of small thrust cells fires along a central
   * spike, and the outside of the jet is bounded only by the surrounding air. `chambers` is then
   * the number of thrust cells, and the dimensions above describe one cell, with `exitDia` the
   * share of the spike's base that one cell's flow expands across. `nozzleLenPct` sets how much
   * of a full-length spike is kept before it is cut off flat.
   */
  aerospike: boolean;
}

export interface FlightState {
  altitudeKm: number;
  /** 0.4–1 */
  throttle: number;
}

/** 'compensating': an aerospike below its design altitude, its jet shaped by the air to match it */
export type ExpansionState = 'ideal' | 'over' | 'under' | 'separated' | 'compensating';
export type Failure = null | 'burst' | 'burnthrough' | 'instability' | 'meltdown';

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
}
