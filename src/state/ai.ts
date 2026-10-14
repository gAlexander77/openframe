// The local AI tools as app actions: analyze a clip's source (engine), turn
// the result into edits with registry commands (cut_ranges, split_at_times,
// add_markers), and apply them as ONE undoable edit with a clear label
// (ADR-019). Also the small state the AI tools panel shows: each tool's
// settings, the running job and its progress, and the last result.
//
// Everything runs on the user's machine: decode with WebCodecs, analyze in
// TypeScript. Nothing is uploaded and nothing needs a key.

import { useSyncExternalStore } from "react";
import { decodeMono, frameScores } from "../engine/analyze";
import { detectBeats } from "../lib/analysis/beats";
import { sceneCuts } from "../lib/analysis/scenes";
import { findSilences, totalLength, type Range } from "../lib/analysis/silence";
import { runCommand } from "../lib/commands";
import { frameOfSource, framesOfRanges } from "../lib/project/cut";
import * as ops from "../lib/project/ops";
import type { Asset, AudioClip, Id, VideoClip } from "../lib/project/types";
import { framesToSeconds } from "../lib/time";
import { edit } from "./actions";
import { store } from "./store";
import { dismiss, toast, updateToast } from "./toast";

export type ToolId = "silences" | "scenes" | "beats";

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

export interface AiSettings {
  silences: SilenceSettings;
  scenes: SceneSettings;
  beats: BeatSettings;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  silences: { sensitivity: 0.5, minSilence: 0.4, padding: 0.1 },
  scenes: { sensitivity: 0.5, minScene: 0.5, detector: "adaptive", output: "split" },
  beats: { every: 1 },
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
  setSettings<T extends ToolId>(tool: T, patch: Partial<AiSettings[T]>) {
    set({ settings: { ...state.settings, [tool]: { ...state.settings[tool], ...patch } } });
  },
  resetSettings(tool: ToolId) {
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

const NEEDS: Record<ToolId, string> = {
  silences: "a video or audio clip with sound",
  scenes: "a video clip",
  beats: "a music or video clip with sound",
};

/** Whether `tool` can analyze this clip, and why not. */
function fit(tool: ToolId, clip: MediaClip, asset: Asset | undefined): string | null {
  if (!asset) return "Its media is missing";
  if (clip.freeze) return "A freeze frame has no source to analyze";
  if (tool === "scenes") return clip.type === "video" && asset.hasVideo ? null : `Needs ${NEEDS.scenes}`;
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
 * toast and the card's progress, cancelable, errors shown as toasts. */
async function job<T>(tool: ToolId, clip: MediaClip, label: string, work: (progress: (x: number) => void, signal: AbortSignal) => Promise<T>): Promise<T> {
  if (state.jobs[tool]) throw new Error("Already running");
  const abort = new AbortController();
  const tid = toast(label, "progress");
  updateToast(tid, { progress: 0 });
  const progress = (x: number) => {
    updateToast(tid, { progress: x });
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
  finish("beats", `Marked ${plural(markers, "beat")} · ${Math.round(res.bpm)} BPM`);
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
