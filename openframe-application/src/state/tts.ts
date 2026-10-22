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
import { checkVoice, DEFAULT_VOICE, speechFileName, speechText } from "../lib/tts";
import { retakeLine } from "../lib/voiceLines";
import { asksEmphasis, breaksOf, checkPronounce, chunkSentences, EMPHASIS_NOTE, lateLineNotes, layoutLines, placedLineTimes, matchPauses, parseLine, pauseAfter, syllables, writtenWords } from "../lib/voiceScript";
import { bandSource, CHOSEN_MAX_SPS, landSpeed, readWps, speedBounds, syllableBand, targetBand, type ReadAs, type ReadSpan } from "../lib/voicePace";
import { finishTake, FINISHES, joinTakes, NATURAL_REVERB, resizePauses, type Finish, type FinishId } from "../lib/voiceTake";
import { encodeWav } from "../lib/wav";
import { duckArgs, staleDuckNote, staleDucks, type StaleDuck } from "../lib/analysis/duck";
import type { Caption } from "../lib/captions";
import { edit } from "./actions";
import { duckUnderSpeech, type DuckRequest } from "./ai";
import { chunkNote, overLimitNotes, takeChunks } from "./voiceWords";
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
  /** The pace the line is meant to have, kept with its script: a slow line
   * aims under its band, a fast one over it (lib/voicePace.ts). */
  pace?: SpeechInfo["pace"];
  /** Words a second over the line's speech to land on ([lowest,
   * highest]), as asked: it wins over the pace; with no speed given, the
   * speed is chosen by reading the line and measuring it. */
  wps?: [number, number];
  /** The kind of read whose band (moved for the pace) the line lands on
   * when no band is asked (default narration's 2.3-2.8). */
  readAs?: ReadAs;
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
  /** Words a second over the speech, as read, and the band it aimed at. */
  wps: number;
  band: [number, number];
  /** Why the band is under the one asked or the kind's: long words, held
   * under CHOSEN_MAX_SPS syllables a second (ADR-114). */
  paceNote?: string;
  /** Reads it took to land on the band (1 with a speed given). */
  reads: number;
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
async function readPart(text: string, marks: { at: number; seconds: number }[], o: Required<Omit<ReadOptions, "pronounce" | "pace" | "wps" | "readAs">>, f: Finish, signal: AbortSignal, engine: Take["engine"], how: Take["pauses"], acc: { fixed: number; directed: number }): Promise<Part> {
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
      out = append(out, await readPart(raw.trim(), inner, o, f, signal, engine, how, acc), pause);
      // A mark's silence: set to a length, and the script's, not the pace's.
      acc.fixed += pause;
      acc.directed += pause;
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
    // A pause set to a length stays that long at any speed; a mark's is
    // the script's beat, out of the pace (ADR-104).
    if (b.mark !== undefined || want !== p.end - p.start) acc.fixed += want;
    if (b.mark !== undefined) acc.directed += want;
  });
  if (!runs.length) return { audio, rate, first: act.first, last: act.last };
  audio = resizePauses(audio, rate, runs);
  const now = speechActivity(audio, rate)!;
  return { audio, rate, first: now.first, last: now.last };
}

/** Reads a line may take to land on its words a second: the first at a
 * speed estimated from its syllables, then corrected by what it measured. */
const MAX_READS = 3;

/** Read a script line whole and finish it (ADR-083, ADR-084). With no
 * speed given, the speed is chosen to land the line on its words a second
 * (ADR-096): read, measured over the speech, and read again at the speed
 * the measure calls for, up to three reads; the audio is never stretched. */
