import { modelWorker } from "./modelWorker";
import { MiB } from "./memory";
// Text to speech on this machine (CapCut's Text to speech, ADR-050): the
// Kokoro worker turns words into a voice; the caller saves it as WAV and
// places it. Only the model weights are downloaded, once.

import { workerRequest } from "../lib/workerRequest";
import type { Quality } from "./tts.worker";

export type { Quality };

const ttsWorker = modelWorker("model_kokoro", () => new Worker(new URL("./tts.worker.ts", import.meta.url), { type: "module" }));
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
  return ttsWorker.run(quality, (quality === "best" ? 512 : 128) * MiB, (worker, active) =>
    workerRequest(worker, { id: nextId++, type: "speak", text, voice, speed, quality }, { onDownload, signal: active }), signal);
}
