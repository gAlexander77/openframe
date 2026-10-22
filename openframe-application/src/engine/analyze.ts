import { sceneSampling, SCENE_BUDGET_SECONDS } from "../lib/analysis/highlights";
import { proxySource } from "../lib/proxyPolicy";
import { borrowImage } from "./media";
// Decoding for the local AI tools: a clip's source range as mono PCM at a
// fixed analysis rate, or as per-frame scene scores from small frames.
// Each call opens its own mediabunny Input (like thumbs.ts), so analysis
// never moves a playback decoder, and closes it when done. Long jobs report
// progress (0..1) and stop promptly when their AbortSignal fires.
//
// ponytail: runs on the main thread; mediabunny's iterators yield between
// packets, and the per-frame work is a 128 px HSV diff, so the UI stays
// responsive. A worker is the upgrade if long files show jank.

import { ALL_FORMATS, AudioSampleSink, CanvasSink, Input } from "mediabunny";
import { DECODE_PREROLL, mediaOrigin, soundOrigin } from "./media";
import { LoudnessMeter } from "../lib/analysis/loudness";
import { TruePeakMeter } from "../lib/analysis/truePeak";
import { contentScore, DEFAULT_WEIGHTS, LUMA_WEIGHTS, rgbaToHsv } from "../lib/analysis/scenes";
import type { Asset, Compressor } from "../lib/project/types";
import { compressorNodes } from "./audio";
import { platform } from "../platform";

export type Progress = (fraction: number) => void;

/** One decoder pass, bounded 10-second 16 kHz buffers. Source timestamps
 * preserve gaps and encoder priming, as decodeMono does. */
export async function streamMono(asset: Asset, consume: (pcm: Float32Array) => void, onProgress?: Progress, signal?: AbortSignal): Promise<void> {
  const input = await openInput(asset);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) throw new Error(`${asset.name} has no sound this app can decode`);
    const t0 = await soundOrigin(input, proxySource(asset, "analysis", false));
    const size = 160000, length = Math.ceil(asset.duration * 16000);
    const sum = new Float32Array(size), count = new Uint16Array(size);
    let base = 0, previous = 0, plane = new Float32Array(0), mono = new Float32Array(0);
    const flush = (n: number) => {
      for (let i = 0; i < n; i++) { if (count[i]) previous = sum[i] /= count[i]; else sum[i] = previous; }
      consume(sum.subarray(0, n)); sum.fill(0); count.fill(0); base += n;
    };
    const report = throttle(onProgress);
    let yielded = performance.now();
    for await (const sample of new AudioSampleSink(track).samples(Math.max(0, t0 - DECODE_PREROLL), t0 + asset.duration)) {
      try {
        signal?.throwIfAborted();
        const frames = sample.numberOfFrames, channels = sample.numberOfChannels;
        if (mono.length < frames) [mono, plane] = [new Float32Array(frames), new Float32Array(frames)];
        mono.fill(0, 0, frames);
        for (let ch = 0; ch < channels; ch++) {
          sample.copyTo(plane, { planeIndex: ch, format: "f32-planar" });
          for (let j = 0; j < frames; j++) mono[j] += plane[j] / channels;
        }
        const first = (sample.timestamp - t0) * 16000, step = 16000 / sample.sampleRate;
        for (let j = 0; j < frames; j++) {
          const k = Math.floor(first + j * step);
          if (k < base || k >= length) continue;
          while (k >= base + size) { signal?.throwIfAborted(); flush(size); }
          sum[k - base] += mono[j]; count[k - base]++;
        }
        report((sample.timestamp - t0) / asset.duration);
      } finally { sample.close(); }
      if (performance.now() - yielded > 50) { await new Promise(resolve => setTimeout(resolve, 0)); yielded = performance.now(); }
    }
    while (base < length) { signal?.throwIfAborted(); flush(Math.min(size, length - base)); }
    onProgress?.(1);
  } finally { input.dispose(); }
}

/** Sparse low-resolution frames (1 or 4 s). Seeking skips intervening pictures;
 * codecs may still decode dependency frames within a GOP. */
