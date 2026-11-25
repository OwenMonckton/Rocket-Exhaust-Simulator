// Beam thrusters: the gridded ion thruster and the Hall-effect thruster. Neither has a chamber, a
// throat or hot gas. Propellant atoms are stripped of an electron and thrown out by a voltage, so
// everything follows from the power, the voltage and the mass of one atom.
//
// The relations are the textbook ones (Goebel and Katz, Fundamentals of Electric Propulsion, 2008,
// chapter 2). The shares below are that book's typical figures, set once so that the example
// thrusters as a group come out near their published thrust and Isp; docs/future-work.md has the
// comparison.
import { ambientPressure } from './atmosphere';
import type { EngineConfig, Failure, FlightState, RGB, SimResult } from './types';

const E = 1.602176634e-19;  // C, the charge of one electron
const U = 1.66053907e-27;   // kg, one atomic mass unit
const G0 = 9.80665;

export type BeamType = 'ion' | 'hall';
export type BeamPropellantId = 'xenon' | 'krypton' | 'argon' | 'iodine';

export interface BeamPropellant {
  /** Mass of one atom, atomic mass units */
  massU: number;
  /** Energy to strip its first electron, eV */
  ioniseEV: number;
  /** Colour of its glowing beam */
  colour: RGB;
  colourName: string;
}

export const BEAM_PROPELLANTS: Record<BeamPropellantId, BeamPropellant> = {
  xenon: { massU: 131.29, ioniseEV: 12.13, colour: [0.55, 0.62, 1.0], colourName: 'blue-violet' },
  krypton: { massU: 83.8, ioniseEV: 14.0, colour: [0.85, 0.83, 1.0], colourName: 'pale lilac' },
  argon: { massU: 39.95, ioniseEV: 15.76, colour: [0.92, 0.55, 0.95], colourName: 'pink-violet' },
  // Iodine is stored as a solid and leaves as single atoms.
  iodine: { massU: 126.9, ioniseEV: 10.45, colour: [0.8, 0.95, 0.45], colourName: 'yellow-green' },
};

export function isBeamPropellant(id: string): id is BeamPropellantId {
  return Object.hasOwn(BEAM_PROPELLANTS, id);
}

/** A beam thruster lights only where the outside pressure is below this, Pa: about 80 km up. Real ones need a harder vacuum still. */
export const BEAM_VACUUM_PA = 1;

// ---- Gridded ion ----
/** Volts' worth of power spent making each xenon ion, on top of the voltage that throws it out. */
const ION_COST_XENON_V = 200;
/** The share of the beam's push that points straight back, after its spread and the atoms that lost two electrons. */
const ION_BEAM_SHARE = 0.96;
/** The share of the propellant that leaves as ions; the rest drifts out unused, or feeds the neutraliser. */
const ION_USED_SHARE = 0.84;
/**
 * The most current two grids can pull through each square metre of themselves, A/m², per volt to
 * the power 1.5 (the Child-Langmuir law: the charge of the ions already between the grids holds the
 * rest back). About a quarter of the law's figure for grids a millimetre apart, for the area that
 * is holes and for the unevenness of a real beam. Puts NSTAR at 58% of its limit and NEXT at 38%.
 */
const K_GRID = 1.18e-3;

// ---- Hall effect ----
/** Volts lost in the channel: ions are made part-way down it, and the beam spreads in energy. */
const HALL_LOST_V = 40;
/** The share of the current that is ions leaving; the rest is electrons crossing the field the wrong way. */
const HALL_ELECTRICAL_SHARE = 0.8;
const HALL_BEAM_SHARE = 0.9;
/** The share of xenon that leaves as ions. A lighter atom crosses the channel faster and is likelier to get out un-ionised. */
const HALL_USED_SHARE_XENON = 0.9;
const HALL_USED_MASS_POWER = 0.15;
/** The channel's share of the thruster's face. */
const HALL_CHANNEL_SHARE = 0.4;
/** The most waste heat a channel's walls can shed, W per square metre of channel. Puts the SPT-100 and the XR-5 near half. */
const K_HALL = 4.5e5;

