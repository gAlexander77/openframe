// Bulk cuts use the same setters and limits as individual transitions.
import { TRANSITIONS } from "./catalog";
import { crossfadeJoin, newCrossfade } from "./crossfadeJoin";
import { setCrossfade } from "./musicCut";
import { clipEnd, mainTrack, setTransition } from "./project/ops";
import type { Project } from "./project/types";
import { secondsToFrames } from "./time";

export interface TransitionDefaults { type: string; videoSeconds: number; audioSeconds: number }
let defaults: TransitionDefaults = { type: "dissolve", videoSeconds: 0.5, audioSeconds: 0.5 };
/** Preferences supply per-viewer defaults, as they do new still lengths. */
export function setTransitionDefaults(value: TransitionDefaults) { defaults = { ...value }; }
export interface DefaultTransitionOptions {
  clip_ids?: string[];
  kind?: "video" | "audio" | "both";
  type?: string;
  duration?: number;
  replace?: boolean;
}
export interface CutResult { clip_id: string; next_clip_id?: string; kind: "video" | "audio"; reason?: string }
export interface CutsReport { applied: CutResult[]; skipped: CutResult[] }

export function applyDefaultTransitions(p: Project, o: DefaultTransitionOptions): { project: Project; cuts: CutsReport } {
  const cuts: CutsReport = { applied: [], skipped: [] };
  const kind = o.kind ?? "video", type = o.type ?? defaults.type;
  if (!Object.hasOwn(TRANSITIONS, type)) throw new Error(`Unknown transition ${type}`);
  const ids = o.clip_ids ? new Set(o.clip_ids) : null;
  let q = p;
  for (const t of p.tracks) {
    if (!ids && t.id !== mainTrack(p).id) continue;
    t.clips.forEach((c, i) => {
      if (ids && !ids.has(c.id)) return;
      const audio = c.type === "audio";
      const k = audio ? "audio" : "video";
      if (kind !== "both" && kind !== k) return;
      const next = t.clips[i + 1];
      const cut: CutResult = { clip_id: c.id, ...(next ? { next_clip_id: next.id } : {}), kind: k };
      const skip = (reason: string) => cuts.skipped.push({ ...cut, reason });
      if (t.locked) return skip("locked");
      if (!next || next.start !== clipEnd(c) || (audio ? next.type !== "audio" : next.type === "audio")) return skip("no neighbor");
      if (!o.replace && (audio ? !!c.crossfade : "transitionOut" in c && !!c.transitionOut)) return skip("already had one");
      if (audio) {
        const join = crossfadeJoin(q, c.id);
        if (!join || join.most <= 0) return skip(join?.why ?? "no handles");
        q = setCrossfade(q, c.id, newCrossfade(join, o.duration ?? defaults.audioSeconds));
      } else {
        q = setTransition(q, c.id, { type, duration: secondsToFrames(o.duration ?? defaults.videoSeconds, p.fps) });
      }
      cuts.applied.push(cut);
    });
  }
  if (ids) {
    const found = new Set(p.tracks.flatMap((t) => t.clips.map((c) => c.id)));
    for (const id of ids) if (!found.has(id)) cuts.skipped.push({ clip_id: id, kind: kind === "audio" ? "audio" : "video", reason: "clip not found" });
  }
  return { project: q, cuts };
}

/** Keyboard fallback: the outgoing cut nearest the playhead on main. */
export function nearestMainCut(p: Project, frame: number, kind: "video" | "audio"): string[] {
  const clips = mainTrack(p).clips;
  const cuts = clips.filter((c, i) => clips[i + 1]?.start === clipEnd(c) &&
    (kind === "audio" ? c.type === "audio" && clips[i + 1].type === "audio" : c.type !== "audio" && clips[i + 1].type !== "audio"));
  cuts.sort((a, b) => Math.abs(clipEnd(a) - frame) - Math.abs(clipEnd(b) - frame) || clipEnd(a) - clipEnd(b));
  return cuts.length ? [cuts[0].id] : [];
}
