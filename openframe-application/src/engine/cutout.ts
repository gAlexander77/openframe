// Remove background, the engine side (ADR-032, ADR-033): decode a clip's
// source window, run every frame through a segmentation model in a worker,
// steady the mattes over time (src/lib/matte.ts), and encode them as a
// grayscale video (luma = alpha) that the compositor samples beside the
// source while playing and exporting. Processed once, played in real time,
// the way CapCut does it. Everything runs on this machine; only the model
// weights are downloaded, once.

import { ALL_FORMATS, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, QUALITY_HIGH, getFirstEncodableVideoCodec } from "mediabunny";
import { isDownloadFailure, matteSize, stabilize } from "../lib/matte";
import type { Asset } from "../lib/project/types";
import { platform } from "../platform";
import { mediaOrigin } from "./media";
import type { MatteModelSpec } from "./matte.worker";

export interface MatteModel extends MatteModelSpec {
  label: string;
  /** The model's input size, width x height; frames are stretched to it. */
  input: [number, number];
  /** First-use download, approximately. */
  size: string;
}

/** ADR-032: ormbg (IS-Net, Apache-2.0) where WebGPU runs it at ~13 fps;
 * MediaPipe's selfie segmenter (Apache-2.0) where only WASM is left, since
 * ormbg on WASM takes over 5 s a frame. */
export const MATTE_MODELS = {
  quality: { id: "onnx-community/ormbg-ONNX", label: "ormbg", mean: [0, 0, 0], std: [1, 1, 1], dtype: { webgpu: "fp16", wasm: "fp16" }, input: [1024, 1024], size: "88 MB" },
  fallback: { id: "onnx-community/mediapipe_selfie_segmentation", label: "MediaPipe Selfie", mean: [0, 0, 0], std: [1, 1, 1], dtype: { webgpu: "fp32", wasm: "fp32" }, input: [256, 256], size: "0.5 MB" },
} satisfies Record<string, MatteModel>;

type Gpu = { requestAdapter(): Promise<{ features: { has(f: string): boolean } } | null> };

let gpu: Promise<boolean> | null = null;
/** A WebGPU adapter that can run half-precision shaders: the quality
 * model's weights are fp16. */
const hasF16Gpu = () =>
  (gpu ??= (async () => {
    const nav = navigator as Navigator & { gpu?: Gpu };
    const adapter = nav.gpu ? await nav.gpu.requestAdapter().catch(() => null) : null;
    return !!adapter?.features.has("shader-f16");
  })());

/** The model this machine will use. */
export const matteModel = async (): Promise<MatteModel> => ((await hasF16Gpu()) ? MATTE_MODELS.quality : MATTE_MODELS.fallback);

/** A failure on the model's side (fetching the weights, starting the
 * runtime, a run), as opposed to decoding or encoding the video. */
export class ModelError extends Error {
  name = "ModelError";
  constructor(
    message: string,
    readonly stage: "load" | "run",
  ) {
    super(message);
  }
}

let worker: Worker | null = null;
let nextId = 1;

/** A fresh worker after a model failure. transformers.js chains session
 * creation and runs as `chain = chain.then(next)`, so one rejection fails
 * every later load and run in that worker with the same error. */
function resetWorker() {
  worker?.terminate();
  worker = null;
}

/** One request to the matte worker. Aborting stops waiting for the answer;
 * the worker finishes what it started (a download is cached for next time). */
function call<T>(msg: Record<string, unknown>, opts: { onDownload?: (p: number) => void; transfer?: Transferable[]; signal?: AbortSignal } = {}): Promise<T> {
  worker ??= new Worker(new URL("./matte.worker.ts", import.meta.url), { type: "module" });
  const w = worker;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const done = () => {
      w.removeEventListener("message", onMsg);
      opts.signal?.removeEventListener("abort", onAbort);
    };
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === "download") return opts.onDownload?.(m.progress);
      done();
      if (m.type === "error") reject(new ModelError(m.message, m.stage));
      else resolve(m as T);
    };
    const onAbort = () => {
      done();
      reject(opts.signal!.reason);
    };
    if (opts.signal?.aborted) return reject(opts.signal.reason);
    w.addEventListener("message", onMsg);
    opts.signal?.addEventListener("abort", onAbort);
    w.postMessage({ ...msg, id }, opts.transfer ?? []);
  });
}

export interface CutoutProgress {
  stage: "downloading" | "processing";
  /** 0..1 within the stage. */
  progress: number;
  model: MatteModel;
}

export interface MatteResult {
  /** The matte video (MP4). */
  bytes: Uint8Array;
  /** Source seconds covered: `from` is the first frame's start. */
  from: number;
  to: number;
  frames: number;
  model: string;
  device: string;
  width: number;
  height: number;
  /** Frames processed per second, wall clock, download excluded. */
  fps: number;
  /** Set when the quality model could not run here and the light one
   * made the matte instead: why. */
  fellBack?: string;
}

