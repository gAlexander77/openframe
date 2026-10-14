// The local AI tools as app actions: analyze a clip's source (engine), turn
// the result into edits with registry commands (cut_ranges, split_at_times,
// add_markers), and apply them as ONE undoable edit with a clear label
// (ADR-019). Also the small state the AI tools panel shows: each tool's
// settings, the running job and its progress, and the last result.
//
// Everything runs on the user's machine: decode with WebCodecs, analyze in
// TypeScript. Nothing is uploaded and nothing needs a key.

import { useSyncExternalStore } from "react";
import { decodeMono, frameScores, measureLoudness } from "../engine/analyze";
import { makeMatte, matteModel } from "../engine/cutout";
import { detectBeats } from "../lib/analysis/beats";
import { duckKeys } from "../lib/analysis/duck";
import { normalizeGain, type Normalization } from "../lib/analysis/loudness";
import { sceneCuts } from "../lib/analysis/scenes";
import { findSilences, totalLength, type Range } from "../lib/analysis/silence";
import { runCommand } from "../lib/commands";
import { clipWindow, covers } from "../lib/matte";
import { frameOfSource, framesOfRanges } from "../lib/project/cut";
import * as ops from "../lib/project/ops";
import type { Asset, AudioClip, Cutout, Id, VideoClip } from "../lib/project/types";
import { framesToSeconds, secondsToFrames } from "../lib/time";
import { platform } from "../platform";
import { edit } from "./actions";
import { store } from "./store";
import { dismiss, toast, updateToast } from "./toast";

export type ToolId = "silences" | "scenes" | "beats" | "loudness" | "ducking" | "cutout";

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

export interface AiSettings {
  silences: SilenceSettings;
  scenes: SceneSettings;
  beats: BeatSettings;
  loudness: LoudnessSettings;
  ducking: DuckSettings;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  silences: { sensitivity: 0.5, minSilence: 0.4, padding: 0.1 },
  scenes: { sensitivity: 0.5, minScene: 0.5, detector: "adaptive", output: "split" },
  beats: { every: 1 },
  // YouTube, TikTok, Spotify and most social players normalize to about -14.
  loudness: { target: -14 },
  // Ducking guides put music 10-15 dB under dialogue.
  ducking: { depth: 12 },
};

export interface AiJob {
  clipId: Id;
  /** 0..1 */
  progress: number;
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
  scenes: "a video clip",
  beats: "a music or video clip with sound",
  loudness: "video or audio clips with sound",
  ducking: "a music clip with speech under it",
  cutout: "a video clip of a person",
};

