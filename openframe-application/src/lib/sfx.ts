// Sound effects made on this computer (CapCut's Audio > Sound effects is a
// cloud library; Resolve ships a local one): whooshes, pops and dings for
// shorts, synthesized from sines and seeded noise, so they are the same on
// every machine and free of anyone's license. Each makes stereo samples at
// a rate; the library turns them into a WAV asset on first use.

import { assetRole, roleTrack } from "./audioRoles";
import { clipForAsset } from "./project/defaults";
import { addClip } from "./project/ops";
import type { Asset, Clip, Id, Project } from "./project/types";
import { withSourceRange } from "./sourceMonitor";
import { secondsToFrames } from "./time";

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
  // ---- for epic edits: hits on the drop, risers into it ----
  impact: {
    label: "Impact",
    seconds: 1.2,
    make: (r) => {
      // A cinematic hit: a falling low thump, a crack of band-passed noise
      // and a short metallic ring on top.
      const n = Math.round(1.2 * r);
      const crack = bandpass(noise(n, 53), r, (i) => 2400 * Math.exp(-i / (0.05 * r)) + 500, 0.9);
      let ph = 0;
      return finish(Float32Array.from({ length: n }, (_, i) => {
        const t = i / r;
        ph += (2 * Math.PI * (40 + 70 * Math.exp(-t / 0.04))) / r;
        const ring = Math.sin(2 * Math.PI * 1730 * t) * 0.15 + Math.sin(2 * Math.PI * 2615 * t) * 0.1;
        return Math.tanh(1.6 * Math.sin(ph) * env(t, 0.002, 0.35)) + crack[i] * env(t, 0.0005, 0.05) * 1.4 + ring * env(t, 0.001, 0.12);
      }), 0.8);
    },
  },
  subDrop: {
    label: "Sub drop",
    seconds: 1.8,
    make: (r) => {
      // A sine falling from 110 Hz to 30 Hz, a little saturated so small
      // speakers hear its harmonics.
      let ph = 0;
      return finish(Float32Array.from({ length: Math.round(1.8 * r) }, (_, i) => {
        const t = i / r;
        ph += (2 * Math.PI * (30 + 80 * Math.exp(-t / 0.35))) / r;
        return Math.tanh(2 * Math.sin(ph)) * env(t, 0.01, 0.7);
      }), 0.8);
    },
  },
  braam: {
    label: "Braam",
    seconds: 3,
    make: (r) => {
      // The trailer horn: three detuned saws on A1 through a filter that
      // opens with the swell, then fades.
      const n = Math.round(3 * r);
      const voices = [55, 55.4, 54.6];
      const x = Float32Array.from({ length: n }, (_, i) => {
        const t = i / r;
        // Plain saws: at 55 Hz under a filter this low, aliasing is inaudible.
        const s = voices.reduce((a, f) => a + 2 * ((f * t) % 1) - 1, 0);
        return s * (t < 0.08 ? t / 0.08 : Math.exp(-(t - 0.08) / 1.1));
      });
      const shaped = bandpass(x, r, (i) => 180 + 1400 * Math.exp(-i / (0.6 * r)), 0.7);
      return finish(shaped.map((v) => Math.tanh(v * 1.5)), 0.8);
    },
  },
  reverseCymbal: {
    label: "Reverse cymbal",
    seconds: 2,
    make: (r) => {
      // A crash played backward: bright noise swelling to a sudden stop,
      // so it ends exactly where it lands.
      const n = Math.round(2 * r);
      const x = bandpass(noise(n, 61), r, () => 7000, 0.6);
      return finish(x.map((v, i) => v * Math.exp(-(n - i) / (0.5 * r)) * (i > n - r * 0.01 ? (n - i) / (r * 0.01) : 1)), 0.7);
    },
  },
  glitch: {
    label: "Glitch",
    seconds: 0.5,
    make: (r) => {
      // Digital stutter: short grains of square waves at random pitches,
      // held to a few levels like a broken encoder.
      const n = Math.round(0.5 * r);
      const rand = noise(64, 71);
      const grain = Math.round(0.03 * r);
      return finish(Float32Array.from({ length: n }, (_, i) => {
        const g = Math.floor(i / grain);
        const on = rand[g % 64] > -0.4;
        const f = 300 + 1700 * Math.abs(rand[(g * 7) % 64]);
        const sq = Math.sign(Math.sin((2 * Math.PI * f * i) / r));
        return on ? Math.round(sq * (0.6 + 0.4 * rand[(g * 3) % 64]) * 4) / 4 : 0;
      }), 0.6);
    },
  },
  shutter: {
    label: "Camera shutter",
    seconds: 0.25,
    make: (r) => {
      // Two mechanical clicks, the shutter opening and closing.
      const n = Math.round(0.25 * r);
      const x = bandpass(noise(n, 79), r, () => 3000, 2);
      return finish(x.map((v, i) => {
        const t = i / r;
        return v * (env(t, 0.0005, 0.008) + (t > 0.07 ? env(t - 0.07, 0.0005, 0.012) * 0.8 : 0));
      }), 0.7);
    },
  },
  swooshUp: {
    label: "Swoosh up",
    seconds: 0.9,
    make: (r) => {
      // A whoosh whose band only rises and which swells to the end: a lift
      // into the next shot.
      const n = Math.round(0.9 * r);
      const x = bandpass(noise(n, 83), r, (i) => 300 + 5700 * (i / n) ** 1.5, 2);
      return finish(x.map((v, i) => v * Math.sin((Math.PI / 2) * (i / n)) ** 2 * (i > n - r * 0.02 ? (n - i) / (r * 0.02) : 1)), 0.6);
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

// ---- placing them ------------------------------------------------------------------

/** One sound effect to place: by name, starting at `at` seconds or ending
 * at `endAt` (a riser then peaks exactly there), at `volume`, on `trackId`
 * or the effects track. */
export interface SoundCue {
  name: string;
  at?: number;
  endAt?: number;
  volume?: number;
  trackId?: Id;
}

/**
 * Sound effects placed as one edit (add_sound_effect's list: a montage's
 * whooshes in one call and one undo step). Each lands at its frame on its
 * `trackId`, else on the effects stem (ADR-098): the first SFX track with
 * room, another SFX track when sounds overlap, one made when there is
 * none; never in a gap on the voiceover or the music. One that would start
 * before 0 loses its head instead. `assets` holds each effect's file by
 * name (made once per project); `playhead` is the default start.
 */
export function placeSounds(p: Project, cues: SoundCue[], assets: Map<string, Asset>, playhead: number): { project: Project; clipIds: Id[] } {
  const clipIds: Id[] = [];
  for (const cue of cues) {
    const s = SFX[cue.name], asset = assets.get(cue.name);
    if (!s || !asset) throw new Error(`No sound effect ${cue.name}; there are ${Object.keys(SFX).join(", ")}`);
    const head = cue.endAt !== undefined ? Math.max(0, s.seconds - cue.endAt) : 0;
    const frame = cue.endAt !== undefined ? secondsToFrames(Math.max(0, cue.endAt - s.seconds), p.fps) : cue.at !== undefined ? secondsToFrames(cue.at, p.fps) : playhead;
    const range = head > 0 ? { in: Math.min(head, asset.duration - 0.05), out: asset.duration } : undefined;
    let clip = clipForAsset(asset, frame, p.fps);
    if (range) clip = withSourceRange(clip, asset, range, p.fps);
    if (cue.volume !== undefined && cue.volume !== 1) clip = { ...clip, volume: cue.volume } as Clip;
    const r = roleTrack(p, assetRole(asset) ?? "effects", clip.start, clip.duration, cue.trackId);
    p = addClip(r.project, r.trackId, clip, "overwrite");
    clipIds.push(clip.id);
  }
  return { project: p, clipIds };
}
