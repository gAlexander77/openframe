// The local AI tools as app actions: analyze a clip's source (engine), turn
// the result into edits with registry commands (cut_ranges, split_at_times,
// add_markers), and apply them as ONE undoable edit with a clear label
// (ADR-019). Also the small state the AI tools panel shows: each tool's
// settings, the running job and its progress, and the last result.
//
// Everything runs on the user's machine: decode with WebCodecs, analyze in
// TypeScript. Nothing is uploaded and nothing needs a key.

import { useSyncExternalStore } from "react";
import { decodeMono, decodePcm, frameGrays, frameScores, measureLoudness } from "../engine/analyze";
import { AH, AW, shiftBetween, spectrum, stabilization, type StabilizeLevel } from "../lib/analysis/stabilize";
import { denoise } from "../lib/analysis/denoise";
import { replaceClip } from "../lib/project/replace";
import type { Region } from "../lib/align";
import { canvasSize } from "../lib/canvas";
import { applyTrack, centerRegion, trackPath } from "./tracking";
import { encodeWav } from "../lib/wav";
import { adoptAndImport } from "./media";
import { cutOutImage, makeMatte } from "../engine/cutout";
import { SFX } from "../lib/sfx";
import { BEATS_PER_BAR, detectBeats, musicStructure, type MusicStructure } from "../lib/analysis/beats";
import { confidenceNote, gridHints, mapMusic, readMusicHints, type MappedMusic } from "../lib/analysis/musicMap";
import type { StructureHints } from "../lib/analysis/beats";
import { markMusicClip, MUSIC_MARKERS, type MusicMarkerKind } from "../lib/epic";
import { findLag, MIN_CONFIDENCE, SYNC_RATE } from "../lib/analysis/sync";
import { syncProblem } from "../lib/project/sync";
import { measureMix } from "../engine/mixdown";
import { activeSpan, aimDepths, BALANCE_WINDOWS, duckDepth, duckTargetsError, isDialog, lineBalances, lineCeiling, loudnessDifference, marginSummary, speechWindows, windowLoudness, type LineBalance } from "../lib/analysis/balance";
import { duckMark, trackDuckKeys, voicesUnder as voicesUnderMusic, type VoiceUnder } from "../lib/analysis/duck";
import { normalizeGain, type Normalization } from "../lib/analysis/loudness";
import { ceilingFor, LOUDNESS_SPECS, SPEC_IDS, type SpecId } from "../lib/analysis/delivery";
import { sceneCuts } from "../lib/analysis/scenes";
import { findSilences, totalLength, type Range } from "../lib/analysis/silence";
import { FILLERS, fillerRanges } from "../lib/fillers";
import { transcribePcm } from "../engine/transcribe";
import { runCommand } from "../lib/commands";
import { clipWindow, covers } from "../lib/matte";
import { behindProblem, putBehindSubject, type SubjectCut, type BehindPlace, type GradeCopied } from "../lib/ads";
import { frameOfSource, framesOfRanges } from "../lib/project/cut";
import * as ops from "../lib/project/ops";
import type { Asset, AudioClip, Clip, Cutout, DuckRecord, Id, ImageClip, VideoClip } from "../lib/project/types";
import { uid } from "../lib/project/defaults";
import { framesToSeconds, secondsToFrames } from "../lib/time";
import { platform } from "../platform";
import { edit } from "./actions";
import { store } from "./store";
import { dismiss, toast, updateToast } from "./toast";
import { projectWork } from "./projectWork";

export type ToolId = "silences" | "fillers" | "scenes" | "beats" | "loudness" | "ducking" | "denoise" | "stabilize" | "cutout" | "sync" | "reframe";

export interface SilenceSettings {
  /** 0..1; 0.5 is the detector's default threshold. */
  sensitivity: number;
  /** Seconds. */
  minSilence: number;
  /** Seconds. */
  padding: number;
}

export interface SceneSettings {
  sensitivity: number;
  /** Seconds. */
  minScene: number;
  detector: "adaptive" | "content";
  output: "split" | "markers";
}

export interface BeatSettings {
  /** Marker on every Nth beat. */
  every: 1 | 2 | 4;
}

export interface LoudnessSettings {
  /** Integrated loudness to reach, LUFS. */
  target: number;
}

export interface DuckSettings {
  /** How far the music dips under speech, dB. */
  depth: number;
}

export interface DenoiseSettings {
  /** 0..1, how much of the noise goes. */
  strength: number;
}

export interface StabilizeSettings {
  level: StabilizeLevel;
}

export interface ReframeSettings {
  /** The canvas shape to reframe into; "keep" reframes in the current one. */
  ratio: "9:16" | "1:1" | "4:5" | "keep";
}

export interface SyncSettings {
  /** The camera's own sound once the recorded sound is synced to it. */
  camera: "keep" | "mute";
}

export interface FillerSettings {
  /** A Whisper model id from ASR_MODELS. */
  model: string;
}

export interface AiSettings {
  silences: SilenceSettings;
  scenes: SceneSettings;
  beats: BeatSettings;
  loudness: LoudnessSettings;
  ducking: DuckSettings;
  denoise: DenoiseSettings;
  stabilize: StabilizeSettings;
  fillers: FillerSettings;
  sync: SyncSettings;
  reframe: ReframeSettings;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  silences: { sensitivity: 0.5, minSilence: 0.4, padding: 0.1 },
  scenes: { sensitivity: 0.5, minScene: 0.5, detector: "adaptive", output: "split" },
  beats: { every: 1 },
  // YouTube, TikTok, Spotify and most social players normalize to about -14.
  loudness: { target: -14 },
  // Ducking guides put music 10-15 dB under dialogue.
  ducking: { depth: 12 },
  denoise: { strength: 0.75 },
  stabilize: { level: "recommended" },
  // Tiny drops every "um"; base keeps them at a third of small's download.
  fillers: { model: "onnx-community/whisper-base.en_timestamped" },
  // Kept: the camera's sound is how to check the sync by ear, and muting
  // it is the menu's second item.
  sync: { camera: "keep" },
  // Shorts, Reels and TikTok: the reason most wide footage gets reframed.
  reframe: { ratio: "9:16" },
};

export interface AiJob {
  clipId: Id;
  /** 0..1, within the current stage. */
  progress: number;
  /** What the job is doing now, when it has stages ("Downloading the
   * background model"); the progress restarts with each. */
  stage?: string;
  abort: AbortController;
}

export interface AiState {
  settings: AiSettings;
  jobs: Partial<Record<ToolId, AiJob>>;
  /** What the last run of each tool did, for the card. */
  results: Partial<Record<ToolId, string>>;
}

let state: AiState = { settings: DEFAULT_AI_SETTINGS, jobs: {}, results: {} };
const listeners = new Set<() => void>();
const set = (patch: Partial<AiState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const aiStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  setSettings<T extends keyof AiSettings>(tool: T, patch: Partial<AiSettings[T]>) {
    set({ settings: { ...state.settings, [tool]: { ...state.settings[tool], ...patch } } });
  },
  resetSettings(tool: keyof AiSettings) {
    set({ settings: { ...state.settings, [tool]: DEFAULT_AI_SETTINGS[tool] } });
  },
  cancel(tool: ToolId) {
    state.jobs[tool]?.abort.abort();
  },
};

export function useAi<T>(selector: (s: AiState) => T): T {
  return useSyncExternalStore(aiStore.subscribe, () => selector(state));
}

// ---- which clip a tool can work on ---------------------------------------------

type MediaClip = VideoClip | AudioClip;

/** What each tool works on, for hints and errors. */
export const NEEDS: Record<ToolId, string> = {
  silences: "a video or audio clip with sound",
  fillers: "a video or audio clip with speech",
  scenes: "a video clip",
  beats: "a music or video clip with sound",
  loudness: "video or audio clips with sound",
  ducking: "a music clip with speech under it",
  denoise: "a video or audio clip with sound",
  stabilize: "a video clip",
  cutout: "a video clip with a person or subject",
  sync: "an audio clip and the video it was recorded with",
  reframe: "a video clip",
};

/** Whether `tool` can analyze this clip, and why not. */
function fit(tool: ToolId, clip: MediaClip, asset: Asset | undefined): string | null {
  if (!asset) return "Its media is missing";
  if (clip.freeze) return "A freeze frame has no source to analyze";
  if (tool === "reframe" && (clip.reverse || clip.speedCurve)) return "Its speed is curved or reversed";
  if (tool === "scenes" || tool === "stabilize" || tool === "cutout" || tool === "reframe") return clip.type === "video" && asset.hasVideo ? null : `Needs ${NEEDS[tool]}`;
  if (tool === "sync") return clip.type === "audio" && asset.hasAudio ? null : `Needs ${NEEDS[tool]}`;
  // A ducked clip's volume keys scale with its level (setLevel, ADR-110).
  // ponytail: the cleaned sound is a new file of the source window; a
  // retimed clip would need the retimer's window instead.
  if (tool === "denoise" && (clip.speedCurve || clip.reverse)) return "Its speed is curved or reversed";
  return asset.hasAudio ? null : `Needs ${NEEDS[tool]}`;
}

