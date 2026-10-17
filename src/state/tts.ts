// Text to speech for a title (CapCut's Text to speech): speak its words in
// a chosen voice on this machine, save the voice as WAV and place it under
// the title, starting with it, as one undo step.

import { useSyncExternalStore } from "react";
import { speak } from "../engine/tts";
import { runCommand } from "../lib/commands";
import { createTrack } from "../lib/project/defaults";
import { addTrack, findClip } from "../lib/project/ops";
import type { Id, Project, TextStyle } from "../lib/project/types";
import { framesToSeconds, secondsToFrames } from "../lib/time";
import { DEFAULT_VOICE, layoutLines, speechFileName, speechText } from "../lib/tts";
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
    const [asset] = await adoptAndImport([new File([encodeWav([audio], rate)], speechFileName(text), { type: "audio/wav" })]);
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

export interface VoiceLine {
  text: string;
  /** Timeline seconds; default right after the line before. */
  at?: number;
}

export interface VoiceoverOptions {
  voice?: string;
  speed?: number;
  /** Where the first line starts (seconds), default 0. */
  start?: number;
  /** Seconds between lines, default 0.4. */
  gap?: number;
  /** A caption for each line, timed to its voice (default true). */
  captions?: boolean;
  captionStyle?: Partial<TextStyle>;
  captionY?: number;
}

/**
 * Narrate a script (MCP add_voiceover): every line spoken on this machine,
 * placed one after another at its real length on a new Voiceover track,
 * with a caption for each timed to its voice, as one undo step. Building
 * the RacePulse promo, voices ran longer than the slots planned for them
 * and every line and caption had to be moved by hand; here the voice sets
 * the timing and the answer says where each line landed, so the footage
 * can be cut to it.
 */
export async function voiceover(lines: VoiceLine[], opts: VoiceoverOptions = {}) {
  if (running) throw new Error("A voice is already being made");
  const texts = lines.map((l) => speechText(l.text));
  if (!texts.length || texts.some((t) => !t)) throw new Error("Every line needs words to speak");
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, projectWork.signal()]);
  const tid = toast(`Making the voiceover: ${texts.length} lines`, "progress");
  set({ clipId: "", progress: 0, abort });
  try {
    const files: File[] = [], seconds: number[] = [];
    for (const [i, text] of texts.entries()) {
      // ponytail: lines are spoken one by one in the one speech worker; a long
      // script on a CPU can pass the desktop bridge's 300 s for one call.
      const { audio, rate } = await speak(text, opts.voice ?? DEFAULT_VOICE, opts.speed ?? 1, undefined, signal);
      signal.throwIfAborted();
      seconds.push(audio.length / rate);
      files.push(new File([encodeWav([audio], rate)], speechFileName(text), { type: "audio/wav" }));
      updateToast(tid, { progress: (i + 1) / (texts.length + 1) });
    }
    const assets = await adoptAndImport(files);
    signal.throwIfAborted();
    const times = layoutLines(lines.map((l, i) => ({ at: l.at, seconds: seconds[i] })), opts.start ?? 0, opts.gap ?? 0.4);
    const placed: { text: string; start: number; end: number; voice_clip: string; caption_clip?: string }[] = [];
    edit("Voiceover", (q) => {
      placed.length = 0;
      const ids = (x: Project) => new Set(x.tracks.flatMap((t) => t.clips.map((c) => c.id)));
      const added = (before: Set<string>, x: Project) => x.tracks.flatMap((t) => t.clips).filter((c) => !before.has(c.id));
      const track = createTrack("audio", "Voiceover");
      q = addTrack(q, track);
      assets.forEach((asset, i) => {
        const before = ids(q);
        q = runCommand(q, "add_media_clip", { asset_id: asset.id, start: times[i].start, track_id: track.id });
        placed.push({ text: lines[i].text, ...times[i], voice_clip: added(before, q)[0]?.id ?? "" });
      });
      if (opts.captions !== false) {
        const before = ids(q);
        q = runCommand(q, "add_captions", {
          captions: lines.map((l, i) => ({ text: l.text, start: times[i].start, end: times[i].end })),
          ...(opts.captionStyle ? { style: opts.captionStyle } : {}),
          ...(opts.captionY !== undefined ? { y: opts.captionY } : {}),
        });
        const caps = added(before, q);
        placed.forEach((line) => (line.caption_clip = caps.find((c) => c.start === secondsToFrames(line.start, q.fps))?.id));
      }
      return q;
    });
    toast(`Added the voiceover, ${times.at(-1)!.end.toFixed(1)} s`);
    return { lines: placed, end: times.at(-1)!.end };
  } catch (e) {
    if (signal.aborted) toast("Canceled");
    else toast(`The voiceover was not made: ${(e as Error).message || e}`, "error");
    throw e;
  } finally {
    dismiss(tid);
    set(null);
  }
}