export async function sparseSceneCuts(asset: Asset, onProgress?: Progress, signal?: AbortSignal): Promise<{ cuts: number[]; sampling: { interval_seconds: number; samples: number; covered_seconds: number; complete: boolean; elapsed_seconds: number } }> {
  const input = await openInput(asset);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error(`${asset.name} has no picture this app can decode`);
    const origin = await mediaOrigin(track, await input.getPrimaryAudioTrack());
    const sink = new CanvasSink(track, { width: 96, poolSize: 1 });
    let previous: Uint8Array | undefined;
    const cuts: number[] = [], report = throttle(onProgress);
    const started = performance.now(), { interval_seconds } = sceneSampling(asset.duration);
    let samples = 0, covered_seconds = 0;
    for (let t = 0; t < asset.duration; t += interval_seconds) {
      // ponytail: bound costly long-GOP seeking to 75 s; a worker with a
      // keyframe scene index could cover the full file within this budget.
      if ((performance.now() - started) / 1000 >= SCENE_BUDGET_SECONDS) break;
      signal?.throwIfAborted();
      const wrapped = await sink.getCanvas(origin + t);
      covered_seconds = Math.min(asset.duration, t + interval_seconds);
      if (!wrapped) continue;
      samples++;
      const { canvas } = wrapped;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      const hsv = rgbaToHsv(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
      if (previous && contentScore(previous, hsv, DEFAULT_WEIGHTS) >= 25) cuts.push(t);
      previous = hsv;
      report(t / asset.duration);
    }
    return { cuts, sampling: { interval_seconds, samples, covered_seconds, complete: covered_seconds >= asset.duration, elapsed_seconds: (performance.now() - started) / 1000 } };
  } finally { input.dispose(); }
}

async function openInput(asset: Asset): Promise<Input> {
  return new Input({ source: await platform.sourceFor(proxySource(asset, "analysis", false)), formats: ALL_FORMATS });
}

/** Call `onProgress` at most every 100 ms. */
function throttle(onProgress: Progress | undefined): Progress {
  let last = 0;
  return (x) => {
    const now = performance.now();
    if (onProgress && now - last > 100) {
      last = now;
      onProgress(Math.min(1, Math.max(0, x)));
    }
  };
}

/**
 * Source seconds [from, to) of an asset's audio as mono PCM at `rate` Hz.
 * Channels are averaged; resampling is a box filter (each output sample is
 * the mean of the input samples in its slot), which is plenty for level
 * and onset analysis and costs one add per input sample.
 */
export async function decodeMono(asset: Asset, from: number, to: number, rate: number, onProgress?: Progress, signal?: AbortSignal): Promise<Float32Array> {
  const input = await openInput(asset);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) throw new Error(`${asset.name} has no sound this app can decode`);
    // AAC in MP4 starts with encoder priming (1024 samples) that the edit
    // list hides; mediabunny honors it by giving that packet a negative
    // timestamp. Real time 0 is timestamp 0 then, not the first timestamp,
    // or every result lands 21 ms late (measured on the fixtures). A stream
    // that starts late (MPEG-TS) still maps its first timestamp to 0, and
    // an MP3's encoder delay is skipped as ffmpeg skips it (ADR-112).
    const t0 = await soundOrigin(input, proxySource(asset, "analysis", false));
    const n = Math.max(0, Math.ceil((to - from) * rate));
    const sum = new Float32Array(n);
    const count = new Uint16Array(n);
    const report = throttle(onProgress);
    let mono = new Float32Array(0);
    let plane = new Float32Array(0);
    for await (const sample of new AudioSampleSink(track).samples(Math.max(0, t0 + from - DECODE_PREROLL), t0 + to)) {
      try {
        signal?.throwIfAborted();
        const frames = sample.numberOfFrames;
        const channels = sample.numberOfChannels;
        if (mono.length < frames) [mono, plane] = [new Float32Array(frames), new Float32Array(frames)];
        mono.fill(0, 0, frames);
        for (let ch = 0; ch < channels; ch++) {
          sample.copyTo(plane, { planeIndex: ch, format: "f32-planar" });
          for (let j = 0; j < frames; j++) mono[j] += plane[j] / channels;
        }
        const base = (sample.timestamp - t0 - from) * rate;
        const step = rate / sample.sampleRate;
        for (let j = 0; j < frames; j++) {
          const k = Math.floor(base + j * step);
          if (k >= 0 && k < n) {
            sum[k] += mono[j];
            count[k]++;
          }
        }
        report((sample.timestamp - t0 - from) / (to - from));
      } finally {
        sample.close();
      }
    }
    // Slots no input sample landed in (a source rate below `rate`, or a gap
    // in the stream) hold the previous value rather than a click to zero.
    let prev = 0;
    for (let k = 0; k < n; k++) {
      if (count[k]) prev = sum[k] /= count[k];
      else sum[k] = prev;
    }
    return sum;
  } finally {
    input.dispose();
  }
}

/**
 * Source seconds [from, to) of an asset's audio at its own rate and channel
 * count, for tools that write sound back (noise reduction). Samples land by
 * timestamp, so a gap in the stream stays silent rather than shifting.
 */
