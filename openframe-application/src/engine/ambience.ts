// The ambience worker (ambience.worker.ts), from the main thread: one bed
// at a time, canceled with its signal.

import { workerRequest } from "../lib/workerRequest";

let worker: Worker | null = null;
let nextId = 1;

async function call<T>(message: Record<string, unknown>, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<T> {
  worker ??= new Worker(new URL("./ambience.worker.ts", import.meta.url), { type: "module" });
  const w = worker;
  try {
    return await workerRequest<T>(w, { id: nextId++, ...message }, { onDownload: onProgress, signal });
  } catch (e) {
    // A canceled bed cannot be stopped mid-loop: start a fresh worker.
    w.terminate();
    if (worker === w) worker = null;
    throw e;
  }
}

/** Bed `bed` as a stereo WAV file at `rate`. */
export const renderBedFile = (bed: string, seconds: number, seed: number, rate: number, onProgress?: (p: number) => void, signal?: AbortSignal) =>
  call<{ wav: Uint8Array<ArrayBuffer> }>({ bed, seconds, seed, rate }, onProgress, signal);

/** Its samples, for a preview. */
export const renderBedPcm = (bed: string, seconds: number, seed: number, rate: number, signal?: AbortSignal) =>
  call<{ left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> }>({ bed, seconds, seed, rate, pcm: true }, undefined, signal);
