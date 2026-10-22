// Captions in the app: generate (local Whisper), import and export SRT/VTT,
// restyle all at once. Results land through the add_captions command, so a
// person, the auto-captioner and an agent with its own transcript all
// produce the same clips.

import { transcribeTimeline, type TranscribeProgress } from "../engine/transcribe";
import { captionReading, currentCaptions, type Caption, DEFAULT_LINES, parseSubtitles, toSrt, toVtt, readableCaptions, wordsToCaptions } from "../lib/captions";
import { runCommand } from "../lib/commands";
import { trackRole, assetsOf } from "../lib/audioRoles";
import { timelineWords } from "../lib/transcript";
import * as ops from "../lib/project/ops";
import { framesToSeconds } from "../lib/time";
import { clipWords, hearAsset, speechClips } from "./transcript";
import { withScripts } from "../lib/scriptWords";
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
    const project = store.get().project;
    const heard = await transcribeTimeline(
      project,
      opts,
      (s) => {
        onProgress?.(s);
        updateToast(id, { text: `${STAGE[s.stage]}…`, progress: s.progress });
      },
      signal,
    );
    signal.throwIfAborted();
    // A voice line read from a script (add_voiceover, text to speech) says
    // its script: Whisper only times it (ADR-092).
    const words = withScripts(project, heard);
    // One word at a time (CapCut's short-form style): no line can hold two.
    const caps = opts.oneWord ? wordsToCaptions(words, { ...DEFAULT_LINES, maxChars: 1, minDuration: 0.25 }) : readableCaptions(words, DEFAULT_LINES, framesToSeconds(ops.projectDuration(project), project.fps));
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

/** Agent captions use the same source hearing as transcript editing, then
 * map each piece separately: no caption spans a removed source window. */
export async function autoCaptions(_target: string, opts: { replace?: boolean; words_per_caption?: number; start?: number; end?: number; style?: Partial<TextStyle>; y?: number; look?: string; model?: string; language?: string; track_ids?: string[]; detail?: string } = {}) {
  const p = store.get().project, signal = projectWork.signal();
  const end = opts.end ?? framesToSeconds(ops.projectDuration(p), p.fps), start = opts.start ?? 0;
  if (opts.end !== undefined && end <= start) throw new Error("end must be after start");
  for (const id of opts.track_ids ?? []) if (!ops.findTrack(p, id)) throw new Error(`No track with id ${id}`);
  const tracks = p.tracks.filter((t) => !t.muted && (opts.track_ids ? opts.track_ids.includes(t.id) : !["music", "effects"].includes(trackRole(t, assetsOf(p)) ?? "")));
  const clips = tracks.flatMap((t) => speechClips(p, t)).filter((c) => !c.disabled && c.volume > 0 && framesToSeconds(c.start, p.fps) < end && framesToSeconds(c.start + c.duration, p.fps) > start);
  if (!clips.length) throw new Error("Nothing on the selected timeline tracks has speech (muted, reversed and speed-curved clips are excluded)");
  const language = opts.language === "English" ? "en" : opts.language ?? "en";
  const model = opts.model ?? (language === "en" || language === "english" ? undefined : "onnx-community/whisper-base_timestamped");
  // The default English model (base.en) refuses a language: name one only
  // for a multilingual model.
  const english = model === undefined || /\.en(_|$)/.test(model);
  const caps: Caption[] = [];
  let heard = 0;
  for (const c of clips) {
    await hearAsset(p, c.assetId, { model, language: english ? null : language }, signal);
    const words = timelineWords(p, c, clipWords(p, c) ?? [], start, end);
    heard += words.length;
    const limit = Math.min(end, framesToSeconds(c.start + c.duration, p.fps));
    caps.push(...(opts.words_per_caption ? wordsToCaptions(words, { ...DEFAULT_LINES, maxWords: opts.words_per_caption, minDuration: 0.25 }).map(x => ({ ...x, end: Math.min(x.end, limit) })) : readableCaptions(words, DEFAULT_LINES, limit)));
  }
  signal.throwIfAborted();
  if (store.get().project !== p) throw new Error("The project changed while listening; run auto_captions again");
  if (!caps.length) throw new Error("No speech found on the selected timeline tracks");
  caps.sort((a, b) => a.start - b.start);
  const old = new Set(p.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  store.edit("Auto captions", (q) => {
    let next = runCommand(q, "add_captions", { captions: caps, replace: opts.replace !== false });
    const fresh = { ...next, tracks: next.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !old.has(c.id)) })) };
    const args = { ...(opts.look ? { look: opts.look } : {}), ...(opts.style ? { style: opts.style } : {}), ...(opts.y !== undefined ? { y: opts.y } : {}) };
    if (Object.keys(args).length) {
      const styled = runCommand(fresh, "set_caption_look", args);
      const made = new Map(styled.tracks.flatMap((t) => t.clips.map((c) => [c.id, c] as const)));
      next = { ...next, tracks: next.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => made.get(c.id) ?? c) })) };
    }
    return next;
  });
  const made = store.get().project.tracks.flatMap((t) => t.clips.filter((c) => !old.has(c.id) && c.type === "text" && c.caption).map((c) => ({ id: c.id, track_id: t.id, text: c.type === "text" ? c.text : "", start: framesToSeconds(c.start, p.fps), end: framesToSeconds(c.start + c.duration, p.fps) }))).sort((a, b) => a.start - b.start);
  const brief = ({ text, start, end }: typeof made[number]) => ({ text, start: +start.toFixed(3), end: +end.toFixed(3) });
  const unreadable = made.filter(c => !captionReading(c).met).map(c => ({ ...brief(c), characters_per_second: +captionReading(c).cps.toFixed(1) }));
  const readability = opts.words_per_caption ? undefined : { met: !unreadable.length, ...(unreadable.length ? { findings: unreadable, note: "Some cues still miss the reading-time rule; review these cues and shorten the text or extend the available time." } : {}) };
  return { readability, count: made.length, track_id: made[0].track_id, first: brief(made[0]), last: brief(made.at(-1)!), seconds: +made.reduce((n, c) => n + c.end - c.start, 0).toFixed(3), words: heard, ...(opts.detail === "full" ? { captions: made.map(brief) } : {}) };
}