export async function decodePcm(asset: Asset, from: number, to: number, onProgress?: Progress, signal?: AbortSignal): Promise<{ rate: number; channels: Float32Array[] }> {
  const input = await openInput(asset);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) throw new Error(`${asset.name} has no sound this app can decode`);
    const t0 = await soundOrigin(input, proxySource(asset, "analysis", false));
    const rate = track.sampleRate;
    const n = Math.max(0, Math.round((to - from) * rate));
    const channels = Array.from({ length: Math.min(2, track.numberOfChannels) }, () => new Float32Array(n));
    const report = throttle(onProgress);
    let plane = new Float32Array(0);
    for await (const sample of new AudioSampleSink(track).samples(Math.max(0, t0 + from - DECODE_PREROLL), t0 + to)) {
      try {
        signal?.throwIfAborted();
        const frames = sample.numberOfFrames;
        if (plane.length < frames) plane = new Float32Array(frames);
        const base = Math.round((sample.timestamp - t0 - from) * rate);
        channels.forEach((out, ch) => {
          sample.copyTo(plane, { planeIndex: Math.min(ch, sample.numberOfChannels - 1), format: "f32-planar" });
          for (let j = 0; j < frames; j++) if (base + j >= 0 && base + j < n) out[base + j] = plane[j];
        });
        report((sample.timestamp - t0 - from) / (to - from));
      } finally {
        sample.close();
      }
    }
    return { rate, channels };
  } finally {
    input.dispose();
  }
}

/**
 * Integrated loudness (LUFS), sample and true peak of an asset's source seconds
 * [from, to), streamed through a BS.1770 meter at the source's own rate
 * and channel count, so nothing is held in memory but the meter.
 */
export async function measureLoudness(asset: Asset, from: number, to: number, onProgress?: Progress, signal?: AbortSignal, compressor?: Compressor): Promise<{ lufs: number; peak: number; truePeak: number }> {
  const input = await openInput(asset);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) throw new Error(`${asset.name} has no sound this app can decode`);
    const t0 = await soundOrigin(input, proxySource(asset, "analysis", false));
    let meter: LoudnessMeter | null = null;
    // And the 4x-oversampled true peak, which broadcast ceilings are in.
    let tp: TruePeakMeter | null = null;
    let planes: Float32Array[] = [];
    const report = throttle(onProgress);
    // With a compressor the sound is measured as it plays: the decoded audio
    // runs through the same nodes offline, ten seconds at a time.
    // ponytail: each block starts the compressor afresh; it settles within
    // milliseconds, so the reading moves by hundredths of a dB.
    let block: { planes: Float32Array[]; n: number; rate: number } | null = null;
    const flush = async () => {
      if (!block?.n || !compressor) return;
      const { planes: bp, n, rate } = block;
      const ctx = new OfflineAudioContext({ numberOfChannels: bp.length, length: n, sampleRate: rate });
      const buffer = new AudioBuffer({ numberOfChannels: bp.length, length: n, sampleRate: rate });
      bp.forEach((pl, ch) => buffer.copyToChannel(pl.subarray(0, n) as Float32Array<ArrayBuffer>, ch));
      const src = new AudioBufferSourceNode(ctx, { buffer });
      const nodes = compressorNodes(ctx, compressor);
      src.connect(nodes.input);
      nodes.output.connect(ctx.destination);
      src.start();
      const out = await ctx.startRendering();
      const outPlanes = Array.from({ length: out.numberOfChannels }, (_, ch) => out.getChannelData(ch));
      meter!.push(outPlanes, n);
      tp!.push(outPlanes, n);
      block.n = 0;
    };
    const push = async (p: Float32Array[], frames: number, rate: number) => {
      if (!compressor) {
        meter!.push(p, frames);
        return tp!.push(p, frames);
      }
      block ??= { planes: p.map(() => new Float32Array(rate * 10)), n: 0, rate };
      for (let off = 0; off < frames; ) {
        const take = Math.min(frames - off, block.planes[0].length - block.n);
        p.forEach((pl, ch) => block!.planes[ch].set(pl.subarray(off, off + take), block!.n));
        block.n += take;
        off += take;
        if (block.n === block.planes[0].length) await flush();
      }
    };
    for await (const sample of new AudioSampleSink(track).samples(Math.max(0, t0 + from - DECODE_PREROLL), t0 + to)) {
      try {
        signal?.throwIfAborted();
        const rate = sample.sampleRate;
        const channels = sample.numberOfChannels;
        meter ??= new LoudnessMeter(rate, channels);
        tp ??= new TruePeakMeter(channels);
        // Only the part of this chunk inside [from, to).
        const start = sample.timestamp - t0;
        const skip = Math.max(0, Math.round((from - start) * rate));
        const frames = Math.min(sample.numberOfFrames, Math.round((to - start) * rate)) - skip;
        if (frames <= 0) continue;
        if (planes.length !== channels || planes[0].length < sample.numberOfFrames) planes = Array.from({ length: channels }, () => new Float32Array(sample.numberOfFrames));
        for (let ch = 0; ch < channels; ch++) sample.copyTo(planes[ch], { planeIndex: ch, format: "f32-planar" });
        await push(skip ? planes.map((p) => p.subarray(skip)) : planes, frames, rate);
        report((start - from) / (to - from));
      } finally {
        sample.close();
      }
    }
    await flush();
    tp?.flush();
    return { lufs: meter?.integrated() ?? -Infinity, peak: meter?.peak ?? 0, truePeak: tp?.peak ?? 0 };
  } finally {
    input.dispose();
  }
}

