// Text to speech for a title (CapCut's Text to speech): speak its words in
// a chosen voice on this machine, save the voice as WAV and place it under
// the title, starting with it, as one undo step.

import { useSyncExternalStore } from "react";
import { speak } from "../engine/tts";
import { runCommand } from "../lib/commands";
import { findClip } from "../lib/project/ops";
import type { Id } from "../lib/project/types";
import { framesToSeconds } from "../lib/time";
import { DEFAULT_VOICE, speechText } from "../lib/tts";
import { encodeWav } from "../lib/wav";
import { edit } from "./actions";
import { adoptAndImport } from "./media";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { dismiss, toast, updateToast } from "./toast";

let running: { clipId: Id; progress: number; abort: AbortController } | null = null;
const listeners = new Set<() => void>();
const set = (r: typeof running) => {
  running = r;
  listeners.forEach((l) => l());
};
export const useSpeaking = () => useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => running);
export const cancelSpeech = () => running?.abort.abort();

export async function textToSpeech(clipId?: Id, opts: { voice?: string; speed?: number } = {}): Promise<{ clipId: Id; seconds: number }> {
  if (running) throw new Error("A voice is already being made");
  const p = store.get().project;
  const id = clipId ?? store.get().selection[0];
  const loc = id ? findClip(p, id) : null;
  if (!loc || loc.clip.type !== "text") throw new Error("Select a title to speak");
  const text = speechText(loc.clip.text);
  if (!text) throw new Error("The title has no words to speak");
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, projectWork.signal()]);
  const tid = toast("Making the voice", "progress");
  set({ clipId: loc.clip.id, progress: 0, abort });
  try {
    const progress = (x: number) => {
      updateToast(tid, { progress: x });
      if (running) set({ ...running, progress: x });
    };
    // The first run downloads the model (about 90 MB); then it is cached.
    const { audio, rate } = await speak(text, opts.voice ?? DEFAULT_VOICE, opts.speed ?? 1, (x) => progress(x * 0.9), signal);
    signal.throwIfAborted();
    const name = `Speech - ${text.slice(0, 32).replace(/[^\w ,.'-]+/g, "").trim() || "title"}.wav`;
    const [asset] = await adoptAndImport([new File([encodeWav([audio], rate)], name, { type: "audio/wav" })]);
    signal.throwIfAborted();
    const at = findClip(store.get().project, loc.clip.id)?.clip.start ?? loc.clip.start;
    let placed = "";
    edit("Text to speech", (q) => {
      const before = new Set(q.tracks.flatMap((t) => t.clips.map((c) => c.id)));
      const next = runCommand(q, "add_media_clip", { asset_id: asset.id, start: framesToSeconds(at, q.fps) });
      placed = next.tracks.flatMap((t) => t.clips).find((c) => !before.has(c.id))?.id ?? "";
      return next;
    });
    toast(`Added the voice, ${(audio.length / rate).toFixed(1)} s`);
    return { clipId: placed, seconds: audio.length / rate };
  } catch (e) {
    if (signal.aborted) toast("Canceled");
    else toast(`The voice was not made: ${(e as Error).message || e}`, "error");
    throw e;
  } finally {
    dismiss(tid);
    set(null);
  }
}
