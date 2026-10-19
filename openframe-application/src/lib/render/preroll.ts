// Preparing decoders before their cut (ADR-074). A clip that starts late in
// a long-GOP source must decode every frame from the key frame before its
// first one: 210 frames for a clip at 7 s with ffmpeg's default 8 s key
// interval. Done at the cut, that work froze playback; done ahead, the
// first frame is waiting. This file decides, purely, which clips to prepare
// at a frame and how far ahead; the player runs the decoders.

import { getAsset } from "../project/ops";
import type { Id, Project, VisualClip } from "../project/types";
import { layerAt, transitionWindow, walkPlan, type Layer } from "./plan";

/** Every cut is prepared at least this far ahead (the fixed preroll that
 * came before, enough for short GOPs). */
export const MIN_LEAD = 0.75;
/** No decoder starts further ahead than this. */
export const MAX_LEAD = 5;
/** Margin on the estimated catch-up time: decoding shares the machine with
 * the clip playing now. */
const SAFETY = 1.5;
/** Conservative admission estimate: mediabunny can submit 41 packets before
 * its first output, plus the cursor head. Include that catch-up burst. */
export const HELD_FRAMES = 42;
/** Budget for additional prepared entries, excluding currently playing
 * cursors and driver-owned codec surfaces. Oversized entries wait for use. */
export const PREPARE_BUDGET = 512 * 2 ** 20;
/** Decode speed in pixels a second before any catch-up has been measured:
 * 1080p at 240 frames a second, a cautious hardware decoder. */
export const DEFAULT_DECODE_RATE = 1920 * 1080 * 240;

/** A clip that enters the picture after frame f, and the first frame it is
 * needed on: its start, or the start of the transition that brings it in
 * (which shows it from before its cut, in its handles). */
export interface Entry {
  clip: VisualClip;
  at: number;
}

/** Clips on the project's video tracks whose first needed frame lies in
 * (f, f + horizon], soonest first. Only clips that decode video (video and
 * compound clips) are listed. */
export function upcomingEntries(p: Project, f: number, horizon: number): Entry[] {
  const out: Entry[] = [];
  for (const t of p.tracks) {
    if (t.kind !== "video" || t.hidden) continue;
    t.clips.forEach((c, i) => {
      if ((c.type !== "video" && c.type !== "compound") || c.disabled) return;
      // The same rule as planTracks: a transition joins two touching,
      // enabled clips.
      const prev = t.clips[i - 1];
      const tr = prev && "transitionOut" in prev ? prev.transitionOut : undefined;
      const joined = tr && !prev.disabled && prev.start + prev.duration === c.start;
      const at = joined ? transitionWindow(c.start, tr.duration).from : c.start;
      if (at > f && at <= f + horizon) out.push({ clip: c, at });
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** One decoder to prepare: a clip's picture (lane 1 is frame blending's
 * second cursor), or its background matte. `time` is the source time the
 * renderer will ask for first; `pixels` sizes its frames. */
export interface Target {
  kind: "video" | "matte";
  clipId: Id;
  assetId: Id;
  lane: 0 | 1;
  time: number;
  reverse: boolean;
  src?: string;
  pixels: number;
  fps: number;
}

/** The decoders an entry needs on its first frame: its own picture, or for
 * a compound clip every video inside it, with mattes and blend lanes. */
export function entryTargets(p: Project, e: Entry): Target[] {
  const l = layerAt(p, e.clip, e.at);
  return l ? layerTargets(p, l) : [];
}

export function layerTargets(p: Project, layer: Layer): Target[] {
  const out: Target[] = [];
  for (const item of walkPlan([{ kind: "layer", layer }])) {
    const layers = item.kind === "layer" ? [item.layer] : item.kind === "transition" ? [item.from, item.to] : [];
    for (const l of layers) {
      const s = l.source;
      if (s.kind !== "video") continue;
      const a = getAsset(p, s.assetId);
      const pixels = (a?.width ?? 1920) * (a?.height ?? 1080);
      const fps = a?.fps || 30;
      const reverse = !!s.reverse;
      const base = { clipId: l.clipId, assetId: s.assetId, reverse, pixels, fps, src: a?.proxy ?? a?.src };
      out.push({ ...base, kind: "video", lane: 0, time: s.time });
      if (s.next) out.push({ ...base, kind: "video", lane: 1, time: s.next.time });
      if (l.matte) out.push({ ...base, kind: "matte", lane: 0, time: l.matte.time, src: l.matte.src });
    }
  }
  return out;
}

/** Seconds ahead of its first frame that preparing must start: `work`
 * pixels to decode (the frames from the key frame to that frame, times
 * their size) at the measured decode rate, with a margin, never less than
 * MIN_LEAD nor more than MAX_LEAD. */
export function leadFor(work: number, rate: number): number {
  const seconds = work / Math.max(1, rate);
  return Math.min(MAX_LEAD, Math.max(MIN_LEAD, 0.25 + SAFETY * seconds));
}

/** Pixels to decode before each target's first frame, given the seconds
 * from its key frame (CursorPool's keyGap). */
export const workFor = (targets: Target[], gaps: number[]): number =>
  targets.reduce((n, t, i) => n + (gaps[i] ?? 0) * t.fps * t.pixels, 0);

/** The decode rate (pixels a second) after one measured catch-up: `work`
 * pixels in `ms`, the longest run `frames` frames. Slower news counts more
 * than faster news, so a busy machine is believed at once and a quick run
 * must repeat. Catch-ups of under 15 frames are mostly overhead and are
 * ignored. */
export function nextDecodeRate(rate: number, work: number, ms: number, frames: number): number {
  if (frames < 15 || ms <= 0 || work <= 0) return rate;
  const seen = work / (ms / 1000);
  const w = seen < rate ? 0.7 : 0.3;
  return rate + w * (seen - rate);
}

/** What one waiting entry holds in memory. Reverse cursors can hold three
 * 192 MiB windows; count those too. Four bytes per pixel also covers RGBA. */
export function heldBytes(targets: Target[]): number {
  return targets.reduce((n, t) => n + (t.reverse ? 3 * 192 * 2 ** 20 : t.pixels * 4 * HELD_FRAMES), 0);
}

export interface Candidate {
  at: number;
  /** Seconds of lead it needs; null while its key frame is being looked up
   * (it is then due at MIN_LEAD). */
  lead: number | null;
  bytes: number;
  /** Already preparing or prepared: it keeps its place and its bytes. */
  active: boolean;
}

/** The candidates (soonest first) to prepare or keep prepared at frame f:
 * those within their lead, while their bytes fit the budget. Past the budget, later cuts wait. */
export function choose<T extends Candidate>(cands: T[], f: number, fps: number, budget = PREPARE_BUDGET): T[] {
  const out: T[] = [];
  let used = cands.filter(c => c.active).reduce((n, c) => n + c.bytes, 0);
  for (const c of cands) {
    if (c.active) { out.push(c); continue; }
    const due = (c.at - f) / fps <= (c.lead ?? MIN_LEAD);
    if (!due) continue;
    if (used + c.bytes > budget) continue;
    used += c.bytes;
    out.push(c);
  }
  return out;
}