export interface FrameScores {
  /** Source seconds of each decoded frame. */
  times: Float64Array;
  /** Content score against the previous frame (scenes.ts); scores[0] = 0. */
  scores: Float32Array;
}

/**
 * Every frame of source seconds [from, to), decoded `width` pixels wide,
 * reduced to its content score against the previous frame. Only the scores
 * are kept, so memory does not grow with the video.
 */
/**
 * Every frame of source seconds [from, to) as `width` x `height` gray, for
 * motion analysis (stabilization). The picture is squeezed to that size;
 * callers scale what they measure back by the axes' own factors.
 */
export async function frameGrays(
  asset: Asset,
  from: number,
  to: number,
  width: number,
  height: number,
  onFrame: (time: number, gray: Uint8Array) => void,
  onProgress?: Progress,
  signal?: AbortSignal,
): Promise<void> {
  const input = await openInput(asset);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error(`${asset.name} has no picture this app can decode`);
    const t0 = await mediaOrigin(track, await input.getPrimaryAudioTrack());
    const sink = new CanvasSink(track, { width, height, fit: "fill", poolSize: 1 });
    const report = throttle(onProgress);
    for await (const wrapped of sink.canvases(t0 + from, t0 + to)) {
      signal?.throwIfAborted();
      const ctx = wrapped.canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      const rgba = ctx.getImageData(0, 0, width, height).data;
      const gray = new Uint8Array(width * height);
      for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
      onFrame(wrapped.timestamp - t0, gray);
      report((wrapped.timestamp - t0 - from) / (to - from));
    }
  } finally {
    input.dispose();
  }
}

export async function frameScores(
  asset: Asset,
  from: number,
  to: number,
  opts: { width?: number; lumaOnly?: boolean } = {},
  onProgress?: Progress,
  signal?: AbortSignal,
): Promise<FrameScores> {
  const input = await openInput(asset);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error(`${asset.name} has no picture this app can decode`);
    const t0 = await mediaOrigin(track, await input.getPrimaryAudioTrack());
    const sink = new CanvasSink(track, { width: opts.width ?? 128, poolSize: 1 });
    const weights = opts.lumaOnly ? LUMA_WEIGHTS : DEFAULT_WEIGHTS;
    const times: number[] = [];
    const scores: number[] = [];
    let prev: Uint8Array | null = null;
    let spare: Uint8Array | undefined;
    const report = throttle(onProgress);
    for await (const wrapped of sink.canvases(t0 + from, t0 + to)) {
      signal?.throwIfAborted();
      const { canvas } = wrapped;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      const hsv = rgbaToHsv(ctx.getImageData(0, 0, canvas.width, canvas.height).data, spare);
      scores.push(prev ? contentScore(prev, hsv, weights) : 0);
      times.push(wrapped.timestamp - t0);
      spare = prev ?? undefined;
      prev = hsv;
      report((wrapped.timestamp - t0 - from) / (to - from));
    }
    return { times: Float64Array.from(times), scores: Float32Array.from(scores) };
  } finally {
    input.dispose();
  }
}

/**
 * The frames of an asset's video at source seconds `times`, `width` pixels
 * wide: what an agent looks at to choose the moments to cut. A time past
 * the end gives the last frame; a file without picture gives nulls.
 */
export async function sourceFrames(asset: Asset, times: number[], width: number, signal?: AbortSignal): Promise<(CanvasImageSource | null)[]> {
  if (asset.kind === "image") return Promise.all(times.map(async t => {
    const borrowed = await borrowImage(asset, t);
    try {
      const bitmap = borrowed.value;
      const canvas = new OffscreenCanvas(width, Math.max(1, Math.round(width * bitmap.height / bitmap.width)));
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas;
    } finally { borrowed.release(); }
  }));
  const input = await openInput(asset);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return times.map(() => null);
    const t0 = await mediaOrigin(track, await input.getPrimaryAudioTrack());
    const sink = new CanvasSink(track, { width, fit: "contain" });
    const out: (CanvasImageSource | null)[] = [];
    for (const t of times) {
      signal?.throwIfAborted();
      out.push((await sink.getCanvas(t0 + Math.max(0, Math.min(t, asset.duration - 1e-3))))?.canvas ?? null);
    }
    return out;
  } finally {
    input.dispose();
  }
}