export interface MatteOptions {
  /** Force a model (benchmarks, the drive); by default the machine's. */
  model?: MatteModel;
  /** Force a backend; by default WebGPU when the machine has it. */
  device?: "webgpu" | "wasm";
}

interface Raw {
  alpha: Uint8Array;
  /** Source seconds. */
  time: number;
  duration: number;
}

/** Network trouble while fetching the weights (src/lib/matte.ts). */
const downloadFailed = (e: ModelError) => e.stage === "load" && isDownloadFailure(e.message, navigator.onLine);

/** A message a person can act on. */
function explain(e: unknown, model: MatteModel): unknown {
  if (!(e instanceof ModelError)) return e;
  if (downloadFailed(e))
    return new Error(`Couldn't download the background model (${model.size}) from Hugging Face. Check the internet connection and try again; once downloaded it works offline.`);
  return new Error(`The background model couldn't run on this computer (${e.message})`);
}

/**
 * Make the background matte for source seconds [from, to) of an asset.
 * When this machine's GPU cannot run the quality model (no fp16 shaders,
 * a driver limit), the light model makes it on the CPU instead, and the
 * result says so. A failed download is not retried with another model:
 * that one would have to be downloaded too.
 */
export async function makeMatte(asset: Asset, from: number, to: number, onProgress: (p: CutoutProgress) => void, signal?: AbortSignal, opts: MatteOptions = {}): Promise<MatteResult> {
  const model = opts.model ?? (await matteModel());
  try {
    return await run(asset, from, to, model, opts.device, onProgress, signal);
  } catch (e) {
    if (e instanceof ModelError) resetWorker();
    const retry = !opts.model && model === MATTE_MODELS.quality && e instanceof ModelError && !downloadFailed(e) && !signal?.aborted;
    if (!retry) throw explain(e, model);
    const light = MATTE_MODELS.fallback;
    try {
      return { ...(await run(asset, from, to, light, "wasm", onProgress, signal)), fellBack: e.message };
    } catch (e2) {
      if (e2 instanceof ModelError) resetWorker();
      throw explain(e2, light);
    }
  }
}

async function run(asset: Asset, from: number, to: number, model: MatteModel, force: MatteOptions["device"], onProgress: (p: CutoutProgress) => void, signal?: AbortSignal): Promise<MatteResult> {
  // Download progress arrives only while weights are fetched (first use).
  const { device } = await call<{ device: string }>({ type: "load", spec: model, device: force }, { onDownload: (x) => onProgress({ stage: "downloading", progress: x, model }), signal });
  signal?.throwIfAborted();
  onProgress({ stage: "processing", progress: 0, model });

  const input = new Input({ source: await platform.sourceFor(asset.proxy ?? asset.src), formats: ALL_FORMATS });
  let output: Output | null = null;
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error(`${asset.name} has no picture this app can decode`);
    const t0 = await mediaOrigin(track, await input.getPrimaryAudioTrack());
    const [iw, ih] = model.input;
    const size = matteSize(await track.getDisplayWidth(), await track.getDisplayHeight());
    const codec = await getFirstEncodableVideoCodec(["avc", "vp9", "vp8"], { width: size.width, height: size.height });
    if (!codec) throw new Error("This device can't encode the background matte");

    // The model's answer at its own size, drawn scaled into the canvas the
    // encoder reads. Gray: R = G = B = alpha.
    const small = new OffscreenCanvas(iw, ih);
    const smallCtx = small.getContext("2d")!;
    const img = new ImageData(iw, ih);
    img.data.fill(255);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext("2d")!;
    const target = new BufferTarget();
    output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
    // A key frame a second keeps seeks in the matte as cheap as in a source.
    const source = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH, keyFrameInterval: 1 });
    output.addVideoTrack(source);
    await output.start();

    let first: number | null = null;
    let end = from;
    let frames = 0;
    let last: Uint8Array | null = null;
    let prev: Raw | null = null;
    let cur: Raw | null = null;
    /** Stabilize and encode `cur` once its successor is known. */
    const push = async (next: Raw | null) => {
      if (cur) {
        last = stabilize(prev?.alpha ?? null, cur.alpha, next?.alpha ?? null, last);
        const d = img.data;
        for (let i = 0, j = 0; i < last.length; i++, j += 4) d[j] = d[j + 1] = d[j + 2] = last[i];
        smallCtx.putImageData(img, 0, 0);
        ctx.drawImage(small, 0, 0, size.width, size.height);
        await source.add(cur.time - first!, cur.duration);
        end = cur.time + cur.duration;
        frames++;
      }
      prev = cur;
      cur = next;
    };

    const started = performance.now();
    let reported = 0;
    let inFlight: Promise<Raw> | null = null;
    const sink = new CanvasSink(track, { width: iw, height: ih, fit: "fill", poolSize: 2 });
    for await (const wc of sink.canvases(t0 + from, t0 + to)) {
      signal?.throwIfAborted();
      const c = wc.canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      const rgba = c.getImageData(0, 0, iw, ih).data;
      const time = wc.timestamp - t0;
      first ??= time;
      const job = call<{ alpha: Uint8Array }>({ type: "infer", rgba, width: iw, height: ih }, { transfer: [rgba.buffer], signal }).then((r) => ({ alpha: r.alpha, time, duration: wc.duration }));
      // Handled where it is awaited; a cancel can leave the last one unread.
      job.catch(() => undefined);
      // The worker always has the next frame queued while this one is
      // stabilized and encoded.
      if (inFlight) await push(await inFlight);
      inFlight = job;
      const now = performance.now();
      if (now - reported > 100) {
        reported = now;
        onProgress({ stage: "processing", progress: Math.min(1, Math.max(0, (time - from) / (to - from))), model });
      }
    }
    if (inFlight) await push(await inFlight);
    await push(null);
    signal?.throwIfAborted();
    if (!frames || first === null) throw new Error(`${asset.name} has no frames in that range`);
    await output.finalize();
    const seconds = (performance.now() - started) / 1000;
    return { bytes: new Uint8Array(target.buffer!), from: first, to: end, frames, model: model.id, device, ...size, fps: frames / seconds };
  } catch (e) {
    await output?.cancel().catch(() => undefined);
    throw e;
  } finally {
    input.dispose();
  }
}

