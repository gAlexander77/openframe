// Deliverables: the versions of an ad a campaign ships (16:9, 9:16, 1:1,
// 4:5; 30, 15 and 6 second cut-downs; a textless master), each made from
// the master as a separate project document and never saved over it, so
// export_versions renders them one after another while the editor keeps
// the master open and untouched.
//
// A new shape refits every layer: full-frame footage fills the new frame
// (or fits it over a blurred copy of itself, CapCut's Canvas: Blur), and
// titles, logos and boxes keep their pixel size against the frame's short
// side and their place in its title-safe area (on 9:16, clear of the apps'
// buttons): against the same edges, or centered. A group (an ad element)
// moves and scales as one, its layout kept, shrunk to fit the safe area
// when it must (ADR-063). A shorter cut
// keeps the opening and the end card, cutting the middle out of the
// picture tracks; the music runs from the start and fades at the new end.

import { safeArea } from "./ads";
import { canvasSize } from "./canvas";
import { paramAt } from "./keyframes";
import { clipEnd, findCompound, getAsset, liftRange, projectDuration } from "./project/ops";
import type { Clip, ColorClip, Id, Keyframe, Project, TextStyle, Track, VisualClip } from "./project/types";
import { fittedSize, textPad } from "./render/size";
import { secondsToFrames } from "./time";

export type VersionRatio = "16:9" | "9:16" | "1:1" | "4:5" | "original";
export const VERSION_RATIOS: VersionRatio[] = ["16:9", "9:16", "1:1", "4:5", "original"];
export type VersionFit = "fill" | "blur" | "fit";
export const VERSION_FITS: VersionFit[] = ["fill", "blur", "fit"];

export interface VersionSpec {
  ratio: VersionRatio;
  /** Seconds; a cut-down when shorter than the master. */
  duration?: number;
  /** Titles and captions off, for the master other languages are cut from. */
  textless?: boolean;
  /** How full-frame footage meets a new shape (default fill). */
  fit?: VersionFit;
  /** File name; default the project's name and what the version is. */
  name?: string;
}

/** A file name that says what the version is: "Roast 9x16 6s textless". */
export function versionName(base: string, v: VersionSpec): string {
  if (v.name) return v.name;
  const parts = [base, v.ratio === "original" ? "" : v.ratio.replace(":", "x"), v.duration ? `${+v.duration.toFixed(2)}s` : "", v.textless ? "textless" : ""];
  return parts.filter(Boolean).join(" ");
}

const SHORT_BLUR = 40;

/** Where the master's end card starts (the clips add_ad_element named "End
 * card" that run to the end), or undefined without one. */
export function endCardStart(p: Project): number | undefined {
  const end = projectDuration(p);
  const card = p.tracks.flatMap((t) => t.clips).filter((c) => c.name === "End card");
  if (!card.length || Math.max(...card.map(clipEnd)) < end - 1) return undefined;
  return Math.min(...card.map((c) => c.start));
}

// ---- refitting to a new shape ----------------------------------------------------

interface Frame {
  w: number;
  h: number;
}

const short = (f: Frame) => Math.min(f.w, f.h);

/** The picture's own size in pixels, for media; undefined for the rest. */
function mediaSize(p: Project, c: Clip): Frame | undefined {
  if (c.type !== "video" && c.type !== "image") return undefined;
  const a = getAsset(p, c.assetId);
  return a?.width && a.height ? { w: a.rotation === 90 || a.rotation === 270 ? a.height : a.width, h: a.rotation === 90 || a.rotation === 270 ? a.width : a.height } : undefined;
}

const KEYED = ["transform.x", "transform.y", "transform.scale", "transform.scaleY"] as const;

/** Every value of a transform path, static and keyed, mapped by `fn`. */
function mapPath(c: VisualClip, path: (typeof KEYED)[number], fn: (v: number, rel: number) => number): VisualClip {
  const k = path.split(".")[1] as "x" | "y" | "scale" | "scaleY";
  const t = { ...c.transform };
  if (t[k] !== undefined) t[k] = fn(t[k]!, 0);
  const keys = c.keyframes?.[path];
  return { ...c, transform: t, ...(keys?.length ? { keyframes: { ...c.keyframes, [path]: keys.map((key) => ({ ...key, v: fn(key.v, key.f) })) } } : {}) };
}

/** Is a compound clip placed on the frame as a picture (moved, scaled,
 * turned or animated: a floating window), rather than a whole scene nested
 * at rest? */
