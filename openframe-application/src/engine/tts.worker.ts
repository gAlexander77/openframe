// Text to speech off the main thread: Kokoro-82M (Apache-2.0) through
// kokoro-js, on WebGPU when the machine has it and WASM otherwise. The
// model downloads once from Hugging Face and is cached by the browser; the
// text never leaves the machine (ADR-050).

import { KokoroTTS } from "kokoro-js";

type Msg =
  | { id: number; type: "load" }
  | { id: number; type: "speak"; text: string; voice: string; speed: number };

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
let tts: KokoroTTS | null = null;
let device = "wasm";

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

async function load(id: number) {
  if (tts) return;
  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  const gpu = nav.gpu ? await nav.gpu.requestAdapter().catch(() => null) : null;
  device = gpu ? "webgpu" : "wasm";
  const files = new Map<string, number>();
  tts = await KokoroTTS.from_pretrained(MODEL, {
    // q8 is a fifth the size and fast on the CPU; WebGPU wants fp32.
    dtype: gpu ? "fp32" : "q8",
    device: device as "webgpu" | "wasm",
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === "progress" && p.file && p.total) {
        files.set(p.file, (p.loaded ?? 0) / p.total);
        const vals = [...files.values()];
        post({ id, type: "download", progress: vals.reduce((a, b) => a + b, 0) / vals.length });
      }
    },
  } as never);
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    await load(m.id);
    if (m.type === "load") {
      post({ id: m.id, type: "ready", device });
      return;
    }
    const out = await tts!.generate(m.text, { voice: m.voice as never, speed: m.speed });
    const audio = out.audio as Float32Array;
    post({ id: m.id, type: "audio", audio, rate: out.sampling_rate }, [audio.buffer]);
  } catch (err) {
    post({ id: m.id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
