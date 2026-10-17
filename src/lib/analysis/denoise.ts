// Noise reduction for speech (CapCut's Reduce noise, Audacity's Noise
// Reduction): a spectral gate. The noise's spectrum is learned from the
// quietest tenth of the clip, then every short-time frame keeps each
// frequency in proportion to how far it stands above that noise, with the
// gain smoothed across neighbors and over time so it does not warble.
// One gain mask from the channels' mix applies to every channel, so stereo
// stays stereo.
// ponytail: stationary noise only (hum, hiss, fans, room tone); changing
// noise (traffic, chatter) wants a learned model such as DeepFilterNet.

import { fft } from "./beats";

const N = 2048;
const HOP = N / 4;

export interface DenoiseOptions {
  /** 0..1: how much of the noise to take out. 0.5 is gentle, 1 is strong. */
  strength: number;
}

/** Periodic Hann, which overlap-adds to a constant at a quarter hop. */
const hann = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));

function spectra(x: Float32Array) {
  const frames = Math.max(1, Math.ceil((x.length + N) / HOP));
  const mags: Float32Array[] = [];
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    const at = f * HOP - N / 2;
    for (let i = 0; i < N; i++) {
      const k = at + i;
      re[i] = k >= 0 && k < x.length ? x[k] * hann[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    const m = new Float32Array(N / 2 + 1);
    for (let b = 0; b <= N / 2; b++) m[b] = Math.hypot(re[b], im[b]);
    mags.push(m);
  }
  return mags;
}

/** The gain per frame and bin, from the mix of the channels. */
export function noiseMask(mix: Float32Array, o: DenoiseOptions): Float32Array[] {
  const mags = spectra(mix);
  const bins = N / 2 + 1;
  // The noise: the mean spectrum of the quietest tenth of the frames that
  // lie wholly inside the audio (edge frames are part zero padding, so they
  // would always look quietest and make the noise seem lower than it is).
  const inside = mags.map((m, i) => [m, i] as const).filter(([, i]) => i * HOP - N / 2 >= 0 && i * HOP + N / 2 <= mix.length);
  const pool = inside.length >= 4 ? inside : mags.map((m, i) => [m, i] as const);
  const energy = pool.map(([m, i]) => [m.reduce((s, v) => s + v * v, 0), i] as const).sort((a, b) => a[0] - b[0]);
  const quiet = energy.slice(0, Math.max(1, Math.floor(energy.length / 10)));
  const noise = new Float32Array(bins);
  for (const [, i] of quiet) for (let b = 0; b < bins; b++) noise[b] += mags[i][b] / quiet.length;
  const over = 1 + 2 * o.strength; // how far above the noise a bin must be
  const floor = 1 - 0.9 * o.strength; // what a noise-only bin keeps
  const masks: Float32Array[] = [];
  let prev = new Float32Array(bins).fill(1);
  for (const m of mags) {
    const g = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      const snr = m[b] / (noise[b] * over + 1e-12);
      g[b] = Math.max(floor, Math.min(1, (snr - 1) / 1 + floor));
    }
    // Smooth across three bins, then over time: fast to open, slow to close.
    const s = new Float32Array(bins);
    for (let b = 0; b < bins; b++) s[b] = (g[Math.max(0, b - 1)] + g[b] + g[Math.min(bins - 1, b + 1)]) / 3;
    for (let b = 0; b < bins; b++) s[b] = s[b] > prev[b] ? s[b] : prev[b] * 0.6 + s[b] * 0.4;
    masks.push(s);
    prev = s;
  }
  return masks;
}

/** One channel through a mask, by overlap-add. */
export function applyMask(x: Float32Array, masks: Float32Array[]): Float32Array {
  const out = new Float64Array(x.length + N);
  const re = new Float64Array(N), im = new Float64Array(N);
  masks.forEach((g, f) => {
    const at = f * HOP - N / 2;
    for (let i = 0; i < N; i++) {
      const k = at + i;
      re[i] = k >= 0 && k < x.length ? x[k] * hann[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b <= N / 2; b++) {
      re[b] *= g[b];
      im[b] *= g[b];
      if (b > 0 && b < N / 2) {
        re[N - b] *= g[b];
        im[N - b] *= g[b];
      }
    }
    // Inverse by conjugation: ifft(z) = conj(fft(conj(z))) / N.
    for (let i = 0; i < N; i++) im[i] = -im[i];
    fft(re, im);
    for (let i = 0; i < N; i++) {
      const k = at + i;
      if (k >= 0 && k < x.length) out[k] += (re[i] / N) * hann[i];
    }
  });
  // Hann squared at a quarter hop sums to 1.5.
  return Float32Array.from(out.subarray(0, x.length), (v) => v / 1.5);
}

/** Clean every channel with one mask learned from their mix. */
export function denoise(channels: Float32Array[], o: DenoiseOptions): Float32Array[] {
  const n = channels[0]?.length ?? 0;
  const mix = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) mix[i] += c[i] / channels.length;
  const masks = noiseMask(mix, o);
  return channels.map((c) => applyMask(c, masks));
}
