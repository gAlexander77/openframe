// Speech made on this machine: text to speech for a title (CapCut's Text to
// speech), a whole narrated script (MCP add_voiceover) and one line read
// again (retake_voiceover). Every line is read whole, a sentence at a time,
// so its intonation is the voice's own; pauses the script asks for lengthen
// the voice's own pauses (ADR-083); the take is finished to sit like a
// recorded read (ADR-084). Each edit adds its speech files with its clips,
// so one undo leaves nothing behind in the library.

import { useSyncExternalStore } from "react";
import { voiceSpeedReport } from "../lib/voiceSpeed";
import { speak, type Quality } from "../engine/tts";
import { dips, speechActivity } from "../lib/analysis/speech";
import { runCommand } from "../lib/commands";
import { createTrack } from "../lib/project/defaults";
import { addTrack, findClip } from "../lib/project/ops";
import type { Asset, Id, Project, SpeechInfo, TextStyle } from "../lib/project/types";
import { framesToSeconds, secondsToFrames } from "../lib/time";
import { checkVoice, DEFAULT_SPEED, DEFAULT_VOICE, speechFileName, speechText } from "../lib/tts";
import { retakeLine } from "../lib/voiceLines";
import { breaksOf, checkPronounce, chunkSentences, layoutLines, matchPauses, parseLine, pauseAfter, syllables } from "../lib/voiceScript";
import { finishTake, FINISHES, joinTakes, NATURAL_REVERB, resizePauses, type Finish, type FinishId } from "../lib/voiceTake";
import { encodeWav } from "../lib/wav";
import { edit } from "./actions";
import { adoptAndProbe, prepare } from "./media";
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

/** How a line is read; each defaults to the voiceover's own. */
export interface ReadOptions {
  voice?: string;
  speed?: number;
  pronounce?: Record<string, string>;
  /** best (full precision, the default) or draft (8-bit, quicker on a CPU). */
  quality?: Quality;
  /** natural (the default), clean or raw (lib/voiceTake.ts). */
  finish?: FinishId;
}