function placedOnFrame(c: Clip): boolean {
  if (c.type !== "compound") return false;
  const t = c.transform;
  const moved = Math.abs(t.scale - 1) > 1e-3 || t.scaleY !== undefined || Math.abs(t.x) > 1e-3 || Math.abs(t.y) > 1e-3 || Math.abs(t.rotation) > 1e-3;
  return moved || [...KEYED, "transform.rotation"].some((k) => !!c.keyframes?.[k]?.length);
}

/** The compounds some compound clip plays as a picture on its frame: their
 * timelines refit as one picture (asPicture), the clip as an overlay
 * (ADR-067). */
function pictureCompounds(p: Project): Set<Id> {
  const out = new Set<Id>();
  for (const t of [...p.tracks, ...(p.compounds ?? []).flatMap((k) => k.tracks)]) for (const c of t.clips) if (c.type === "compound" && placedOnFrame(c)) out.add(c.compoundId);
  return out;
}

/** Does the picture cover the frame (a full-frame shot, not a
 * picture-in-picture or a logo)? A compound clip by what its timeline
 * draws, where it rests. */
function fullFrame(p: Project, c: VisualClip, m: Frame): boolean {
  if (c.type === "compound") {
    const b = boxOf(p, c, restOf(p, [c]) - c.start);
    return b.left <= p.width * 0.015 && b.right >= p.width * 0.985 && b.top <= p.height * 0.015 && b.bottom >= p.height * 0.985;
  }
  const fit = Math.min(p.width / m.w, p.height / m.h);
  const s = paramAt(c, "transform.scale", 0);
  const sy = c.transform.scaleY !== undefined ? paramAt(c, "transform.scaleY", 0) : s;
  return m.w * fit * s * (1 - c.crop.left - c.crop.right) >= p.width * 0.97 && m.h * fit * sy * (1 - c.crop.top - c.crop.bottom) >= p.height * 0.97;
}

/** Text sizes are pixels at a 1080-tall frame: scaling every pixel measure
 * of a style by `k`. */
function scaleStyle(s: TextStyle, k: number, maxWidth: number): TextStyle {
  const r = (v: number) => +(v * k).toFixed(2);
  return {
    ...s,
    size: Math.max(4, r(s.size)),
    letterSpacing: r(s.letterSpacing),
    maxWidth: Math.min(s.maxWidth, maxWidth),
    ...(s.stroke ? { stroke: { ...s.stroke, width: r(s.stroke.width) } } : {}),
    ...(s.stroke2 ? { stroke2: { ...s.stroke2, width: r(s.stroke2.width) } } : {}),
    ...(s.shadow ? { shadow: { ...s.shadow, blur: r(s.shadow.blur), x: r(s.shadow.x), y: r(s.shadow.y) } } : {}),
    ...(s.glow ? { glow: { ...s.glow, blur: r(s.glow.blur) } } : {}),
    ...(s.background ? { background: { ...s.background, padding: r(s.background.padding), radius: r(s.background.radius) } } : {}),
  };
}

/** A shape's box (fractions of the frame) and stroke (pixels at a
 * 1080-tall one) scaled by kw, kh and ks, keys and all. */
function scaleShape(c: ColorClip, kw: number, kh: number, ks: number): ColorClip {
  const sh = c.shape!;
  const keyed: Record<string, Keyframe[]> = {};
  for (const [path, k] of [["shape.width", kw], ["shape.height", kh], ["shape.stroke.width", ks]] as const) {
    const keys = c.keyframes?.[path];
    if (keys?.length) keyed[path] = keys.map((key) => ({ ...key, v: +(key.v * k).toFixed(5) }));
  }
  return {
    ...c,
    shape: { ...sh, width: +(sh.width * kw).toFixed(5), height: +(sh.height * kh).toFixed(5), ...(sh.stroke ? { stroke: { ...sh.stroke, width: +(sh.stroke.width * ks).toFixed(2) } } : {}) },
    ...(Object.keys(keyed).length ? { keyframes: { ...c.keyframes, ...keyed } } : {}),
  };
}

/**
 * A clip inside a compound that plays as a picture (a floating window),
 * from the master's frame `a` to `b`: the whole inner frame shrinks to fit
 * inside the new one, centered, as a video's picture does, so the compound
 * still draws what it drew (a 16:9 window stays a 16:9 window on 9:16, not
 * a crop of itself) and the compound clip sizes and places it as one.
 */
