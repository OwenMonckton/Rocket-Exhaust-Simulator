import type { ExpansionState, Failure, PropellantId } from '../physics/types';

export const TIPS = {
  scale: 'Grows or shrinks the whole engine in proportion, walls included. Thrust grows with the square of size.',
  chamberDia: 'Width of the combustion chamber. Wider chambers strain the walls more and are prone to instability.',
  chamberLen: 'Length of the combustion chamber. Too short and the propellant leaves before it finishes burning.',
  throatDia: 'The narrowest point. A wider throat lets more propellant through, which means more thrust.',
  exitDia: 'Width of the nozzle exit. Bigger suits thin air and vacuum; smaller suits sea level.',
  nozzleLenPct: 'How long the bell is. Longer bells point the exhaust straighter for slightly better efficiency.',
  chamberPressureBar: 'How hard the engine is pushed. More pressure means more thrust, more heat and more stress.',
  propellant: 'What the engine burns. Each has its own efficiency, flame temperature and plume colour.',
  mixtureRatio: 'Kilograms of oxidiser burned per kilogram of fuel. Lower is fuel-rich, higher is oxidiser-rich.',
  deploy: 'Slide the nozzle extension into place, or stow it. The longer nozzle is far more efficient in vacuum.',
  altitudeKm: 'How high the engine is. The air thins out as you climb, and is effectively gone by 86 km.',
  throttle: 'Run the engine below full power by lowering chamber pressure.',
  ascent: 'Fire the engine and climb from the ground to space over about 30 seconds.',
  descent: 'Fire the engine and come down from space to the ground over about 30 seconds.',
  overlay: 'Colour the gas inside the engine by how fast or how hot it is.',
};

export const STATE_COPY: Record<ExpansionState, { label: string; text: string }> = {
  ideal: {
    label: 'Ideally expanded',
    text: 'Exhaust pressure matches the surrounding air. This nozzle is the right size for this altitude.',
  },
  over: {
    label: 'Over-expanded',
    text: 'The nozzle is too big for this altitude, so the surrounding air pinches the plume inward.',
  },
  under: {
    label: 'Under-expanded',
    text: 'The nozzle is too small for this altitude, so the plume balloons outward after leaving it.',
  },
  separated: {
    label: 'Flow separation!',
    text: 'The nozzle is far too big for this altitude. The exhaust has torn away from the nozzle wall, wasting thrust.',
  },
};

export const FAILURE_COPY: Record<Exclude<Failure, null>, { title: string; text: string }> = {
  burst: {
    title: 'Chamber burst',
    text: 'The chamber pressure was more than the walls could hold. Lower the chamber pressure or narrow the chamber. Growing the whole engine with Engine scale is safe, because the walls thicken with it.',
  },
  burnthrough: {
    title: 'Throat burn-through',
    text: 'The throat got too hot and melted through. Lower the chamber pressure or widen the throat. Small, high-pressure throats are the hardest to keep cool.',
  },
  meltdown: {
    title: 'Reactor core meltdown',
    text: 'The reactor core ran hotter than its fuel elements can take and they broke up. Lower the core temperature. Hotter hydrogen is more efficient, which is why real nuclear engines run so close to this limit.',
  },
  instability: {
    title: 'Combustion instability',
    text: 'The chamber is so wide that pressure waves built up inside it and shook the engine apart. Narrow the chamber or lower the chamber pressure.',
  },
};

/** Failure text, with wording specific to a propellant where the general wording would mislead. */
export function failureCopy(failure: Exclude<Failure, null>, propellant: PropellantId): { title: string; text: string } {
  if (propellant === 'saltwater' && failure === 'burnthrough') {
    return {
      title: 'Nozzle vaporised',
      text: 'The fission reaction ran hotter than the layer of water protecting the nozzle could take. Turn down the reaction temperature, lower the chamber pressure or widen the throat.',
    };
  }
  return FAILURE_COPY[failure];
}

export const LIMIT_COPY = {
  structural: { label: 'Wall stress', tip: 'How close the chamber walls are to bursting from the pressure inside.' },
  heating: { label: 'Heat load', tip: 'How close the hottest part is to melting: the throat, or the reactor core in a nuclear thermal engine. Throat heat rises with chamber pressure and with smaller throats.' },
  instability: { label: 'Instability', tip: 'How close the chamber is to shaking itself apart. Rises with chamber width.' },
};
