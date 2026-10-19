// The score generator's mixer and master: a plan's events rendered into
// four stems (drums, bass, harmony, lead), each with its EQ, reverb send
// (convolution with a generated hall), delay and sidechain pumping, then
// one master bus: a gentle glue compressor, the gain to the loudness
// target and a true-peak limiter. The master's gains are worked out on the
// mix and applied to every stem alike, so the stems still add up to the
// mix exactly (as the launch film's track was delivered).

import { gatedLoudness, LoudnessMeter, LIMIT_BLOCK, limiterGains } from "../analysis/loudness";
import { TruePeakMeter, toDbtp } from "../analysis/truePeak";
import { reverbImpulse } from "../soundFx";
import { biquad, convolveStereoHalf, filter, kFilters, pingPong, saturate } from "./dsp";
import { renderEvent, type VoiceCtx } from "./instruments";
import { hashSeed, type MusicPlan } from "./arrange";
import { STEM_OF, STEMS, STYLES, type Stem } from "./styles";

export const MUSIC_RATE = 48000;

export interface RenderOptions {
  rate?: number;
  /** Integrated loudness to master to, LUFS (default -14). */
  loudness?: number;
  /** True-peak ceiling, dBTP (default -1). */
  ceiling?: number;
  /** Keep the four stems (default false: only the mix). */
  stems?: boolean;
  /** The master's tilt, -1 (darker) .. 1 (brighter); default the style's
   * (0 for most). */
  brightness?: number;
  onProgress?: (fraction: number) => void;
}

export interface MasterReport {
  /** Integrated loudness of the mix, LUFS. */
  lufs: number;
  true_peak_dbtp: number;
  sample_peak_dbfs: number;
  /** The gain the master applied to reach the target, dB. */
  gain_db: number;
  /** The most the glue compressor and the limiter took off, dB. */
  compression_db: number;
  limiting_db: number;
}

export interface RenderResult {
  rate: number;
  mix: [Float32Array, Float32Array];
  stems: Record<Stem, [Float32Array, Float32Array]> | null;
  master: MasterReport;
}

/** Breakpoints [t, value] read at `t`, interpolated on a log scale. */
export function logCurve(points: [number, number][]): (t: number) => number {
  return (t) => {
    if (!points.length) return 1000;
    if (t <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [t1, v1] = points[i];
      if (t <= t1) {
        const [t0, v0] = points[i - 1];
        const x = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
        return v0 * (v1 / v0) ** x;
      }
    }
    return points[points.length - 1][1];
  };
}

/** The sidechain: how far (0..1) the music is ducked at every sample, from
 * each kick: in over 2 ms just before it, held 20 ms, released over most
 * of a beat. */
function duckCurve(n: number, rate: number, kicks: number[], beat: number): Float32Array {
  const d = new Float32Array(n);
  const pre = Math.round(0.0015 * rate), att = Math.round(0.002 * rate), hold = Math.round(0.02 * rate);
  kicks.forEach((t, k) => {
    const next = kicks[k + 1] ?? t + beat;
    const rel = Math.round(Math.min(0.6 * beat, Math.max(0.05, next - t - 0.01)) * rate);
    const a = Math.round(t * rate) - pre;
    for (let i = 0; i < att + hold + rel; i++) {
      const j = a + i;
      if (j < 0 || j >= n) continue;
      const v = i < att ? i / att : i < att + hold ? 1 : (1 - (i - att - hold) / rel) ** 1.6;
      if (v > d[j]) d[j] = v;
    }
  });
  return d;
}

/** Brightness as a tilt: the highs shelved up `TILT_DB` times `b` from 3 kHz
 * and the lows down half as far below 300 Hz (b < 0 the other way), so
 * the balance leans without a band of its own sticking out. */
export const TILT_DB = 6;
export function tiltEq(x: Float32Array, rate: number, b: number) {
  filter(x, biquad("highshelf", 3000, rate, Math.SQRT1_2, TILT_DB * b));
  filter(x, biquad("lowshelf", 300, rate, Math.SQRT1_2, (-TILT_DB / 2) * b));
}

/** High-pass the side channel only, so everything low stays in the middle. */
function monoBelow(L: Float32Array, R: Float32Array, hz: number, rate: number) {
  const side = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) side[i] = (L[i] - R[i]) / 2;
  const kept = Float32Array.from(side);
  filter(kept, biquad("highpass", hz, rate));
  filter(kept, biquad("highpass", hz, rate));
  for (let i = 0; i < L.length; i++) {
    const dS = kept[i] - side[i];
    L[i] += dS;
    R[i] -= dS;
  }
}

/** Tape wow and flutter: a delay read at a slowly wandering point, so the
 * pitch drifts by about `cents` (the same drift on every stem). */
