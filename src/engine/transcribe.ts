// Auto captions: mix the timeline's sound to 16 kHz mono (the same
// scheduler export uses, so captions match what you hear), cut it at quiet
// moments into ~28 s windows, and run each through the Whisper worker.
// Everything runs on this machine; only the model weights are downloaded,
// once.

import { quietCuts, rms10ms, type Word } from "../lib/captions";
import { projectDuration } from "../lib/project/ops";
import type { Project } from "../lib/project/types";
import { framesToSeconds } from "../lib/time";
import { workerRequest } from "../lib/workerRequest";
import { scheduleAudio } from "./audio";

export interface AsrModel {
  id: string;
  label: string;
  /** Approximate first-use download. */
  size: string;
  englishOnly?: boolean;
}

// The `_timestamped` exports carry the cross-attention outputs word
// timestamps need (research §7.1).
export const ASR_MODELS: AsrModel[] = [
  { id: "onnx-community/whisper-tiny.en_timestamped", label: "Fast (English)", size: "41 MB", englishOnly: true },
  { id: "onnx-community/whisper-base.en_timestamped", label: "Balanced (English)", size: "77 MB", englishOnly: true },
  { id: "onnx-community/whisper-small.en_timestamped", label: "Accurate (English)", size: "249 MB", englishOnly: true },
  { id: "onnx-community/whisper-base_timestamped", label: "Balanced (any language)", size: "77 MB" },
  { id: "onnx-community/whisper-small_timestamped", label: "Accurate (any language)", size: "249 MB" },
];

const RATE = 16000;

/** The timeline's audible mix as 16 kHz mono, rendered in 5-minute windows so
 * a long timeline never allocates one huge OfflineAudioContext. */
export async function timelineAudio16k(p: Project, from = 0, to?: number, signal?: AbortSignal): Promise<Float32Array> {
  const end = to ?? framesToSeconds(projectDuration(p), p.fps);
  const out = new Float32Array(Math.ceil((end - from) * RATE));
  const WINDOW = 300;
  for (let t = from; t < end; t += WINDOW) {
    if (signal?.aborted) throw new DOMException("Canceled", "AbortError");
    const len = Math.min(WINDOW, end - t);
    const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: Math.ceil(len * RATE), sampleRate: RATE });
    const sched = scheduleAudio(ctx, ctx.destination, p, t, t + len, 0);
    await sched.done;
    const buf = await ctx.startRendering();
    out.set(buf.getChannelData(0), Math.round((t - from) * RATE));
  }
  return out;
}

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  worker ??= new Worker(new URL("./asr.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

async function call<T>(msg: Record<string, unknown>, onDownload?: (p: number) => void, transfer: Transferable[] = [], signal?: AbortSignal): Promise<T> {
  const w = getWorker();
  const id = nextId++;
  try {
    return await workerRequest<T>(w, { ...msg, id }, { onDownload, transfer, signal });
  } catch (e) {
    // Failed imports and canceled inference cannot keep a reusable worker.
    w.terminate();
    if (worker === w) worker = null;
    throw e;
  }
}

export interface TranscribeProgress {
  stage: "mixing" | "downloading" | "transcribing";
  /** 0..1 within the stage. */
  progress: number;
}

/** Recognize the timeline's speech; words come back in timeline seconds. */
export async function transcribeTimeline(
  p: Project,
  opts: { model: string; language: string | null },
  onProgress: (s: TranscribeProgress) => void,
  signal?: AbortSignal,
): Promise<Word[]> {
  onProgress({ stage: "mixing", progress: 0 });
  const pcm = await timelineAudio16k(p, 0, undefined, signal);
  onProgress({ stage: "downloading", progress: 0 });
  await call({ type: "load", model: opts.model }, (x) => onProgress({ stage: "downloading", progress: x }), [], signal);
  const total = pcm.length / RATE;
  const bounds = [0, ...quietCuts(rms10ms(pcm, RATE), total), total];
  const words: Word[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    if (signal?.aborted) throw new DOMException("Canceled", "AbortError");
    onProgress({ stage: "transcribing", progress: i / (bounds.length - 1) });
    const a = Math.round(bounds[i] * RATE);
    const b = Math.round(bounds[i + 1] * RATE);
    const slice = pcm.slice(a, b);
    // Skip silent windows: Whisper hallucinates text ("Thank you.") on silence.
    let peak = 0;
    for (let j = 0; j < slice.length; j += 32) peak = Math.max(peak, Math.abs(slice[j]));
    if (peak < 0.01) continue;
    const r = await call<{ words: Word[] }>({ type: "transcribe", audio: slice, language: opts.language, offset: bounds[i] }, undefined, [slice.buffer], signal);
    words.push(...r.words);
  }
  onProgress({ stage: "transcribing", progress: 1 });
  return words;
}