function asPicture(p: Project, a: Frame, b: Frame, c: Clip): Clip {
  if (c.type === "audio" || c.type === "adjustment") return c;
  const u = Math.min(b.w / a.w, b.h / a.h);
  // Fractions of the width and of the height, and pixels at a 1080-tall frame.
  const kx = (a.w * u) / b.w, ky = (a.h * u) / b.h;
  let v = mapPath(c, "transform.x", (x) => +(x * kx).toFixed(5));
  v = mapPath(v, "transform.y", (y) => +(y * ky).toFixed(5));
  const m = mediaSize(p, c);
  if (m) {
    const k = (u * Math.min(a.w / m.w, a.h / m.h)) / Math.min(b.w / m.w, b.h / m.h);
    v = mapPath(v, "transform.scale", (s) => +(s * k).toFixed(5));
    return v.transform.scaleY !== undefined ? mapPath(v, "transform.scaleY", (s) => +(s * k).toFixed(5)) : v;
  }
  if (v.type === "text") return { ...v, style: { ...scaleStyle(v.style, ky, Infinity), maxWidth: +(v.style.maxWidth * kx).toFixed(5) } };
  if (v.type === "color" && v.shape) return scaleShape(v, kx, ky, ky);
  if (v.type === "color") {
    // A solid fills the canvas: keep only the part the old frame covered.
    const { left, right, top, bottom } = v.crop;
    const ex = (1 - kx) / 2, ey = (1 - ky) / 2;
    return { ...v, crop: { left: ex + left * kx, right: ex + right * kx, top: ey + top * ky, bottom: ey + bottom * ky } };
  }
  return v;
}

/** One clip refit from frame `a` (the master's) to project `q`'s frame.
 * `grouped`: a part of a group, which placeSets fits as one. A compound
 * clip in `pictures` refits as a picture the master's frame in size. */