function wow(x: Float32Array, rate: number, cents: number) {
  const depth = ((2 ** (cents / 1200) - 1) / (2 * Math.PI * 0.55)) * rate;
  const base = depth + 0.0004 * rate + 4;
  const src = Float32Array.from(x);
  for (let i = 0; i < x.length; i++) {
    const t = i / rate;
    const d = base + depth * Math.sin(2 * Math.PI * 0.55 * t) + 0.00008 * rate * Math.sin(2 * Math.PI * 6.1 * t);
    const p = i - d;
    const k = Math.floor(p);
    const f = p - k;
    x[i] = k < 0 ? 0 : (src[k] ?? 0) * (1 - f) + (src[k + 1] ?? 0) * f;
  }
}

/**
 * Render a plan: every event into its stem, the stems' processing, the
 * master. Deterministic: the same plan gives the same samples.
 */
export function renderMusic(plan: MusicPlan, o: RenderOptions = {}): RenderResult {
  const rate = o.rate ?? MUSIC_RATE;
  const spec = STYLES[plan.style];
  const n = Math.max(1, Math.round(plan.duration * rate));
  const progress = o.onProgress ?? (() => {});
  const cutoffAt = logCurve(plan.padCutoff);
  // The hall is convolved at half the rate (its send stops at 9 kHz).
  const [irL, irR] = reverbImpulse(rate / 2, { size: spec.reverb.size, decay: spec.reverb.decay, mix: 1 });
  const duck = Object.values(spec.sidechain).some((d) => d && d > 0) ? duckCurve(n, rate, plan.pump, plan.beat) : null;
  const stems = {} as Record<Stem, [Float32Array, Float32Array]>;
  const send = new Float32Array(n);
  const cache = new Map<string, [Float32Array, Float32Array]>();
  const color = spec.color;

  STEMS.forEach((stem, si) => {
    const L = new Float32Array(n), R = new Float32Array(n);
    send.fill(0);
    const out = { L, R, send };
    const evs = plan.events.filter((e) => STEM_OF[e.part] === stem);
    evs.forEach((e, k) => {
      const m = spec.mix[e.part] ?? { gain: 0.2 };
      const ctx: VoiceCtx = { rate, style: plan.style, beat: plan.beat, out, gain: m.gain, send: m.send ?? 0, pan: m.pan ?? 0, cutoffAt, seed: plan.seed };
      renderEvent(e, ctx, cache);
      if (k % 64 === 0) progress((si + (0.7 * k) / evs.length) / STEMS.length);
    });

    // Each stem's EQ: room for the bass under the music, air kept clean.
    const hp = { drums: 25, bass: 25, harmony: plan.style === "cinematic" || plan.style === "ambient" ? 60 : 120, lead: plan.style === "cinematic" ? 90 : 180 }[stem];
    for (const x of [L, R]) filter(x, biquad("highpass", hp, rate));
    if (stem === "harmony" || stem === "lead") monoBelow(L, R, 140, rate);
    if (plan.style === "lofi" && stem === "drums") for (const x of [L, R]) filter(x, biquad("lowpass", 6500, rate));
    // Air on the bright styles' chords and hook, as pop pads are shelved up.
    if ((plan.style === "launch" || plan.style === "corporate") && (stem === "harmony" || stem === "lead")) for (const x of [L, R]) filter(x, biquad("highshelf", 6000, rate, 1, 2.5));

    // The lead's echo: dotted eighths bouncing between the sides.
    if (stem === "lead") {
      const mid = new Float32Array(n);
      for (let i = 0; i < n; i++) mid[i] = (L[i] + R[i]) / 2;
      filter(mid, biquad("highpass", 300, rate));
      const fb = plan.style === "ambient" || plan.style === "lofi" ? 0.45 : 0.32;
      pingPong(mid, rate, 0.75 * plan.beat, fb, plan.style === "cinematic" ? 0.12 : 0.2, L, R);
      for (let i = 0; i < n; i++) send[i] += mid[i] * 0.15;
    }
    // The reverb: the send, its lows and highest highs cut, through the hall.
    if (send.some((v) => v !== 0)) {
      filter(send, biquad("highpass", 250, rate));
      filter(send, biquad("lowpass", plan.style === "lofi" ? 5500 : 9000, rate));
      convolveStereoHalf(send, rate, [irL, irR], L, R, 1);
    }
    // Pumping: the stem ducks under the kick.
    const depth = spec.sidechain[stem] ?? 0;
    if (duck && depth > 0) {
      for (let i = 0; i < n; i++) {
        if (duck[i] > 0) {
          const g = 10 ** ((-depth * duck[i]) / 20);
          L[i] *= g;
          R[i] *= g;
        }
      }
    }
    // Lo-fi: tape wow, a darker top and a little saturation on every stem.
    if (color.wow) for (const x of [L, R]) wow(x, rate, color.wow);
    if (color.lowpass) for (const x of [L, R]) filter(x, biquad("lowpass", color.lowpass, rate));
    if (color.drive) for (const x of [L, R]) saturate(x, color.drive);
    // No DC and nothing below hearing: saturating a lopsided wave (a kick)
    // leaves an offset.
    for (const x of [L, R]) filter(x, biquad("highpass", 18, rate));
    stems[stem] = [L, R];
    progress((si + 1) / STEMS.length * 0.85);
  });

  // The balance: each stem's loudness in the drops (the whole piece if it
  // has none) set to the style's levels against the loudest stem, so the
  // hook and the chords sit where a mix engineer would put them whatever
  // the key, the voicings or the seed.
  const loudest = plan.sections.filter((s) => s.role === "drop");
  const windows = (loudest.length ? loudest : plan.sections).map((s) => [Math.round(s.start * rate), Math.min(n, Math.round(s.end * rate))]);
  const levels = STEMS.map((stem) => {
    const m = new LoudnessMeter(rate, 2);
    const [L, R] = stems[stem];
    for (const [a, b] of windows) if (b > a) m.push([L.subarray(a, b), R.subarray(a, b)], b - a);
    return m.integrated();
  });
  const offsets = STEMS.map((stem, i) => (Number.isFinite(levels[i]) ? spec.balance[stem] - levels[i] : 0));
  const top = Math.max(...offsets.filter((_, i) => Number.isFinite(levels[i])));
  STEMS.forEach((stem, i) => {
    if (!Number.isFinite(levels[i])) return;
    const g = 10 ** ((offsets[i] - top) / 20);
    for (const x of stems[stem]) for (let k = 0; k < n; k++) x[k] *= g;
  });

  // Brightness: a tilt about 1 kHz on every stem alike (so they still add
  // up to the mix), before the master sets the loudness again.
  const tilt = Math.max(-1, Math.min(1, o.brightness ?? spec.brightness ?? 0));
  if (tilt) for (const stem of STEMS) for (const x of stems[stem]) tiltEq(x, rate, tilt);

  // The ending: everything fades to silence by the end of the file.
  const [f0, f1] = plan.fadeOut;
  const a = Math.round(f0 * rate), b = Math.min(n, Math.round(f1 * rate));
  const fadeIn = Math.min(n, Math.round(0.002 * rate));
  // Ringing out falls like a reverb tail (48 dB, fastest at first, a last
  // tenth eased to nothing); a stop's short fade is a plain cosine.
  const fade = plan.ending === "ring"
    ? (x: number) => 10 ** ((-48 * x ** 0.6) / 20) * (x < 0.9 ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (x - 0.9)) / 0.1))
    : (x: number) => 0.5 + 0.5 * Math.cos(Math.PI * x);
  for (const stem of STEMS) {
    for (const x of stems[stem]) {
      for (let i = 0; i < fadeIn; i++) x[i] *= i / fadeIn;
      for (let i = a; i < n; i++) x[i] *= i >= b ? 0 : fade((i - a) / Math.max(1, b - a));
      // A last few milliseconds of nothing: no click at the end.
      for (let i = Math.max(0, n - Math.round(0.003 * rate)); i < n; i++) x[i] = 0;
    }
  }

  const master = masterBus(stems, n, rate, o.loudness ?? -14, o.ceiling ?? -1);
  progress(0.97);
  const mix: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  for (const stem of STEMS) {
    const [L, R] = stems[stem];
    for (let i = 0; i < n; i++) {
      mix[0][i] += L[i];
      mix[1][i] += R[i];
    }
  }
  const tp = new TruePeakMeter(2);
  tp.push(mix, n);
  const lm = new LoudnessMeter(rate, 2);
  lm.push(mix, n);
  progress(1);
  return {
    rate,
    mix,
    stems: o.stems ? stems : null,
    master: { ...master, lufs: +lm.integrated().toFixed(2), true_peak_dbtp: +toDbtp(tp.peak).toFixed(2), sample_peak_dbfs: +toDbtp(lm.peak).toFixed(2) },
  };
}

