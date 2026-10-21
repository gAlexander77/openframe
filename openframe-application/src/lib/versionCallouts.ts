// Callouts in a version (ADR-122). An explainer made from screen
// recordings points at the part of the interface that matters with rings
// (an outlined shape) and spotlights (a dim over the whole frame with a
// hole cut by an inverted mask), over footage the editor pushed into with
// frame_region. A version that crops the footage another way has to keep
// them on what they point at: Claude film test 3's 1:1 version moved its
// rings by the title layout rules into empty interface, left the
// spotlights' holes where they were on the 16:9 frame, shrank a frame-wide
// ring with a transform scale its size keys did not know about, and
// cropped around a detected subject, so the Split button fell outside.
//
// A callout is found in the master with what it points at: a clip pinned
// with an anchor (ADR-120: add_callout's ring and dim, a label pinned to a
// button) points into its anchor's clip; a ring or a spotlight made by
// hand (add_shape, set_mask) points into the video or picture under it, or
// at a title it rings. What it points at is read in that picture's own
// fractions at every frame, the version's crop is placed to keep it
// (shotTargets, lib/reframe.ts), and the callout is written again from the
// version's picture: an anchored clip by reanchor (lib/anchors.ts), a
// hand-made one here at every frame, thinned to a quarter pixel (a ring's
// place and size, a spotlight's hole). What still lands off the frame, or
// over other content than in the master, is reported for the check sheet
// (calloutReports).
//
// ponytail: callouts on the project's timeline over a video or picture
// clip (not inside compound clips); a turned callout or picture is placed
// by its center and size, its angle kept; the footage's anchor point, in
// and out animations and wiggle are not followed (as ADR-120's anchors).

import { anchorOf } from "./anchors";
import { thin } from "./analysis/track";
import type { Rect01 } from "./analysis/subject";
import { seenLetters, seenTexts } from "./designCheck";
import { inSource, onCanvas } from "./follow";
import { paramAt, setPath } from "./keyframes";
import { getAsset } from "./project/ops";
import type { Clip, Id, Keyframe, Project, VisualClip } from "./project/types";
import { restLayer, type ShotTargets } from "./reframe";
import { fittedSize } from "./render/size";
import { resolveShape } from "./shapes";
import { framesToSeconds, secondsToFrames } from "./time";

/** Canvas pixels. */
type Box = { left: number; top: number; right: number; bottom: number };
/** A target's middle and size, canvas pixels. */
type Spot = { cx: number; cy: number; w: number; h: number };
/** Where a callout points: its shape's own box (a ring, a box), its mask's
 * (a spotlight's hole), or its whole picture (a label pinned to a point). */
type Part = "shape" | "mask" | "point";

/** A graphic over a part of the master's footage or titles. */
export interface Callout {
  id: Id;
  part: Part;
  /** The video or picture clip it points into, or the title it rings. */
  shot?: Id;
  title?: Id;
  /** Kept on what it points at in a version: rings, spotlights and pinned
   * clips. A filled box made by hand is only checked (a panel or a mark
   * may belong to the frame's layout). */
  follows: boolean;
  /** Pinned with an anchor (ADR-120): reanchor writes it. */
  anchored?: boolean;
}

const CLOSED = new Set(["circle", "rectangle", "heart", "star"]);
const SPOT_PATHS = { shape: ["transform.x", "transform.y", "shape.width", "shape.height"], mask: ["mask.x", "mask.y", "mask.width", "mask.height"] } as const;
/** Paths that move what a callout points at. */
const MOVES: Record<Part, string[]> = {
  shape: [...SPOT_PATHS.shape, "transform.scale", "transform.scaleY"],
  mask: [...SPOT_PATHS.mask, "transform.x", "transform.y", "transform.scale", "transform.scaleY"],
  point: ["transform.x", "transform.y", "transform.scale", "transform.scaleY"],
};

const tidy = (v: number) => Math.round(v * 1e5) / 1e5 || 0;

/** A layer's middle and size on its frame at clip frame r, from its
 * transform and keys (its animations aside), canvas pixels. */
function layerSpot(p: Project, c: VisualClip, r: number): Spot {
  const s = fittedSize(p, c);
  const l = restLayer(c, r);
  return { cx: p.width * (0.5 + l.x), cy: p.height * (0.5 + l.y), w: s.w * Math.abs(l.scale), h: s.h * Math.abs(l.scaleY ?? l.scale) };
}

