// A version keeps each shot's subject in frame (export_versions, ADR-097).
// When a new shape crops a full-frame shot (16:9 filled into 9:16 keeps a
// third of its width), the crop is placed over the shot's subject instead
// of its center, and follows it where it moves: lib/analysis/subject.ts
// scores where a window of the new frame's size holds what stands out in
// the pictures the app looked at (state/subjects.ts), and the shot's
// position is keyed to put that window on the frame. The window stays
// inside what the master showed of the shot at each moment, so a push-in
// or a pan the editor made keeps its framing, and a caller's focus (a
// point of the picture) overrides it per clip. Each version also says
// where its framing cuts the subject, for the check sheet.

import { followPath, subjectBox, windowScores, shareInside, type Rect01, type SaliencyMap } from "./analysis/subject";
import { thin } from "./analysis/track";
import { inSource, onCanvas } from "./follow";
import { paramAt } from "./keyframes";
import { sourceTimeAt } from "./project/ops";
import type { Id, Keyframe, Project, VisualClip } from "./project/types";
import type { Layer } from "./render/plan";
import { fittedSize } from "./render/size";
import { framesToSeconds } from "./time";

/** What the app saw of a shot's pictures: saliency maps at source seconds
 * of its media (state/subjects.ts). A still has one. */
export interface ShotLook {
  assetId: Id;
  times: number[];
  maps: SaliencyMap[];
}

/** The looks of a project's shots, by clip id. */
export type Looks = Record<Id, ShotLook>;

/** How a version frames footage it crops: on its subject (default), or at
 * the center as it was (the master's framing grown to cover). */
export type Reframe = "subject" | "center";
export const REFRAMES: Reframe[] = ["subject", "center"];

/** A caller's framing of one clip in a version: the point of its picture
 * (fractions from the top left, as preview_media shows it) to keep at the
 * center of the frame; an axis left out stays on the subject. */
export interface Focus {
  clip_id: Id;
  x?: number;
  y?: number;
}

/** Where a version's framing of a shot cuts its subject. */
export interface SubjectNote {
  clipId: Id;
  /** Version timeline seconds. */
  at: number;
  /** The subject, fractions of the picture. */
  subject: Rect01;
  /** Its share inside the frame. */
  kept: number;
  /** Wider (or taller) than the frame: no placement keeps it whole. */
  wide?: boolean;
}

/** The clip-relative frame where `c` shows source second `t`, or null
 * outside it. */
export function relOf(c: VisualClip, t: number, fps: Project["fps"]): number | null {
  if (c.type === "image") return null;
  if (!("in" in c)) return null;
  const at = (rel: number) => sourceTimeAt(c, c.start + rel, fps);
  const first = at(0), last = at(c.duration - 1), step = framesToSeconds(1, fps);
  if (t < Math.min(first, last) - step || t > Math.max(first, last) + step) return null;
  const up = last >= first;
  let lo = 0, hi = c.duration - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at(mid) <= t === up) lo = mid;
    else hi = mid;
  }
  return Math.abs(at(lo) - t) <= Math.abs(at(hi) - t) ? lo : hi;
}

/** A clip's place on its frame at clip frame `rel`, from its own transform
 * and keys (not the in and out animations), as onCanvas reads a layer. */
function restLayer(c: VisualClip, rel: number, x?: number, y?: number): Layer {
  const scale = paramAt(c, "transform.scale", rel);
  return {
    x: x ?? paramAt(c, "transform.x", rel),
    y: y ?? paramAt(c, "transform.y", rel),
    scale,
    ...(c.transform.scaleY !== undefined ? { scaleY: paramAt(c, "transform.scaleY", rel) } : {}),
    rotation: paramAt(c, "transform.rotation", rel),
    flipX: c.transform.flipX,
    flipY: c.transform.flipY,
  } as Layer;
}

/** The part of a shot's picture a frame shows with the shot placed so,
 * fractions of the picture, within the picture. */
function shownRect(p: Project, c: VisualClip, l: Layer): Rect01 {
  const a = inSource(p, c, l, 0, 0), b = inSource(p, c, l, p.width, p.height);
  const cl = (v: number) => Math.max(0, Math.min(1, v));
  return { left: cl(Math.min(a.u, b.u)), right: cl(Math.max(a.u, b.u)), top: cl(Math.min(a.v, b.v)), bottom: cl(Math.max(a.v, b.v)) };
}

