// Captions in the app: generate (local Whisper), import and export SRT/VTT,
// restyle all at once. Results land through the add_captions command, so a
// person, the auto-captioner and an agent with its own transcript all
// produce the same clips.

import { transcribeTimeline, type TranscribeProgress } from "../engine/transcribe";
import { currentCaptions, DEFAULT_LINES, parseSubtitles, toSrt, toVtt, wordsToCaptions } from "../lib/captions";
import { runCommand } from "../lib/commands";
import type { TextStyle } from "../lib/project/types";
import { platform } from "../platform";
import { store } from "./store";
import { dismiss, toast, updateToast } from "./toast";
import { projectWork } from "./projectWork";

export { captionClips, currentCaptions } from "../lib/captions";

let running: AbortController | null = null;

export function cancelCaptions() {
  running?.abort();
}

const STAGE: Record<TranscribeProgress["stage"], string> = {
  mixing: "Preparing audio",
  downloading: "Downloading speech model (first time only)",
  transcribing: "Recognizing speech",
};

export async function generateCaptions(opts: { model: string; language: string | null; replace: boolean; oneWord?: boolean }, onProgress?: (s: TranscribeProgress) => void) {
  if (running) return;
  running = new AbortController();
  const signal = AbortSignal.any([running.signal, projectWork.signal()]);
  const id = toast("Preparing audio…", "progress");
  try {
    const words = await transcribeTimeline(
      store.get().project,
      opts,
      (s) => {
        onProgress?.(s);
        updateToast(id, { text: `${STAGE[s.stage]}…`, progress: s.progress });
      },
      signal,
    );
    signal.throwIfAborted();
    // One word at a time (CapCut's short-form style): no line can hold two.
    const caps = wordsToCaptions(words, opts.oneWord ? { ...DEFAULT_LINES, maxChars: 1, minDuration: 0.25 } : DEFAULT_LINES);
    if (!caps.length) {
      toast("No speech found in the timeline's audio", "info");
      return;
    }
    store.edit("Auto captions", (p) => runCommand(p, "add_captions", { captions: caps, replace: opts.replace }));
    toast(`Added ${caps.length} captions`);
  } catch (e) {
    if ((e as Error).name !== "AbortError") toast(captionsError(e), "error");
  } finally {
    dismiss(id);
    running = null;
  }
}

/** What went wrong, in words a user can act on. The usual failure is the
 * first-run model download (offline, blocked), which the browser reports
 * only as "Failed to fetch" (Chrome), "NetworkError…" (Firefox) or "Load
 * failed" (Safari). */
function captionsError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|networkerror|load failed/i.test(msg))
    return "Couldn't download the speech model. Check your internet connection and try again; after the first download, captions work offline.";
  return `Captions failed: ${msg}`;
}

export async function importCaptions(file: File) {
  const signal = projectWork.signal();
  const caps = parseSubtitles(await file.text());
  if (signal.aborted) return;
  if (!caps.length) {
    toast(`${file.name} has no captions this app can read (SRT or WebVTT)`, "error");
    return;
  }
  store.edit(`Import ${file.name}`, (p) => runCommand(p, "add_captions", { captions: caps }));
  toast(`Imported ${caps.length} captions`);
}

export async function exportCaptions(format: "srt" | "vtt") {
  const p = store.get().project;
  const caps = currentCaptions(p);
  if (!caps.length) return toast("There are no captions to export yet");
  const target = await platform.createExportTarget(p.name, format);
  if (!target) return;
  const bytes = new TextEncoder().encode(format === "srt" ? toSrt(caps) : toVtt(caps));
  const w = target.writable.getWriter();
  await w.write({ type: "write", data: bytes, position: 0 });
  await w.close();
  await target.reveal();
  toast(`Exported ${target.displayName}`);
}

/** Give every caption the same style (CapCut's "Apply to all"). */
export function styleAllCaptions(style: TextStyle, y: number) {
  store.edit("Style all captions", (p) => ({
    ...p,
    tracks: p.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => (c.type === "text" && c.caption ? { ...c, style: { ...style }, transform: { ...c.transform, y } } : c)),
    })),
  }));
}