/** A line read and finished, ready to save. */
export interface Take {
  audio: Float32Array;
  rate: number;
  seconds: number;
  /** The words as written (the caption's), and what the voice was given. */
  written: string;
  spoken: string;
  /** Silence the script asks for before and after the line. */
  before: number;
  after: number;
  /** Each pause mark: how long, and whether the voice's own pause was
   * lengthened (stretched) or the line read in two parts (split). */
  pauses: { seconds: number; how: "stretched" | "split" }[];
  info: SpeechInfo;
  engine: { device?: string; dtype?: string };
  speedChosen?: boolean;
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

type Part = { audio: Float32Array; rate: number; first: number; last: number };

/** Two parts joined with `seconds` between their speech. */
function append(a: Part | null, b: Part, seconds: number): Part {
  if (!a) return b;
  const audio = joinTakes(a.audio, a.last, b.audio, b.first, b.rate, seconds);
  return { audio, rate: b.rate, first: a.first, last: audio.length / b.rate - (b.audio.length / b.rate - b.last) };
}

/**
 * Read one stretch of text (whole sentences) and set its pauses: the voice
 * pauses on its own at commas and sentence ends; a mark's pause lengthens
 * (or shortens) the one the voice made there, and the natural finish
 * lengthens pauses shorter than a reader's. When the voice ran through a
 * mark, that stretch is read again in two parts, the first ending on a
 * comma so its pitch stays up, and joined with the mark's silence.
 */
async function readPart(text: string, marks: { at: number; seconds: number }[], o: Required<Omit<ReadOptions, "pronounce">>, f: Finish, signal: AbortSignal, engine: Take["engine"], how: Take["pauses"]): Promise<Part> {
  const spoken = await speak(text, o.voice, o.speed, undefined, signal, o.quality);
  signal.throwIfAborted();
  engine.device = spoken.device;
  engine.dtype = spoken.dtype;
  const { rate } = spoken;
  let audio = spoken.audio;
  const act = speechActivity(audio, rate);
  if (!act) throw new Error(`The voice made no sound for "${text.slice(0, 40)}"`);
  const breaks = breaksOf(text).map((b) => ({ ...b, mark: marks.find((m) => Math.abs(b.at - m.at) <= 2)?.seconds }));
  const found = dips(audio, rate);
  const match = matchPauses(found, act.first, act.last, breaks.map((b) => b.share));
  const missed = breaks.filter((b, i) => b.mark !== undefined && match[i] < 0);
  if (missed.length) {
    // Read the parts on either side of each missed mark on their own.
    let out: Part | null = null;
    let from = 0, pause = 0;
    for (const cut of [...missed.map((b) => ({ at: b.at, seconds: b.mark! })), { at: text.length, seconds: 0 }]) {
      const raw = text.slice(from, cut.at);
      const lead = raw.length - raw.trimStart().length;
      const inner = marks.filter((m) => m.at > from && m.at < cut.at).map((m) => ({ at: m.at - from - lead, seconds: m.seconds }));
      out = append(out, await readPart(raw.trim(), inner, o, f, signal, engine, how), pause);
      from = cut.at;
      pause = cut.seconds;
    }
    missed.forEach((b) => how.push({ seconds: b.mark!, how: "split" }));
    return out!;
  }
  const runs: { start: number; end: number; seconds: number }[] = [];
  breaks.forEach((b, i) => {
    if (match[i] < 0) return;
    const p = found[match[i]];
    const want = b.mark ?? Math.max(p.end - p.start, b.sentence ? f.sentencePause : f.commaPause);
    if (b.mark !== undefined) how.push({ seconds: b.mark, how: "stretched" });
    if (Math.abs(want - (p.end - p.start)) > 0.005) runs.push({ ...p, seconds: want });
  });
  if (!runs.length) return { audio, rate, first: act.first, last: act.last };
  audio = resizePauses(audio, rate, runs);
  const now = speechActivity(audio, rate)!;
  return { audio, rate, first: now.first, last: now.last };
}

/** Syllables a second a voice may read a line at before the natural
 * finish reads it again slower: read speech runs about 4-5.5, and the
 * voice model rushes short lines (a six-word line came out at 6). */
export const RUSHED_SPS = 5.5;

/** Read a script line whole and finish it (ADR-083, ADR-084). With no
 * speed given, the natural finish reads a rushed line once more, slower
 * (at most a fifth), so it lands near 5 syllables a second. */
export async function readLine(text: string, o: ReadOptions, signal: AbortSignal): Promise<Take> {
  const opts = { voice: checkVoice(o.voice ?? DEFAULT_VOICE), speed: o.speed ?? DEFAULT_SPEED, quality: o.quality ?? "best", finish: o.finish ?? "natural" } as const;
  const f = FINISHES[opts.finish];
  const written = parseLine(text).written;
  // A title's lines are sentences of their own.
  const pronounce = checkPronounce(o.pronounce);
  const line = parseLine(speechText(text), pronounce);
  let spoken = line.spoken;
  if (!spoken || !/[\p{L}\p{N}]/u.test(spoken)) throw new Error("Every line needs words to speak");
  if (!/[.!?…,;:]$/.test(spoken)) spoken += ".";
  const engine: Take["engine"] = {};
  let how: Take["pauses"] = [];
  const read = async (speed: number): Promise<Part> => {
    how = [];
    // Sentences past the model's reach are read in groups, joined at a
    // sentence's end (or at the mark there).
    let out: Part | null = null;
    let from = 0;
    for (const chunk of chunkSentences(spoken)) {
      const at = spoken.indexOf(chunk, from);
      const end = at + chunk.length;
      const marks = line.pauses.filter((m) => m.at > at && m.at < end).map((m) => ({ at: m.at - at, seconds: m.seconds }));
      const boundary = out ? line.pauses.find((m) => m.at >= from && m.at <= at) : undefined;
      if (boundary) how.push({ seconds: boundary.seconds, how: "split" });
      out = append(out, await readPart(chunk, marks, { ...opts, speed }, f, signal, engine, how), boundary?.seconds ?? Math.max(f.sentencePause, 0.45));
      from = end;
    }
    return out!;
  };
  let speed: number = opts.speed;
  let out = await read(speed);
  if (opts.finish === "natural" && o.speed === undefined) {
    const sps = written.split(/\s+/).reduce((n, w) => n + syllables(w), 0) / Math.max(0.3, out.last - out.first);
    if (sps > RUSHED_SPS) {
      speed = +Math.max(opts.speed * 0.8, (opts.speed * 5) / sps).toFixed(2);
      out = await read(speed);
    }
  }
  const { audio } = finishTake(out.audio, out.rate, f, hash(text));
  const info: SpeechInfo = { text, voice: opts.voice, speed, quality: opts.quality, finish: opts.finish, ...(pronounce && Object.keys(pronounce).length ? { pronounce } : {}) };
  return { speedChosen: speed !== opts.speed, audio, rate: out.rate, seconds: audio.length / out.rate, written, spoken, before: line.before, after: line.after, pauses: how, info, engine };
}

/** The takes as probed assets carrying their scripts, not yet in the
 * project: the caller's edit adds them, so one undo removes them. */
async function takeAssets(takes: Take[], signal: AbortSignal): Promise<Asset[]> {
  const files = takes.map((t) => new File([encodeWav([t.audio], t.rate)], speechFileName(t.written), { type: "audio/wav" }));
  const assets = await adoptAndProbe(files);
  signal.throwIfAborted();
  if (assets.length !== takes.length) throw new Error("A speech file could not be read back");
  return assets.map((a, i) => ({ ...a, speech: takes[i].info }));
}

/** Clip settings the finish asks for (the compressor unless `enhance` is
 * false, and natural's touch of room). */
function finishClips(q: Project, ids: Id[], finish: FinishId, enhance: boolean | undefined): Project {
  if (enhance !== false && finish !== "raw") q = runCommand(q, "set_compressor", { clip_ids: ids, preset: "voice" });
  if (FINISHES[finish].reverb) q = runCommand(q, "set_reverb", { clip_ids: ids, preset: "room", ...NATURAL_REVERB });
  return q;
}

const ids = (x: Project) => new Set(x.tracks.flatMap((t) => t.clips.map((c) => c.id)));
const added = (before: Set<string>, x: Project) => x.tracks.flatMap((t) => t.clips).filter((c) => !before.has(c.id));

export async function textToSpeech(clipId?: Id, opts: ReadOptions = {}): Promise<{ clipId: Id; seconds: number }> {
  if (running) throw new Error("A voice is already being made");
  const p = store.get().project;
  const id = clipId ?? store.get().selection[0];
  const loc = id ? findClip(p, id) : null;
  if (!loc || loc.clip.type !== "text") throw new Error("Select a title to speak");
  if (!speechText(loc.clip.text)) throw new Error("The title has no words to speak");
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, projectWork.signal()]);
  const tid = toast("Making the voice", "progress");
  set({ clipId: loc.clip.id, progress: 0, abort });
  try {
    // The first run downloads the model; then it is cached.
    const take = await readLine(loc.clip.text, opts, signal);
    const [asset] = await takeAssets([take], signal);
    const at = findClip(store.get().project, loc.clip.id)?.clip.start ?? loc.clip.start;
    const finish = opts.finish ?? "natural";
    let placed = "";
    edit("Text to speech", (q) => {
      const before = ids(q);
      q = runCommand({ ...q, assets: [...q.assets, asset] }, "add_media_clip", { asset_id: asset.id, start: framesToSeconds(at, q.fps) });
      placed = added(before, q)[0]?.id ?? "";
      return placed ? finishClips(q, [placed], finish, undefined) : q;
    });
    prepare(asset);
    toast(`Added the voice, ${take.seconds.toFixed(1)} s`);
    return { clipId: placed, seconds: take.seconds };
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
  /** Words to say, with pause marks ([pause], [pause 0.4], [beat]). */
  text: string;
  /** Timeline seconds; default after the line before and its pause. */
  at?: number;
  /** What the caption shows, when it differs from the words spoken. */
  caption?: string;
  voice?: string;
  speed?: number;
  /** Seconds of silence before the next line (overrides `gap`). */
  pauseAfter?: number;
  /** The line ends a paragraph: a longer pause after it. */
  paragraph?: boolean;
}