const XENON = BEAM_PROPELLANTS.xenon;

/**
 * The shares a thruster of `type` runs at on `propellant` at `voltage`: of its power that becomes
 * beam current times voltage, of the beam's push that counts, of the propellant that is used, and
 * the volts the atoms do not get.
 */
export function beamShares(type: BeamType, propellant: BeamPropellantId, voltage: number): { electrical: number; beam: number; used: number; lostVolts: number } {
  const p = BEAM_PROPELLANTS[propellant];
  if (type === 'ion') {
    // An atom that is harder to ionise costs more to make an ion of.
    const cost = ION_COST_XENON_V * (p.ioniseEV / XENON.ioniseEV);
    return { electrical: voltage / (voltage + cost), beam: ION_BEAM_SHARE, used: ION_USED_SHARE, lostVolts: 0 };
  }
  return {
    electrical: HALL_ELECTRICAL_SHARE,
    beam: HALL_BEAM_SHARE,
    used: HALL_USED_SHARE_XENON * (p.massU / XENON.massU) ** HALL_USED_MASS_POWER,
    // Never all of them: the least voltage a Hall thruster runs at is well above this.
    lostVolts: Math.min(HALL_LOST_V, 0.5 * voltage),
  };
}

/** A beam thruster's figures. `cfg` and `flight` are already sanitised. */
export function simulateBeam(cfg: EngineConfig, flight: FlightState): SimResult {
  const type = cfg.energy as BeamType;
  const propellant: BeamPropellantId = isBeamPropellant(cfg.propellant) ? cfg.propellant : 'xenon';
  const m = BEAM_PROPELLANTS[propellant].massU * U;
  const pa = ambientPressure(flight.altitudeKm * 1000);
  const power = cfg.powerKW * 1000 * flight.throttle;
  const shares = beamShares(type, propellant, cfg.voltage);
  const vNet = cfg.voltage - shares.lostVolts;

  const current = (shares.electrical * power) / cfg.voltage;
  const speed = Math.sqrt((2 * E * vNet) / m);
  const thrust = shares.beam * current * Math.sqrt((2 * m * vNet) / E);
  const flow = (current * m) / (E * shares.used);
  const isp = thrust / (flow * G0);
  const efficiency = thrust ** 2 / (2 * flow * power);

  const face = (Math.PI / 4) * cfg.exitDia ** 2;
  // Each type has one limit: the grids' current, or the channel's heat.
  const grid = type === 'ion' ? current / face / (K_GRID * cfg.voltage ** 1.5) : 0;
  const heat = type === 'hall' ? (power * (1 - efficiency)) / (K_HALL * HALL_CHANNEL_SHARE * face) : 0;

  const lit = pa < BEAM_VACUUM_PA;
  const failure: Failure = !lit ? 'noVacuum' : grid >= 1 ? 'gridOverload' : heat >= 1 ? 'channelOverheat' : null;

  return {
    thrust: lit ? thrust : 0,
    isp: lit ? isp : 0,
    ispSeaLevel: 0,
    ispVacuum: isp,
    massFlow: lit ? flow : 0,
    pc: 0,
    pe: 0,
    pa,
    exitMach: 0,
    exitVelocity: speed,
    expansionRatio: 1,
    effectiveExitDia: cfg.exitDia,
    flowExitDia: cfg.exitDia,
    tc: 0,
    gamma: 5 / 3,
    cStarEff: 0,
    lStar: 0,
    combustionEff: 1,
    nozzleEff: shares.beam,
    state: 'ideal',
    rough: false,
    shudder: 0,
    limits: { structural: grid, heating: heat, instability: 0 },
    failure,
    exhaust: [],
    notes: [],
    calculated: false,
    settled: true,
    electric: { power, thrustEfficiency: lit ? efficiency : 0, voltage: cfg.voltage, beamCurrent: lit ? current : 0 },
  };
}