/** The look for a clip: its own, else one of the same media whose
 * pictures cover its source (a cut-down split it in two). */
export function lookFor(looks: Looks | undefined, c: VisualClip): ShotLook | undefined {
  if (!looks) return undefined;
  if (looks[c.id]) return looks[c.id];
  if (c.type !== "video" && c.type !== "image") return undefined;
  return Object.values(looks).find((l) => l.assetId === c.assetId);
}

/** At most every this many seconds a key of a followed subject. */
const SAMPLE = 0.5;

/**
 * A full-frame shot refit to a version's frame (`after`, its scale already
 * grown to cover), placed so the version's frame holds its subject: at
 * every look sample the window of the new frame's size is chosen inside
 * what the master showed (`master`, `before`) on the axis the new shape
 * crops, together over the shot (followPath), or at the caller's focus;
 * the position is keyed there (kept within the picture) and thinned.
 * "center" keeps `after` as it is. Notes say where the result cuts the
 * subject, measured on the looks, whatever the mode.
 */
export function reframeShot(master: Project, q: Project, before: VisualClip, after: VisualClip, look: ShotLook | undefined, mode: Reframe = "subject", focus?: Focus): { clip: VisualClip; notes: SubjectNote[] } {
  const none = { clip: after, notes: [] as SubjectNote[] };
  const crop = after.crop;
  // Turned or cut pictures keep the old framing; so does a shot with
  // neither a look nor a focus.
  if (Math.abs(after.transform.rotation) > 1e-3 || crop.left + crop.right + crop.top + crop.bottom > 1e-3 || (!look && !focus)) return none;
  const S = fittedSize(q, after);
  const fps = q.fps;
  // The frames to place it at: the look's samples inside the clip, else
  // every half second; with its first and last frame.
  const every = Math.max(1, Math.round((SAMPLE * fps.num) / fps.den));
  const still = after.type === "image" || !look || look.times.length === 1;
  const samples: { rel: number; map?: SaliencyMap }[] = [];
  if (look && !still) look.times.forEach((t, i) => {
    const rel = relOf(after, t, fps);
    if (rel !== null && !samples.some((s) => s.rel === rel)) samples.push({ rel, map: look.maps[i] });
  });
  if (!samples.length) for (let rel = 0; rel < after.duration; rel += every) samples.push({ rel, map: look?.maps[0] });
  samples.sort((a, b) => a.rel - b.rel);
  if (samples[0].rel > 0) samples.unshift({ rel: 0, map: samples[0].map });
  if (samples.at(-1)!.rel < after.duration - 1) samples.push({ rel: after.duration - 1, map: samples.at(-1)!.map });

  // Per sample: the frame's size in picture fractions, and the room its
  // center has: inside what the master showed of the shot.
  const placed = samples.map((s) => {
    const l = restLayer(after, s.rel);
    const w = Math.min(1, q.width / (S.w * Math.abs(l.scale))), h = Math.min(1, q.height / (S.h * Math.abs(l.scaleY ?? l.scale)));
    const shown = shownRect(master, before, restLayer(before, s.rel));
    return { ...s, l, w, h, shown };
  });
  const axes = (["x", "y"] as const).filter((a) => placed.some((s) => (a === "x" ? s.w : s.h) < 0.995));
  if (!axes.length) return none;

  const centers = placed.map((s) => centerOf(q, after, s.l));
  const auto: Record<"x" | "y", number[]> = { x: [], y: [] };
  for (const axis of axes) {
    const size = (s: (typeof placed)[number]) => (axis === "x" ? s.w : s.h);
    const lo = (s: (typeof placed)[number]) => (axis === "x" ? s.shown.left : s.shown.top), hi = (s: (typeof placed)[number]) => (axis === "x" ? s.shown.right : s.shown.bottom);
    const fit = (s: (typeof placed)[number], c: number) => Math.max(lo(s) + size(s) / 2, Math.min(hi(s) - size(s) / 2, c));
    if (look) auto[axis] = followPath(placed.map((s) => windowScores(s.map!, axis, size(s), s.shown)));
    const want = focus?.[axis];
    placed.forEach((s, k) => {
      const c = want !== undefined ? fit(s, want) : mode === "subject" && look ? auto[axis][k] : (axis === "x" ? centers[k].u : centers[k].v);
      if (axis === "x") centers[k].u = c;
      else centers[k].v = c;
    });
  }

  // The position that puts each chosen center at the frame's center, kept
  // where the picture still covers the frame.
  const moved = mode === "subject" || !!focus;
  let clip = after;
  for (const axis of axes) {
    if (!moved) break;
    const dim = axis === "x" ? q.width : q.height;
    const values = placed.map((s, k) => {
      const at = onCanvas(q, after, { ...s.l, x: 0, y: 0 }, centers[k].u, centers[k].v);
      const room = Math.max(0, ((axis === "x" ? S.w * Math.abs(s.l.scale) : S.h * Math.abs(s.l.scaleY ?? s.l.scale)) - dim) / (2 * dim));
      const v = ((axis === "x" ? q.width / 2 - at.x : q.height / 2 - at.y)) / dim;
      return Math.max(-room, Math.min(room, v));
    });
    const path = `transform.${axis}` as const;
    const flat = Math.max(...values) - Math.min(...values) < 1 / dim;
    const keys = clip.keyframes ? { ...clip.keyframes } : {};
    delete keys[path];
    if (flat) clip = { ...clip, transform: { ...clip.transform, [axis]: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(5) }, keyframes: keys };
    else {
      const keep = thin(values, 1 / dim);
      const list: Keyframe[] = keep.map((i) => ({ f: placed[i].rel, v: +values[i].toFixed(5) }));
      clip = { ...clip, transform: { ...clip.transform, [axis]: list[0].v }, keyframes: { ...keys, [path]: list } };
    }
  }

  // Where the frame, as placed, cuts the subject the looks see.
  const notes: SubjectNote[] = [];
  if (look) {
    const sec = (rel: number) => +framesToSeconds(after.start + rel, fps).toFixed(2);
    placed.forEach((s, k) => {
      if (!s.map) return;
      const subject = subjectBox(s.map, s.shown);
      if (!subject) return;
      const win = frameRect(q, clip, s.rel, S);
      const kept = shareInside(subject, win);
      const ideal = { ...win };
      for (const axis of axes) {
        const c = auto[axis][k], half = (axis === "x" ? s.w : s.h) / 2;
        if (axis === "x") (ideal.left = c - half), (ideal.right = c + half);
        else (ideal.top = c - half), (ideal.bottom = c + half);
      }
      // Wide: the subject is wider than the frame on a cropped axis, and a
      // figure rather than a band (a horizon's glow is not a subject).
      const sw = subject.right - subject.left, sh = subject.bottom - subject.top;
      const aspect = (sh * S.h) / Math.max(1e-6, sw * S.w);
      const wide = axes.some((a) => (a === "x" ? sw > s.w && aspect >= 0.5 : sh > s.h && 1 / aspect >= 0.5));
      // Cut: this framing loses much of a subject the subject framing keeps.
      const cut = kept < 0.65 && shareInside(subject, ideal) >= 0.9;
      if (cut || wide) notes.push({ clipId: after.id, at: sec(s.rel), subject: round(subject), kept: +kept.toFixed(2), ...(wide ? { wide: true } : {}) });
    });
  }
  return { clip, notes };
}

const round = (r: Rect01): Rect01 => ({ left: +r.left.toFixed(3), top: +r.top.toFixed(3), right: +r.right.toFixed(3), bottom: +r.bottom.toFixed(3) });

/** The picture point at the frame's center with the shot placed by `l`. */
function centerOf(q: Project, c: VisualClip, l: Layer): { u: number; v: number } {
  return inSource(q, c, l, q.width / 2, q.height / 2);
}

/** The part of the picture the version's frame shows at clip frame `rel`. */
function frameRect(q: Project, c: VisualClip, rel: number, S: { w: number; h: number }): Rect01 {
  const l = restLayer(c, rel);
  const half = { w: q.width / (2 * S.w * Math.abs(l.scale)), h: q.height / (2 * S.h * Math.abs(l.scaleY ?? l.scale)) };
  const m = centerOf(q, c, l);
  return { left: m.u - half.w, right: m.u + half.w, top: m.v - half.h, bottom: m.v + half.h };
}