const boxOfSpot = (s: Spot): Box => ({ left: s.cx - s.w / 2, right: s.cx + s.w / 2, top: s.cy - s.h / 2, bottom: s.cy + s.h / 2 });

/** Where a layer reaches the frame's edges where it starts: across it (x),
 * up and down it (y). */
function spans(p: Project, c: VisualClip): { x: boolean; y: boolean } {
  const b = boxOfSpot(layerSpot(p, c, 0));
  const e = 0.005;
  return { x: b.left <= p.width * e && b.right >= p.width * (1 - e), y: b.top <= p.height * e && b.bottom >= p.height * (1 - e) };
}

/** What a hand-made graphic points with: its own box (a shape short of the
 * frame's edges), or its mask's (a layer over the whole frame with a
 * closed mask: a spotlight's hole, or its window); undefined for anything
 * else (a band or a scrim is part of the frame, a box cut from a solid is
 * laid out). */
export function calloutPart(p: Project, c: Clip): "shape" | "mask" | undefined {
  if (c.type !== "color") return undefined;
  const k = c.crop;
  if (k.left + k.right + k.top + k.bottom > 1e-3) return undefined;
  const s = spans(p, c);
  if (c.mask && CLOSED.has(c.mask.shape) && s.x && s.y) return "mask";
  if (c.shape && c.shape.kind !== "line" && !s.x && !s.y) return "shape";
  return undefined;
}

/** What a callout points at on its frame at its frame r, canvas pixels: a
 * shape's own box, keys applied; its mask's (its angle left out); or its
 * whole picture. */
export function calloutSpot(p: Project, c: VisualClip, part: Part, r: number): Spot {
  const l = layerSpot(p, c, r);
  if (part === "shape" && c.type === "color" && c.shape) {
    const sh = resolveShape(c, r)!;
    const t = restLayer(c, r);
    return { cx: l.cx, cy: l.cy, w: sh.width * p.width * Math.abs(t.scale), h: sh.height * p.height * Math.abs(t.scaleY ?? t.scale) };
  }
  if (part === "mask" && "mask" in c && c.mask) {
    const m = (k: string) => paramAt(c, `mask.${k}`, r);
    return { cx: l.cx + m("x") * l.w, cy: l.cy + m("y") * l.h, w: m("width") * l.w, h: m("height") * l.h };
  }
  return l;
}

/** The topmost video or picture (not a sticker) on a track under track
 * `ti` that plays at frame f with point (x, y) on its picture. */
function pictureUnder(p: Project, ti: number, f: number, x: number, y: number): VisualClip | undefined {
  for (const t of p.tracks.slice(ti + 1)) {
    if (t.kind !== "video" || t.hidden) continue;
    for (const c of t.clips) {
      if (c.disabled || f < c.start || f >= c.start + c.duration) continue;
      if (c.type !== "video" && (c.type !== "image" || getAsset(p, c.assetId)?.sticker)) continue;
      const b = boxOfSpot(layerSpot(p, c, f - c.start));
      if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return c;
    }
  }
  return undefined;
}

/**
 * The graphics over a part of the master's pictures or titles, on the
 * project's timeline:
 * - every clip pinned with an anchor, pointing into its anchor's clip;
 * - rings (an outlined shape short of the frame's edges) and spotlights (a
 *   layer over the whole frame with a closed mask), which a version keeps
 *   on what they point at; a ring around a title showing with it (most of
 *   its letters inside, and a fifth of the ring or more) rings that title,
 *   else it points into the picture under its middle for at least half of
 *   its time;
 * - filled boxes under a quarter of the frame over a picture, which a
 *   version only checks.
 * Parts of a group with a title (an ad element) are the group's layout,
 * and a filled box with a title's middle on it is that title's panel:
 * neither is a callout.
 */
