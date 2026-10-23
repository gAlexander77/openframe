import { memoryOwners } from "../engine/memory";
import { retainedBytes } from "../lib/memory";
// Edit by transcript (Premiere's Text-Based Editing, CapCut's transcript
// editing): what each clip on a track says, heard on this machine by
// Whisper, and deleting words as cuts. Words are kept per asset in source
// seconds, so the pieces of a clip cut by an edit read on without hearing
// it again. Session state: never in the project.

import { useSyncExternalStore } from "react";
import { decodeMono } from "../engine/analyze";
import { transcribePcm } from "../engine/transcribe";
import type { Word } from "../lib/captions";
import { runCommand } from "../lib/commands";
import { frameOfSource } from "../lib/project/cut";
import * as ops from "../lib/project/ops";
import type { Clip, Id, Project, Track } from "../lib/project/types";
import { merge, missing, speechWindow, wordRanges, wordsIn, type Heard } from "../lib/transcript";
import { assetWords } from "../lib/scriptWords";
import { edit } from "./actions";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { dismiss, toast, updateToast } from "./toast";

/** Base keeps "um" and runs at a third of small's download. */
export const TRANSCRIPT_MODEL = "onnx-community/whisper-base.en_timestamped";

const heard = new Map<Id, Heard>();
let version = 0;
let busy: AbortController | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
/** Re-render when words arrive or a run starts or stops. */
export const useTranscriptVersion = () => useSyncExternalStore(subscribe, () => version);
export const transcribing = () => !!busy;

export type SpeechClip = Extract<Clip, { type: "video" | "audio" }>;

/** Clips a transcript covers: media with sound, at plain speed, unmuted.
 * ponytail: speed curves and reverse map source to timeline unevenly;
 * those clips are left out rather than shown misaligned. */
export function speechClips(p: Project, track: Track): SpeechClip[] {
  return track.clips
    .filter((c): c is SpeechClip => (c.type === "video" || c.type === "audio") && !c.muted && !c.freeze && !c.speedCurve && !c.reverse && !!ops.getAsset(p, c.assetId)?.hasAudio)
    .sort((a, b) => a.start - b.start);
}

/** Clips with sound the transcript leaves out (speed curve or reverse),
 * so the card can say so instead of dropping them silently. */
export function skippedClips(p: Project, track: Track): number {
  return track.clips.filter((c) => (c.type === "video" || c.type === "audio") && !c.muted && !c.freeze && (!!c.speedCurve || !!c.reverse) && !!ops.getAsset(p, c.assetId)?.hasAudio).length;
}

/** A clip's source window [from, to) in seconds. */
function windowOf(c: SpeechClip, p: Project): [number, number] {
  return [c.in, Math.min(ops.getAsset(p, c.assetId)?.duration ?? Infinity, ops.sourceTimeAt(c, c.start + c.duration, p.fps))];
}

/** The words a clip plays, or null when it has not been heard yet. */
export function clipWords(p: Project, c: SpeechClip): Word[] | null {
  const h = heard.get(c.assetId);
  const [from, to] = windowOf(c, p);
  return h && !missing(h, from, to) ? wordsIn(h.words, from, to) : null;
}

/** The timeline frame a word of `c` starts at. */
export const wordFrame = (p: Project, c: SpeechClip, w: Word) => Math.max(c.start, frameOfSource(c, w.start, p.fps));

/** Model and language belong to the cached source windows. */
const models = new Map<Id, string>();
const languages = new Map<Id, string | null>();
let hearing: Promise<void> = Promise.resolve();
memoryOwners.register("transcript_words", () => ({ bytes: retainedBytes([heard, models, languages]), count: heard.size, estimated: true }), () => {
  heard.clear(); models.clear(); languages.clear(); busy?.abort(); hearing = Promise.resolve(); changed();
});
export interface Hearing { audio_seconds: number; elapsed_seconds: number; model: string; cached: boolean }

/** Highlight refinement and clip tools share the same window cache and ASR
 * queue. Words always remain in source seconds. */