function refitClip(master: Project, q: Project, c: Clip, fit: VersionFit, grouped = false, pictures = new Set<Id>()): Clip {
  if (c.type === "audio" || c.type === "adjustment") return c;
  if (c.type === "compound" && !pictures.has(c.compoundId)) return c;
  const a: Frame = { w: master.width, h: master.height }, b: Frame = { w: q.width, h: q.height };
  const m = c.type === "compound" ? a : mediaSize(master, c);
  if (m) {
    const fitA = Math.min(a.w / m.w, a.h / m.h), fitB = Math.min(b.w / m.w, b.h / m.h);
    const full = fullFrame(master, c, m);
    // How much larger the picture is drawn, in pixels: a full-frame shot
    // keeps covering (fill) or fitting (blur, fit) the frame; anything
    // smaller keeps its size against the short side.
    const grow = full ? (fit === "fill" ? Math.max(b.w / m.w, b.h / m.h) / Math.max(a.w / m.w, a.h / m.h) : fitB / fitA) : short(b) / short(a);
    const kScale = (fitA / fitB) * grow;
    let v = c as VisualClip;
    v = mapPath(v, "transform.scale", (s) => +(s * kScale).toFixed(5));
    if (v.transform.scaleY !== undefined) v = mapPath(v, "transform.scaleY", (s) => +(s * kScale).toFixed(5));
    // Offsets in pixels grow with the picture, so the same part of it
    // stays at the frame's center.
    v = mapPath(v, "transform.x", (x) => (full ? (x * a.w * grow) / b.w : x));
    v = mapPath(v, "transform.y", (y) => (full ? (y * a.h * grow) / b.h : y));
    if (full && fit === "fill") {
      // No empty band: slide each position back inside what the picture covers.
      const room = (rel: number, dim: "w" | "h") => {
        const s = paramAt(v, dim === "w" ? "transform.scale" : v.transform.scaleY !== undefined ? "transform.scaleY" : "transform.scale", rel);
        const shown = m[dim] * fitB * s * (1 - (dim === "w" ? c.crop.left + c.crop.right : c.crop.top + c.crop.bottom));
        return Math.max(0, (shown - b[dim]) / (2 * b[dim]));
      };
      v = mapPath(v, "transform.x", (x, rel) => Math.max(-room(rel, "w"), Math.min(room(rel, "w"), x)));
      v = mapPath(v, "transform.y", (y, rel) => Math.max(-room(rel, "h"), Math.min(room(rel, "h"), y)));
    }
    if (full && fit === "blur") v = { ...v, canvas: { type: "blur", amount: SHORT_BLUR } };
    return v;
  }
  if (c.type === "text") {
    // Pixels against the short side stay, so a title is as big on a phone;
    // but a line wider than the new safe area shrinks to fit it (to three
    // quarters at most, then it wraps): a 16:9 headline otherwise broke
    // into a word a line on 9:16.
    const k = short(b) / b.h / (short(a) / a.h);
    // A part of a group keeps its lines (it wraps at the same width
    // against its size), so the group's layout holds when it is fitted.
    if (grouped) return { ...c, style: { ...scaleStyle(c.style, k, Infinity), maxWidth: +((c.style.maxWidth * a.w * short(b)) / short(a) / b.w).toFixed(5) } };
    const s = safeArea(q);
    const room = 1 - s.left - s.right;
    const style = scaleStyle(c.style, k, +room.toFixed(3));
    const wide = fittedSize(q, { ...c, style: { ...style, maxWidth: 1 } }).w;
    let kk = k * (wide > room * b.w ? Math.max(0.75, (room * b.w) / wide) : 1);
    // A word that cannot wrap (a 170-size wordmark on 9:16) still has to
    // fit: shrink until the wrapped lines are no wider than the safe area.
    let out = scaleStyle(c.style, kk, +room.toFixed(3));
    for (let i = 0; i < 3; i++) {
      const t = { ...c, style: out };
      const w = fittedSize(q, t).w - 2 * textPad(q, t);
      if (w <= room * b.w * 1.03) break;
      kk *= (room * b.w) / w;
      out = scaleStyle(c.style, kk, +room.toFixed(3));
    }
    return { ...c, style: out };
  }
  if (c.type === "color") {
    const { left, right, top, bottom } = c.crop;
    const boxed = left + right + top + bottom > 0.001;
    let out: Clip = c;
    if (boxed) {
      // A box cut from the solid: the same pixels against the short side,
      // around the same center.
      const kw = (a.w / b.w) * (short(b) / short(a)), kh = (a.h / b.h) * (short(b) / short(a));
      const cx = (left + 1 - right) / 2, cy = (top + 1 - bottom) / 2;
      const w = Math.min(1, (1 - left - right) * kw), h = Math.min(1, (1 - top - bottom) * kh);
      out = { ...c, crop: { left: Math.max(0, cx - w / 2), right: Math.max(0, 1 - cx - w / 2), top: Math.max(0, cy - h / 2), bottom: Math.max(0, 1 - cy - h / 2) } };
    }
    if (c.shape) {
      // A shape's box is fractions of the frame and its stroke pixels at a
      // 1080-tall one: both keep their pixels against the short side.
      const g = short(b) / short(a);
      out = scaleShape(out as ColorClip, (a.w / b.w) * g, (a.h / b.h) * g, (a.h / b.h) * g);
    }
    if (c.mask && c.mask.shape !== "linear" && c.mask.shape !== "mirror") {
      const kw = (a.w / b.w) * (short(b) / short(a)), kh = (a.h / b.h) * (short(b) / short(a));
      out = { ...out, mask: { ...c.mask, width: +(c.mask.width * kw).toFixed(5), height: +(c.mask.height * kh).toFixed(5) } } as Clip;
    }
    return out;
  }
  return c;
}

type Rect = { left: number; right: number; top: number; bottom: number };

const union = (boxes: Rect[]): Rect => ({ left: Math.min(...boxes.map((b) => b.left)), right: Math.max(...boxes.map((b) => b.right)), top: Math.min(...boxes.map((b) => b.top)), bottom: Math.max(...boxes.map((b) => b.bottom)) });

/** What a compound's timeline draws, in pixels of its canvas (the frame):
 * its pictures' boxes at their first frames; the whole canvas when there
 * are none to measure.
 * ponytail: boxes, not pixels; a shadow sprite's clear margin counts. */
function contentBox(p: Project, id: Id, depth: number): Rect {
  const k = findCompound(p, id);
  const whole = { left: 0, top: 0, right: p.width, bottom: p.height };
  if (!k || depth > 4) return whole;
  const view = { ...p, tracks: k.tracks };
  const boxes = k.tracks.filter((t) => t.kind === "video" && !t.hidden).flatMap((t) => t.clips.filter((c) => !c.disabled && "transform" in c).map((c) => boxOf(view, c as VisualClip, 0, depth + 1)));
  return boxes.length ? union(boxes) : whole;
}