export function calloutsOf(p: Project): Callout[] {
  const out: Callout[] = [];
  const all = p.tracks.flatMap((t) => t.clips);
  const texty = new Set(all.filter((c) => c.type === "text" && c.group).map((c) => c.group));
  const titles = seenTexts(p).filter((s) => !s.via.length);
  for (const [ti, t] of p.tracks.entries()) {
    if (t.kind !== "video" || t.hidden) continue;
    for (const c of t.clips) {
      if (c.disabled) continue;
      const a = anchorOf(c);
      if (a) {
        const part: Part = a.mask ? "mask" : a.keys[0].w !== undefined && c.type === "color" && c.shape ? "shape" : "point";
        out.push({ id: c.id, part, shot: a.clipId, follows: true, anchored: true });
        continue;
      }
      if (c.type !== "color" || (c.group && texty.has(c.group))) continue;
      const part = calloutPart(p, c);
      if (!part) continue;
      const ring = part === "mask" || c.shape?.fill === false;
      const mid = Math.floor(c.duration / 2), f = c.start + mid;
      const spot = calloutSpot(p, c, part, mid), box = boxOfSpot(spot);
      const area = Math.max(1, spot.w * spot.h);
      // A filled box is checked when it is a small mark (a highlight), not
      // a panel a quarter of the frame or more.
      if (!ring && area > 0.25 * p.width * p.height) continue;
      // A title it holds: most of the letters inside, and a fair share of it.
      const held = titles.find((s) => {
        if (f < s.start || f >= s.start + s.duration) return false;
        const l = seenLetters(p, s, f)?.box;
        if (!l) return false;
        const lw = l.right - l.left, lh = l.bottom - l.top;
        const iw = Math.max(0, Math.min(l.right, box.right) - Math.max(l.left, box.left)), ih = Math.max(0, Math.min(l.bottom, box.bottom) - Math.max(l.top, box.top));
        return (iw * ih) / Math.max(1, lw * lh) >= 0.8 && (lw * lh) / area >= 0.2;
      });
      if (held) {
        if (ring) out.push({ id: c.id, part, title: held.c.id, follows: true });
        continue;
      }
      // A filled box with a title's middle on it is that title's panel.
      const panel = (s: (typeof titles)[number]) => {
        if (s.start >= c.start + c.duration || c.start >= s.start + s.duration) return false;
        const l = seenLetters(p, s, Math.max(s.start, Math.min(f, s.start + s.duration - 1)))?.box;
        if (!l) return false;
        const x = (l.left + l.right) / 2, y = (l.top + l.bottom) / 2;
        return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
      };
      if (!ring && titles.some(panel)) continue;
      const shot = pictureUnder(p, ti, f, spot.cx, spot.cy);
      if (!shot) continue;
      const together = Math.min(c.start + c.duration, shot.start + shot.duration) - Math.max(c.start, shot.start);
      if (together < 0.5 * c.duration) continue;
      out.push({ id: c.id, part, shot: shot.id, follows: ring });
    }
  }
  return out;
}

/** The ids a version keeps out of its overlay layout: what it keeps on
 * what it points at instead. */
export const followed = (callouts: Callout[]) => new Set(callouts.filter((k) => k.follows).map((k) => k.id));

/** A picture point and size from the master's canvas to the version's,
 * through the same picture placed in each (restLayer) at frame f. */
function throughPicture(p: Project, q: Project, sm: VisualClip, sv: VisualClip, f: number, s: Spot): Spot {
  const lm = restLayer(sm, f - sm.start), lv = restLayer(sv, f - sv.start);
  const u = inSource(p, sm, lm, s.cx, s.cy);
  const at = onCanvas(q, sv, lv, u.u, u.v);
  const fm = fittedSize(p, sm), fv = fittedSize(q, sv);
  const kx = (fv.w * Math.abs(lv.scale)) / (fm.w * Math.abs(lm.scale)), ky = (fv.h * Math.abs(lv.scaleY ?? lv.scale)) / (fm.h * Math.abs(lm.scaleY ?? lm.scale));
  return { cx: at.x, cy: at.y, w: s.w * kx, h: s.h * ky };
}

/** What a callout points at, as fractions of its picture, at its frame r. */
function inPicture(p: Project, c: VisualClip, part: Part, shot: VisualClip, r: number): Rect01 {
  const b = boxOfSpot(calloutSpot(p, c, part, r));
  const l = restLayer(shot, c.start + r - shot.start);
  const a = inSource(p, shot, l, b.left, b.top), z = inSource(p, shot, l, b.right, b.bottom);
  const cl = (v: number) => Math.max(0, Math.min(1, v));
  return { left: cl(Math.min(a.u, z.u)), right: cl(Math.max(a.u, z.u)), top: cl(Math.min(a.v, z.v)), bottom: cl(Math.max(a.v, z.v)) };
}