/** Whether `tool` can analyze this clip, and why not. */
function fit(tool: ToolId, clip: MediaClip, asset: Asset | undefined): string | null {
  if (!asset) return "Its media is missing";
  if (clip.freeze) return "A freeze frame has no source to analyze";
  if (tool === "scenes" || tool === "cutout") return clip.type === "video" && asset.hasVideo ? null : `Needs ${NEEDS[tool]}`;
  // ponytail: one static gain per clip; keyframed volume would need every
  // key scaled, so those clips are left to the user.
  if (tool === "loudness" && clip.keyframes?.volume?.length) return "Its volume is keyframed";
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
  const tid = toast(label, "progress");
  updateToast(tid, { progress: 0 });
  const progress = (x: number, text?: string) => {
    updateToast(tid, { progress: x, ...(text ? { text } : {}) });
    const j = state.jobs[tool];
    if (j) set({ jobs: { ...state.jobs, [tool]: { ...j, progress: x } } });
  };
  set({ jobs: { ...state.jobs, [tool]: { clipId: clip.id, progress: 0, abort } } });
  try {
    return await work(progress, abort.signal);
  } catch (e) {
    if (abort.signal.aborted) toast("Canceled");
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
  const id = resolve("silences", clipId).clip.id;
  const res = await analyzeSilences(id, opts);
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

export interface SceneEdit extends SceneAnalysis {
  output: "split" | "markers";
}

/** Split a clip at its scene cuts (or mark them) as one undoable edit. */
export async function splitScenes(clipId?: Id, opts: Partial<SceneSettings> = {}): Promise<SceneEdit> {
  const id = resolve("scenes", clipId).clip.id;
  const o = { ...state.settings.scenes, ...opts };
  const res = await analyzeScenes(id, o);
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

export interface BeatEdit extends BeatAnalysis {
  markers: number;
}

/** Drop a marker on every (Nth) beat of a clip as one undoable edit. */
export async function markBeats(clipId?: Id, opts: Partial<BeatSettings> = {}): Promise<BeatEdit> {
  const id = resolve("beats", clipId).clip.id;
  const every = opts.every ?? state.settings.beats.every;
  const res = await analyzeBeats(id);
  const clip = stillThere(id);
  const picked = res.beats.filter((_, i) => i % every === 0);
  if (!picked.length) {
    finish("beats", "No beat found");
    return { ...res, markers: 0 };
  }
  const times = timelineTimes(clip, picked);
  const before = store.get().project.markers.length;
  edit(`Mark ${plural(times.length, "beat")}`, (p) => runCommand(p, "add_markers", { times, label: "Beat", color: "#f5c543" }));
  const markers = store.get().project.markers.length - before;
  finish("beats", markers ? `Marked ${plural(markers, "beat")} · ${Math.round(res.bpm)} BPM` : `Every beat is already marked · ${Math.round(res.bpm)} BPM`);
  return { ...res, markers };
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
export async function normalizeLoudness(clipIds?: Id[], opts: Partial<LoudnessSettings> = {}): Promise<LoudnessResult[]> {
  const target = opts.target ?? state.settings.loudness.target;
  const ids = clipIds ?? store.get().selection;
  const targets = ids.map((id) => targetFor("loudness", id)).filter((t): t is Target => typeof t !== "string");
  if (!targets.length) throw new Error(ids.length ? String(targetFor("loudness", ids[0])) : `Select ${NEEDS.loudness} on the timeline`);
  const label = targets.length === 1 ? `Measuring the loudness of ${targets[0].asset.name}` : `Measuring the loudness of ${plural(targets.length, "clip")}`;
  const measured = await job("loudness", targets[0].clip, label, async (progress, signal) => {
    const out: { clipId: Id; lufs: number; peak: number }[] = [];
    for (const [i, { clip, asset }] of targets.entries()) {
      const [from, to] = windowOf(clip);
      const r = await measureLoudness(asset, from, to, (x) => progress((i + x) / targets.length), signal);
      out.push({ clipId: clip.id, ...r });
    }
    return out;
  });
  const results = measured.map((m) => ({ clipId: m.clipId, lufs: +m.lufs.toFixed(2), ...normalizeGain(m.lufs, target, m.peak) }));
  const live = results.filter((r) => Number.isFinite(r.lufs) && ops.findClip(store.get().project, r.clipId));
  if (!live.length) {
    finish("loudness", "Only silence, so nothing changed");
    return results;
  }
  edit(live.length === 1 ? "Normalize loudness" : `Normalize loudness of ${plural(live.length, "clip")}`, (p) =>
    live.reduce((q, r) => runCommand(q, "set_param", { clip_ids: [r.clipId], path: "volume", value: r.gain }), p),
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
}

/** Clips with sound that play under `clip`: not muted, not disabled. */
function voicesUnder(clip: MediaClip): Target[] {
  const p = store.get().project;
  const end = clip.start + clip.duration;
  return p.tracks
    .filter((t) => !t.muted)
    .flatMap((t) => t.clips)
    .filter((c): c is MediaClip => (c.type === "video" || c.type === "audio") && c.id !== clip.id && !c.disabled && !c.muted && c.volume > 0 && !c.freeze)
    .filter((c) => c.start < end && c.start + c.duration > clip.start)
    .flatMap((c) => {
      const asset = ops.getAsset(p, c.assetId);
      return asset?.hasAudio ? [{ clip: c, asset }] : [];
    });
}

/**
 * Dip a music clip under the speech of every other clip with sound that
 * plays with it, as volume keyframes the user can adjust (one undo step;
 * existing volume keyframes are replaced). Speech is wherever the silence
 * detector finds no silence.
 * ponytail: every other audible clip counts as speech, music included; a
 * speech/music classifier is the upgrade if mixed beds duck wrongly.
 */
export async function duckUnderSpeech(clipId?: Id, opts: Partial<DuckSettings> = {}): Promise<DuckEdit> {
  const { clip, asset } = resolve("ducking", clipId);
  const depth = opts.depth ?? state.settings.ducking.depth;
  const fps = store.get().project.fps;
  const voices = voicesUnder(clip);
  if (!voices.length) {
    const msg = "No other clip with sound plays under it";
    toast(msg, "error");
    throw new Error(msg);
  }
  const spans = await job("ducking", clip, `Finding speech under ${asset.name}`, async (progress, signal) => {
    const out: [number, number][] = [];
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
      out.push(...framesOfRanges(v.clip, speech, fps));
    }
    return out;
  });
  const c = stillThere(clip.id);
  const frames = (s: number) => secondsToFrames(s, fps);
  const keys = duckKeys(spans, c.start, c.start + c.duration, c.volume, { depthDb: depth, attack: frames(0.1), release: frames(0.4), hold: frames(0.6) });
  const dips = keys.filter((k, i) => k.v < c.volume && !(keys[i - 1]?.v < c.volume)).length;
  if (!dips) {
    finish("ducking", "No speech found under it");
    return { voices: voices.length, dips: 0, keys: 0 };
  }
  edit("Duck under speech", (p) => {
    if (c.keyframes?.volume?.length) p = runCommand(p, "remove_keyframes", { clip_id: c.id, path: "volume" });
    return keys.reduce((q, k) => runCommand(q, "add_keyframe", { clip_id: c.id, path: "volume", at: framesToSeconds(c.start + k.f, fps), value: k.v }), p);
  });
  finish("ducking", `Lowered ${depth} dB under ${plural(dips, "stretch", "stretches")} of speech`);
  return { voices: voices.length, dips, keys: keys.length };
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
  model: string;
  device?: string;
  matte: string;
}

/**
 * CapCut's Remove background: make the clip's background matte on this
 * machine (once; progress and cancel like the other tools) and turn it
 * on, as one undoable edit. A clip whose matte already exists, or whose
 * asset has one covering it, turns on instantly.
 */
export async function removeBackground(clipId?: Id): Promise<CutoutResult> {
  const { clip, asset } = resolve("cutout", clipId);
  const fps = store.get().project.fps;
  const [from, to] = clipWindow(clip as VideoClip, fps, asset.fps);
  const own = (clip as VideoClip).cutout;
  const ready = own && covers(own, from, to) ? { ...own, enabled: true } : findMatte(asset, from, to);
  if (ready) {
    edit("Remove background", (p) => ops.setCutout(p, clip.id, ready));
    finish("cutout", "Background removed");
    return { clipId: clip.id, cached: true, model: ready.model, matte: ready.src };
  }
  const model = await matteModel();
  const started = performance.now();
  const made = await job("cutout", clip, `Removing the background of ${asset.name}`, async (progress, signal) => {
    const m = await makeMatte(
      asset,
      from,
      to,
      (s) => (s.stage === "downloading" ? progress(0, `Downloading the background model (${model.size})`) : progress(s.progress, `Removing the background of ${asset.name}`)),
      signal,
    );
    // Stored like imported media: OPFS on the web, app data on desktop.
    const [file] = await platform.adoptFiles([new File([m.bytes as Uint8Array<ArrayBuffer>], `matte-${asset.name.replace(/\.[^.]+$/, "")}.mp4`, { type: "video/mp4" })]);
    return { ...m, src: file.src };
  });
  const cutout: Cutout = { enabled: true, src: made.src, from: made.from, to: made.to, model: made.model };
  madeMattes.push({ ...cutout, asset: asset.proxy ?? asset.src });
  const c = stillThere(clip.id);
  edit("Remove background", (p) => ops.setCutout(p, c.id, cutout));
  const seconds = (performance.now() - started) / 1000;
  finish("cutout", `Background removed · ${plural(made.frames, "frame")} in ${seconds.toFixed(1)} s`);
  return { clipId: clip.id, cached: false, frames: made.frames, fps: +made.fps.toFixed(1), seconds: +seconds.toFixed(2), model: made.model, device: made.device, matte: made.src };
}

/** The inspector's switch: on makes or reuses the matte, off keeps it. */
export async function setBackgroundRemoval(clipId: Id, on: boolean): Promise<void> {
  if (on) {
    await removeBackground(clipId);
    return;
  }
  edit("Remove background off", (p) => runCommand(p, "set_background_removal", { clip_ids: [clipId], enabled: false }));
}
