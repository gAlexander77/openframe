import { ByteLru } from "../lib/memory";
import { memoryOwners, MiB, trackCache } from "./memory";
import { sourceForPurpose } from "./playbackProxies";
// Thumbnails and waveforms, generated in the background after import and
// cached for the session. A small job queue keeps at most two files
// decoding at once so import never starves playback. Results arrive
// progressively: the timeline repaints as each batch lands.
//
// Separate mediabunny Inputs are used here (not the playback ones), so a
// thumbnail scan never moves a playback decoder.

import { ALL_FORMATS, AudioSampleSink, CanvasSink, Input } from "mediabunny";
import type { Asset } from "../lib/project/types";
import { platform } from "../platform";
import { borrowImage, mediaOrigin, soundOrigin } from "./media";

export interface Filmstrip {
  /** Seconds between thumbnails. */
  step: number;
  /** Thumbnail i shows source time i * step. Missing until decoded. */
  frames: (ImageBitmap | undefined)[];
  aspect: number;
}

export interface Peaks {
  /** Max absolute amplitude per bucket, 0..1, all channels mixed. */
  data: Float32Array;
  /** Buckets per second of source. */
  rate: number;
}

const THUMB_H = 96;
const PEAK_RATE = 100;

const started = new Set<string>();
const strips = new ByteLru<string, Filmstrip>(64 * MiB, (strip, src) => { strip.frames.forEach(f => f?.close()); started.delete(src); });
const peaks = new ByteLru<string, Peaks>(16 * MiB, (_peaks, src) => { started.delete(src); });
const posters = new ByteLru<string, string>(8 * MiB, url => URL.revokeObjectURL(url));
trackCache("filmstrips", strips); trackCache("waveform_peaks", peaks); trackCache("posters", posters);
let session = new AbortController();
memoryOwners.register("thumbnail_jobs", () => ({ bytes: 0, count: active + queue.length }), () => {
  session.abort(); session = new AbortController(); queue.length = 0; started.clear();
});

let version = 0;
const listeners = new Set<() => void>();
const bump = () => {
  version++;
  for (const l of listeners) l();
};
/** Repaint what shows thumbnails: compound clips' strips arrive this way. */
export const notifyThumbs = bump;
export const thumbs = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  version: () => version,
  strip: (a: Asset) => { const strip = strips.get(sourceForPurpose(a, "filmstrip")) ?? strips.get(a.proxy ?? a.src); if (!strip) prepare(a); return strip; },
  peaks: (a: Asset) => { const peak = peaks.get(a.proxy ?? a.src); if (!peak) prepare(a); return peak; },
  poster: (a: Asset) => posters.get(a.src),
};

// ---- job queue -------------------------------------------------------------------

const queue: (() => Promise<void>)[] = [];
let active = 0;
function enqueue(job: () => Promise<void>) {
  queue.push(job);
  pump();
}
function pump() {
  while (active < 2 && queue.length) {
    const job = queue.shift()!;
    active++;
    void job()
      // Canceling a job disposes its input, which mediabunny reports as InputDisposedError.
      .catch((e) => { if (!(e instanceof Error && (e.name === "AbortError" || e.name === "InputDisposedError"))) console.warn("thumbnail job failed:", e); })
      .finally(() => {
        active--;
        pump();
      });
  }
}

/** Start generating everything an asset needs. Idempotent. */
export function prepare(asset: Asset) {
  const src = sourceForPurpose(asset, "thumbnail");
  if (started.has(src)) return;
  started.add(src);
  const signal = session.signal;
  if (asset.kind === "image") {
    enqueue(async () => {
      signal.throwIfAborted();
      const h = THUMB_H;
      const w = Math.max(1, Math.min(512, Math.round(((asset.width ?? 1) / (asset.height ?? 1)) * h)));
      const small = await smallImage(asset, 0, w, h, signal);
      const frames = [small];
      let published = false;
      try {
        const step = asset.animated ? asset.duration / 20 : Infinity;
        if (asset.animated) for (let i = 1; i < 20; i++) frames.push(await smallImage(asset, i * step, w, h, signal));
        if (signal.aborted) return;
        await setPoster(asset.src, small, signal);
        if (signal.aborted) return;
        strips.set(src, { step, frames, aspect: w / h }, frames.length * w * h * 4);
        published = true;
        bump();
      } finally { if (!published) frames.forEach(f => f.close()); }
    });
    return;
  }
  if (asset.hasVideo && asset.kind === "video") enqueue(() => makeStrip(asset, src, signal));
  if (asset.hasAudio) enqueue(() => makePeaks(asset, asset.proxy ?? asset.src, signal));
}