/** A layer's box on q's frame at clip frame `rel`, at rest otherwise
 * (before animations), in pixels. A compound clip's is what its timeline
 * draws, scaled about the canvas center. */
export function boxOf(q: Project, c: VisualClip, rel = 0, depth = 0): Rect {
  const sc = paramAt(c, "transform.scale", rel), scy = c.transform.scaleY !== undefined ? paramAt(c, "transform.scaleY", rel) : sc;
  const rad = (paramAt(c, "transform.rotation", rel) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const at = (w: number, h: number, ox: number, oy: number): Rect => {
    const hw = (Math.abs(cos) * w + Math.abs(sin) * h) / 2, hh = (Math.abs(sin) * w + Math.abs(cos) * h) / 2;
    const cx = q.width / 2 + paramAt(c, "transform.x", rel) * q.width + cos * ox - sin * oy;
    const cy = q.height / 2 + paramAt(c, "transform.y", rel) * q.height + sin * ox + cos * oy;
    return { left: cx - hw, right: cx + hw, top: cy - hh, bottom: cy + hh };
  };
  if (c.type === "compound") {
    const k = contentBox(q, c.compoundId, depth);
    return at((k.right - k.left) * Math.abs(sc), (k.bottom - k.top) * Math.abs(scy), ((k.left + k.right) / 2 - q.width / 2) * sc, ((k.top + k.bottom) / 2 - q.height / 2) * scy);
  }
  const s = fittedSize(q, c);
  const { left, right, top, bottom } = c.crop;
  return at(s.w * Math.abs(sc) * (1 - left - right), s.h * Math.abs(scy) * (1 - top - bottom), ((left - right) / 2) * s.w * sc, ((top - bottom) / 2) * s.h * scy);
}

/**
 * The timeline frame a set of layers is at rest: of its first frame and
 * its position and scale keys, the one where it shows the most of itself
 * inside the frame, and of those the one it holds longest. A window that
 * slides in rests where it lands, not where it starts off the edge; a
 * layer without keys rests where it starts.
 */
function restOf(p: Project, set: VisualClip[]): number {
  const times = [...new Set(set.flatMap((c) => [c.start, ...KEYED.flatMap((k) => (c.keyframes?.[k] ?? []).map((key) => c.start + key.f))].filter((t) => t >= c.start && t < c.start + c.duration)))].sort((x, y) => x - y);
  if (times.length < 2) return times[0] ?? set[0].start;
  const end = Math.max(...set.map((c) => c.start + c.duration));
  let best = times[0], shownBest = -1, holdBest = -1;
  times.forEach((t, i) => {
    const b = union(set.map((c) => boxOf(p, c, t - c.start)));
    const area = Math.max(1, (b.right - b.left) * (b.bottom - b.top));
    const inside = Math.max(0, Math.min(b.right, p.width) - Math.max(b.left, 0)) * Math.max(0, Math.min(b.bottom, p.height) - Math.max(b.top, 0));
    const shown = Math.round((inside / area) * 100) / 100, hold = (times[i + 1] ?? end) - t;
    if (shown > shownBest || (shown === shownBest && hold > holdBest)) [best, shownBest, holdBest] = [t, shown, hold];
  });
  return best;
}

/** Is this a layer to keep inside the safe area (a title, logo, sticker,
 * box, floating window), rather than footage or a background that fills
 * the frame? Measured where it rests. */
function isOverlay(q: Project, c: Clip): c is VisualClip {
  if (c.type === "audio" || c.type === "adjustment" || (c.type === "compound" && !placedOnFrame(c))) return false;
  if (c.type === "text") return true;
  const b = boxOf(q, c, restOf(q, [c]) - c.start);
  return b.right - b.left < q.width * 0.95 || b.bottom - b.top < q.height * 0.95;
}

/** The overlays of a frame in sets that move as one: the clips of a group
 * (an ad element's parts, a lower third's name and title), each other
 * overlay alone. */
function overlaySets(p: Project): VisualClip[][] {
  const sets = new Map<string, VisualClip[]>();
  for (const c of p.tracks.flatMap((t) => t.clips)) {
    if (c.disabled || !isOverlay(p, c)) continue;
    const key = c.group ?? c.id;
    sets.set(key, [...(sets.get(key) ?? []), c]);
  }
  return [...sets.values()];
}

/** A frame's safe area in pixels; even about the center line for a set
 * centered on the frame (on 9:16 the right 19% is the apps' buttons, so a
 * centered card keeps that margin on the left too, as lib/ads.ts lays it). */
function areaOf(p: Pick<Project, "width" | "height">, centered: boolean): Rect {
  const s = safeArea(p);
  const r = { left: s.left * p.width, right: p.width * (1 - s.right), top: s.top * p.height, bottom: p.height * (1 - s.bottom) };
  const m = Math.max(r.left, p.width - r.right);
  return centered ? { ...r, left: m, right: p.width - m } : r;
}

/** Where a span sat in the free room around it, 0 (against the start) to
 * 1 (against the end); 0.5 when it fills the room or more. */
function share(lo: number, hi: number, min: number, max: number): number {
  const free = max - min - (hi - lo);
  return free > 1 ? Math.max(0, Math.min(1, (lo - min) / free)) : 0.5;
}

/** Where a span of `size` starts in [min, max] at `t` of the free room;
 * centered on the room when it is wider. */
const startAt = (t: number, size: number, min: number, max: number) => (size > max - min ? (min + max) / 2 - size / 2 : min + t * (max - min - size));

/** A layer `f` times its size: a title's type (and its wrap width, so its
 * lines stay), any other layer's scale. */
function shrink(c: VisualClip, f: number): VisualClip {
  if (c.type === "text") return { ...c, style: { ...scaleStyle(c.style, f, Infinity), maxWidth: +(c.style.maxWidth * f).toFixed(5) } };
  let v = mapPath(c, "transform.scale", (s) => +(s * f).toFixed(5));
  if (v.transform.scaleY !== undefined) v = mapPath(v, "transform.scaleY", (s) => +(s * f).toFixed(5));
  return v;
}

/**
 * Place the master's overlay sets on the new frame, each where it rests
 * (restOf). A set keeps its place in the safe area, against the same edges
 * or centered (a corner badge stays in its corner, a centered card on the
 * center line), and fits inside the new safe area. A set that reached past
 * the master's safe area on an axis (a picture centered on a 9:16 frame
 * reaches into the captions' band) is measured against the whole frame on
 * that axis instead, and a lone picture of that kind is placed in it. A
 * group moves and scales as one unit: its parts keep their layout, each
 * offset growing with the short side as their sizes did (refitClip), so an
 * end card's stack is not spread 1.78 times taller than its type grows on
 * a wider frame. A group shrinks to fit the safe area when it would not;
 * so does a lone picture the new frame would cut (a floating window wider
 * than 9:16); a lone title keeps refitClip's size (it already wraps and
 * shrinks to the new width) and only moves.
 *
 * Keyed motion is laid out again around the rest (ADR-067): each key's
 * offset from the rest is scaled by how far the set has to travel to
 * leave the frame on that side, new against old, so a slide in from off
 * the edge still starts off the edge, and a drift stays a drift.
 */
// ponytail: each set is placed alone, so a title beside a window on 16:9
// overlaps it on 9:16; re-stacking a layout needs a layout engine (ADR-067).
function placeSets(master: Project, q: Project, sets: VisualClip[][]): Project {
  const g = Math.min(q.width, q.height) / Math.min(master.width, master.height);
  const refit = new Map(q.tracks.flatMap((t) => t.clips).map((c) => [c.id, c as VisualClip]));
  const placed = new Map<Id, Clip>();
  for (const set of sets) {
    const rest = restOf(master, set);
    const before = set.map((c) => boxOf(master, c, rest - c.start));
    const was = union(before);
    const centered = Math.abs((was.left + was.right) / 2 - master.width / 2) < master.width * 0.01;
    const safeA = areaOf(master, centered), safeB = areaOf(q, centered);
    const now = set.map((c) => refit.get(c.id)!);
    const group = set.length > 1;
    const own = boxOf(q, now[0], rest - now[0].start);
    const size = group ? { w: (was.right - was.left) * g, h: (was.bottom - was.top) * g } : { w: own.right - own.left, h: own.bottom - own.top };
    // A lone picture that the new frame would cut (a floating window wider
    // than a 9:16 frame) is fitted as a group is.
    const fitted = group || (now[0].type !== "text" && (size.w > q.width + 1 || size.h > q.height + 1));
    // Per axis: measured in the safe area when the set was inside it, else
    // in the frame; a lone picture that was not, and need not shrink, is
    // placed in the frame too (the rest keep to the new safe area).
    const inX = was.left >= safeA.left - 1 && was.right <= safeA.right + 1, inY = was.top >= safeA.top - 1 && was.bottom <= safeA.bottom + 1;
    const roomA = { left: inX ? safeA.left : 0, right: inX ? safeA.right : master.width, top: inY ? safeA.top : 0, bottom: inY ? safeA.bottom : master.height };
    const free = now[0].type !== "text" && !fitted;
    const room = { left: inX || !free ? safeB.left : 0, right: inX || !free ? safeB.right : q.width, top: inY || !free ? safeB.top : 0, bottom: inY || !free ? safeB.bottom : q.height };
    const f = fitted ? Math.min(1, (room.right - room.left) / size.w, (room.bottom - room.top) / size.h) : 1;
    const w = size.w * f, h = size.h * f;
    const left = startAt(share(was.left, was.right, roomA.left, roomA.right), w, room.left, room.right);
    const top = startAt(share(was.top, was.bottom, roomA.top, roomA.bottom), h, room.top, room.bottom);
    // How much farther (or nearer) the edges are, each way, new over old.
    const ratio = (b: number, a: number) => (a > 1 && b > 1 ? b / a : g);
    const kx = { out: ratio(q.width - left, master.width - was.left), back: ratio(left + w, was.right) };
    const ky = { out: ratio(q.height - top, master.height - was.top), back: ratio(top + h, was.bottom) };
    now.forEach((c, i) => {
      const v = f < 1 ? shrink(c, f) : c;
      const rel = rest - c.start;
      // The part's center: its place in the group's layout, grown and fitted.
      const want = group
        ? { x: left + ((before[i].left + before[i].right) / 2 - was.left) * g * f, y: top + ((before[i].top + before[i].bottom) / 2 - was.top) * g * f }
        : { x: left + w / 2, y: top + h / 2 };
      const b = boxOf(q, v, rel);
      const dx = want.x - (b.left + b.right) / 2, dy = want.y - (b.top + b.bottom) / 2;
      const keyed = !!(c.keyframes?.["transform.x"]?.length || c.keyframes?.["transform.y"]?.length);
      if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5 && v === c && !keyed) return;
      const x0 = paramAt(v, "transform.x", rel), y0 = paramAt(v, "transform.y", rel);
      let moved = mapPath(v, "transform.x", (x) => +(x0 + dx / q.width + ((x - x0) * master.width * (x > x0 ? kx.out : kx.back)) / q.width).toFixed(5));
      moved = mapPath(moved, "transform.y", (y) => +(y0 + dy / q.height + ((y - y0) * master.height * (y > y0 ? ky.out : ky.back)) / q.height).toFixed(5));
      placed.set(c.id, moved);
    });
  }
  if (!placed.size) return q;
  return { ...q, tracks: q.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => placed.get(c.id) ?? c) })) };
}