const clipsById = (p: Project) => new Map(p.tracks.flatMap((t) => t.clips).map((c) => [c.id, c] as const));

/**
 * What the callouts over a shot point at, for lib/reframe.ts to keep in a
 * version's crop: the shot frames where one starts or stops, every frame
 * one moves by its own keys, and a moment before each starts (0.4 s, so
 * the frame has panned to it when it draws on); and their union at a
 * frame, as fractions of the shot's picture.
 */
export function shotTargets(p: Project, callouts: Callout[], shotId: Id): ShotTargets | undefined {
  const byId = clipsById(p);
  const shot = byId.get(shotId) as VisualClip | undefined;
  const mine = callouts.filter((k) => k.follows && k.shot === shotId).flatMap((k) => {
    const c = byId.get(k.id);
    return c && "transform" in c ? [{ k, c: c as VisualClip }] : [];
  });
  if (!shot || !("transform" in shot) || !mine.length) return undefined;
  const ahead = secondsToFrames(0.4, p.fps);
  const frames = new Set<number>();
  for (const { k, c } of mine) {
    const off = c.start - shot.start;
    frames.add(off).add(off - ahead).add(off + c.duration - 1);
    for (const path of MOVES[k.part]) {
      const keys = c.keyframes?.[path] ?? [];
      for (let i = 1; i < keys.length; i++) if (keys[i].v !== keys[i - 1].v) for (let f = Math.max(0, keys[i - 1].f); f <= Math.min(c.duration - 1, keys[i].f); f++) frames.add(off + f);
    }
  }
  return {
    frames: [...frames].filter((f) => f >= 0 && f < shot.duration).sort((a, b) => a - b),
    at: (rel) => {
      const f = shot.start + rel;
      const boxes = mine.filter(({ c }) => f >= c.start && f < c.start + c.duration).map(({ k, c }) => inPicture(p, c, k.part, shot, f - c.start));
      if (!boxes.length) return null;
      return { left: Math.min(...boxes.map((b) => b.left)), right: Math.max(...boxes.map((b) => b.right)), top: Math.min(...boxes.map((b) => b.top)), bottom: Math.max(...boxes.map((b) => b.bottom)) };
    },
  };
}

/** Where a callout of the master belongs in version q at its frame r:
 * through its picture, or around its title as in the master (the margins
 * scaled with the letters). Undefined where it cannot be told. */
function placer(p: Project, q: Project, k: Callout, c: VisualClip): ((r: number) => Spot) | undefined {
  const pm = clipsById(p), pv = clipsById(q);
  if (k.shot) {
    const sm = pm.get(k.shot), sv = pv.get(k.shot);
    if (!sm || !sv || !("transform" in sm) || !("transform" in sv) || sv.disabled) return undefined;
    return (r) => throughPicture(p, q, sm, sv, c.start + r, calloutSpot(p, c, k.part, r));
  }
  const f = c.start + Math.floor(c.duration / 2);
  const tm = seenTexts(p).find((s) => s.c.id === k.title && !s.via.length && f >= s.start && f < s.start + s.duration);
  const tv = seenTexts(q).find((s) => s.c.id === k.title && !s.via.length && f >= s.start && f < s.start + s.duration);
  const a = tm && seenLetters(p, tm, f)?.box, b = tv && seenLetters(q, tv, f)?.box;
  if (!a || !b) return undefined;
  const g = (b.bottom - b.top) / Math.max(1, a.bottom - a.top);
  return (r) => {
    const o = boxOfSpot(calloutSpot(p, c, k.part, r));
    const left = b.left - (a.left - o.left) * g, right = b.right + (o.right - a.right) * g, top = b.top - (a.top - o.top) * g, bottom = b.bottom + (o.bottom - a.bottom) * g;
    return { cx: (left + right) / 2, cy: (top + bottom) / 2, w: right - left, h: bottom - top };
  };
}