/**
 * The master bus, worked out on the sum of the stems and applied to each:
 * a glue compressor (2:1, soft knee, a few dB on the loudest parts only),
 * the gain to `target` LUFS and a true-peak limiter holding `ceilingDb`,
 * the gain re-measured until the loudness lands within 0.05 LU. The
 * loudness of each try is read from the mix's K-weighted power, sample by
 * sample, times the gain squared (the gain moves slowly next to the
 * K-weighting filter, so the two commute closely enough).
 */
function masterBus(stems: Record<Stem, [Float32Array, Float32Array]>, n: number, rate: number, target: number, ceilingDb: number): Omit<MasterReport, "lufs" | "true_peak_dbtp" | "sample_peak_dbfs"> {
  const B = LIMIT_BLOCK;
  const blocks = Math.ceil(n / B);
  const all = STEMS.map((s) => stems[s]);
  const mL = new Float32Array(n), mR = new Float32Array(n);
  for (const [L, R] of all) {
    for (let i = 0; i < n; i++) {
      mL[i] += L[i];
      mR[i] += R[i];
    }
  }
  // K-weighted power of the mix, per sample, and each block's mean square.
  const kw = new Float32Array(n);
  const ms = new Float32Array(blocks);
  for (const m of [mL, mR]) {
    const k = Float32Array.from(m);
    kFilters(k, rate);
    for (let i = 0; i < n; i++) {
      kw[i] += k[i] * k[i];
      ms[(i / B) | 0] += (m[i] * m[i]) / (2 * B);
    }
  }
  // The compressor: RMS over 30 ms, the threshold 4 dB under the loudest parts.
  const win = 30;
  const det = new Float32Array(blocks);
  let acc = 0;
  for (let i = 0; i < blocks; i++) {
    acc += ms[i] - (i >= win ? ms[i - win] : 0);
    det[i] = 10 * Math.log10(Math.max(1e-12, acc / Math.min(win, i + 1)));
  }
  const loud = [...det].filter((d) => d > -80).sort((x, y) => x - y);
  const thr = (loud[Math.floor(loud.length * 0.95)] ?? -20) - 4;
  const ratio = 2, knee = 6;
  const comp = new Float32Array(blocks);
  let gDb = 0, maxComp = 0;
  const att = 1 - Math.exp(-1 / 15), rel = 1 - Math.exp(-1 / 250);
  for (let i = 0; i < blocks; i++) {
    const over = det[i] - thr;
    const want = over <= -knee / 2 ? 0 : over >= knee / 2 ? -over * (1 - 1 / ratio) : -((1 - 1 / ratio) * (over + knee / 2) ** 2) / (2 * knee);
    gDb += (want - gDb) * (want < gDb ? att : rel);
    comp[i] = 10 ** (gDb / 20);
    maxComp = Math.max(maxComp, -gDb);
  }
  // True peaks of the compressed mix, per limiter block.
  const peaks = new Float32Array(blocks);
  const tp = new TruePeakMeter(2);
  const CH = B * 100;
  const bl = new Float32Array(CH), br = new Float32Array(CH);
  for (let s = 0; s < n; s += CH) {
    const e = Math.min(n, s + CH);
    for (let i = s; i < e; i++) {
      const g = comp[(i / B) | 0];
      bl[i - s] = mL[i] * g;
      br[i - s] = mR[i] * g;
    }
    tp.push([bl, br], e - s, peaks);
  }
  // The gain at sample i: compressor, makeup and limiter (its gains are
  // block boundaries, read between them as export reads them).
  const gainAt = (i: number, gain: number, lim: Float32Array) => {
    const at = i / B;
    const b = at | 0;
    const l0 = lim[b] ?? 1;
    const l1 = lim[b + 1] ?? l0;
    return comp[b] * gain * (l0 + (l1 - l0) * (at - b));
  };
  const hop = Math.round(rate / 10);
  const measure = (gain: number, lim: Float32Array) => {
    const steps: number[] = [];
    let sum = 0, c = 0;
    for (let i = 0; i < n; i++) {
      const g = gainAt(i, gain, lim);
      sum += kw[i] * g * g;
      if (++c === hop) {
        steps.push(sum / hop);
        sum = c = 0;
      }
    }
    return gatedLoudness(steps);
  };
  const ceiling = 10 ** (ceilingDb / 20);
  const ones = new Float32Array(blocks + 1).fill(1);
  const before = measure(1, ones);
  if (!Number.isFinite(before)) return { gain_db: 0, compression_db: 0, limiting_db: 0 };
  let gain = 10 ** ((target - before) / 20);
  let lim = limiterGains(peaks, gain, ceiling, 5, 80);
  for (let k = 0; k < 6; k++) {
    const got = measure(gain, lim);
    if (Math.abs(got - target) < 0.03) break;
    gain *= 10 ** ((target - got) / 20);
    lim = limiterGains(peaks, gain, ceiling, 5, 80);
  }
  let maxLim = 0;
  for (const v of lim) maxLim = Math.max(maxLim, -20 * Math.log10(Math.max(1e-6, v)));
  // Apply the master's gains to every stem alike.
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = gainAt(i, gain, lim);
  for (const [L, R] of all) {
    for (let i = 0; i < n; i++) {
      L[i] *= g[i];
      R[i] *= g[i];
    }
  }
  return { gain_db: +(20 * Math.log10(gain)).toFixed(2), compression_db: +maxComp.toFixed(2), limiting_db: +maxLim.toFixed(2) };
}

/** A seed for the files' dither, from the plan. */
export const ditherSeed = (plan: MusicPlan) => hashSeed(plan.seed, "dither");