/** The master in another shape. Compound timelines first, since a
 * compound clip's box is what its timeline draws: one played as a picture
 * refits as one (asPicture), a whole scene nested at rest as a frame of
 * its own, its overlays placed as the root's are. */
export function reshape(p: Project, ratio: VersionRatio, fit: VersionFit): Project {
  if (ratio === "original") return p;
  const [rw, rh] = ratio.split(":").map(Number);
  const [width, height] = canvasSize(rw, rh, Math.min(p.width, p.height));
  if (width === p.width && height === p.height) return p;
  const q: Project = { ...p, width, height, canvasFixed: true };
  const pictures = pictureCompounds(p);
  const a: Frame = { w: p.width, h: p.height }, b: Frame = { w: width, h: height };
  // One timeline refit as a frame: each clip on its own, then its overlays placed.
  const asFrame = (m: Project, out: Project): Track[] => {
    const sets = overlaySets(m);
    const grouped = new Set(sets.filter((s) => s.length > 1).flatMap((s) => s.map((c) => c.id)));
    const fitted = { ...out, tracks: m.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => refitClip(m, out, c, fit, grouped.has(c.id), pictures)) })) };
    return placeSets(m, fitted, sets).tracks;
  };
  let out: Project = q;
  if (p.compounds) {
    out = { ...q, compounds: p.compounds.map((k) => (pictures.has(k.id) ? { ...k, tracks: k.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => asPicture(p, a, b, c)) })) } : k)) };
    out = { ...out, compounds: out.compounds!.map((k) => (pictures.has(k.id) ? k : { ...k, tracks: asFrame({ ...p, tracks: k.tracks }, { ...out, tracks: k.tracks }) })) };
  }
  return { ...out, tracks: asFrame(p, out) };
}