/** The values a callout's paths take to put its target at `s` on q. */
function valuesFor(q: Project, v: VisualClip, part: "shape" | "mask", r: number, s: Spot): number[] {
  if (part === "shape") {
    const t = restLayer(v, r);
    return [s.cx / q.width - 0.5, s.cy / q.height - 0.5, s.w / (q.width * Math.abs(t.scale || 1)), s.h / (q.height * Math.abs(t.scaleY ?? (t.scale || 1)))];
  }
  const l = layerSpot(q, v, r);
  return [(s.cx - l.cx) / l.w, (s.cy - l.cy) / l.h, s.w / l.w, s.h / l.h];
}

/** Paths written frame by frame, thinned to a quarter pixel: one value
 * where it holds, keys where it moves. */
function write(c: VisualClip, paths: readonly string[], cols: number[][], tol: number[]): VisualClip {
  let out = c;
  const keys: Record<string, Keyframe[]> = { ...c.keyframes };
  paths.forEach((path, i) => {
    const col = cols[i].map(tidy);
    out = setPath(out, path, col[0]);
    if (Math.max(...col) - Math.min(...col) <= tol[i]) delete keys[path];
    else keys[path] = thin(col, tol[i]).map((f) => ({ f, v: col[f] }));
  });
  const { keyframes: _, ...rest } = out;
  return (Object.keys(keys).length ? { ...rest, keyframes: keys } : rest) as VisualClip;
}

/**
 * The master's hand-made rings and spotlights written again on version q,
 * frame by frame, from what they point at as q shows it: a ring's place
 * and size (its stroke and its own scale as the version has them: never a
 * transform scale its size keys do not know), a spotlight's hole. Static
 * where it holds still, keyed where it moves. Pinned clips are reanchor's.
 */
export function followCallouts(p: Project, q: Project, callouts: Callout[]): Project {
  const pm = clipsById(p), pv = clipsById(q);
  const changed = new Map<Id, Clip>();
  for (const k of callouts) {
    if (!k.follows || k.anchored || k.part === "point") continue;
    const c = pm.get(k.id) as VisualClip | undefined, v = pv.get(k.id) as VisualClip | undefined;
    if (!c || !v || v.disabled) continue;
    const place = placer(p, q, k, c);
    if (!place) continue;
    const part = k.part;
    const paths = SPOT_PATHS[part];
    const cols: number[][] = paths.map(() => []);
    for (let r = 0; r < c.duration; r++) valuesFor(q, v, part, r, place(r)).forEach((x, i) => cols[i].push(x));
    const l = layerSpot(q, v, 0);
    const tol = part === "shape" ? [0.25 / q.width, 0.25 / q.height, 0.25 / q.width, 0.25 / q.height] : [0.25 / l.w, 0.25 / l.h, 0.25 / l.w, 0.25 / l.h];
    changed.set(k.id, write(v, paths, cols, tol));
  }
  if (!changed.size) return q;
  return { ...q, tracks: q.tracks.map((t) => (t.clips.some((c) => changed.has(c.id)) ? { ...t, clips: t.clips.map((c) => changed.get(c.id) ?? c) } : t)) };
}

/** A callout a version leaves off the frame or off what it pointed at. */
export interface CalloutReport {
  clip_id: Id;
  /** Version seconds: its worst moment. */
  at: number;
  issue: "off_frame" | "off_target";
  /** Where it is there, canvas pixels. */
  box: Box;
  note: string;
}

/** How a callout is named in a note. */
function nameOf(c: VisualClip, part: Part): string {
  if (part === "mask") return "mask" in c && c.mask?.invert ? "a spotlight's hole" : "a spotlight";
  if (part === "point") return c.type === "text" ? "a pinned title" : "a pinned layer";
  return c.type === "color" && c.shape?.fill === false ? "a ring" : "a box";
}

/**
 * Where version q leaves a graphic of master p off the frame, or over
 * other content than in the master: every callout (calloutsOf), every
 * sixth of a second it shows, its box as q draws it against where its
 * target is in q. Off its target: its middle a quarter of its size (and 3
 * px) or more from it. Off the frame: a twentieth of its box or more
 * outside. One report a callout, at its worst moment.
 */
