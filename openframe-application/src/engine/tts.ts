// Text to speech on this machine (CapCut's Text to speech, ADR-050): the
// Kokoro worker turns words into a voice; the caller saves it as WAV and
// places it. Only the model weights are downloaded, once.

import { workerRequest } from "../lib/workerRequest";

let worker: Worker | null = null;
let nextId = 1;

/** Speak `text` in `voice` at `speed` (1 = natural). */
export async function speak(
  text: string,
  voice: string,
  speed: number,
  onDownload?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<{ audio: Float32Array; rate: number }> {
  worker ??= new Worker(new URL("./tts.worker.ts", import.meta.url), { type: "module" });
  const w = worker;
  try {
    return await workerRequest(w, { id: nextId++, type: "speak", text, voice, speed }, { onDownload, signal });
  } catch (e) {
    // A failed load or a canceled generation cannot keep a reusable worker.
    w.terminate();
    if (worker === w) worker = null;
    throw e;
  }
}
