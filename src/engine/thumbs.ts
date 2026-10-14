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
import { imageFor, mediaOrigin } from "./media";

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

const strips = new Map<string, Filmstrip>();
const peaks = new Map<string, Peaks>();
const posters = new Map<string, string>();
const started = new Set<string>();

let version = 0;
const listeners = new Set<() => void>();
const bump = () => {
  version++;
  for (const l of listeners) l();
};
export const thumbs = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  version: () => version,
  strip: (a: Asset) => strips.get(a.proxy ?? a.src),
  peaks: (a: Asset) => peaks.get(a.proxy ?? a.src),
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
      .catch((e) => console.warn("thumbnail job failed:", e))
      .finally(() => {
        active--;
        pump();
      });
  }
}

/** Start generating everything an asset needs. Idempotent. */
export function prepare(asset: Asset) {
  const src = asset.proxy ?? asset.src;
  if (started.has(src)) return;
  started.add(src);
  if (asset.kind === "image") {
    enqueue(async () => {
      const bmp = await imageFor(asset);
      const h = THUMB_H;
      const w = Math.max(1, Math.round((bmp.width / bmp.height) * h));
      const small = await createImageBitmap(bmp, { resizeHeight: h, resizeWidth: w, resizeQuality: "medium" });
      strips.set(src, { step: Infinity, frames: [small], aspect: w / h });
      posters.set(asset.src, await toUrl(small));
      bump();
    });
    return;
  }
  if (asset.hasVideo && asset.kind === "video") enqueue(() => makeStrip(asset, src));
  if (asset.hasAudio) enqueue(() => makePeaks(asset, src));
}

async function toUrl(bmp: ImageBitmap): Promise<string> {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  return URL.createObjectURL(await c.convertToBlob({ type: "image/jpeg", quality: 0.8 }));
}

async function makeStrip(asset: Asset, src: string) {
  const input = new Input({ source: await platform.sourceFor(src), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return;
    const start = await mediaOrigin(track, await input.getPrimaryAudioTrack());
    const duration = asset.duration || (await input.computeDuration());
    const aspect = (await track.getDisplayWidth()) / (await track.getDisplayHeight());
    // At most ~120 thumbnails per file; the timeline picks the nearest.
    const step = Math.max(0.5, duration / 120);
    const count = Math.max(1, Math.ceil(duration / step));
    const strip: Filmstrip = { step, frames: new Array(count), aspect };
    strips.set(src, strip);
    const sink = new CanvasSink(track, { height: THUMB_H, fit: "contain" });
    // Poster first so the media card fills in immediately.
    const first = await sink.getCanvas(start + Math.min(duration * 0.1, 1));
    if (first) {
      const bmp = await createImageBitmap(first.canvas);
      posters.set(asset.src, await toUrl(bmp));
      bmp.close();
      bump();
    }
    const times = Array.from({ length: count }, (_, i) => start + i * step);
    let i = 0;
    let lastBump = performance.now();
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (wrapped) strip.frames[i] = await createImageBitmap(wrapped.canvas);
      i++;
      if (performance.now() - lastBump > 250) {
        lastBump = performance.now();
        bump();
      }
    }
    bump();
  } finally {
    input.dispose();
  }
}

async function makePeaks(asset: Asset, src: string) {
  const input = new Input({ source: await platform.sourceFor(src), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return;
    const start = await mediaOrigin(await input.getPrimaryVideoTrack(), track);
    const duration = asset.duration || (await input.computeDuration());
    const data = new Float32Array(Math.ceil(duration * PEAK_RATE) + 1);
    peaks.set(src, { data, rate: PEAK_RATE });
    const sink = new AudioSampleSink(track);
    let lastBump = performance.now();
    let buf = new Float32Array(0);
    for await (const sample of sink.samples()) {
      const n = sample.numberOfFrames;
      if (buf.length < n) buf = new Float32Array(n);
      const t0 = sample.timestamp - start;
      for (let ch = 0; ch < sample.numberOfChannels; ch++) {
        sample.copyTo(buf, { planeIndex: ch, format: "f32-planar" });
        for (let j = 0; j < n; j++) {
          const b = Math.floor((t0 + j / sample.sampleRate) * PEAK_RATE);
          const v = Math.abs(buf[j]);
          if (b >= 0 && b < data.length && v > data[b]) data[b] = v;
        }
      }
      sample.close();
      if (performance.now() - lastBump > 300) {
        lastBump = performance.now();
        bump();
      }
    }
    bump();
  } finally {
    input.dispose();
  }
}
