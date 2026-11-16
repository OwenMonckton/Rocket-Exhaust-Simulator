export interface Rumble {
  /** level 0–1 follows thrust; airFraction 0–1 is how much atmosphere is left to carry the sound */
  setLevel(level: number, airFraction: number): void;
  setMuted(muted: boolean): void;
}

/** Filtered-noise engine rumble. Silent until first unmuted, as browsers require a click to start audio. */
export function createRumble(): Rumble {
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let muted = true;

  const start = () => {
    if (ctx) return;
    try {
      ctx = new AudioContext();
      const seconds = 3;
      const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        // Brown-ish noise: low frequencies dominate, like a real engine.
        last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04;
        data[i] = last * 4 + (Math.random() * 2 - 1) * 0.12;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(ctx.destination);
      source.start();
    } catch {
      ctx = null;
    }
  };

  return {
    setMuted(m) {
      muted = m;
      if (!m) {
        start();
        void ctx?.resume();
      }
    },
    setLevel(level, airFraction) {
      if (!ctx || !gain || !filter) return;
      const now = ctx.currentTime;
      const air = 0.12 + 0.88 * Math.sqrt(Math.max(0, airFraction));
      gain.gain.setTargetAtTime(muted ? 0 : 0.55 * level * air, now, 0.05);
      filter.frequency.setTargetAtTime(120 + 2200 * level * air, now, 0.08);
    },
  };
}