async function smallImage(asset: Asset, time: number, width: number, height: number, signal: AbortSignal) {
  const borrowed = await borrowImage(asset, time);
  try { signal.throwIfAborted(); return await createImageBitmap(borrowed.value, { resizeHeight: height, resizeWidth: width, resizeQuality: "medium" }); }
  finally { borrowed.release(); }
}

async function setPoster(src: string, bmp: ImageBitmap, signal: AbortSignal): Promise<void> {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.8 });
  if (!signal.aborted) posters.set(src, URL.createObjectURL(blob), blob.size);
}

async function makeStrip(asset: Asset, src: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const input = new Input({ source: await platform.sourceFor(src), formats: ALL_FORMATS });
  const abort = () => input.dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return;
    const start = await mediaOrigin(track, await input.getPrimaryAudioTrack());
    const duration = asset.duration || (await input.computeDuration());
    const aspect = (await track.getDisplayWidth()) / (await track.getDisplayHeight());
    // At most ~120 thumbnails per file; the timeline picks the nearest.
    const step = Math.max(0.5, duration / 120);
    const count = Math.max(1, Math.ceil(duration / step));
    const strip: Filmstrip = { step, frames: new Array(count), aspect };
    signal.throwIfAborted();
    const width = Math.min(512, Math.max(1, Math.round(THUMB_H * aspect)));
    strips.set(src, strip, count * width * THUMB_H * 4);
    const sink = new CanvasSink(track, { width, height: THUMB_H, fit: "contain", poolSize: 1 });
    // Poster first so the media card fills in immediately.
    const first = await sink.getCanvas(start + Math.min(duration * 0.1, 1));
    if (first) {
      const bmp = await createImageBitmap(first.canvas);
      try { await setPoster(asset.src, bmp, signal); } finally { bmp.close(); }
      bump();
    }
    const times = Array.from({ length: count }, (_, i) => start + i * step);
    let i = 0;
    let lastBump = performance.now();
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      signal.throwIfAborted();
      if (strips.peek(src) !== strip) return;
      if (wrapped) {
        const bitmap = await createImageBitmap(wrapped.canvas);
        if (signal.aborted || strips.peek(src) !== strip) { bitmap.close(); return; }
        strip.frames[i] = bitmap;
      }
      i++;
      if (performance.now() - lastBump > 250) {
        lastBump = performance.now();
        bump();
      }
    }
    bump();
  } finally {
    signal.removeEventListener("abort", abort);
    input.dispose();
  }
}

async function makePeaks(asset: Asset, src: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const input = new Input({ source: await platform.sourceFor(src), formats: ALL_FORMATS });
  const abort = () => input.dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return;
    const start = await soundOrigin(input, src);
    const duration = asset.duration || (await input.computeDuration());
    // A multi-hour source keeps at most 1 MiB of peaks; timeline drawing
    // already samples the nearest bucket, so the rate may be lower.
    const rate = Math.min(PEAK_RATE, (MiB / 4 - 1) / Math.max(1, duration));
    const data = new Float32Array(Math.ceil(duration * rate) + 1);
    signal.throwIfAborted();
    peaks.set(src, { data, rate }, data.byteLength);
    const sink = new AudioSampleSink(track);
    let lastBump = performance.now();
    let buf = new Float32Array(0);
    for await (const sample of sink.samples()) {
      try {
        signal.throwIfAborted();
        if (peaks.peek(src)?.data !== data) return;
        const n = sample.numberOfFrames;
        if (buf.length < n) buf = new Float32Array(n);
        const t0 = sample.timestamp - start;
        for (let ch = 0; ch < sample.numberOfChannels; ch++) {
          sample.copyTo(buf, { planeIndex: ch, format: "f32-planar" });
          for (let j = 0; j < n; j++) {
            const b = Math.floor((t0 + j / sample.sampleRate) * rate);
            const v = Math.abs(buf[j]);
            if (b >= 0 && b < data.length && v > data[b]) data[b] = v;
          }
        }
      } finally { sample.close(); }
      if (performance.now() - lastBump > 300) {
        lastBump = performance.now();
        bump();
      }
    }
    bump();
  } finally {
    signal.removeEventListener("abort", abort);
    input.dispose();
  }
}
