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
import { merge, missing, wordRanges, wordsIn, type Heard } from "../lib/transcript";
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
  return [c.in, ops.sourceTimeAt(c, c.start + c.duration, p.fps)];
}

/** The words a clip plays, or null when it has not been heard yet. */
export function clipWords(p: Project, c: SpeechClip): Word[] | null {
  const h = heard.get(c.assetId);
  const [from, to] = windowOf(c, p);
  return h && !missing(h, from, to) ? wordsIn(h.words, from, to) : null;
}

/** The timeline frame a word of `c` starts at. */
export const wordFrame = (p: Project, c: SpeechClip, w: Word) => Math.max(c.start, frameOfSource(c, w.start, p.fps));

/** Hear every clip of `track` not heard yet. */
export async function transcribeTrack(trackId: Id) {
  if (busy) return;
  busy = new AbortController();
  const signal = AbortSignal.any([busy.signal, projectWork.signal()]);
  changed();
  const id = toast("Listening…", "progress");
  try {
    const p = store.get().project;
    const track = ops.findTrack(p, trackId);
    const todo = track ? speechClips(p, track).filter((c) => !clipWords(p, c)) : [];
    for (const [k, c] of todo.entries()) {
      const asset = ops.getAsset(p, c.assetId)!;
      const [from, to] = windowOf(c, p);
      const gap = missing(heard.get(c.assetId), from, to);
      if (!gap) continue;
      const step = (x: number) => updateToast(id, { progress: (k + x) / todo.length });
      const pcm = await decodeMono(asset, gap.start, gap.end, 16000, (x) => step(x * 0.2), signal);
      const words = await transcribePcm(
        pcm,
        gap.start,
        { model: TRANSCRIPT_MODEL, language: null },
        (s) => {
          updateToast(id, { text: s.stage === "downloading" ? "Downloading the speech model…" : `Listening to ${asset.name}…` });
          step(0.2 + 0.8 * (s.stage === "transcribing" ? s.progress : 0));
        },
        signal,
      );
      heard.set(c.assetId, merge(heard.get(c.assetId), gap.start, gap.end, words));
      changed();
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
export async function clipTranscript(clipId: Id): Promise<{ clipId: Id; words: Word[] }> {
  const loc = ops.findClip(store.get().project, clipId);
  if (!loc || (loc.clip.type !== "video" && loc.clip.type !== "audio")) throw new Error("Select a video or audio clip with speech");
  await transcribeTrack(loc.track.id);
  const p = store.get().project;
  const c = ops.findClip(p, clipId)?.clip as SpeechClip | undefined;
  return { clipId, words: (c && clipWords(p, c)) ?? [] };
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