export interface VoiceoverOptions extends ReadOptions {
  /** Where the first line starts (seconds), default 0. */
  start?: number;
  /** Seconds between every pair of lines; default by each line's ending. */
  gap?: number;
  /** A caption for each line, timed to its voice (default true). */
  captions?: boolean;
  captionStyle?: Partial<TextStyle>;
  captionY?: number;
  /** The Enhance voice compressor on each voice (default true): synthetic
   * voices peak far over their loudness. */
  enhance?: boolean;
}

/**
 * Narrate a script (MCP add_voiceover): every line read on this machine,
 * placed one after another at its real length on a new Voiceover track,
 * with a caption for each timed to its voice, as one undo step with the
 * speech files. Building the RacePulse promo, voices ran longer than the
 * slots planned for them and every line and caption had to be moved by
 * hand; here the voice sets the timing and the answer says where each
 * line landed, so the footage can be cut to it.
 */
export async function voiceover(lines: VoiceLine[], opts: VoiceoverOptions = {}) {
  if (running) throw new Error("A voice is already being made");
  if (!lines.length) throw new Error("Every line needs words to speak");
  for (const l of [opts, ...lines]) if (l.voice !== undefined) checkVoice(l.voice);
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, projectWork.signal()]);
  const tid = toast(`Making the voiceover: ${lines.length} lines`, "progress");
  set({ clipId: "", progress: 0, abort });
  try {
    const takes: Take[] = [];
    for (const [i, l] of lines.entries()) {
      // ponytail: lines are read one by one in the one speech worker; on a
      // CPU without WebGPU a long script can pass the desktop bridge's 300 s.
      takes.push(await readLine(l.text, { ...opts, voice: l.voice ?? opts.voice, speed: l.speed ?? opts.speed }, signal));
      updateToast(tid, { progress: (i + 1) / (lines.length + 1) });
    }
    const assets = await takeAssets(takes, signal);
    const times = layoutLines(
      lines.map((l, i) => ({ at: l.at, seconds: takes[i].seconds, before: takes[i].before, gap: (l.pauseAfter ?? opts.gap ?? pauseAfter(l.text, l.paragraph)) + takes[i].after })),
      opts.start ?? 0,
    );
    const finish = opts.finish ?? "natural";
    const placed: { text: string; start: number; end: number; seconds: number; voice: string; speed: number; voice_clip: string; caption_clip?: string; pauses?: Take["pauses"] }[] = [];
    edit("Voiceover", (q) => {
      placed.length = 0;
      q = { ...q, assets: [...q.assets, ...assets] };
      const track = createTrack("audio", "Voiceover");
      q = addTrack(q, track);
      assets.forEach((asset, i) => {
        const before = ids(q);
        q = runCommand(q, "add_media_clip", { asset_id: asset.id, start: times[i].start, track_id: track.id });
        const t = takes[i];
        placed.push({ text: t.written, ...times[i], seconds: +t.seconds.toFixed(3), voice: t.info.voice, speed: t.info.speed, voice_clip: added(before, q)[0]?.id ?? "", ...(t.pauses.length ? { pauses: t.pauses } : {}) });
      });
      q = finishClips(q, placed.map((l) => l.voice_clip), finish, opts.enhance);
      if (opts.captions !== false) {
        const before = ids(q);
        q = runCommand(q, "add_captions", {
          captions: lines.map((l, i) => ({ text: l.caption ?? takes[i].written, start: times[i].start, end: times[i].end })),
          ...(opts.captionStyle ? { style: opts.captionStyle } : {}),
          ...(opts.captionY !== undefined ? { y: opts.captionY } : {}),
        });
        const caps = added(before, q);
        placed.forEach((line) => (line.caption_clip = caps.find((c) => c.start === secondsToFrames(line.start, q.fps))?.id));
      }
      return q;
    });
    assets.forEach(prepare);
    const end = Math.max(...times.map((t) => t.end));
    toast(`Added the voiceover, ${end.toFixed(1)} s`);
    return { lines: placed, end, finish, engine: { quality: opts.quality ?? "best", ...takes[0].engine } };
  } catch (e) {
    if (signal.aborted) toast("Canceled");
    else toast(`The voiceover was not made: ${(e as Error).message || e}`, "error");
    throw e;
  } finally {
    dismiss(tid);
    set(null);
  }
}

