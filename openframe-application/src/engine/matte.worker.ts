// Background removal off the main thread: a segmentation model through
// transformers.js, on WebGPU when the machine has it and WASM otherwise,
// the same way the Whisper worker runs (ADR-007, ADR-032). The page sends
// frames already scaled to the model's input size as RGBA; this answers
// with one alpha byte per pixel. Only the weights are downloaded, once, and
// the browser caches them; frames never leave the machine.

import { AutoModel, Tensor, env } from "@huggingface/transformers";

env.allowLocalModels = false;

export interface MatteModelSpec {
  /** Hugging Face id of a transformers.js export. */
  id: string;
  /** Per-channel normalization the model was trained with. */
  mean: [number, number, number];
  std: [number, number, number];
  dtype: { webgpu: string; wasm: string };
}

type Msg =
  /** `device` forces one (tests, benchmarks); by default WebGPU if any. */
  | { id: number; type: "load"; spec: MatteModelSpec; device?: "webgpu" | "wasm" }
  | { id: number; type: "infer"; rgba: Uint8ClampedArray; width: number; height: number };

type Model = ((inputs: Record<string, Tensor>) => Promise<Record<string, Tensor>>) & {
  sessions: Record<string, { inputNames: string[]; outputNames: string[] }>;
  dispose(): Promise<unknown>;
};

let model: Model | null = null;
let spec: MatteModelSpec | null = null;
let device = "wasm";
let loaded = "";

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

async function load(id: number, s: MatteModelSpec, force?: "webgpu" | "wasm") {
  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  const gpu = force !== "wasm" && nav.gpu ? await nav.gpu.requestAdapter().catch(() => null) : null;
  const want = gpu ? "webgpu" : "wasm";
  const key = `${s.id} ${want} ${want === "webgpu" ? s.dtype.webgpu : s.dtype.wasm}`;
  if (model && loaded === key) return;
  await model?.dispose();
  model = null;
  device = want;
  // Bytes of the weights, not an average of files: the small JSON configs
  // finish first and would read as 100% before the weights start.
  const files = new Map<string, [number, number]>();
  let shown = 0;
  model = (await AutoModel.from_pretrained(s.id, {
    device,
    dtype: gpu ? s.dtype.webgpu : s.dtype.wasm,
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== "progress" || !p.file || !p.total || p.total < 100_000) return;
      files.set(p.file, [p.loaded ?? 0, p.total]);
      let loaded = 0, total = 0;
      for (const [l, t] of files.values()) (loaded += l), (total += t);
      shown = Math.max(shown, loaded / total);
      post({ id, type: "download", progress: shown });
    },
  } as never)) as unknown as Model;
  spec = s;
  loaded = key;
}

/** RGBA bytes to a normalized planar float tensor, [1, 3, h, w]. */
function toTensor(rgba: Uint8ClampedArray, w: number, h: number, s: MatteModelSpec): Tensor {
  const n = w * h;
  const data = new Float32Array(3 * n);
  for (let c = 0; c < 3; c++) {
    const k = 1 / (255 * s.std[c]);
    const o = s.mean[c] / s.std[c];
    const plane = c * n;
    for (let i = 0; i < n; i++) data[plane + i] = rgba[i * 4 + c] * k - o;
  }
  return new Tensor("float32", data, [1, 3, h, w]);
}

async function infer(rgba: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array> {
  if (!model || !spec) throw new Error("no model loaded");
  const session = model.sessions.model;
  const out = await model({ [session.inputNames[0]]: toTensor(rgba, w, h, spec) });
  const data = out[session.outputNames[0]].data as Float32Array;
  // Mattes are 0..1; some models (BiRefNet) answer logits instead.
  let logits = false;
  for (let i = 0; i < data.length; i += 97) if (data[i] < -1e-3 || data[i] > 1.001) logits = true;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) {
    const v = logits ? 1 / (1 + Math.exp(-data[i])) : data[i];
    alpha[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
  return alpha;
}

// One model run at a time: ONNX Runtime sessions are not reentrant, and an
// async onmessage would otherwise start the next frame mid-run.
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  queue = queue.then(async () => {
    try {
      if (m.type === "load") {
        await load(m.id, m.spec, m.device);
        post({ id: m.id, type: "ready", device });
      } else {
        const alpha = await infer(m.rgba, m.width, m.height);
        post({ id: m.id, type: "matte", alpha }, [alpha.buffer]);
      }
    } catch (err) {
      // The page tells a failed download (load) from a model that cannot
      // run here (run) to pick its message and whether to fall back.
      post({ id: m.id, type: "error", stage: m.type === "load" ? "load" : "run", message: err instanceof Error ? err.message : String(err) });
    }
  });
};