export async function readLine(text: string, o: ReadOptions, signal: AbortSignal): Promise<Take> {
  const opts = { voice: checkVoice(o.voice ?? DEFAULT_VOICE), quality: o.quality ?? "best", finish: o.finish ?? "natural" } as const;
  const f = FINISHES[opts.finish];
  const written = parseLine(text).written;
  // A title's lines are sentences of their own.
  const pronounce = checkPronounce(o.pronounce);
  const line = parseLine(speechText(text), pronounce);
  let spoken = line.spoken;
  if (!spoken || !/[\p{L}\p{N}]/u.test(spoken)) throw new Error("Every line needs words to speak");
  if (!/[.!?…,;:]$/.test(spoken)) spoken += ".";
  const engine: Take["engine"] = {};
  type Read = ReadSpan & { out: Part; how: Take["pauses"] };
  const read = async (speed: number): Promise<Read> => {
    const how: Take["pauses"] = [];
    const acc = { fixed: 0, directed: 0 };
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
      const join = out ? (boundary?.seconds ?? Math.max(f.sentencePause, 0.45)) : 0;
      out = append(out, await readPart(chunk, marks, { ...opts, speed }, f, signal, engine, how, acc), join);
      acc.fixed += join;
      if (boundary) acc.directed += join;
      from = end;
    }
    return { out: out!, how, span: out!.last - out!.first, ...acc };
  };
  const words = writtenWords(text).length;
  const syll = writtenWords(text).reduce((n, w) => n + syllables(w), 0);
  // A band asked wins over the pace; else the kind's, moved for the pace;
  // either moved down when its top would rush long words (ADR-114).
  const asked = targetBand(o.readAs ?? "narration", o.wps, o.pace ?? "normal");
  const band = syllableBand(asked, words, syll);
  const auto = o.speed === undefined;
  // The first guess: its syllables at Heart's rate, the finish's pauses at
  // their least; a break where a mark is takes the mark's (out of the pace).
  const natural = breaksOf(spoken)
    .filter((b) => !line.pauses.some((m) => Math.abs(b.at - m.at) <= 2))
    .reduce((n, b) => n + (b.sentence ? f.sentencePause : f.commaPause), 0);
  const landed = auto
    ? await landSpeed(read, { words, syllables: syll, natural, band, bounds: speedBounds(o.pace, !!o.wps), maxReads: MAX_READS })
    : { read: await read(o.speed!), speed: o.speed!, reads: 1 };
  const { out, how } = landed.read;
  const { speed, reads } = landed;
  const wps = +readWps(words, landed.read).toFixed(2);
  const { audio } = finishTake(out.audio, out.rate, f, hash(text));
  const info: SpeechInfo = {
    text,
    voice: opts.voice,
    speed,
    quality: opts.quality,
    finish: opts.finish,
    ...(pronounce && Object.keys(pronounce).length ? { pronounce } : {}),
    ...(o.pace && o.pace !== "normal" ? { pace: o.pace } : {}),
    ...(o.readAs ? { readAs: o.readAs } : {}),
    ...(o.wps ? { wps: o.wps } : {}),
    ...(auto ? { speedChosen: true } : {}),
  };
  const paceNote = auto && band[1] < asked[1] ? `long words (${(syll / words).toFixed(1)} syllables each): read to ${band[0]}-${band[1]} words a second, not ${asked[0]}-${asked[1]}, so it says no more than ${CHOSEN_MAX_SPS} syllables a second; a speed given reads it faster` : undefined;
  return { speedChosen: auto, audio, rate: out.rate, seconds: audio.length / out.rate, written, spoken, before: line.before, after: line.after, pauses: how, info, engine, wps, band, reads, ...(paceNote ? { paceNote } : {}) };
}

/** The takes as probed assets carrying their scripts, not yet in the
 * project: the caller's edit adds them, so one undo removes them. */
async function takeAssets(takes: Take[], signal: AbortSignal): Promise<Asset[]> {
  const files = takes.map((t) => new File([encodeWav([t.audio], t.rate)], speechFileName(t.written), { type: "audio/wav" }));
  const assets = await adoptAndProbe(files, signal);
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
  const signal = AbortSignal.any([abort.signal, projectWork.capture()]);
  const tid = toast("Making the voice", "progress", undefined, { label: "Cancel", run: () => abort.abort() });
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
  /** The pace it is meant to have (an end-card tagline: slow). */
  pace?: SpeechInfo["pace"];
  /** This line's words a second, [lowest, highest]; default the call's. */
  wps?: [number, number];
  /** This line's kind of read (a second speaker's radio call read as social); default the call's. */
  readAs?: ReadAs;
}

/** A line's band: its own words a second or kind, else the call's (a
 * kind on the line wins over the call's words a second). */
