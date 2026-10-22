import { ByteLru, retainedBytes } from "../lib/memory";
import { MiB, trackCache } from "../engine/memory";
import { useSyncExternalStore } from "react";
import { sparseSceneCuts, streamMono } from "../engine/analyze";
import { findHighlights, HighlightAudio, refineHighlight, type Highlight, type HighlightFeature, type HighlightOptions } from "../lib/analysis/highlights";
import { sourceToTimeline } from "../lib/analysis/musicMap";
import { parseChatReplay } from "../lib/chatReplay";
import { runCommand } from "../lib/commands";
import { findClip, sourceRange } from "../lib/project/ops";
import type { Asset } from "../lib/project/types";
import { platform } from "../platform";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { hearWindow } from "./transcript";
import { dismiss, toast, updateToast } from "./toast";
import { run } from "./actions";

export interface HighlightRequest extends HighlightOptions {
  asset_id?: string; clip_id?: string; chat_file?: string; transcribe?: boolean; scenes?: boolean | "auto"; markers?: boolean;
}
export interface HighlightAnswer { asset_id: string; clip_id?: string; highlights: Highlight[]; elapsed_seconds: number; signals: string[]; cached: boolean; scene_sampling?: { interval_seconds: number; samples: number; covered_seconds: number; complete: boolean; elapsed_seconds: number } }
interface HighlightState { result?: HighlightAnswer; progress: number; stage: string; busy: boolean; error?: string }
let state: HighlightState = { progress: 0, stage: "", busy: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<HighlightState>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useHighlights = () => useSyncExternalStore(subscribe, () => state);
let controller: AbortController | undefined, session: AbortSignal | undefined;
const readings = new ByteLru<string, { features: HighlightFeature[]; cuts?: number[]; sampling?: HighlightAnswer["scene_sampling"] }>(8 * MiB);
trackCache("highlight_features", readings);
export const cancelHighlights = () => controller?.abort();

export function addHighlightMarkers(result: HighlightAnswer) {
  if (!result.clip_id) throw new Error("Place this source on the timeline before adding markers");
  const c = findClip(store.get().project, result.clip_id)?.clip;
  if (!c || !("assetId" in c) || c.assetId !== result.asset_id) throw new Error("The source clip changed; run Find highlights again");
  store.edit("Add highlight markers", p => runCommand(p, "add_highlight_markers", { clip_id: result.clip_id, ranges: result.highlights.map(h => ({ start: h.start, end: h.end })) }));
}

export function seekHighlight(result: HighlightAnswer, h: Highlight, play = false) {
  const p = store.get().project;
  const c = (result.clip_id ? findClip(p, result.clip_id)?.clip : undefined) ?? p.tracks.flatMap(t => t.clips).find(c => "assetId" in c && c.assetId === result.asset_id);
  if (!c || (c.type !== "audio" && c.type !== "video")) { toast("Place this source on the timeline to preview its highlights", "info"); return; }
  const frame = sourceToTimeline(c, p.fps).frame(h.start);
  if (frame === null) { toast("This highlight is outside the source clip on the timeline", "info"); return; }
  store.seek(frame);
  if (play && !store.get().playing) run("playPause");
}

export async function findAssetHighlights(options: HighlightRequest, chatText?: string): Promise<HighlightAnswer> {
  if (controller) throw new Error("Find highlights is already running; cancel it before starting another reading");
  const started = performance.now(), p = store.get().project;
  if (!!options.asset_id === !!options.clip_id) throw new Error("Give exactly one asset_id or clip_id");
  const clip = options.clip_id ? findClip(p, options.clip_id)?.clip : undefined;
  if (options.clip_id && (!clip || (clip.type !== "audio" && clip.type !== "video") || clip.freeze)) throw new Error("Give a video or audio source clip");
  const asset = p.assets.find(a => a.id === (options.asset_id ?? (clip && "assetId" in clip ? clip.assetId : "")));
  if (!asset || (!asset.hasAudio && !asset.hasVideo)) throw new Error("Choose video or audio media");
  const min = options.min_length ?? 15, max = options.max_length ?? 60;
  if (!(Number.isFinite(min) && Number.isFinite(max) && min >= 1 && max >= min && max <= 300)) throw new Error("Length must be 1 <= min_length <= max_length <= 300 seconds");
  const count = options.count ?? 10;
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("Count must be an integer from 1 to 100");
  for (const value of [options.lead_in, options.lead_out, options.min_gap]) if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error("Lead and gap seconds must be finite and nonnegative");
  if (options.times?.some(t => !Number.isFinite(t) || t < 0 || t > asset.duration)) throw new Error("Given times must fall inside the source duration");
  const sourceClips = p.tracks.flatMap(t => t.clips).filter(c => (c.type === "audio" || c.type === "video") && c.assetId === asset.id && !c.freeze);
  if (options.markers && !sourceClips.length) throw new Error("Place the source on the timeline before adding markers");
  const scope = projectWork.capture();
  scope.throwIfAborted();
  if (session !== projectWork.signal()) {
    session = projectWork.signal(); readings.clear();
    session.addEventListener("abort", () => { readings.clear(); set({ result: undefined, error: undefined }); }, { once: true });
  }
  controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, scope]);
  const notice = toast("Finding highlights…", "progress", undefined, { label: "Cancel", run: cancelHighlights });
  const progress = (stage: string, fraction: number) => { set({ stage, progress: fraction }); updateToast(notice, { text: stage, progress: fraction }); };
  set({ busy: true, error: undefined, result: undefined });
  try {
    const key = JSON.stringify([asset.id, asset.src, asset.duration, asset.size]);
    let reading = readings.get(key);
    const cached = !!reading;
    if (!reading) {
      const audio = new HighlightAudio();
      if (asset.hasAudio) await streamMono(asset, pcm => audio.push(pcm), f => progress("Reading audio excitement…", f), signal);
      signal.throwIfAborted();
      reading = { features: asset.hasAudio ? audio.finish() : [] };
      readings.set(key, reading, retainedBytes(reading));
    }
    const scenes = asset.hasVideo && (options.scenes === true || ((options.scenes ?? "auto") === "auto" && asset.duration <= 7200));
    if (scenes && !reading.cuts) {
      const sampled = await sparseSceneCuts(asset, f => progress("Sampling scene activity…", f), signal);
      signal.throwIfAborted();
      reading.cuts = sampled.cuts; reading.sampling = sampled.sampling;
      readings.set(key, reading, retainedBytes(reading));
    }
    let chat;
    if (options.chat_file) chatText = (await platform.openChatReplay(options.chat_file, signal))?.text;
    if (chatText !== undefined) {
      progress("Reading chat replay…", 0);
      chat = parseChatReplay(chatText);
      if (!chat.length) throw new Error("No timestamped messages were found in this chat replay");
    }
    signal.throwIfAborted();
    progress("Ranking moments…", 0);
    const range: [number, number] = clip && (clip.type === "audio" || clip.type === "video") ? sourceRange(clip, p.fps) : [0, asset.duration];
    // Read the file once, but a clip request ranks only its visible source span.
    let highlights = findHighlights(reading.features, asset.duration, { ...options, count: 100 }, chat, scenes ? reading.cuts : undefined, range)
      .filter(h => h.peak >= range[0] && h.peak < range[1])
      .map(h => ({ ...h, start: Math.max(range[0], h.start), end: Math.min(range[1], h.end) }))
      .filter(h => h.end - h.start >= Math.min(min, range[1] - range[0]))
      .slice(0, options.transcribe ? Math.min(100, count * 2) : count);
    if (options.transcribe) {
      for (let i = 0; i < highlights.length; i++) {
        const h = highlights[i];
        const words = await hearWindow(p, asset.id, Math.max(0, h.start - 5), Math.min(asset.duration, h.end + 5), signal, s => progress(s.stage === "downloading" ? "Downloading speech model…" : `Listening to candidate ${i + 1} of ${highlights.length}…`, s.progress));
        highlights[i] = refineHighlight(h, words, asset.duration, options, range);
      }
      highlights.sort((a, b) => b.score - a.score);
      highlights = highlights.slice(0, count);
    }
    highlights = highlights.map((h, i) => ({ ...h, rank: i + 1 }));
    signal.throwIfAborted();
    const signals = [...(asset.hasAudio ? ["audio", "speech"] : []), ...(scenes ? ["scenes"] : []), ...(chat ? ["chat"] : []), ...(options.times?.length ? ["times"] : []), ...(options.transcribe ? ["transcript", ...(options.keywords?.length ? ["keywords"] : [])] : [])];
    const markerClip = clip ?? sourceClips.find(c => {
      if (c.type !== "audio" && c.type !== "video") return false;
      const [lo, hi] = sourceRange(c, p.fps);
      return highlights.every(h => h.start >= lo && h.end <= hi);
    });
    const result: HighlightAnswer = { asset_id: asset.id, ...(markerClip ? { clip_id: markerClip.id } : {}), highlights, elapsed_seconds: (performance.now() - started) / 1000, signals, cached, ...(scenes && reading.sampling ? { scene_sampling: reading.sampling } : {}) };
    const current: Asset | undefined = store.get().project.assets.find(a => a.id === asset.id);
    if (current?.src !== asset.src) throw new Error("The source changed during analysis; run Find highlights again");
    if (options.markers) addHighlightMarkers(result);
    set({ result, progress: 1, stage: `${highlights.length} highlights found` });
    return result;
  } catch (e) {
    const error = signal.aborted ? "Highlight analysis canceled" : e instanceof Error ? e.message : String(e);
    if (!scope.aborted) set({ error });
    throw new Error(error);
  } finally { dismiss(notice); controller = undefined; set({ busy: false }); }
}