export interface Target {
  clip: MediaClip;
  asset: Asset;
}

/** The clip a tool should act on: the first selected clip it can use.
 * Returns a reason string when there is none. */
export function targetFor(tool: ToolId, clipId?: Id): Target | string {
  const p = store.get().project;
  const ids = clipId ? [clipId] : store.get().selection;
  if (!ids.length) return `Select ${NEEDS[tool]} on the timeline`;
  let reason = `Select ${NEEDS[tool]} on the timeline`;
  for (const id of ids) {
    const loc = ops.findClip(p, id);
    if (!loc) {
      reason = `No clip with id ${id}`;
      continue;
    }
    const c = loc.clip;
    if (c.type !== "video" && c.type !== "audio") continue;
    const asset = ops.getAsset(p, c.assetId);
    const why = loc.track.locked ? "Its track is locked" : fit(tool, c, asset);
    if (!why) return { clip: c, asset: asset! };
    reason = why;
  }
  return reason;
}

function resolve(tool: ToolId, clipId?: Id): Target {
  const t = targetFor(tool, clipId);
  if (typeof t === "string") throw new Error(t);
  return t;
}

/** The clip's source window [in, out) in seconds. */
function windowOf(clip: MediaClip): [number, number] {
  const fps = store.get().project.fps;
  return [clip.in, ops.sourceTimeAt(clip, clip.start + clip.duration, fps)];
}

// ---- running a job ---------------------------------------------------------------

/** Run `work` as `tool`'s job: one at a time per tool, with a progress
 * toast and the card's progress, cancelable, errors shown as toasts. A
 * stage of the work can retitle the toast. */
async function job<T>(tool: ToolId, clip: MediaClip, label: string, work: (progress: (x: number, label?: string) => void, signal: AbortSignal) => Promise<T>): Promise<T> {
  if (state.jobs[tool]) throw new Error("Already running");
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, projectWork.signal()]);
  const tid = toast(label, "progress");
  updateToast(tid, { progress: 0 });
  const progress = (x: number, text?: string) => {
    updateToast(tid, { progress: x, ...(text ? { text } : {}) });
    const j = state.jobs[tool];
    if (j) set({ jobs: { ...state.jobs, [tool]: { ...j, progress: x, ...(text ? { stage: text } : {}) } } });
  };
  set({ jobs: { ...state.jobs, [tool]: { clipId: clip.id, progress: 0, stage: label, abort } } });
  try {
    const result = await work(progress, signal);
    signal.throwIfAborted();
    return result;
  } catch (e) {
    if (signal.aborted) toast("Canceled");
    else toast(e instanceof Error ? e.message : String(e), "error");
    throw e;
  } finally {
    dismiss(tid);
    const { [tool]: _done, ...rest } = state.jobs;
    set({ jobs: rest });
  }
}