export interface CutoutImage {
  /** The picture with its background transparent (PNG). */
  blob: Blob;
  width: number;
  height: number;
  model: string;
  fellBack?: string;
}

/**
 * Remove the background of a still picture: the same models as a video's
 * matte, run once, and the matte multiplied into the picture's alpha at
 * its own size (up to 4096 pixels a side), as a PNG. Text behind the
 * subject of a photo is then just this picture above the title.
 */
export async function cutOutImage(asset: Asset, onProgress: (p: CutoutProgress) => void, signal?: AbortSignal): Promise<CutoutImage> {
  const bitmap = await createImageBitmap(await platform.blobFor(asset.src));
  const go = async (model: MatteModel, device?: "webgpu" | "wasm") => {
    await call<{ device: string }>({ type: "load", spec: model, device }, { onDownload: (x) => onProgress({ stage: "downloading", progress: x, model }), signal });
    signal?.throwIfAborted();
    onProgress({ stage: "processing", progress: 0, model });
    const [iw, ih] = model.input;
    const small = new OffscreenCanvas(iw, ih);
    const sctx = small.getContext("2d", { willReadFrequently: true })!;
    sctx.drawImage(bitmap, 0, 0, iw, ih);
    const rgba = sctx.getImageData(0, 0, iw, ih).data;
    const { alpha } = await call<{ alpha: Uint8Array }>({ type: "infer", rgba, width: iw, height: ih }, { transfer: [rgba.buffer], signal });
    // The matte, gray, scaled up smoothly to the picture's size.
    const gray = new ImageData(iw, ih);
    for (let i = 0, j = 0; i < alpha.length; i++, j += 4) {
      gray.data[j] = gray.data[j + 1] = gray.data[j + 2] = alpha[i];
      gray.data[j + 3] = 255;
    }
    sctx.putImageData(gray, 0, 0);
    const k = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * k), h = Math.round(bitmap.height * k);
    const big = new OffscreenCanvas(w, h);
    const bctx = big.getContext("2d", { willReadFrequently: true })!;
    bctx.imageSmoothingQuality = "high";
    bctx.drawImage(small, 0, 0, w, h);
    const matte = bctx.getImageData(0, 0, w, h).data;
    bctx.clearRect(0, 0, w, h);
    bctx.drawImage(bitmap, 0, 0, w, h);
    const pic = bctx.getImageData(0, 0, w, h);
    for (let j = 3; j < pic.data.length; j += 4) pic.data[j] = Math.round((pic.data[j] * matte[j - 3]) / 255);
    bctx.putImageData(pic, 0, 0);
    onProgress({ stage: "processing", progress: 1, model });
    return { blob: await big.convertToBlob({ type: "image/png" }), width: w, height: h, model: model.id };
  };
  const model = await matteModel();
  try {
    return await go(model);
  } catch (e) {
    if (e instanceof ModelError) resetWorker();
    const retry = model === MATTE_MODELS.quality && e instanceof ModelError && !downloadFailed(e) && !signal?.aborted;
    if (!retry) throw explain(e, model);
    try {
      return { ...(await go(MATTE_MODELS.fallback, "wasm")), fellBack: e.message };
    } catch (e2) {
      if (e2 instanceof ModelError) resetWorker();
      throw explain(e2, MATTE_MODELS.fallback);
    }
  } finally {
    bitmap.close();
  }
}