export async function hearWindow(p: Project, assetId: Id, from: number, to: number, signal: AbortSignal, onProgress: (s: import("../engine/transcribe").TranscribeProgress) => void): Promise<Word[]> {
  await hearAsset(p, assetId, { from, to, model: TRANSCRIPT_MODEL, language: null }, signal, onProgress);
  return wordsIn(heard.get(assetId)?.words ?? [], from, to);
}
export async function hearAsset(p: Project, assetId: Id, opts: { model?: string; language?: string | null; from?: number; to?: number } = {}, signal = projectWork.capture(), onProgress: (s: import("../engine/transcribe").TranscribeProgress) => void = () => {}): Promise<Hearing> {
  const started = performance.now();
  const asset = ops.getAsset(p, assetId);
  if (!asset?.hasAudio) throw new Error("The media has no speech audio");
  const from = Math.max(0, opts.from ?? 0), to = Math.min(asset.duration, opts.to ?? asset.duration);
  const model = opts.model ?? models.get(assetId) ?? TRANSCRIPT_MODEL;
  const language = opts.language === undefined ? languages.get(assetId) ?? null : opts.language;
  const task = hearing.catch(() => {}).then(async () => {
    signal.throwIfAborted();
    const compatible = models.get(assetId) === model && (languages.get(assetId) ?? "en") === (language ?? "en");
    if (compatible && !missing(heard.get(assetId), from, to)) return { audio_seconds: 0, elapsed_seconds: (performance.now() - started) / 1000, model, cached: true };
    const words: Word[] = [];
    let audioSeconds = 0;
    // Keep at most 62 s of PCM, even for get_transcript on a multi-hour VOD.
    // The overlap supplies word context; each word belongs to one window.
    for (let at = from; at < to; at += 60) {
      signal.throwIfAborted();
      const lo = Math.max(from, at - 1), hi = Math.min(to, at + 61);
      const pcm = await decodeMono(asset, lo, hi, 16000, progress => onProgress({ stage: "mixing", progress }), signal);
      audioSeconds += pcm.length / 16000;
      const result = await transcribePcm(pcm, lo, { model, language }, onProgress, signal);
      words.push(...result.filter(w => w.start >= at && w.start < Math.min(to, at + 60)));
    }
    signal.throwIfAborted();
    heard.set(assetId, merge(compatible ? heard.get(assetId) : undefined, from, to, assetWords(p, assetId, from, to, words)));
    models.set(assetId, model); languages.set(assetId, language); changed();
    return { audio_seconds: audioSeconds, elapsed_seconds: (performance.now() - started) / 1000, model, cached: false };
  });
  hearing = task.then(() => {}, () => {});
  // Cancel promptly while queued; the queued task checks again before ASR.
  return new Promise<Hearing>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function hearClip(p: Project, c: SpeechClip, opts: { model?: string; language?: string | null; start?: number; end?: number } = {}, signal = projectWork.capture(), onProgress: (s: import("../engine/transcribe").TranscribeProgress) => void = () => {}) {
  const [from, to] = speechWindow(p, c, opts.start, opts.end);
  const hearing = await hearAsset(p, c.assetId, { ...opts, model: opts.model ?? TRANSCRIPT_MODEL, language: opts.language ?? null, from, to }, signal, onProgress);
  return { ...hearing, words: wordsIn(heard.get(c.assetId)?.words ?? [], c.in, ops.sourceTimeAt(c, c.start + c.duration, p.fps)) };
}

/** Hear every clip of `track` not heard yet. */
export async function transcribeTrack(trackId: Id) {
  if (busy) return;
  busy = new AbortController();
  const signal = AbortSignal.any([busy.signal, projectWork.capture()]);
  changed();
  const id = toast("Listening…", "progress", undefined, { label: "Cancel", run: cancelTranscript });
  try {
    const p = store.get().project;
    const track = ops.findTrack(p, trackId);
    const todo = track ? speechClips(p, track).filter((c) => !clipWords(p, c)) : [];
    for (const [k, c] of todo.entries()) {
      const asset = ops.getAsset(p, c.assetId)!;
      await hearClip(p, c, {}, signal, (s) => {
        updateToast(id, { text: s.stage === "downloading" ? "Downloading the speech model\u2026" : `Listening to ${asset.name}\u2026`, progress: (k + s.progress) / todo.length });
      });
    }
  } catch (e) {
    if (!signal.aborted) toast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    dismiss(id);
    busy = null;
    changed();
  }
}

export const cancelTranscript = () => busy?.abort();

/** For agents: hear the clip's track if needed and return the clip's words
 * in source seconds, ready for cut_ranges. */
export async function clipTranscript(clipId: Id, opts: { model?: string } = {}) {
  const signal = projectWork.capture();
  const notice = toast("Listening to clip\u2026", "progress");
  try {
    const loc = ops.findClip(store.get().project, clipId);
    if (!loc || (loc.clip.type !== "video" && loc.clip.type !== "audio")) throw new Error("Select a video or audio clip with speech");
    const hearing = await hearClip(store.get().project, loc.clip, opts, signal, s => updateToast(notice, { progress: s.progress, text: `${s.stage} speech\u2026` }));
    signal.throwIfAborted();
    const p = store.get().project;
    const c = ops.findClip(p, clipId)?.clip as SpeechClip | undefined;
    return { clipId, ...hearing, words: (c && clipWords(p, c)) ?? [] };
  } finally { dismiss(notice); }
}

/** Cut the chosen words (by clip and index into clipWords) and close the
 * gaps, as one undo step. */
export function deleteWords(picks: Map<Id, Set<number>>) {
  const p = store.get().project;
  let n = 0;
  const cuts: { id: Id; ranges: { start: number; end: number }[] }[] = [];
  for (const [id, idx] of picks) {
    const c = ops.findClip(p, id)?.clip as SpeechClip | undefined;
    const words = c && clipWords(p, c);
    if (!c || !words || !idx.size) continue;
    const [from, to] = windowOf(c, p);
    const ranges = wordRanges(words, (_, i) => idx.has(i))
      .map((r) => ({ start: Math.max(r.start, from), end: Math.min(r.end, to) }))
      .filter((r) => r.end > r.start);
    if (ranges.length) cuts.push({ id, ranges });
    n += idx.size;
  }
  if (!cuts.length) return;
  edit(`Delete ${n} ${n === 1 ? "word" : "words"}`, (q) => cuts.reduce((r, x) => runCommand(r, "cut_ranges", { clip_id: x.id, ranges: x.ranges, ripple: true }), q));
}

/** Read only the already-heard source window; never queues speech work. */
export function cachedAssetWords(assetId: Id, from: number, to: number): Word[] | undefined {
  const h = heard.get(assetId);
  return h && !missing(h, from, to) ? wordsIn(h.words, from, to) : undefined;
}