export interface RetakeOptions extends ReadOptions {
  /** New words (with pause marks); default the line's own. */
  text?: string;
  /** The caption's new words; default the new text as written. */
  caption?: string;
  /** Move the lines and captions after it by the change in length. */
  ripple?: boolean;
}

/**
 * Read one voiceover line again (MCP retake_voiceover), with new words, a
 * voice, a speed or pronunciations, and put the take in the line's place
 * as one undo step: the clip keeps its id and settings, its caption takes
 * the new words and length, and the old take leaves the library.
 */
export async function retakeVoiceover(clipId: Id, o: RetakeOptions = {}) {
  if (running) throw new Error("A voice is already being made");
  const doc = store.document();
  const loc = findClip(doc, clipId);
  if (!loc || loc.clip.type !== "audio") throw new Error(`No voice line ${clipId}: describe_project lists the Voiceover track's clips`);
  const was = doc.assets.find((a) => a.id === (loc.clip as { assetId: Id }).assetId)?.speech;
  const text = o.text ?? was?.text;
  if (!text) throw new Error(`${clipId} was not spoken from a script (it was recorded or imported): give text to read in its place`);
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, projectWork.signal()]);
  const tid = toast("Reading the line again", "progress");
  set({ clipId, progress: 0, abort });
  try {
    const take = await readLine(text, { voice: o.voice ?? was?.voice, speed: o.speed ?? was?.speed, pronounce: o.pronounce ?? was?.pronounce, quality: o.quality ?? was?.quality, finish: o.finish ?? was?.finish }, signal);
    const caption = o.caption ?? (o.text !== undefined ? take.written : undefined);
    if (caption !== undefined) take.info.caption = o.caption;
    else if (was?.caption) take.info.caption = was.caption;
    const [asset] = await takeAssets([take], signal);
    let answer: { shift: number; captionId?: Id } = { shift: 0 };
    let start = 0;
    store.editDocument("Retake voiceover line", (q) => {
      const r = retakeLine(q, { clipId, asset, frames: secondsToFrames(take.seconds, q.fps), caption, ripple: o.ripple });
      answer = r;
      start = framesToSeconds(findClip(r.project, clipId)!.clip.start, q.fps);
      const finish = take.info.finish ?? "natural";
      // A new finish brings its clip settings; the line's own stay otherwise.
      return o.finish && o.finish !== was?.finish ? finishClips(r.project, [clipId], finish, undefined) : r.project;
    });
    prepare(asset);
    toast(`Read the line again, ${take.seconds.toFixed(1)} s`);
    const fps = store.document().fps;
    return {
      voice_clip: clipId,
      caption_clip: answer.captionId,
      text: take.written,
      start,
      end: +(start + take.seconds).toFixed(3),
      seconds: +take.seconds.toFixed(3),
      voice: take.info.voice,
      speed: take.info.speed,
      ...voiceSpeedReport(o.speed, take.info.speed, take.speedChosen === true, was?.speed !== undefined),
      ...(take.pauses.length ? { pauses: take.pauses } : {}),
      ...(o.ripple ? { shifted: +framesToSeconds(answer.shift, fps).toFixed(3) } : {}),
    };
  } catch (e) {
    if (signal.aborted) toast("Canceled");
    else toast(`The line was not read again: ${(e as Error).message || e}`, "error");
    throw e;
  } finally {
    dismiss(tid);
    set(null);
  }
}
