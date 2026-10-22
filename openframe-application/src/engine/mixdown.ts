// The mix rendered offline, the way export renders it: the preview's own
// scheduler into OfflineAudioContext windows. Export (export.ts) and the
// loudness report (measure_loudness) both render through here, so what an
// agent measures is what the file will hold.

import { insertsPreroll } from "../lib/audioInserts";
import { soundingClips, soundPreroll } from "../lib/audio";
import { planLoudness, ceilingFor, loudnessStats, shortTermSeries, type LoudnessPlan, type LoudnessStats } from "../lib/analysis/delivery";
import { applyLimiter, LIMIT_BLOCK, LoudnessMeter } from "../lib/analysis/loudness";
import { TruePeakMeter } from "../lib/analysis/truePeak";
import { audioWindows, EXPORT_CHANNELS, EXPORT_SAMPLE_RATE } from "../lib/export";
import { getAsset } from "../lib/project/ops";
import type { Project } from "../lib/project/types";
import { scheduleAudio } from "./audio";

/** Retained audio per window: 10 s of stereo float is 3.8 MB. Stateful
 * insert graphs additionally render their earlier history (mixPreroll). */
export const WINDOW_SECONDS = 10;

/** The legacy chain's longest pre-roll, seconds (a long echo at high
 * feedback rings for minutes, far under hearing at the end). */
const PREROLL_MAX = 12;

/** Does any clip make sound? Silence needs no OfflineAudioContext. */
export const hasSound = (p: Project) => soundingClips(p, (id) => getAsset(p, id)?.hasAudio ?? false).length > 0;

/** Seconds each window starts early: the longest tail any clip's sound
 * design rings (lib/soundFx fxTail), so echoes, reverb and filter state
 * carry across window edges instead of starting again at each, and a
 * compressor's settling (lib/audio soundPreroll). 0 when no clip has any,
 * which keeps a plain mix rendered exactly as before. */
export function mixPreroll(p: Project): number {
  // Hysteresis can hold a gate open indefinitely in its dead band. No
  // finite warm-up can reconstruct that state. Replay history for new
  // stateful inserts rather than resetting a detector at a window edge.
  // ponytail: long timelines with inserts replay earlier samples for each
  // window; worklet state checkpoints would retain bounded render memory.
  const tracks = [...p.tracks, ...(p.compounds ?? []).flatMap(k => k.tracks)];
  if (tracks.some(t => [t.inserts, ...t.clips.map(c => "inserts" in c ? c.inserts : undefined)].some(list => list?.some(i => i.on && ["gate", "deesser", "limiter", "compressor"].includes(i.type))))) return Infinity;
  const sounding = soundingClips(p, (id) => getAsset(p, id)?.hasAudio ?? false);
  const tails = sounding.map(soundPreroll);
  // New ordered chains may contain several time effects in series. Their
  // tails add rather than taking the longest individual effect's tail.
  const insertTails = sounding.map(s => insertsPreroll(s.track.inserts) + insertsPreroll(s.clip.inserts) + (s.via ?? []).reduce((sum, v) => sum + insertsPreroll(v.track.inserts) + insertsPreroll(v.clip.inserts), 0));
  return Math.max(Math.min(PREROLL_MAX, Math.max(0, ...tails)), ...insertTails);
}

/**
 * The mix of timeline seconds [t0, t0 + length / rate): rendered from
 * `preroll` seconds earlier and trimmed, so the window opens with the
 * tails the timeline has there.
 */
export async function renderMixWindow(p: Project, t0: number, length: number, rate: number, channels: number, preroll: number): Promise<AudioBuffer> {
  // Nothing sounds before the timeline's start.
  const pre = Math.round(Math.min(preroll, Math.max(0, t0)) * rate);
  const ctx = new OfflineAudioContext({ numberOfChannels: channels, length: length + pre, sampleRate: rate });
  await scheduleAudio(ctx, ctx.destination, p, t0 - pre / rate, t0 + length / rate, 0).done;
  const b = await ctx.startRendering();
  if (!pre) return b;
  const out = new AudioBuffer({ length, numberOfChannels: channels, sampleRate: rate });
  for (let c = 0; c < channels; c++) out.copyToChannel(b.getChannelData(c).subarray(pre), c);
  return out;
}

export const planesOf = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));

export interface MixMeasurement extends LoudnessStats {
  shortTerm: { end: number; lufs: number }[];
  /** K-weighted mean square of every 100 ms from `from` (LoudnessMeter's
   * steps): any stretch inside can be measured from them without
   * rendering again (lib/analysis/balance.ts windowLoudness). */
  steps: number[];
  seconds: number;
  /** Linear, 4x oversampled. */
  truePeak: number;
  /** Linear, the largest sample. */
  samplePeak: number;
  /** With a loudness target: what export does to reach it (null: nothing). */
  plan?: LoudnessPlan | null;
}

/**
 * Measure the mix of timeline seconds [from, to) as export renders it (48
 * kHz stereo): loudness, range, maxima and true peak. With `loudness`, as
 * export_video with that target delivers it: measured, raised and limited
 * the way export does (planLoudness), and measured again.
 */
export async function measureMix(p: Project, from: number, to: number, opts: { loudness?: number | null; signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}): Promise<MixMeasurement> {
  const rate = EXPORT_SAMPLE_RATE;
  const channels = EXPORT_CHANNELS;
  const total = Math.max(0, Math.round((to - from) * rate));
  const windows = audioWindows(total, WINDOW_SECONDS * rate);
  const preroll = mixPreroll(p);
  const sounding = hasSound(p);
  const passes = opts.loudness != null ? 2 : 1;
  const pass = async (n: number, apply: LoudnessPlan | null) => {
    const meter = new LoudnessMeter(rate, channels);
    const tp = new TruePeakMeter(channels);
    const blocks = new Float32Array(Math.ceil(total / LIMIT_BLOCK) + 1);
    for (const [i, w] of windows.entries()) {
      opts.signal?.throwIfAborted();
      const b = sounding ? await renderMixWindow(p, from + w.start / rate, w.length, rate, channels, preroll) : new AudioBuffer({ length: w.length, numberOfChannels: channels, sampleRate: rate });
      const planes = planesOf(b);
      if (apply) applyLimiter(planes, w.start, apply.gain, apply.gains);
      meter.push(planes, b.length);
      tp.push(planes, b.length, blocks);
      opts.onProgress?.((n + (i + 1) / windows.length) / passes);
    }
    tp.flush(blocks);
    return { meter, tp, blocks };
  };
  let r = await pass(0, null);
  let plan: LoudnessPlan | null | undefined;
  if (opts.loudness != null) {
    plan = planLoudness(r.meter.integrated(), r.tp.peak, r.blocks, opts.loudness, ceilingFor(opts.loudness));
    if (plan) r = await pass(1, plan);
  }
  return { seconds: total / rate, ...loudnessStats(r.meter.steps), shortTerm: shortTermSeries(r.meter.steps), steps: r.meter.steps, truePeak: r.tp.peak, samplePeak: r.meter.peak, ...(plan !== undefined ? { plan } : {}) };
}