export function calloutReports(p: Project, q: Project, callouts = calloutsOf(p)): CalloutReport[] {
  const pm = clipsById(p), pv = clipsById(q);
  const step = Math.max(1, secondsToFrames(1 / 6, q.fps));
  const out: CalloutReport[] = [];
  for (const k of callouts) {
    const c = pm.get(k.id), v = pv.get(k.id);
    if (!c || !v || v.disabled || !("transform" in c) || !("transform" in v)) continue;
    const place = placer(p, q, k, c);
    if (!place) continue;
    type Worst = { score: number; r: number; s: Spot; want: Spot };
    let target: Worst | undefined, edge: Worst | undefined;
    const frames: number[] = [];
    for (let r = 0; r < c.duration; r += step) frames.push(r);
    if (frames.at(-1) !== c.duration - 1) frames.push(c.duration - 1);
    for (const r of frames) {
      const s = calloutSpot(q, v, k.part, r), want = place(r);
      const off = Math.max(Math.abs(s.cx - want.cx) / Math.max(1, want.w), Math.abs(s.cy - want.cy) / Math.max(1, want.h));
      if (off >= 0.25 && Math.hypot(s.cx - want.cx, s.cy - want.cy) >= 3 && (!target || off > target.score)) target = { score: off, r, s, want };
      const b = boxOfSpot(s);
      const inside = Math.max(0, Math.min(b.right, q.width) - Math.max(b.left, 0)) * Math.max(0, Math.min(b.bottom, q.height) - Math.max(b.top, 0));
      const outside = 1 - inside / Math.max(1, s.w * s.h);
      if (outside >= 0.05 && (!edge || outside > edge.score)) edge = { score: outside, r, s, want };
    }
    const worst = target ?? edge;
    if (!worst) continue;
    const at = +framesToSeconds(c.start + worst.r, q.fps).toFixed(2);
    const b = boxOfSpot(worst.s);
    const box = { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) };
    const name = `${k.id} (${nameOf(c, k.part)})`;
    const on = k.shot ? `what it points at in ${k.shot}` : `the title ${k.title} it rings`;
    let note: string;
    if (target) {
      const w = worst.want;
      const fix = k.part === "mask" ? `set_mask on it in a saved version puts the hole back on ${on}` : `an override {clip_id: "${k.id}", x: ${+(w.cx / q.width - 0.5).toFixed(3)}, y: ${+(w.cy / q.height - 0.5).toFixed(3)}} puts it back on ${on}`;
      note = `${name} sits over other content than in the master at ${at} s in this shape: ${fix}`;
    } else {
      const share = Math.round(worst.score * 100);
      const big = worst.want.w > q.width * 0.98 || worst.want.h > q.height * 0.98;
      const sm = k.shot ? pm.get(k.shot) : undefined;
      let fix: string;
      if (big) fix = `${on} is wider than this frame: fit "blur" or "fit" shows it whole, or a saved version can point at a part of it`;
      else if (sm && "transform" in sm) {
        const u = inPicture(p, c, k.part, sm, worst.r);
        fix = `focus {clip_id: "${k.shot}", x: ${+((u.left + u.right) / 2).toFixed(3)}, y: ${+((u.top + u.bottom) / 2).toFixed(3)}, at: ${at}} centers ${on} there (one focus point with at for each part it glides to make a path)`;
      } else fix = `${on} runs off this frame too`;
      note = `${name} runs off the frame at ${at} s in this shape (${share}% of it outside): ${fix}`;
    }
    out.push({ clip_id: k.id, at, issue: target ? "off_target" : "off_frame", box, note });
  }
  return out;
}

/** A callout's box on q at timeline frame f, canvas pixels, for the check
 * sheet; null when it does not show then. */
export function calloutBoxAt(q: Project, id: Id, f: number): Box | null {
  const c = clipsById(q).get(id);
  if (!c || !("transform" in c) || f < c.start || f >= c.start + c.duration) return null;
  const a = anchorOf(c);
  const part: Part = a ? (a.mask ? "mask" : a.keys[0].w !== undefined && c.type === "color" && c.shape ? "shape" : "point") : (calloutPart(q, c) ?? (c.type === "color" && c.mask && CLOSED.has(c.mask.shape) ? "mask" : c.type === "color" && c.shape ? "shape" : "point"));
  return boxOfSpot(calloutSpot(q, c, part, f - c.start));
}
