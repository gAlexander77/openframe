import { modelWorker } from "./modelWorker";
// The score generator's worker, from the main thread (music.worker.ts):
// one render at a time, canceled with its signal.

import type { MusicRequest } from "../lib/music/arrange";
import { workerRequest } from "../lib/workerRequest";

export interface Measured {
  lufs: number;
  true_peak_dbtp: number;
  sample_peak_dbfs: number;
  plr: number;
  correlation: number;
  clipped: number;
  low: number;
  mid: number;
  high: number;
  slope_db_per_octave: number;
  gain_db: number;
  compression_db: number;
  limiting_db: number;
  /** The master tilt the render used (-1..1; the answer fills it in). */
  brightness?: number;
}

const managed = modelWorker("worker_music", () => new Worker(new URL("./music.worker.ts", import.meta.url), { type: "module" }));
let nextId = 1;

async function call<T>(message: Record<string, unknown>, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<T> {
  return managed.run("synthesis", 0, (worker, active) =>
    workerRequest<T>(worker, { id: nextId++, ...message }, { onDownload: onProgress, signal: active }), signal);
}

/** The score as WAV files: the mix, and the four stems when asked. */
export const renderMusicFiles = (request: MusicRequest, o: { stems: boolean; loudness: number }, onProgress?: (p: number) => void, signal?: AbortSignal) =>
  call<{ mix: Uint8Array<ArrayBuffer>; stems: Record<string, Uint8Array<ArrayBuffer>> | null; measured: Measured }>({ request, stems: o.stems, loudness: o.loudness }, onProgress, signal);

/** The score's samples, for a preview. */
export const renderMusicPcm = (request: MusicRequest, loudness: number, onProgress?: (p: number) => void, signal?: AbortSignal) =>
  call<{ rate: number; left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer>; measured: Measured }>({ request, stems: false, loudness, pcm: true }, onProgress, signal);
