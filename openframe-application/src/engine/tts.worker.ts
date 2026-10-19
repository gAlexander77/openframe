// Text to speech off the main thread: Kokoro-82M (Apache-2.0) through
// kokoro-js. The model downloads once from Hugging Face and is cached by
// the browser; the text never leaves the machine (ADR-050).
//
// Precision (ADR-084): "best" runs the full-precision (fp32) weights, on
// WebGPU when the machine has it and on the CPU (WASM) otherwise, falling
// back to the 8-bit weights only when fp32 cannot load; "draft" runs the
// 8-bit weights on the CPU (a fifth of the download, a duller voice).
//
// Blends: a voice "af_heart:60,af_bella:40" mixes the voices' style
// vectors (the weights are normalized), as Kokoro's own pipeline does for
// "af_heart,af_bella". kokoro-js picks one voice's vectors inside
// generate_from_ids; this worker replaces that step on its instance.

import { KokoroTTS } from "kokoro-js";

export type Quality = "best" | "draft";

type Msg =
  | { id: number; type: "load"; quality?: Quality }
  | { id: number; type: "speak"; text: string; voice: string; speed: number; quality?: Quality };

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE_URL = (id: string) => `https://huggingface.co/onnx-community/${MODEL.split("/")[1]}/resolve/main/voices/${id}.bin`;

type Plan = { device: "webgpu" | "wasm"; dtype: "fp32" | "q8" };
let tts: KokoroTTS | null = null;
let loaded: (Plan & { quality: Quality }) | null = null;
/** Set when WebGPU failed once in this worker: best runs on the CPU then. */
let gpuBroken = false;

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

async function plans(quality: Quality): Promise<Plan[]> {
  if (quality === "draft") return [{ device: "wasm", dtype: "q8" }];
  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  const gpu = !gpuBroken && nav.gpu ? await nav.gpu.requestAdapter().catch(() => null) : null;
  // WebGPU wants fp32; the CPU runs fp32 too (slower than q8, but the
  // 8-bit weights flatten the voice), with q8 as the last resort.
  return [...(gpu ? [{ device: "webgpu", dtype: "fp32" } as Plan] : []), { device: "wasm", dtype: "fp32" }, { device: "wasm", dtype: "q8" }];
}

async function load(id: number, quality: Quality) {
  if (tts && loaded?.quality === quality) return;
  tts = null;
  loaded = null;
  let last: unknown = null;
  for (const plan of await plans(quality)) {
    const files = new Map<string, number>();
    try {
      tts = await KokoroTTS.from_pretrained(MODEL, {
        dtype: plan.dtype,
        device: plan.device,
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status === "progress" && p.file && p.total) {
            files.set(p.file, (p.loaded ?? 0) / p.total);
            const vals = [...files.values()];
            post({ id, type: "download", progress: vals.reduce((a, b) => a + b, 0) / vals.length });
          }
        },
      } as never);
      loaded = { ...plan, quality };
      return;
    } catch (e) {
      if (plan.device === "webgpu") gpuBroken = true;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

const voiceData = new Map<string, Promise<Float32Array>>();
/** A voice's style vectors (510 x 256), from the browser cache kokoro-js
 * fills, else downloaded once (a voice is half a megabyte). */
function voiceVectors(id: string): Promise<Float32Array> {
  let v = voiceData.get(id);
  if (!v) {
    v = (async () => {
      const url = VOICE_URL(id);
      const cache = await caches.open("kokoro-voices").catch(() => null);
      const hit = await cache?.match(url);
      if (hit) return new Float32Array(await hit.arrayBuffer());
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Voice ${id} could not be downloaded (${r.status})`);
      const buf = await r.arrayBuffer();
      await cache?.put(url, new Response(buf.slice(0))).catch(() => undefined);
      return new Float32Array(buf);
    })();
    voiceData.set(id, v);
    v.catch(() => voiceData.delete(id));
  }
  return v;
}

/** "af_heart:60,af_bella:40" as normalized weights; null for one voice. */
function blendOf(voice: string): { id: string; w: number }[] | null {
  if (!/[,+]/.test(voice)) return null;
  const parts = voice.split(/[,+]/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const [id, w] = s.split(":");
    return { id: id.trim(), w: w === undefined ? 1 : Number(w) };
  });
  const sum = parts.reduce((a, p) => a + (p.w > 0 ? p.w : 0), 0);
  if (!(sum > 0)) throw new Error(`Blend ${voice} needs positive weights`);
  return parts.filter((p) => p.w > 0).map((p) => ({ id: p.id, w: p.w / sum }));
}

type Ids = { dims: number[] };
type Model = (inputs: Record<string, unknown>) => Promise<{ waveform: { data: Float32Array } }>;
type TensorCtor = new (type: string, data: Float32Array | number[], dims: number[]) => unknown;
type Audio = { audio: Float32Array; sampling_rate: number };
/** The parts of kokoro-js's KokoroTTS a blend reaches into. */
type Kokoro = {
  voices: Record<string, unknown>;
  generate(text: string, o: { voice: string; speed: number }): Promise<Audio>;
  generate_from_ids: (ids: Ids, o: { voice?: string; speed: number }) => Promise<Audio>;
  model: Model;
  tokenizer: (s: string) => { input_ids: unknown };
};

async function generate(text: string, voice: string, speed: number): Promise<{ audio: Float32Array; rate: number }> {
  const t = tts as unknown as Kokoro;
  const blend = blendOf(voice);
  if (!blend) {
    const out = await t.generate(text, { voice, speed });
    return { audio: out.audio, rate: out.sampling_rate };
  }
  for (const b of blend) if (!(b.id in t.voices)) throw new Error(`Voice "${b.id}" not found`);
  // The tensor class kokoro-js bundles, from a tensor it makes.
  const Tensor = (t.tokenizer("a").input_ids as { constructor: TensorCtor }).constructor;
  const own = t.generate_from_ids;
  t.generate_from_ids = async (ids: Ids, o: { speed: number }) => {
    // The style row kokoro-js picks: one per input length.
    const row = 256 * Math.min(Math.max(ids.dims.at(-1)! - 2, 0), 509);
    const style = new Float32Array(256);
    for (const b of blend) {
      const v = await voiceVectors(b.id);
      for (let i = 0; i < 256; i++) style[i] += b.w * v[row + i];
    }
    const { waveform } = await t.model({ input_ids: ids, style: new Tensor("float32", style, [1, 256]), speed: new Tensor("float32", [o.speed], [1]) });
    return { audio: waveform.data, sampling_rate: 24000 };
  };
  try {
    // The first voice names the accent the words are read in.
    const out = await t.generate(text, { voice: blend[0].id, speed });
    return { audio: out.audio, rate: out.sampling_rate };
  } finally {
    t.generate_from_ids = own;
  }
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  const quality = m.quality ?? "best";
  try {
    await load(m.id, quality);
    if (m.type === "load") {
      post({ id: m.id, type: "ready", ...loaded });
      return;
    }
    let out: { audio: Float32Array; rate: number };
    try {
      out = await generate(m.text, m.voice, m.speed);
    } catch (err) {
      // A GPU that loads but cannot run the model: once more on the CPU.
      if (loaded?.device !== "webgpu") throw err;
      gpuBroken = true;
      tts = null;
      await load(m.id, quality);
      out = await generate(m.text, m.voice, m.speed);
    }
    post({ id: m.id, type: "audio", audio: out.audio, rate: out.rate, device: loaded?.device, dtype: loaded?.dtype }, [out.audio.buffer]);
  } catch (err) {
    post({ id: m.id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
