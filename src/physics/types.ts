export type PropellantId = 'kerolox' | 'hydrolox' | 'methalox' | 'hypergolic' | 'solid' | 'nuclear';

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
   * 'ratio' is oxidiser-to-fuel mass ratio, 'temperature' is reactor core temperature in K
   * (nuclear thermal: nothing burns, a reactor heats the propellant), 'none' is fixed.
   */
  mixKind: 'ratio' | 'temperature' | 'none';
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
}

export interface FlightState {
  altitudeKm: number;
  /** 0.4–1 */
  throttle: number;
}

export type ExpansionState = 'ideal' | 'over' | 'under' | 'separated';
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
