// Speech recognition off the main thread: Whisper via transformers.js, on
// WebGPU when the machine has it and WASM otherwise. Inference blocks for
// seconds at a time, so it gets a worker of its own (research §7.1). The
// model downloads once from Hugging Face and is cached by the browser; the
// audio never leaves the machine.

import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;

type Msg =
  | { id: number; type: "load"; model: string }
  | { id: number; type: "transcribe"; audio: Float32Array; language: string | null; offset: number };

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ chunks?: { text: string; timestamp: [number, number | null] }[] }>;

let asr: Asr | null = null;
let loaded = "";
let device = "wasm";

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

async function load(id: number, model: string) {
  if (asr && loaded === model) return;
  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  const gpu = nav.gpu ? await nav.gpu.requestAdapter().catch(() => null) : null;
  device = gpu ? "webgpu" : "wasm";
  const files = new Map<string, number>();
  asr = (await pipeline("automatic-speech-recognition", model, {
    device: device as "webgpu" | "wasm",
    dtype: gpu ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === "progress" && p.file && p.total) {
        files.set(p.file, (p.loaded ?? 0) / p.total);
        const vals = [...files.values()];
        post({ id, type: "download", progress: vals.reduce((a, b) => a + b, 0) / vals.length });
      }
    },
  } as never)) as unknown as Asr;
  loaded = model;
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === "load") {
      await load(m.id, m.model);
      post({ id: m.id, type: "ready", device });
      return;
    }
    if (!asr) throw new Error("no model loaded");
    const out = await asr(m.audio, {
      return_timestamps: "word",
      chunk_length_s: 30,
      ...(m.language ? { language: m.language, task: "transcribe" } : {}),
    });
    const words = (out.chunks ?? []).map((c) => ({
      text: c.text,
      start: c.timestamp[0] + m.offset,
      end: (c.timestamp[1] ?? c.timestamp[0] + 0.3) + m.offset,
    }));
    post({ id: m.id, type: "words", words });
  } catch (err) {
    post({ id: m.id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
