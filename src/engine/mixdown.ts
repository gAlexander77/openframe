// The mix rendered offline, the way export renders it: the preview's own
// scheduler into OfflineAudioContext windows. Export (export.ts) and the
// loudness report (measure_loudness) both render through here, so what an
// agent measures is what the file will hold.

import { soundingClips } from "../lib/audio";
import { planLoudness, ceilingFor, loudnessStats, type LoudnessPlan, type LoudnessStats } from "../lib/analysis/delivery";
import { applyLimiter, LIMIT_BLOCK, LoudnessMeter } from "../lib/analysis/loudness";
import { TruePeakMeter } from "../lib/analysis/truePeak";
import { audioWindows, EXPORT_CHANNELS, EXPORT_SAMPLE_RATE } from "../lib/export";
import { getAsset } from "../lib/project/ops";
import type { Project } from "../lib/project/types";
import { fxTail } from "../lib/soundFx";
import { scheduleAudio } from "./audio";

/** Audio rendered per OfflineAudioContext: 10 s of stereo float is 3.8 MB,
 * where a whole-timeline context would allocate it all up front. */
export const WINDOW_SECONDS = 10;

/** The longest pre-roll a window takes, seconds (a long echo at high
 * feedback rings for minutes, far under hearing at the end). */
const PREROLL_MAX = 12;

/** Does any clip make sound? Silence needs no OfflineAudioContext. */
export const hasSound = (p: Project) => soundingClips(p, (id) => getAsset(p, id)?.hasAudio ?? false).length > 0;

/** Seconds each window starts early: the longest tail any clip's sound
 * design rings (lib/soundFx fxTail), so echoes, reverb and filter state
 * carry across window edges instead of starting again at each. 0 when no
 * clip has any, which keeps a plain mix rendered exactly as before. */
export function mixPreroll(p: Project): number {
  const tails = soundingClips(p, (id) => getAsset(p, id)?.hasAudio ?? false).map((s) => fxTail(s.clip));
  return Math.min(PREROLL_MAX, Math.max(0, ...tails));
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
  return { seconds: total / rate, ...loudnessStats(r.meter.steps), truePeak: r.tp.peak, samplePeak: r.meter.peak, ...(plan !== undefined ? { plan } : {}) };
}