const finish = (tool: ToolId, text: string) => {
  set({ results: { ...state.results, [tool]: text } });
  toast(text);
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Analysis rates: 16 kHz is plenty for levels; beats want up to 11 kHz. */
const SILENCE_RATE = 16000;
const BEAT_RATE = 22050;

// ---- analysis without editing (automation and previews) ------------------------

export interface SilenceAnalysis {
  /** Source seconds. */
  ranges: Range[];
  thresholdDb: number;
  floorDb: number;
}

/** Silent ranges of a clip's source window, in source seconds. */
export async function analyzeSilences(clipId?: Id, opts: Partial<SilenceSettings> = {}): Promise<SilenceAnalysis> {
  const { clip, asset } = resolve("silences", clipId);
  const o = { ...state.settings.silences, ...opts };
  return job("silences", clip, `Finding silences in ${asset.name}`, async (progress, signal) => {
    const [from, to] = windowOf(clip);
    const pcm = await decodeMono(asset, from, to, SILENCE_RATE, progress, signal);
    const res = findSilences(pcm, SILENCE_RATE, { minSilence: o.minSilence, padding: o.padding, biasDb: (o.sensitivity - 0.5) * 16 });
    return { ...res, ranges: res.ranges.map((r) => ({ start: +(r.start + from).toFixed(4), end: +(r.end + from).toFixed(4) })) };
  });
}

export interface SceneAnalysis {
  /** Source seconds where each new scene starts. */
  cuts: number[];
  frames: number;
}

/** Scene cuts inside a clip's source window, in source seconds. */
export async function analyzeScenes(clipId?: Id, opts: Partial<SceneSettings> = {}): Promise<SceneAnalysis> {
  const { clip, asset } = resolve("scenes", clipId);
  const o = { ...state.settings.scenes, ...opts };
  return job("scenes", clip, `Finding scenes in ${asset.name}`, async (progress, signal) => {
    const [from, to] = windowOf(clip);
    const { times, scores } = await frameScores(asset, from, to, {}, progress, signal);
    // Sensitivity halves or doubles PySceneDetect's thresholds around the
    // defaults (docs/AI tools.md).
    const k = 2 ** (0.5 - o.sensitivity);
    const cuts = sceneCuts(times, scores, {
      detector: o.detector,
      adaptiveThreshold: 3 * k * k,
      threshold: 27 * k,
      minContentVal: 15 * k,
      minScene: o.minScene,
    });
    return { cuts: cuts.filter((t) => t > from && t < to).map((t) => +t.toFixed(4)), frames: times.length };
  });
}

export interface BeatAnalysis {
  /** Source seconds. */
  beats: number[];
  bpm: number;
}

/** Beats inside a clip's source window, in source seconds. */
export async function analyzeBeats(clipId?: Id, _opts: Partial<BeatSettings> = {}): Promise<BeatAnalysis> {
  const { clip, asset } = resolve("beats", clipId);
  return job("beats", clip, `Finding beats in ${asset.name}`, async (progress, signal) => {
    const [from, to] = windowOf(clip);
    const pcm = await decodeMono(asset, from, to, BEAT_RATE, progress, signal);
    const res = detectBeats(pcm, BEAT_RATE);
    return { bpm: res.bpm, beats: res.beats.map((t) => +(t + from).toFixed(4)) };
  });
}

// ---- analysis, then one edit ------------------------------------------------------------

/** The clip again after analysis: the user may have edited meanwhile. */
function stillThere(clipId: Id): MediaClip {
  const c = ops.findClip(store.get().project, clipId)?.clip;
  if (!c || (c.type !== "video" && c.type !== "audio")) {
    const msg = "The clip was removed while it was being analyzed";
    toast(msg, "error");
    throw new Error(msg);
  }
  return c;
}

export interface SilenceEdit extends SilenceAnalysis {
  removed: number;
  /** Seconds the timeline got shorter (or the clip, without ripple). */
  seconds: number;
}

/** Remove a clip's silences as one undoable edit. */
export async function removeSilences(clipId?: Id, opts: Partial<SilenceSettings> = {}): Promise<SilenceEdit> {
  const signal = projectWork.signal();
  const id = resolve("silences", clipId).clip.id;
  const res = await analyzeSilences(id, opts);
  signal.throwIfAborted();
  const clip = stillThere(id);
  const [from, to] = windowOf(clip);
  if (!res.ranges.length) {
    finish("silences", "No silences found");
    return { ...res, removed: 0, seconds: 0 };
  }
  if (totalLength(res.ranges) >= to - from - 1e-3) {
    finish("silences", "The whole clip is silent, so nothing was cut");
    return { ...res, removed: 0, seconds: 0 };
  }
  // What the cut will take out, in timeline frames of this clip.
  const fps = store.get().project.fps;
  const spans = framesOfRanges(clip, res.ranges, fps);
  const seconds = +framesToSeconds(spans.reduce((n, [a, b]) => n + b - a, 0), fps).toFixed(2);
  const label = `Remove ${plural(spans.length, "silence")}`;
  edit(label, (p) => runCommand(p, "cut_ranges", { clip_id: id, ranges: res.ranges, ripple: true }));
  finish("silences", `Removed ${plural(spans.length, "silence")}, ${seconds.toFixed(1)} s shorter`);
  return { ...res, removed: spans.length, seconds };
}

export interface FillerAnalysis {
  /** Source seconds. */
  ranges: Range[];
  /** The filler words heard, as transcribed. */
  words: string[];
}

/** The filler words in a clip's speech (Whisper on this machine), as source
 * ranges to cut. */
export async function analyzeFillers(clipId?: Id, opts: Partial<FillerSettings> = {}): Promise<FillerAnalysis> {
  const { clip, asset } = resolve("fillers", clipId);
  const o = { ...state.settings.fillers, ...opts };
  return job("fillers", clip, `Listening to ${asset.name}`, async (progress, signal) => {
    const [from, to] = windowOf(clip);
    const pcm = await decodeMono(asset, from, to, SILENCE_RATE, (x) => progress(x * 0.2), signal);
    const words = await transcribePcm(
      pcm,
      from,
      { model: o.model, language: null },
      (s) => (s.stage === "downloading" ? progress(0.2 + s.progress * 0.2, "Downloading the speech model") : progress(0.4 + s.progress * 0.6, "Finding filler words")),
      signal,
    );
    const ranges = fillerRanges(words)
      .map((r) => ({ start: Math.max(r.start, from), end: Math.min(r.end, to) }))
      .filter((r) => r.end > r.start);
    return { ranges, words: words.filter((w) => FILLERS.has(w.text.toLowerCase().replace(/[^a-z]/g, ""))).map((w) => w.text.trim()) };
  });
}

export interface FillerEdit extends FillerAnalysis {
  removed: number;
  /** Seconds the timeline got shorter. */
  seconds: number;
}

/** Cut a clip's filler words, with the hesitation around each, as one
 * undoable edit. */
export async function removeFillers(clipId?: Id, opts: Partial<FillerSettings> = {}): Promise<FillerEdit> {
  const signal = projectWork.signal();
  const id = resolve("fillers", clipId).clip.id;
  const res = await analyzeFillers(id, opts);
  signal.throwIfAborted();
  const clip = stillThere(id);
  if (!res.ranges.length) {
    finish("fillers", "No filler words found");
    return { ...res, removed: 0, seconds: 0 };
  }
  const fps = store.get().project.fps;
  const spans = framesOfRanges(clip, res.ranges, fps);
  const seconds = +framesToSeconds(spans.reduce((n, [a, b]) => n + b - a, 0), fps).toFixed(2);
  const n = res.words.length;
  edit(`Remove ${plural(n, "filler word")}`, (p) => runCommand(p, "cut_ranges", { clip_id: id, ranges: res.ranges, ripple: true }));
  finish("fillers", `Removed ${plural(n, "filler word")}, ${seconds.toFixed(1)} s shorter`);
  return { ...res, removed: n, seconds };
}

export interface SceneEdit extends SceneAnalysis {
  output: "split" | "markers";
}

/** Split a clip at its scene cuts (or mark them) as one undoable edit. */
export async function splitScenes(clipId?: Id, opts: Partial<SceneSettings> = {}): Promise<SceneEdit> {
  const signal = projectWork.signal();
  const id = resolve("scenes", clipId).clip.id;
  const o = { ...state.settings.scenes, ...opts };
  const res = await analyzeScenes(id, o);
  signal.throwIfAborted();
  const clip = stillThere(id);
  if (!res.cuts.length) {
    finish("scenes", "No scene cuts found");
    return { ...res, output: o.output };
  }
  if (o.output === "markers") {
    edit(`Mark ${plural(res.cuts.length, "scene cut")}`, (p) =>
      runCommand(p, "add_markers", { times: timelineTimes(clip, res.cuts), label: "Scene", color: "#8d90f0" }),
    );
    finish("scenes", `Marked ${plural(res.cuts.length, "scene cut")}`);
  } else {
    edit(`Split into ${plural(res.cuts.length + 1, "scene")}`, (p) => runCommand(p, "split_at_times", { clip_id: id, times: res.cuts }));
    finish("scenes", `Split into ${plural(res.cuts.length + 1, "scene")}`);
  }
  return { ...res, output: o.output };
}

export interface BeatEdit {
  /** Beats a minute as the clip plays them; file_bpm, the file's own, when it plays at another speed. */
  bpm: number;
  file_bpm?: number;
  /** Timeline seconds of the beats marked. */
  beats: number[];
  /** Markers added: 0 when the clip's beats were marked already (they are replaced, never doubled). */
  markers: number;
  /** The song's grid was given (set_music_grid), not guessed. */
  grid?: "given";
}

/**
 * Drop a marker on every (Nth) beat of a clip as one undoable edit, from
 * the whole song's reading (analyze_music's, through its given grid when
 * it has one), so a trimmed or moved clip keeps the song's beats. The
 * markers follow the clip and replace its earlier Beat markers.
 */
export async function markBeats(clipId?: Id, opts: Partial<BeatSettings> = {}): Promise<BeatEdit> {
  const every = Math.max(1, opts.every ?? state.settings.beats.every);
  const song = await readSong(clipId, {});
  const fps = store.get().project.fps;
  const mapped = mapMusic(song.m, song.clip, fps, song.from);
  const picked = mapped.beats.filter((_, i) => i % every === 0);
  if (!picked.length) {
    finish("beats", "No beat found");
    return { bpm: mapped.bpm, beats: [], markers: 0 };
  }
  const before = store.get().project.markers.length;
  edit(`Mark ${plural(picked.length, "beat")}`, (p) => markMusicClip(p, song.clip.id, { beats: song.m.beats.map((t) => t + song.from), downbeats: [], phrases: [], sections: [], drops: [] }, ["beats"], every));
  // Added: a second call replaces the clip's Beat markers, never doubles them.
  const markers = store.get().project.markers.length - before;
  finish("beats", markers > 0 ? `Marked ${plural(markers, "beat")} · ${Math.round(mapped.bpm)} BPM` : `Every beat is already marked · ${Math.round(mapped.bpm)} BPM`);
  return { bpm: mapped.bpm, ...(mapped.file_bpm !== undefined ? { file_bpm: mapped.file_bpm } : {}), beats: picked, markers, ...(song.asset.musicGrid ? { grid: "given" as const } : {}) };
}

export interface MusicAnalysis extends MappedMusic {
  beats_per_bar: number;
  /** What was read: the music file (its asset), the source seconds
   * analyzed, whether the reading came from the cache, and how the clip
   * plays it (in-point and speed) to put it on the timeline. */
  source: { asset_id: Id; analyzed: [number, number]; whole_file: boolean; cached: boolean; clip_in: number; clip_speed: number | "curve"; reversed?: boolean };
  /** How sure the reading is, 0..1 each (beats.ts MusicStructure). */
  confidence: { tempo: number; bars: number; sections: number; note?: string };
  /** The hints given, as used (source seconds); grid: the file's own given grid (set_music_grid) was read through. */
  given?: { bpm?: number; first_downbeat?: number; cues?: number; grid?: true };
  /** Markers added (analyze_music's markers option). */
  markers: number;
}

/** A file this long or shorter is read whole; a longer one, the clip's own
 * stretch with a minute either side (enough for its bars and parts). */
const WHOLE_FILE_MAX = 600;
const WINDOW_PAD = 60;

/** Readings of music files, by asset, its length and the hints: a second
 * clip of the same score, or a second call, reads nothing again. */
const musicReadings = new Map<string, MusicStructure>();

/**
 * A music clip's beat grid and parts (Final Cut's beat grid: song parts,
 * bars, beats), in TIMELINE seconds, for agents to cut to (ADR-096). The
 * whole file is read (once; the reading is kept) and placed through the
 * clip's in-point, speed and position, so a trimmed clip keeps the file's
 * bar phase and drops; `hints` (a cue sheet's tempo, downbeat or parts, in
 * the file's own seconds) replace what would be detected. `markers` also
 * drops markers for the kinds named, as one undoable edit: Beat, Bar,
 * Phrase, each section by name, and Drop (lib/epic.ts MUSIC_MARKERS).
 */
/** A song read whole (once; kept), through the grid its file was given
 * (set_music_grid) and the call's own hints, for a clip of it. Times in
 * `m` are seconds from `from` in the file. */
async function readSong(clipId: Id | undefined, given: StructureHints): Promise<{ m: MusicStructure; clip: MediaClip; asset: Asset; from: number; to: number; whole: boolean; cached: boolean; hints: StructureHints }> {
  const signal = projectWork.signal();
  const { clip: c0, asset } = resolve("beats", clipId);
  const hints = gridHints(asset.musicGrid, given);
  const id = c0.id;
  const [lo, hi] = ops.sourceRange(c0, store.get().project.fps);
  const whole = !(asset.duration > WHOLE_FILE_MAX);
  // ponytail: past ten minutes (a long video's sound) only the clip's stretch and a minute either side is read.
  const [from, to] = whole ? [0, asset.duration] : [Math.max(0, lo - WINDOW_PAD), Math.min(asset.duration, hi + WINDOW_PAD)];
  const key = `${asset.id}|${from}|${to}|${JSON.stringify(hints)}`;
  let m = musicReadings.get(key);
  const cached = !!m;
  if (!m) {
    m = await job("beats", c0, `Reading the music in ${asset.name}`, async (progress, sig) => musicStructure(await decodeMono(asset, from, to, BEAT_RATE, progress, sig), BEAT_RATE, hints));
    if (musicReadings.size >= 8) musicReadings.delete(musicReadings.keys().next().value!);
    musicReadings.set(key, m);
  }
  signal.throwIfAborted();
  return { m, clip: stillThere(id), asset, from, to, whole, cached, hints };
}

export async function analyzeMusic(clipId?: Id, opts: { markers?: MusicMarkerKind[]; bpm?: number; first_downbeat?: number; cues?: unknown } = {}): Promise<MusicAnalysis> {
  const { m, clip, asset, from, to, whole, cached, hints } = await readSong(clipId, readMusicHints(opts));
  const fps = store.get().project.fps;
  const note = confidenceNote(m.confidence, hints);
  const out: MusicAnalysis = {
    ...mapMusic(m, clip, fps, from),
    beats_per_bar: BEATS_PER_BAR,
    source: { asset_id: asset.id, analyzed: [+from.toFixed(3), +to.toFixed(3)], whole_file: whole, cached, clip_in: +clip.in.toFixed(3), clip_speed: clip.speedCurve ? "curve" : clip.speed, ...(clip.reverse ? { reversed: true } : {}) },
    confidence: { ...m.confidence, ...(note ? { note } : {}) },
    ...(Object.keys(hints).length ? { given: { ...(hints.bpm !== undefined ? { bpm: hints.bpm } : {}), ...(hints.firstDownbeat !== undefined ? { first_downbeat: hints.firstDownbeat } : {}), ...(hints.cues ? { cues: hints.cues.length } : {}), ...(asset.musicGrid ? { grid: true as const } : {}) } } : {}),
    markers: 0,
  };
  const kinds = [...new Set(opts.markers ?? [])].filter((k) => k in MUSIC_MARKERS);
  if (kinds.length) {
    // Following the clip, replacing its earlier markers of these kinds (a
    // second reading never doubles the first).
    const at = (ts: number[]) => ts.map((t) => t + from);
    const before = store.get().project.markers.length;
    edit(`Mark the music`, (p) => markMusicClip(p, clip.id, { beats: at(m.beats), downbeats: at(m.downbeats), phrases: at(m.phrases), sections: m.sections.map((x) => ({ start: x.start + from, label: x.label })), drops: at(m.drops) }, kinds));
    out.markers = store.get().project.markers.length - before;
  }
  finish("beats", `${Math.round(out.bpm)} BPM · ${plural(out.sections.length, "section")}${out.drop !== null ? ` · drop at ${out.drop.toFixed(2)} s` : ""}`);
  return out;
}

/** Source seconds inside `clip` to timeline seconds, dropping any outside it. */
function timelineTimes(clip: MediaClip, times: number[]): number[] {
  const fps = store.get().project.fps;
  return times
    .map((t) => frameOfSource(clip, t, fps))
    .filter((f) => f >= clip.start && f < clip.start + clip.duration)
    .map((f) => +framesToSeconds(f, fps).toFixed(6));
}

// ---- loudness --------------------------------------------------------------------

export interface LoudnessResult extends Normalization {
  clipId: Id;
  /** Measured integrated loudness of the source, LUFS. */
  lufs: number;
}

/**
 * Bring every selected clip with sound (or `clipIds`) to the target
 * loudness by setting its volume, as one undoable edit (CapCut's
 * "Normalize loudness", measured per ITU-R BS.1770).
 */
export async function normalizeLoudness(clipIds?: Id[], opts: Partial<LoudnessSettings> & { spec?: string } = {}): Promise<LoudnessResult[]> {
  const scope = projectWork.signal();
  // A delivery spec names the target and the true-peak ceiling (ADR-061).
  const spec = opts.spec === undefined ? undefined : LOUDNESS_SPECS[opts.spec as SpecId];
  if (opts.spec !== undefined && !spec) throw new Error(`Unknown spec ${opts.spec}: use ${SPEC_IDS.join(", ")}`);
  const target = spec?.target ?? opts.target ?? state.settings.loudness.target;
  const ceilingDb = spec?.maxTruePeak ?? ceilingFor(target);
  const ids = clipIds ?? store.get().selection;
  const targets = ids.map((id) => targetFor("loudness", id)).filter((t): t is Target => typeof t !== "string");
  if (!targets.length) throw new Error(ids.length ? String(targetFor("loudness", ids[0])) : `Select ${NEEDS.loudness} on the timeline`);
  const label = targets.length === 1 ? `Measuring the loudness of ${targets[0].asset.name}` : `Measuring the loudness of ${plural(targets.length, "clip")}`;
  const measured = await job("loudness", targets[0].clip, label, async (progress, signal) => {
    const out: { clipId: Id; lufs: number; peak: number; truePeak: number }[] = [];
    for (const [i, { clip, asset }] of targets.entries()) {
      const [from, to] = windowOf(clip);
      // Measured as it plays: through the clip's compressor, if it has one.
      const r = await measureLoudness(asset, from, to, (x) => progress((i + x) / targets.length), signal, "compressor" in clip ? clip.compressor : undefined);
      out.push({ clipId: clip.id, ...r });
    }
    return out;
  });
  scope.throwIfAborted();
  const results = measured.map((m) => ({ clipId: m.clipId, lufs: +m.lufs.toFixed(2), ...normalizeGain(m.lufs, target, m.truePeak, { ceilingDb }) }));
  const live = results.filter((r) => Number.isFinite(r.lufs) && ops.findClip(store.get().project, r.clipId));
  if (!live.length) {
    finish("loudness", "Only silence, so nothing changed");
    return results;
  }
  edit(live.length === 1 ? "Normalize loudness" : `Normalize loudness of ${plural(live.length, "clip")}`, (p) =>
    // A ducked song's keys scale to the level (ADR-110): its volume under them is never heard.
    live.reduce((q, r) => ops.setLevel(q, r.clipId, r.gain), p),
  );
  const held = live.filter((r) => r.limitedBy).length;
  const one = live.length === 1 ? ` from ${live[0].lufs.toFixed(1)}` : "";
  finish("loudness", `${plural(live.length, "clip")} set to ${target} LUFS${one}${held ? ` · ${held} held back to avoid clipping` : ""}`);
  return results;
}

// ---- ducking ---------------------------------------------------------------------

export interface DuckEdit {
  /** Clips listened to for speech. */
  voices: number;
  /** Stretches of speech the music dips under. */
  dips: number;
  keys: number;
  /** The dip's depth; with min_line_lu, the least (each line's own is in balance.per_line.each). */
  depth_db?: number;
  /** The music clips dipped, when a whole track was (track_id). */
  clips?: Id[];
  balance?: DuckBalance;
  /** One clip of a track that plays more: track_id ducks them all. */
  note?: string;
}

/** What the music sits under the voice, measured once the dips are set,
 * in the windows lib/analysis/balance.ts names (ADR-096). */
export interface DuckBalance {
  /** Which window the numbers at this level are: speech. */
  window: "speech";
  means: string;
  start: number;
  end: number;
  /** Stretches of speech, and their seconds together. */
  stretches: number;
  seconds: number;
  dialog_lufs: number | null;
  music_lufs: number | null;
  voice_above_music_lu: number | null;
  /** voice_above_music_lu's target, when one was given. */
  target_lu?: number;
  /** Every target given was met (within 0.5 LU over speech; every line between its minimum and its ceiling). */
  met?: boolean;
  per_line: (NonNullable<ReturnType<typeof marginSummary>> | { lines: 0 }) & {
    window: "line";
    means: string;
    min_target_lu?: number;
    /** The most a line sits over the music: max_line_lu, or its default (lineCeiling). */
    max_target_lu?: number;
    met?: boolean;
    /** Each line, its margin and its own dip. */
    each?: (LineBalance & { depth_db: number })[];
  };
}

/** duck_under_speech's arguments. */
export interface DuckRequest extends Partial<DuckSettings> {
  voice_above_music_lu?: number;
  min_line_lu?: number;
  max_line_lu?: number;
  /** Duck every clip with sound on this track, as one music bed. */
  track_id?: Id;
  /** The undo step's name (a retake dips the music again under its own). */
  label?: string;
}

/** Clips with sound that play under any of `music` (not one of them,
 * through compound clips too: lib/analysis/duck voicesUnder), the
 * built-in sound effects left out. */
function voicesUnder(music: MediaClip[]): (Target & Omit<VoiceUnder, "clip">)[] {
  const p = store.get().project;
  return voicesUnderMusic(p, music, (id) => ops.getAsset(p, id)?.hasAudio ?? false).flatMap((v) => {
    const asset = ops.getAsset(p, v.clip.assetId);
    return asset?.hasAudio && !SFX_FILES.has(asset.name) ? [{ ...v, asset }] : [];
  });
}

/** The built-in sound effects' file names (state/sfx.ts names them by label). */
const SFX_FILES = new Set(Object.values(SFX).map((s) => `${s.label}.wav`));

/** The music to duck: one clip, or every clip with sound on a track. */
function duckTargets(clipId: Id | undefined, trackId: Id | undefined): Target[] {
  if (!trackId) return [resolve("ducking", clipId)];
  if (clipId) throw new Error("Give clip_id (one music clip) or track_id (every clip on a music track), not both.");
  const t = store.get().project.tracks.find((x) => x.id === trackId);
  if (!t) throw new Error(`No track with id ${trackId}: describe_project lists the tracks`);
  if (t.locked) throw new Error(`Track ${t.name} is locked`);
  const out = t.clips.filter((c) => (c.type === "audio" || c.type === "video") && !c.disabled && !c.muted).map((c) => targetFor("ducking", c.id)).filter((x): x is Target => typeof x !== "string");
  if (!out.length) throw new Error(`Track ${t.name} has no clip with sound to duck`);
  return out;
}

/**
 * Dip music under the speech of every other clip with sound that plays
 * with it, as volume keyframes the user can adjust (one undo step;
 * existing volume keyframes are replaced): one clip, or every clip of a
 * track as one bed (a song cut into pieces), a line across a cut dipping
 * on both sides. Speech is wherever the silence detector finds no
 * silence; a line is one clip's speech, its pauses under a second
 * bridged. voice_above_music_lu aims the voice that far over the music
 * while it speaks (all lines together); min_line_lu holds every line to
 * at least that margin and max_line_lu (default lineCeiling) to at most,
 * each line dipping as deep as it needs and no deeper (ADR-104). All are
 * measured on the rendered stems and met by measuring again (ADR-096).
 * Each clip keeps how it was ducked (`duck`), so a voice line that
 * changes later can dip it again the same way.
 * ponytail: every other audible clip counts as speech, music included; a
 * speech/music classifier is the upgrade if mixed beds duck wrongly.
 */
export async function duckUnderSpeech(clipId?: Id, opts: DuckRequest = {}): Promise<DuckEdit> {
  const scope = projectWork.signal();
  const targets = duckTargets(clipId || undefined, opts.track_id || undefined);
  let depth = opts.depth ?? state.settings.ducking.depth;
  const target = opts.voice_above_music_lu;
  const minLine = opts.min_line_lu;
  const wrong = duckTargetsError(target, minLine, opts.max_line_lu);
  if (wrong) throw new Error(wrong);
  const measuring = target !== undefined || minLine !== undefined || opts.max_line_lu !== undefined;
  // A line never sits further over the music than this: a quiet passage
  // dips less instead of being emptied (ADR-104).
  const maxLine = measuring ? (opts.max_line_lu ?? lineCeiling(target, minLine)) : undefined;
  const original = store.get().project;
  const fps = store.get().project.fps;
  let voices = voicesUnder(targets.map((t) => t.clip));
  if (measuring) {
    const dialogIds = new Set(original.tracks.filter(t => isDialog(t, original)).flatMap(t => t.clips.map(c => c.id)));
    if (dialogIds.size) voices = voices.filter(v => dialogIds.has(v.clip.id));
  }
  if (!voices.length) {
    const msg = "No other clip with sound plays under it";
    toast(msg, "error");
    throw new Error(msg);
  }
  const named = targets.length > 1 ? `${targets.length} music clips` : targets[0].asset.name;
  // Each voice clip's speech, timeline frames.
  const perClip = await job("ducking", targets[0].clip, `Finding speech under ${named}`, async (progress, signal) => {
    const out: [number, number][][] = [];
    for (const [i, v] of voices.entries()) {
      const [from, to] = windowOf(v.clip);
      const pcm = await decodeMono(v.asset, from, to, SILENCE_RATE, (x) => progress((i + x) / voices.length), signal);
      const speech: Range[] = [];
      let at = 0;
      for (const r of findSilences(pcm, SILENCE_RATE).ranges) {
        if (r.start > at) speech.push({ start: from + at, end: from + r.start });
        at = r.end;
      }
      if (at < to - from) speech.push({ start: from + at, end: to });
      // Inside a compound clip, only where the compound clip plays it.
      out.push(framesOfRanges(v.clip, speech, fps).map(([a, b]): [number, number] => [Math.max(a, v.span[0]), Math.min(b, v.span[1])]).filter(([a, b]) => b > a));
    }
    return out;
  });
  scope.throwIfAborted();
  const cs = targets.map((t) => stillThere(t.clip.id));
  const ids = cs.map((c) => c.id);
  const frames = (s: number) => secondsToFrames(s, fps);
  const lo = Math.min(...cs.map((c) => c.start)), hi = Math.max(...cs.map((c) => c.start + c.duration));
  const under = (s: [number, number]) => cs.some((c) => s[0] < c.start + c.duration && s[1] > c.start);
  const inside = (s: [number, number]) => [Math.max(lo, s[0]), Math.min(hi, s[1])] as [number, number];
  // The lines: each clip's speech under the music, pauses under a second bridged.
  const lines = perClip.flatMap((spans) => speechWindows(spans.filter(under).map(inside).filter(([a, b]) => b > a), frames(1))).sort((x, y) => x[0] - y[0]);
  const spans = perClip.flat();
  const lineOf = spans.map(([a, b]) => lines.findIndex(([x, y]) => a < y && b > x));
  const shape = { attack: frames(0.1), release: frames(0.4), hold: frames(0.6) };
  const beds = cs.map((c) => ({ id: c.id, start: c.start, end: c.start + c.duration, base: c.volume }));
  const keysAt = (db: number, lineDb?: number[]) => trackDuckKeys(spans, beds, { depthDb: db, ...shape }, lineDb && spans.map((_, i) => (lineOf[i] >= 0 ? lineDb[lineOf[i]] : db)));
  let keys = keysAt(depth);
  let balance: DuckBalance | undefined;
  const withKeys = (p: typeof original, ks: typeof keys) => {
    for (const [id, list] of ks) {
      const c = ops.findClip(p, id)?.clip;
      if (!c) continue;
      if (c.keyframes?.volume?.length) p = runCommand(p, "remove_keyframes", { clip_id: id, path: "volume" });
      p = list.reduce((q, k) => runCommand(q, "add_keyframe", { clip_id: id, path: "volume", at: framesToSeconds(c.start + k.f, fps), value: k.v }), p);
    }
    return p;
  };
  if (measuring && !lines.length) {
    finish("ducking", "No speech found under it");
    return { voices: voices.length, dips: 0, keys: 0 };
  }
  let lineDb: number[] | undefined;
  if (measuring) {
    // One render of each stem over the lines serves every window inside it.
    const sec = (f: number) => framesToSeconds(f, fps);
    const t0 = sec(lines[0][0]), t1 = sec(Math.max(...lines.map((l) => l[1])));
    const win = lines.map(([a, b]) => [sec(a), sec(b)] as [number, number]);
    const stem = (p: typeof original, keep: string[]) => ({ ...p, tracks: p.tracks.map(t => ({ ...t, clips: t.clips.filter(x => keep.includes(x.id)) })) });
    const render = async (p: typeof original) => (await measureMix(p, t0, t1, { signal: scope })).steps;
    const voice = await render(stem(original, voices.map(v => v.top)));
    // Each line from its first word to its last: the voice's own steps say where.
    const said = win.map(([a, b]): [number, number] => activeSpan(voice, t0, a, b) ?? [a, b]);
    // Two voices at once count once.
    const speaking = speechWindows(said, 0.001);
    const speechLufs = (steps: number[]) => windowLoudness(steps, t0, speaking);
    const dialogLufs = speechLufs(voice);
    const flat = await render(stem(withKeys(original, keysAt(0)), ids));
    if (target !== undefined) {
      // Measure only while someone speaks. One window from the first word to
      // the last took in the bed between lines too, where the dip releases,
      // and the target then pushed every line's dip to its 40 dB limit.
      depth = +duckDepth(dialogLufs, speechLufs(flat), target).toFixed(1);
    } else if (opts.depth === undefined && minLine !== undefined) depth = 0;
    // Render the actual keyed bed: fades, gaps and effect tails can keep
    // the achieved attenuation from matching the requested depth.
    let bed = flat;
    keys = keysAt(depth);
    for (let attempt = 0; attempt < 4 && (target !== undefined || depth > 0); attempt++) {
      keys = keysAt(depth);
      bed = await render(stem(withKeys(original, keys), ids));
      if (target === undefined) break;
      const difference = loudnessDifference(dialogLufs, speechLufs(bed));
      if (difference === null) throw new Error("Cannot measure voice balance in this window.");
      if (Math.abs(target - difference) <= 0.5) break;
      const next = +Math.max(0, Math.min(40, depth + target - difference)).toFixed(1);
      if (next === depth || attempt === 3) break;
      depth = next;
    }
    // Every line between its minimum and its ceiling: a line short of the
    // minimum dips deeper, one past the ceiling (a quiet passage) less.
    let each = lineBalances(voice, bed, t0, said);
    // The lines between their minimum and ceiling, and together on the
    // speech target: a line held under the ceiling lifts the rest (ADR-107).
    const fit = (ds: number[]) => aimDepths(ds, each.map((l) => l.voice_above_music_lu), { target, speech: target === undefined ? null : loudnessDifference(dialogLufs, speechLufs(bed)), min: minLine, max: maxLine, floor: depth });
    lineDb = fit(said.map(() => depth));
    for (let attempt = 0; attempt < 4 && lineDb.some((d) => d !== depth); attempt++) {
      keys = keysAt(depth, lineDb);
      bed = await render(stem(withKeys(original, keys), ids));
      each = lineBalances(voice, bed, t0, said);
      const next = fit(lineDb);
      // The keys kept are the ones just measured.
      if (next.every((d, i) => d === lineDb![i]) || attempt === 3) break;
      lineDb = next;
    }
    scope.throwIfAborted();
    if (store.get().project !== original) throw new Error("The project changed while measuring; run duck_under_speech again.");
    const music = speechLufs(bed);
    const difference = loudnessDifference(dialogLufs, music);
    const r1 = (x: number | null) => (x === null || !Number.isFinite(x) ? null : +x.toFixed(1));
    // A line over the ceiling with no dip left is as low as the music goes.
    const lineMet = each.every((l, i) => l.voice_above_music_lu === null || ((minLine === undefined || l.voice_above_music_lu >= minLine - 0.05) && (maxLine === undefined || l.voice_above_music_lu <= maxLine + 0.05 || lineDb![i] === 0)));
    const speechMet = target === undefined || difference === null ? undefined : Math.abs(target - difference) <= 0.5;
    balance = {
      window: "speech",
      means: BALANCE_WINDOWS.speech,
      start: +t0.toFixed(3),
      end: +t1.toFixed(3),
      stretches: speaking.length,
      seconds: +speaking.reduce((n, [a, b]) => n + b - a, 0).toFixed(1),
      dialog_lufs: r1(dialogLufs),
      music_lufs: r1(music),
      voice_above_music_lu: r1(difference),
      ...(target !== undefined ? { target_lu: target } : {}),
      met: speechMet !== false && lineMet,
      per_line: {
        window: "line",
        means: BALANCE_WINDOWS.line,
        ...(marginSummary(each) ?? { lines: 0 }),
        ...(minLine !== undefined ? { min_target_lu: minLine } : {}),
        ...(maxLine !== undefined ? { max_target_lu: maxLine } : {}),
        met: lineMet,
        each: each.map((l, i) => ({ ...l, depth_db: lineDb?.[i] ?? depth })),
      },
    };
  }
  const all = [...keys.values()];
  const dips = cs.reduce((n, c, k) => n + all[k].filter((x, i) => x.v < c.volume && !(all[k][i - 1]?.v < c.volume)).length, 0);
  if (!dips && !measuring) {
    finish("ducking", "No speech found under it");
    return { voices: voices.length, dips: 0, keys: 0 };
  }
  // How it was asked, kept with each clip: a voice line that changes later
  // dips it again the same way (ADR-104).
  const record: Omit<DuckRecord, "keys"> = {
    ...(target !== undefined ? { voiceAboveMusicLu: target } : {}),
    ...(minLine !== undefined ? { minLineLu: minLine } : {}),
    ...(opts.max_line_lu !== undefined ? { maxLineLu: opts.max_line_lu } : {}),
    ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
    ...(opts.track_id ? { track: true } : {}),
  };
  edit(opts.label ?? "Duck under speech", (p) => ids.reduce((q, id) => ops.updateClip(q, id, (x) => ({ ...x, duck: { ...record, ...duckMark(x) } }) as Clip), withKeys(p, keys)));
  const deepest = lineDb ? Math.max(depth, ...lineDb) : depth;
  const least = lineDb ? Math.min(depth, ...lineDb) : depth;
  finish("ducking", deepest > least ? `Lowered ${least}-${deepest} dB under ${plural(lines.length, "line")}` : `Lowered ${depth} dB under ${plural(dips, "stretch", "stretches")} of speech`);
  // A song cut into pieces was ducked a piece at a time (film test 3.14).
  const home = opts.track_id ? undefined : ops.findClip(store.get().project, ids[0])?.track;
  const more = home ? home.clips.filter((x) => x.id !== ids[0] && (x.type === "audio" || x.type === "video")).length : 0;
  const note = home && more ? `Only ${ids[0]} was ducked; its track ${home.id} plays ${more} more ${more === 1 ? "clip" : "clips"}: duck_under_speech track_id ${home.id} ducks them all as one bed.` : undefined;
  return { voices: voices.length, dips, keys: all.reduce((n, k) => n + k.length, 0), depth_db: depth, ...(opts.track_id ? { clips: ids } : {}), ...(balance ? { balance } : {}), ...(note ? { note } : {}) };
}

export interface DenoiseEdit {
  /** The cleaned sound's new media. */
  assetId: Id;
  /** The clip that now plays it (a video's sound is extracted first). */
  clipId: Id;
}

/**
 * CapCut's Reduce noise: clean the clip's sound with a spectral gate
 * (src/lib/analysis/denoise.ts) and play the cleaned copy instead, as one
 * undoable edit. A video's own sound is extracted to an audio clip first,
 * as CapCut does, so the picture keeps its original file. The cleaned
 * copy is a new WAV of exactly the clip's source window.
 */
export async function reduceNoise(clipId?: Id, opts: Partial<DenoiseSettings> = {}): Promise<DenoiseEdit> {
  const scope = projectWork.signal();
  const { clip, asset } = resolve("denoise", clipId);
  const strength = opts.strength ?? state.settings.denoise.strength;
  const file = await job("denoise", clip, `Reducing noise in ${asset.name}`, async (progress, signal) => {
    const [from, to] = windowOf(clip);
    const { rate, channels } = await decodePcm(asset, from, to, (x) => progress(x * 0.7), signal);
    if (!channels[0]?.length) throw new Error("The clip has no sound to clean");
    progress(0.75);
    // Let the progress paint before the (synchronous) pass.
    await new Promise((r) => setTimeout(r, 0));
    const clean = denoise(channels, { strength });
    signal.throwIfAborted();
    progress(0.95);
    return new File([encodeWav(clean, rate)], `${asset.name.replace(/\.[^.]+$/, "")} (noise reduced).wav`, { type: "audio/wav" });
  });
  scope.throwIfAborted();
  const [cleaned] = await adoptAndImport([file]);
  scope.throwIfAborted();
  const c = stillThere(clip.id);
  let target = c.id;
  edit("Reduce noise", (p) => {
    if (c.type === "video") {
      const before = new Set(p.tracks.flatMap((t) => t.clips.map((x) => x.id)));
      p = ops.detachAudio(p, c.id);
      target = p.tracks.flatMap((t) => t.clips).find((x) => !before.has(x.id))?.id ?? c.id;
    }
    return replaceClip(p, target, cleaned);
  });
  finish("denoise", `Reduced noise in ${asset.name}`);
  return { assetId: cleaned.id, clipId: target };
}

export interface StabilizeEdit {
  frames: number;
  /** The zoom that hides the uncovered edges. */
  zoom: number;
}

/**
 * CapCut's Stabilize: measure the camera's shake across the clip's source
 * window, then store per-frame corrections (src/lib/analysis/stabilize.ts)
 * that preview and export apply. Level "off" removes them. One undo step.
 */
export async function stabilizeClip(clipId?: Id, opts: { level?: StabilizeLevel | "off" } = {}): Promise<StabilizeEdit> {
  const scope = projectWork.signal();
  const { clip, asset } = resolve("stabilize", clipId);
  const level = opts.level ?? state.settings.stabilize.level;
  if (level === "off") {
    store.edit("Remove stabilization", (p) => ops.updateClip(p, clip.id, (c) => {
      const { stabilize: _, ...rest } = c as VideoClip;
      return rest as VideoClip;
    }));
    return { frames: 0, zoom: 1 };
  }
  const data = await job("stabilize", clip, `Stabilizing ${asset.name}`, async (progress, signal) => {
    const [a, b] = windowOf(clip);
    const from = Math.min(a, b), to = Math.max(a, b);
    const times: number[] = [];
    const moves: { dx: number; dy: number }[] = [];
    let prev: ReturnType<typeof spectrum> | null = null;
    await frameGrays(asset, from, to, AW, AH, (t, gray) => {
      const s = spectrum(gray);
      if (prev) moves.push(shiftBetween(prev, s));
      prev = s;
      times.push(t);
    }, progress, signal);
    if (times.length < 2) throw new Error("The clip is too short to stabilize");
    // ponytail: a constant rate; variable-frame-rate phone footage is
    // indexed by its average rate, close enough for a smooth path.
    const rate = (times.length - 1) / (times[times.length - 1] - times[0]);
    return { level, from: times[0], rate, ...stabilization(moves, level, rate) };
  });
  scope.throwIfAborted();
  const c = stillThere(clip.id);
  store.edit("Stabilize", (p) => ops.updateClip(p, c.id, (x) => ({ ...x, stabilize: data }) as VideoClip));
  finish("stabilize", `Stabilized ${asset.name}, zoomed ${Math.round((data.zoom - 1) * 100)}%`);
  return { frames: data.x.length, zoom: data.zoom };
}

// ---- sync audio ------------------------------------------------------------------

export interface SyncEdit {
  /** The audio clip, now in sync. */
  clipId: Id;
  /** The video it was synced to. */
  videoId: Id;
  /** Seconds: the audio's source time minus the video's for one moment. */
  offset: number;
  /** 0..1, how clearly the best match stands out (MIN_CONFIDENCE up). */
  confidence: number;
  /** Where the audio clip starts now (timeline seconds) and its in-point
   * (source seconds). */
  start: number;
  in: number;
  /** The video's own sound was set to volume 0. */
  muted: boolean;
}

/** Throw `msg` as a toast and an error, for refusals before a job starts. */
function refuse(msg: string): never {
  toast(msg, "error");
  throw new Error(msg);
}

/** The camera clip to sync `audio` to: `videoId`, else the selected video
 * clip with sound, else the one that plays with it longest. */
function cameraFor(audio: AudioClip, videoId?: Id): VideoClip {
  const p = store.get().project;
  if (videoId) {
    const v = ops.findClip(p, videoId)?.clip;
    if (!v) refuse(`No clip with id ${videoId}`);
    if (v.type !== "video") refuse("Sync the audio to a video clip");
    return v;
  }
  const videos = p.tracks.flatMap((t) => t.clips).filter((c): c is VideoClip => c.type === "video" && !!ops.getAsset(p, c.assetId)?.hasAudio);
  const picked = videos.find((v) => store.get().selection.includes(v.id));
  if (picked) return picked;
  const overlap = (v: VideoClip) => Math.min(v.start + v.duration, audio.start + audio.duration) - Math.max(v.start, audio.start);
  const under = videos.filter((v) => overlap(v) > 0).sort((a, b) => overlap(b) - overlap(a))[0];
  return under ?? refuse("Select the video clip to sync to as well");
}

/**
 * CapCut's Sync video and audio, Resolve's Auto Sync Audio > Based on
 * Waveform: find where a separately recorded sound (a lav, a recorder)
 * lines up with the camera's own sound by matching their waveforms
 * (lib/analysis/sync.ts), then move the audio clip into sync, exact to the
 * sample (sync_to_clip), as one undo step. Refuses when the sounds do not
 * clearly match. muteCamera sets the video's volume to 0.
 */
export async function syncAudio(clipId?: Id, opts: { videoId?: Id; muteCamera?: boolean } = {}): Promise<SyncEdit> {
  const scope = projectWork.signal();
  const t = targetFor("sync", clipId);
  if (typeof t === "string") refuse(t);
  const { clip, asset } = t;
  const video = cameraFor(clip as AudioClip, opts.videoId);
  const p = store.get().project;
  const vAsset = ops.getAsset(p, video.assetId);
  if (!vAsset) refuse("The video's media is missing");
  if (!vAsset.hasAudio) refuse(`${vAsset.name} has no sound of its own to sync to`);
  const why = syncProblem(p, clip.id, video.id);
  if (why) refuse(why);
  const muteCamera = opts.muteCamera ?? state.settings.sync.camera === "mute";
  const match = await job("sync", clip, `Syncing ${asset.name} to ${vAsset.name}`, async (progress, signal) => {
    const [vFrom, vTo] = windowOf(video);
    const [aFrom, aTo] = windowOf(clip);
    const ref = await decodeMono(vAsset, vFrom, vTo, SYNC_RATE, (x) => progress(x * 0.4), signal);
    const other = await decodeMono(asset, aFrom, aTo, SYNC_RATE, (x) => progress(0.4 + x * 0.5), signal);
    progress(0.92, "Matching the waveforms");
    // Let the progress paint before the (synchronous) match.
    await new Promise((r) => setTimeout(r, 0));
    const m = findLag(ref, other, SYNC_RATE);
    if (!m.score) throw new Error("One of the clips is silent where it plays, so there is nothing to match");
    if (m.confidence < MIN_CONFIDENCE) throw new Error(`The two sounds don't match clearly enough to sync (confidence ${Math.round(m.confidence * 100)}%). Are they the same take?`);
    return { ...m, offset: aFrom - vFrom + m.lag };
  });
  scope.throwIfAborted();
  const a = stillThere(clip.id), v = stillThere(video.id);
  edit("Sync audio", (q) => runCommand(q, "sync_to_clip", { clip_id: a.id, to_clip_id: v.id, offset: match.offset, mute_reference: muteCamera }));
  const now = ops.findClip(store.get().project, a.id)!.clip as AudioClip;
  finish("sync", `Synced ${asset.name} to ${vAsset.name}${muteCamera ? ", camera sound muted" : ""}`);
  const fps = store.get().project.fps;
  return { clipId: a.id, videoId: v.id, offset: +match.offset.toFixed(4), confidence: +match.confidence.toFixed(3), start: +framesToSeconds(now.start, fps).toFixed(4), in: +now.in.toFixed(4), muted: muteCamera };
}

// ---- auto reframe ----------------------------------------------------------------

export interface ReframeEdit {
  width: number;
  height: number;
  /** Frames followed, and those the subject was lost on (held in place). */
  frames: number;
  lost: number;
}

/**
 * CapCut's and Premiere's Auto reframe: the canvas takes the new shape
 * (its short side kept), the subject is followed through the whole clip
 * from a box (fractions of the picture; default a square at its center,
 * where a framed subject starts), and the clip fills the canvas with
 * position keyframes that keep the subject centered (state/tracking.ts,
 * ADR-054). One undo step. The inspector's Tracking > Keep subject
 * centered does the same from a box placed on the viewer.
 */
export async function reframeClip(clipId?: Id, opts: Partial<ReframeSettings> & { box?: Region } = {}): Promise<ReframeEdit> {
  const scope = projectWork.signal();
  const { clip, asset } = resolve("reframe", clipId);
  const ratio = opts.ratio ?? state.settings.reframe.ratio;
  const p0 = store.get().project;
  const video = clip as VideoClip;
  const [rw, rh] = ratio === "keep" ? [p0.width, p0.height] : ratio.split(":").map(Number);
  const [width, height] = ratio === "keep" ? [p0.width, p0.height] : canvasSize(rw, rh, Math.min(p0.width, p0.height));
  const region = opts.box ?? centerRegion(p0, video);
  const { path, lost } = await job("reframe", clip, `Reframing ${asset.name}`, (progress, signal) =>
    trackPath(p0, video, asset, region, video.start, video.start + video.duration, progress, signal),
  );
  scope.throwIfAborted();
  const c = stillThere(clip.id);
  store.edit("Auto reframe", (p) => applyTrack({ ...p, width, height, canvasFixed: true }, c.id, c.id, path, c.start, "center"));
  finish("reframe", lost > path.times.length / 4 ? `Reframed ${asset.name}, but lost the subject on ${plural(lost, "frame")}` : `Reframed ${asset.name} to ${width}×${height}`);
  return { width, height, frames: path.times.length, lost };
}

// ---- remove background -----------------------------------------------------------

/** Mattes made this session, so undoing past one and turning Remove
 * background on again does not process the clip again. */
const madeMattes: (Cutout & { asset: string })[] = [];

/** An existing matte of this asset that covers [from, to]: on any clip of
 * the project, or made earlier this session. */
function findMatte(asset: Asset, from: number, to: number): Cutout | undefined {
  const p = store.get().project;
  const onClips = p.tracks.flatMap((t) => t.clips).flatMap((c) => (c.type === "video" && c.assetId === asset.id && c.cutout ? [c.cutout] : []));
  const key = asset.proxy ?? asset.src;
  const m = [...onClips, ...madeMattes.filter((x) => x.asset === key)].find((x) => covers(x, from, to));
  return m && { enabled: true, src: m.src, from: m.from, to: m.to, model: m.model };
}

export interface CutoutResult {
  clipId: Id;
  /** True when an existing matte was reused (instant). */
  cached: boolean;
  frames?: number;
  /** Frames processed per second. */
  fps?: number;
  /** Wall-clock seconds, the model download included. */
  seconds?: number;
  /** Why the light model made the matte, when the quality one couldn't run. */
  fellBack?: string;
  model: string;
  device?: string;
  matte: string;
}

/** A clip's matte, ready to put on it: its own or another of the asset's
 * that covers it (instant), or one made now as the cutout job. Edits
 * nothing, so a caller can apply it with other changes in one undo step. */
export async function matteFor(clipId?: Id): Promise<{ clipId: Id; cutout: Cutout; result: CutoutResult; note: string }> {
  const { clip, asset } = resolve("cutout", clipId);
  const fps = store.get().project.fps;
  const [from, to] = clipWindow(clip as VideoClip, fps, asset.fps);
  const own = (clip as VideoClip).cutout;
  const ready = own && covers(own, from, to) ? { ...own, enabled: true } : findMatte(asset, from, to);
  if (ready) return { clipId: clip.id, cutout: ready, result: { clipId: clip.id, cached: true, model: ready.model, matte: ready.src }, note: "Background removed" };
  const scope = projectWork.signal();
  const started = performance.now();
  // Starting the model takes a moment even when it is cached.
  const made = await job("cutout", clip, "Starting the background model", async (progress, signal) => {
    const m = await makeMatte(
      asset,
      from,
      to,
      (s) => (s.stage === "downloading" ? progress(s.progress, `Downloading the background model (${s.model.size})`) : progress(s.progress, `Removing the background of ${asset.name}`)),
      signal,
    );
    // Stored like imported media: OPFS on the web, app data on desktop.
    const [file] = await platform.adoptFiles([new File([m.bytes as Uint8Array<ArrayBuffer>], `matte-${asset.name.replace(/\.[^.]+$/, "")}.mp4`, { type: "video/mp4" })]);
    return { ...m, src: file.src };
  });
  scope.throwIfAborted();
  const cutout: Cutout = { enabled: true, src: made.src, from: made.from, to: made.to, model: made.model };
  madeMattes.push({ ...cutout, asset: asset.proxy ?? asset.src });
  const seconds = (performance.now() - started) / 1000;
  // The light model's edge is coarser: say why it was used.
  const light = made.fellBack ? " with the light model (this computer's graphics couldn't run the detailed one)" : "";
  return {
    clipId: clip.id,
    cutout,
    result: { clipId: clip.id, cached: false, frames: made.frames, fps: +made.fps.toFixed(1), seconds: +seconds.toFixed(2), model: made.model, device: made.device, matte: made.src, ...(made.fellBack ? { fellBack: made.fellBack } : {}) },
    note: `Background removed${light} · ${plural(made.frames, "frame")} in ${seconds.toFixed(1)} s`,
  };
}

/**
 * CapCut's Remove background: make the clip's background matte on this
 * machine (once; progress and cancel like the other tools) and turn it
 * on, as one undoable edit. A clip whose matte already exists, or whose
 * asset has one covering it, turns on instantly.
 */
export async function removeBackground(clipId?: Id): Promise<CutoutResult> {
  const m = await matteFor(clipId);
  const c = stillThere(m.clipId);
  // A look change, like the inspector's: store.edit, because edit()'s
  // settle would let the magnet close gaps on the main track.
  store.edit("Remove background", (p) => ops.setCutout(p, c.id, m.cutout));
  finish("cutout", m.note);
  return m.result;
}

/** Pictures cut out this session, by source, so asking again is instant. */
const cutPictures = new Map<string, Asset>();

/** A picture clip's subject as a new picture with its background
 * transparent (engine/cutout.ts cutOutImage), made once a session. */
async function cutOutPicture(clip: ImageClip): Promise<{ asset: Asset; cached: boolean; model: string; note: string }> {
  const asset = ops.getAsset(store.get().project, clip.assetId);
  if (!asset) throw new Error("Its picture is missing");
  const have = cutPictures.get(asset.src);
  if (have) return { asset: have, cached: true, model: "", note: "Text placed behind the subject" };
  const made = await job("cutout", clip as unknown as MediaClip, "Starting the background model", async (progress, signal) => {
    const r = await cutOutImage(asset, (s) => (s.stage === "downloading" ? progress(s.progress, `Downloading the background model (${s.model.size})`) : progress(s.progress, `Cutting out ${asset.name}`)), signal);
    const name = `${asset.name.replace(/\.[^.]+$/, "")} (cut out).png`;
    const [file] = await platform.adoptFiles([new File([r.blob], name, { type: "image/png" })]);
    return { ...r, file, name };
  });
  const cut: Asset = { id: uid("a"), kind: "image", name: made.name, src: made.file.src, size: made.file.size, duration: 0, width: made.width, height: made.height, hasVideo: true, hasAudio: false };
  cutPictures.set(asset.src, cut);
  return { asset: cut, cached: false, model: made.model, note: made.fellBack ? "Text placed behind the subject with the light model" : "Text placed behind the subject" };
}

/**
 * The "text behind the subject" look: the clip's subject alone (a video's
 * matte, made or reused as Remove background does; a picture cut out into
 * a new picture), then, in one undo step, a copy of the clip showing only
 * the subject above the titles (lib/ads.ts putBehindSubject). Titles
 * below the clip are lifted above it first.
 */
export async function textBehindSubject(clipId: Id, opts: { textIds?: Id[] } = {}): Promise<{ subjectClipId: Id; textClipIds: Id[]; cached: boolean; model: string; placed: BehindPlace; graded?: GradeCopied[]; note: string }> {
  const ids = opts.textIds ?? [];
  const problem = behindProblem(store.get().project, clipId, ids);
  if (problem) throw new Error(problem);
  const scope = projectWork.signal();
  const clip = ops.findClip(store.get().project, clipId)!.clip;
  let cut: SubjectCut, cached: boolean, model: string, note: string;
  if (clip.type === "image") {
    const r = await cutOutPicture(clip);
    ({ cached, model, note } = r);
    cut = { asset: r.asset };
  } else {
    const m = await matteFor(clipId);
    stillThere(m.clipId);
    cut = { cutout: m.cutout };
    cached = m.result.cached;
    model = m.cutout.model;
    note = m.note.replace("Background removed", "Text placed behind the subject");
  }
  scope.throwIfAborted();
  const again = behindProblem(store.get().project, clipId, ids);
  if (again) throw new Error(again);
  let made: ReturnType<typeof putBehindSubject> | undefined;
  store.edit("Text behind subject", (p) => {
    made = putBehindSubject(p, clipId, ids, cut);
    return made.project;
  });
  finish("cutout", note);
  const { subjectId, placed, graded } = made!;
  // Where the copy went, and the grade it took (ADR-103): said, so an
  // agent knows the copy is a clip of its own to keep in step.
  const said = [
    `The subject's copy (${subjectId}) is on a new track "${placed.track}", right above "${placed.above}"${ids.length > 1 ? ", the highest of the titles' tracks" : ", the title's track"}.`,
    graded.length
      ? `It sits above ${graded.length === 1 ? "an adjustment layer that grades" : `${graded.length} adjustment layers that grade`} the clip under it (${graded.map((g) => g.adjustment_clip_id).join(", ")}), so it took that grade itself: ${graded.flatMap((g) => g.copied).join(", ")}. A grade changed later goes on the copy too (set_filter, set_param on ${subjectId}).`
      : "No adjustment layer lies between it and the clip, so it is graded as the clip is.",
  ].join(" ");
  return { subjectClipId: subjectId, textClipIds: ids, cached, model, placed, ...(graded.length ? { graded } : {}), note: said };
}

/** The inspector's switch: on makes or reuses the matte, off keeps it. */
export async function setBackgroundRemoval(clipId: Id, on: boolean): Promise<void> {
  if (on) {
    await removeBackground(clipId);
    return;
  }
  store.edit("Remove background off", (p) => runCommand(p, "set_background_removal", { clip_ids: [clipId], enabled: false }));
}