// ---- cutting down -------------------------------------------------------------------

/**
 * The master cut to `frames`: the picture keeps its opening and its last
 * `keepEnd` frames (the end card), the middle taken out and closed up; the
 * music and other sound run on from the start and fade out over a second
 * at the new end. Longer than the master: unchanged.
 */
export function cutDown(p: Project, frames: number, keepEnd: number): Project {
  const total = projectDuration(p);
  if (frames >= total) return p;
  const tail = Math.max(0, Math.min(keepEnd, frames - 1));
  const locked = new Map(p.tracks.map((t) => [t.id, t.locked]));
  // The picture: lift [frames - tail, total - tail) out, closing the gap.
  let q: Project = { ...p, tracks: p.tracks.map((t) => ({ ...t, locked: t.kind === "audio" })) };
  q = liftRange(q, frames - tail, total - tail, true);
  // The sound: cut at the new end, fading out.
  q = { ...q, tracks: q.tracks.map((t) => ({ ...t, locked: t.kind !== "audio" })) };
  q = liftRange(q, frames, total, false);
  const fade = secondsToFrames(1, p.fps);
  q = {
    ...q,
    tracks: q.tracks.map((t) => ({
      ...t,
      locked: locked.get(t.id) ?? false,
      clips: t.kind === "audio" ? t.clips.map((c) => (clipEnd(c) === frames && c.type === "audio" ? { ...c, fadeOut: Math.max(c.fadeOut, Math.min(fade, c.duration)) } : c)) : t.clips,
    })),
  };
  return q;
}

