// Remove background, the engine side (ADR-032, ADR-033): decode a clip's
// source window, run every frame through a segmentation model in a worker,
// steady the mattes over time (src/lib/matte.ts), and encode them as a
// grayscale video (luma = alpha) that the compositor samples beside the
// source while playing and exporting. Processed once, played in real time,
// the way CapCut does it. Everything runs on this machine; only the model
// weights are downloaded, once.

import { ALL_FORMATS, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, QUALITY_HIGH, getFirstEncodableVideoCodec } from "mediabunny";
import { matteSize, stabilize } from "../lib/matte";
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

/** ADR-032: ormbg (IS-Net, Apache-2.0) where WebGPU runs it at ~15 fps;
 * MediaPipe's selfie segmenter (Apache-2.0) where only WASM is left, since
 * ormbg on WASM takes over 5 s a frame. */
export const MATTE_MODELS = {
  quality: { id: "onnx-community/ormbg-ONNX", label: "ormbg", mean: [0, 0, 0], std: [1, 1, 1], dtype: { webgpu: "fp16", wasm: "fp16" }, input: [1024, 1024], size: "88 MB" },
  fallback: { id: "onnx-community/mediapipe_selfie_segmentation", label: "MediaPipe Selfie", mean: [0, 0, 0], std: [1, 1, 1], dtype: { webgpu: "fp32", wasm: "fp32" }, input: [256, 256], size: "0.5 MB" },
} satisfies Record<string, MatteModel>;

let gpu: Promise<boolean> | null = null;
const hasWebGpu = () =>
  (gpu ??= (async () => {
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    return !!(nav.gpu && (await nav.gpu.requestAdapter().catch(() => null)));
  })());

/** The model this machine will use. */
export const matteModel = async (): Promise<MatteModel> => ((await hasWebGpu()) ? MATTE_MODELS.quality : MATTE_MODELS.fallback);

let worker: Worker | null = null;
let nextId = 1;

function call<T>(msg: Record<string, unknown>, onDownload?: (p: number) => void, transfer: Transferable[] = []): Promise<T> {
  worker ??= new Worker(new URL("./matte.worker.ts", import.meta.url), { type: "module" });
  const w = worker;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === "download") onDownload?.(m.progress);
      else {
        w.removeEventListener("message", onMsg);
        if (m.type === "error") reject(new Error(m.message));
        else resolve(m as T);
      }
    };
    w.addEventListener("message", onMsg);
    w.postMessage({ ...msg, id }, transfer);
  });
}

export interface CutoutProgress {
  stage: "downloading" | "processing";
  /** 0..1 within the stage. */
  progress: number;
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
}

interface Raw {
  alpha: Uint8Array;
  /** Source seconds. */
  time: number;
  duration: number;
}

/** Make the background matte for source seconds [from, to) of an asset. */
export async function makeMatte(asset: Asset, from: number, to: number, onProgress: (p: CutoutProgress) => void, signal?: AbortSignal): Promise<MatteResult> {
  const model = await matteModel();
  // Download progress arrives only while weights are fetched (first use).
  const { device } = await call<{ device: string }>({ type: "load", spec: model }, (x) => onProgress({ stage: "downloading", progress: x }));
  signal?.throwIfAborted();
  onProgress({ stage: "processing", progress: 0 });

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
      const job = call<{ alpha: Uint8Array }>({ type: "infer", rgba, width: iw, height: ih }, undefined, [rgba.buffer]).then((r) => ({ alpha: r.alpha, time, duration: wc.duration }));
      // The worker always has the next frame queued while this one is
      // stabilized and encoded.
      if (inFlight) await push(await inFlight);
      inFlight = job;
      const now = performance.now();
      if (now - reported > 100) {
        reported = now;
        onProgress({ stage: "processing", progress: Math.min(1, Math.max(0, (time - from) / (to - from))) });
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
