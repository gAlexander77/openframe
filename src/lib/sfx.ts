// Sound effects made on this computer (CapCut's Audio > Sound effects is a
// cloud library; Resolve ships a local one): whooshes, pops and dings for
// shorts, synthesized from sines and seeded noise, so they are the same on
// every machine and free of anyone's license. Each makes stereo samples at
// a rate; the library turns them into a WAV asset on first use.

export interface Sfx {
  label: string;
  seconds: number;
  make: (rate: number) => Float32Array[];
}

/** Seeded white noise, -1..1: the same whoosh every time. */
function noise(n: number, seed: number): Float32Array {
  let s = seed;
  return Float32Array.from({ length: n }, () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1);
}

/** A state-variable band-pass with a moving center (Hz per sample). */
function bandpass(x: Float32Array, rate: number, center: (i: number) => number, q = 1.5): Float32Array {
  const out = new Float32Array(x.length);
  let low = 0, band = 0;
  for (let i = 0; i < x.length; i++) {
    const f = 2 * Math.sin((Math.PI * Math.min(center(i), rate / 6)) / rate);
    low += f * band;
    const high = x[i] - low - band / q;
    band += f * high;
    out[i] = band;
  }
  return out;
}

/** Peak to `peak`, then the same in both channels. */
function finish(x: Float32Array, peak = 0.7): Float32Array[] {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  const k = m > 0 ? peak / m : 0;
  const out = x.map((v) => v * k);
  return [out, out.slice()];
}

const env = (t: number, attack: number, decay: number) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));

/** Noise through a band that sweeps up then down, swelling and fading:
 * something passing close by. */
function whoosh(rate: number, seconds: number, lo: number, hi: number, seed: number) {
  const n = Math.round(seconds * rate);
  const shape = (i: number) => Math.sin((Math.PI * i) / n) ** 2;
  const x = bandpass(noise(n, seed), rate, (i) => lo + (hi - lo) * shape(i), 2);
  return finish(x.map((v, i) => v * shape(i)), 0.6);
}

export const SFX: Record<string, Sfx> = {
  whoosh: { label: "Whoosh", seconds: 0.8, make: (r) => whoosh(r, 0.8, 300, 2400, 7) },
  swish: { label: "Swish", seconds: 0.35, make: (r) => whoosh(r, 0.35, 900, 5000, 11) },
  pop: {
    label: "Pop",
    seconds: 0.15,
    make: (r) => {
      const n = Math.round(0.15 * r);
      let ph = 0;
      return finish(Float32Array.from({ length: n }, (_, i) => {
        const t = i / r;
        ph += (2 * Math.PI * (180 + 700 * Math.exp(-t / 0.012))) / r;
        return Math.sin(ph) * env(t, 0.002, 0.03);
      }));
    },
  },
  click: {
    label: "Click",
    seconds: 0.06,
    make: (r) => {
      const n = Math.round(0.06 * r);
      const x = bandpass(noise(n, 23), r, () => 3200, 4);
      return finish(x.map((v, i) => v * env(i / r, 0.0005, 0.006)), 0.6);
    },
  },
  ding: {
    label: "Ding",
    seconds: 1.4,
    make: (r) => {
      // A bell: a fundamental and its inharmonic partials, each fading at
      // its own rate.
      const parts = [[1, 1, 0.9], [2.76, 0.45, 0.45], [5.4, 0.25, 0.25], [8.93, 0.12, 0.15]];
      return finish(Float32Array.from({ length: Math.round(1.4 * r) }, (_, i) => {
        const t = i / r;
        return parts.reduce((s, [m, a, d]) => s + a * Math.sin(2 * Math.PI * 1318.5 * m * t) * env(t, 0.003, d), 0);
      }), 0.5);
    },
  },
  success: {
    label: "Success",
    seconds: 0.5,
    make: (r) =>
      finish(Float32Array.from({ length: Math.round(0.5 * r) }, (_, i) => {
        const t = i / r;
        const [f, t0] = t < 0.12 ? [880, 0] : [1318.5, 0.12];
        return (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * env(t - t0, 0.004, 0.09);
      }), 0.5),
  },
  rise: {
    label: "Riser",
    seconds: 2,
    make: (r) => {
      const n = Math.round(2 * r);
      const x = bandpass(noise(n, 31), r, (i) => 400 + 4000 * (i / n) ** 2, 3);
      let ph = 0;
      return finish(x.map((v, i) => {
        const p = i / n;
        ph += (2 * Math.PI * (200 + 1000 * p * p)) / r;
        return (v + 0.25 * Math.sin(ph)) * p * p * (i > n - r * 0.02 ? (n - i) / (r * 0.02) : 1);
      }), 0.6);
    },
  },
  boom: {
    label: "Boom",
    seconds: 1.5,
    make: (r) => {
      const n = Math.round(1.5 * r);
      const thump = bandpass(noise(n, 43), r, () => 120, 0.8);
      let ph = 0;
      return finish(Float32Array.from({ length: n }, (_, i) => {
        const t = i / r;
        ph += (2 * Math.PI * (45 + 90 * Math.exp(-t / 0.05))) / r;
        return Math.sin(ph) * env(t, 0.003, 0.4) + thump[i] * env(t, 0.001, 0.06) * 0.6;
      }), 0.8);
    },
  },
};