/** Titles and captions off, and the boxes that belong to them (a lower
 * third's bar); full-frame cards and logos stay. */
export function textless(p: Project): Project {
  const textGroups = new Set(p.tracks.flatMap((t) => t.clips).filter((c) => c.type === "text" && c.group).map((c) => c.group));
  const off = (c: Clip) => c.type === "text" || (c.type === "color" && !!c.group && textGroups.has(c.group) && isOverlay(p, c));
  return { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (off(c) ? ({ ...c, disabled: true } as Clip) : c)) })) };
}

/** One version of the master: cut down, reshaped, textless, as asked.
 * `keepEnd` frames of the end are kept in a cut-down (default: the end
 * card's length when the master has one). */
export function versionProject(p: Project, v: VersionSpec, keepEnd?: number): Project {
  let q = p;
  if (v.duration !== undefined) {
    const frames = Math.max(1, secondsToFrames(v.duration, p.fps));
    const card = endCardStart(p);
    q = cutDown(q, frames, keepEnd ?? (card === undefined ? 0 : projectDuration(p) - card));
  }
  q = reshape(q, v.ratio, v.fit ?? "fill");
  if (v.textless) q = textless(q);
  return { ...q, name: versionName(p.name, v) };
}

/** What an agent asks export_versions for: explicit versions, or every
 * ratio at every duration (the master's own length when none is given),
 * plus a textless master in the first ratio. At most `limit`. */
export function expandVersions(a: { versions?: VersionSpec[]; ratios?: VersionRatio[]; durations?: number[]; textless?: boolean; fit?: VersionFit }, masterSeconds: number, limit = 12): VersionSpec[] {
  const out: VersionSpec[] = [...(a.versions ?? [])].map((v) => ({ ...v, ...(v.fit === undefined && a.fit ? { fit: a.fit } : {}) }));
  if (a.ratios?.length || a.durations?.length) {
    const ratios = a.ratios?.length ? a.ratios : (["original"] as VersionRatio[]);
    // A duration as long as the master (or longer) is the master itself.
    const durations = [...new Set((a.durations ?? []).map((d) => (d >= masterSeconds - 0.05 ? undefined : d)))];
    for (const ratio of ratios) for (const duration of durations.length ? durations : [undefined]) out.push({ ratio, ...(duration !== undefined ? { duration } : {}), ...(a.fit ? { fit: a.fit } : {}) });
  }
  if (a.textless) out.push({ ratio: out[0]?.ratio ?? "original", textless: true, ...(a.fit ? { fit: a.fit } : {}) });
  if (!out.length) throw new Error("say which versions: versions, or ratios and/or durations");
  if (out.length > limit) throw new Error(`${out.length} versions is more than ${limit} in one call; split them`);
  const names = out.map((v) => versionName("", v));
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup !== undefined) throw new Error(`two versions are the same (${dup.trim() || "the master"}); name them apart`);
  return out;
}