const lineBand = (l: VoiceLine, o: VoiceoverOptions): Pick<ReadOptions, "wps" | "readAs"> => (l.wps ? { wps: l.wps, readAs: l.readAs ?? o.readAs } : l.readAs ? { readAs: l.readAs } : { wps: o.wps, readAs: o.readAs });

export interface VoiceoverOptions extends ReadOptions {
  /** The kind of read, whose words a second lines land on unless a speed
   * or words a second is given (lib/voicePace.ts; default narration). */
  readAs?: ReadAs;
  /** Where the first line starts (seconds), default 0. */
  start?: number;
  /** Seconds between every pair of lines; default by each line's ending. */
  gap?: number;
  /** A caption for each line, timed to its voice (default true). */
  captions?: boolean;
  /** Captions this many words at a time (1-3), each word timed to the
   * voice, instead of one a line (ADR-115). */
  captionWords?: number;
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
  const signal = AbortSignal.any([abort.signal, projectWork.capture()]);
  const tid = toast(`Making the voiceover: ${lines.length} lines`, "progress", undefined, { label: "Cancel", run: () => abort.abort() });
  set({ clipId: "", progress: 0, abort });
  try {
    const takes: Take[] = [];
    for (const [i, l] of lines.entries()) {
      // ponytail: lines are read one by one in the one speech worker; on a
      // CPU without WebGPU a long script can pass the desktop bridge's 300 s.
      takes.push(await readLine(l.text, { ...opts, voice: l.voice ?? opts.voice, speed: l.speed ?? opts.speed, pace: l.pace, ...lineBand(l, opts) }, signal));
      updateToast(tid, { progress: (i + 1) / (lines.length + 1) });
    }
    // Captions a few words at a time: kept with each take, so a retake does the same.
    const chunked = opts.captions !== false && opts.captionWords ? opts.captionWords : 0;
    if (chunked) for (const t of takes) t.info.captionWords = chunked;
    const assets = await takeAssets(takes, signal);
    const chunks: { chunks: Caption[]; heard: boolean }[] = [];
    if (chunked) {
      updateToast(tid, { text: "Timing the captions to the voice" });
      for (const [i, l] of lines.entries()) chunks.push(await takeChunks(assets[i], l.caption ?? takes[i].written, l.text, chunked, signal));
    }
    const times = layoutLines(
      lines.map((l, i) => ({ at: l.at, seconds: takes[i].seconds, before: takes[i].before, gap: (l.pauseAfter ?? opts.gap ?? pauseAfter(l.text, l.paragraph)) + takes[i].after })),
      opts.start ?? 0,
      0.4,
      store.document().fps,
    );
    const finish = opts.finish ?? "natural";
    type Placed = { text: string; start: number; end: number; seconds: number; voice: string; speed: number; words_per_second: number; target_words_per_second: [number, number]; speed_chosen?: true; reads?: number; pace_note?: string; voice_clip: string; caption_clip?: string; caption_clips?: string[]; pauses?: Take["pauses"] };
    const placed: Placed[] = [];
    const before = store.document();
    edit("Voiceover", (q) => {
      placed.length = 0;
      q = { ...q, assets: [...q.assets, ...assets] };
      const track = { ...createTrack("audio", "Voiceover"), role: "dialog" as const };
      q = addTrack(q, track);
      assets.forEach((asset, i) => {
        const before = ids(q);
        q = runCommand(q, "add_media_clip", { asset_id: asset.id, start: times[i].start, track_id: track.id });
        const t = takes[i];
        const clip = added(before, q)[0]!;
        placed.push({
          text: t.written,
          ...placedLineTimes(clip, q.fps),
          seconds: +t.seconds.toFixed(3),
          voice: t.info.voice,
          speed: t.info.speed,
          words_per_second: t.wps,
          target_words_per_second: t.band,
          ...(t.speedChosen ? { speed_chosen: true as const, reads: t.reads } : {}),
          ...(t.paceNote ? { pace_note: t.paceNote } : {}),
          voice_clip: clip.id,
          ...(t.pauses.length ? { pauses: t.pauses } : {}),
        });
      });
      q = finishClips(q, placed.map((l) => l.voice_clip), finish, opts.enhance);
      if (opts.captions !== false) {
        const before = ids(q);
        const at = (i: number, s: number) => +(times[i].start + s).toFixed(3);
        q = runCommand(q, "add_captions", {
          captions: chunked
            ? lines.flatMap((_, i) => chunks[i].chunks.map((c) => ({ text: c.text, start: at(i, c.start), end: at(i, c.end), ...(c.words ? { words: c.words.map((s) => at(i, s)) } : {}) })))
            : lines.map((l, i) => ({ text: l.caption ?? takes[i].written, start: times[i].start, end: times[i].end })),
          ...(opts.captionStyle ? { style: opts.captionStyle } : {}),
          ...(opts.captionY !== undefined ? { y: opts.captionY } : {}),
        });
        const caps = added(before, q);
        if (chunked)
          placed.forEach((line) => {
            const from = secondsToFrames(line.start, q.fps), to = secondsToFrames(line.end, q.fps);
            line.caption_clips = caps.filter((c) => c.start >= from && c.start < to).sort((a, b) => a.start - b.start).map((c) => c.id);
          });
        else placed.forEach((line) => (line.caption_clip = caps.find((c) => c.start === secondsToFrames(line.start, q.fps))?.id));
      }
      return q;
    });
    assets.forEach(prepare);
    const end = Math.max(...times.map((t) => t.end));
    toast(`Added the voiceover, ${end.toFixed(1)} s`);
    // New lines over music ducked for others: it does not dip under them yet.
    const notes = [...(lines.some((l) => asksEmphasis(l.text)) ? [EMPHASIS_NOTE] : []), ...lateLineNotes(lines.map((l) => l.at), times), ...(chunked ? [chunkNote(chunked, chunks.every((c) => c.heard)), ...chunks.flatMap((c) => overLimitNotes(c.chunks, chunked))] : []), ...staleDucks(before, store.document()).map(staleDuckNote)];
    return { lines: placed, end, finish, engine: { quality: opts.quality ?? "best", ...takes[0].engine }, ...(notes.length ? { notes } : {}) };
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
  /** The kind of read to land on (its words a second), as add_voiceover's. */
  readAs?: ReadAs;
  /** New words (with pause marks); default the line's own. */
  text?: string;
  /** The caption's new words; default the new text as written. */
  caption?: string;
  /** Move the lines and captions after it by the change in length. */
  ripple?: boolean;
  /** Its captions this many words at a time (1-3), or 0 for one caption
   * for the line; default as the line was captioned (ADR-115). */
  captionWords?: number;
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
  const signal = AbortSignal.any([abort.signal, projectWork.capture()]);
  const tid = toast("Reading the line again", "progress", undefined, { label: "Cancel", run: () => abort.abort() });
  set({ clipId, progress: 0, abort });
  let ran = false;
  try {
    // A pace asked for, or a speed chosen to land on one, is chosen again;
    // a speed asked for before is kept. A band asked now wins over any pace
    // (ADR-104); a kind asked now replaces the band the line kept.
    const kept = bandSource(was);
    const wps = o.wps ?? (o.readAs ? undefined : kept.wps);
    const readAs = o.readAs ?? kept.readAs;
    const choose = o.wps !== undefined || o.readAs !== undefined || o.pace !== undefined || was?.speedChosen === true;
    const speed = o.speed ?? (choose ? undefined : was?.speed);
    const take = await readLine(text, { voice: o.voice ?? was?.voice, speed, pronounce: o.pronounce ?? was?.pronounce, quality: o.quality ?? was?.quality, finish: o.finish ?? was?.finish, pace: o.pace ?? was?.pace, wps, readAs }, signal);
    const caption = o.caption ?? (o.text !== undefined ? take.written : undefined);
    if (caption !== undefined) take.info.caption = o.caption;
    else if (was?.caption) take.info.caption = was.caption;
    // A line captioned a few words at a time is captioned so again (ADR-115).
    const chunked = o.captionWords ?? was?.captionWords ?? 0;
    if (chunked) take.info.captionWords = chunked;
    const [asset] = await takeAssets([take], signal);
    // caption_words 0 on a chunked line: one caption for the line again.
    const shown = take.info.caption ?? take.written;
    const words = chunked ? await takeChunks(asset, shown, text, chunked, signal) : was?.captionWords ? { chunks: [{ start: 0, end: take.seconds, text: shown }], heard: true } : undefined;
    let answer: { shift: number; captionId?: Id; captionIds?: Id[] } = { shift: 0 };
    // The take and the music dipped again under it undo as one step.
    store.beginRun();
    ran = true;
    const before = store.document();
    store.editDocument("Retake voiceover line", (q) => {
      const r = retakeLine(q, { clipId, asset, frames: secondsToFrames(take.seconds, q.fps), caption, ripple: o.ripple, ...(words ? { chunks: words.chunks } : {}) });
      answer = r;
      const finish = take.info.finish ?? "natural";
      // A new finish brings its clip settings; the line's own stay otherwise.
      return o.finish && o.finish !== was?.finish ? finishClips(r.project, [clipId], finish, undefined) : r.project;
    });
    prepare(asset);
    // Music ducked under the line (or the lines a ripple moved) dips
    // again under the take as it is now, as it was asked (ADR-104): the
    // film test's retake left the dip ending under the last word.
    const ducking = await duckAgain(staleDucks(before, store.document()));
    toast(`Read the line again, ${take.seconds.toFixed(1)} s`);
    const fps = store.document().fps;
    const notes = [...(asksEmphasis(text) ? [EMPHASIS_NOTE] : []), ...(words && chunked ? [chunkNote(chunked, words.heard), ...overLimitNotes(words.chunks, chunked)] : []), ...ducking.notes];
    return {
      voice_clip: clipId,
      ...(answer.captionIds ? { caption_clips: answer.captionIds } : { caption_clip: answer.captionId }),
      text: take.written,
      ...placedLineTimes(findClip(store.document(), clipId)!.clip, fps),
      seconds: +take.seconds.toFixed(3),
      voice: take.info.voice,
      speed: take.info.speed,
      words_per_second: take.wps,
      target_words_per_second: take.band,
      ...(take.paceNote ? { pace_note: take.paceNote } : {}),
      ...voiceSpeedReport(o.speed, take.info.speed, take.speedChosen === true, was?.speed !== undefined, take.speedChosen ? { wps: take.wps, band: take.band, reads: take.reads } : undefined),
      ...(take.pauses.length ? { pauses: take.pauses } : {}),
      ...(o.ripple ? { shifted: +framesToSeconds(answer.shift, fps).toFixed(3) } : {}),
      ...(ducking.done.length ? { ducking: ducking.done } : {}),
      ...(notes.length ? { notes } : {}),
    };
  } catch (e) {
    if (signal.aborted) toast("Canceled");
    else toast(`The line was not read again: ${(e as Error).message || e}`, "error");
    throw e;
  } finally {
    if (ran) store.endRun();
    dismiss(tid);
    set(null);
  }
}

/** Dip each stale duck again with the arguments it was ducked with, as
 * part of the retake's undo step; a duck whose keys were edited by hand
 * since, or one that cannot be measured, is named in a note instead. */
async function duckAgain(stale: StaleDuck[]): Promise<{ done: Record<string, unknown>[]; notes: string[] }> {
  const done: Record<string, unknown>[] = [];
  const notes: string[] = [];
  for (const d of stale) {
    if (d.edited.length) {
      notes.push(staleDuckNote(d));
      continue;
    }
    try {
      // As it was asked: its open moments, gap and release too.
      const { clip_id, ...asked } = duckArgs(d) as DuckRequest & { clip_id?: string };
      const out = await duckUnderSpeech(clip_id, { ...asked, label: "Retake voiceover line" });
      const b = out.balance;
      const lines = b?.per_line && "min_lu" in b.per_line ? { min_lu: b.per_line.min_lu, max_lu: b.per_line.max_lu } : undefined;
      done.push({ ...duckArgs(d), dipped_again: true, ...(b ? { voice_above_music_lu: b.voice_above_music_lu, ...(lines ? { lines } : {}), met: b.met } : { depth_db: out.depth_db }) });
    } catch (e) {
      notes.push(`${staleDuckNote(d)} It could not be dipped again now: ${(e as Error).message || e}.`);
    }
  }
  return { done, notes };
}
