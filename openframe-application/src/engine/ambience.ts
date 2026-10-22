import { modelWorker } from "./modelWorker";
// The ambience worker (ambience.worker.ts), from the main thread: one bed
// at a time, canceled with its signal.

import { workerRequest } from "../lib/workerRequest";

const managed = modelWorker("worker_ambience", () => new Worker(new URL("./ambience.worker.ts", import.meta.url), { type: "module" }));
let nextId = 1;

async function call<T>(message: Record<string, unknown>, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<T> {
  return managed.run("synthesis", 0, (worker, active) =>
    workerRequest<T>(worker, { id: nextId++, ...message }, { onDownload: onProgress, signal: active }), signal);
}

/** Bed `bed` as a stereo WAV file at `rate`. */
export const renderBedFile = (bed: string, seconds: number, seed: number, rate: number, onProgress?: (p: number) => void, signal?: AbortSignal) =>
  call<{ wav: Uint8Array<ArrayBuffer> }>({ bed, seconds, seed, rate }, onProgress, signal);

/** Its samples, for a preview. */
export const renderBedPcm = (bed: string, seconds: number, seed: number, rate: number, signal?: AbortSignal) =>
  call<{ left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> }>({ bed, seconds, seed, rate, pcm: true }, undefined, signal);
