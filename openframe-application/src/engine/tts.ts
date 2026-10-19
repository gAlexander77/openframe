// Text to speech on this machine (CapCut's Text to speech, ADR-050): the
// Kokoro worker turns words into a voice; the caller saves it as WAV and
// places it. Only the model weights are downloaded, once.

import { workerRequest } from "../lib/workerRequest";
import type { Quality } from "./tts.worker";

export type { Quality };

let worker: Worker | null = null;
let nextId = 1;

export interface Spoken {
  audio: Float32Array;
  rate: number;
  /** Where it ran and at what precision (ADR-084). */
  device?: string;
  dtype?: string;
}

/** Speak `text` in `voice` (or a blend, "af_heart:60,af_bella:40") at
 * `speed` (1 = natural), at `quality` (default best). */
export async function speak(
  text: string,
  voice: string,
  speed: number,
  onDownload?: (progress: number) => void,
  signal?: AbortSignal,
  quality: Quality = "best",
): Promise<Spoken> {
  worker ??= new Worker(new URL("./tts.worker.ts", import.meta.url), { type: "module" });
  const w = worker;
  try {
    return await workerRequest(w, { id: nextId++, type: "speak", text, voice, speed, quality }, { onDownload, signal });
  } catch (e) {
    // A failed load or a canceled generation cannot keep a reusable worker.
    w.terminate();
    if (worker === w) worker = null;
    throw e;
  }
}
