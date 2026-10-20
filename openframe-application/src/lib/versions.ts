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
// when it must (ADR-063). A wide frame made tall stacks what stood side by
// side (a window beside its headline, a split screen) in the safe column,
// and its captions, burned in by default, take the tall frame's caption
// place (ADR-091). Footage a new shape crops is framed on its subject and
// follows it (lib/reframe.ts, ADR-097), unless asked to stay centered or
// given a clip's focus. A shorter cut
// keeps the opening and the end card, cutting the middle out of the
// picture tracks; the music runs from the start and fades at the new end.

import { safeArea, titleWrap } from "./ads";
import { VERTICAL_SAFE } from "./align";
import { minTextSize } from "./brandKit";
import { canvasSize } from "./canvas";
import { captionFit, captionY } from "./captionLooks";
import { withoutCaptions } from "./captions";
import { paramAt } from "./keyframes";
import { clipEnd, findCompound, getAsset, liftRange, projectDuration } from "./project/ops";
import type { Clip, ColorClip, Id, ImageClip, Keyframe, Project, TextClip, TextStyle, Track, VideoClip, VisualClip } from "./project/types";
import { fittedSize, textPad } from "./render/size";
import { lookFor, reframeShot, type Focus, type Looks, type Reframe, type SubjectNote } from "./reframe";
import { secondsToFrames } from "./time";

export type VersionRatio = "16:9" | "9:16" | "1:1" | "4:5" | "original";
export const VERSION_RATIOS: VersionRatio[] = ["16:9", "9:16", "1:1", "4:5", "original"];
export type VersionFit = "fill" | "blur" | "fit";
export const VERSION_FITS: VersionFit[] = ["fill", "blur", "fit"];
/** What a version does with the captions (add_captions' clips): burned in
 * (their track shown, even when the master hides it), none, or as the
 * project has them. */
export type VersionCaptions = "burn" | "none" | "as_project";
export const VERSION_CAPTIONS: VersionCaptions[] = ["burn", "none", "as_project"];

export interface VersionSpec {
  ratio: VersionRatio;
  /** Seconds; a cut-down when shorter than the master. */
  duration?: number;
  /** Titles and captions off, for the master other languages are cut from. */
  textless?: boolean;
  /** How full-frame footage meets a new shape (default fill). */
  fit?: VersionFit;
  /** The captions; default burned in on a tall version (9:16, 4:5), where
   * the sound is often off, and as the project has them on the rest. */
  captions?: VersionCaptions;
  /** File name; default the project's name and what the version is. */
  name?: string;
  /** How footage the new shape crops is framed: on its subject (default)
   * or at the center. */
  reframe?: Reframe;
  /** Clips framed by hand in this version: the point of each one's picture
   * to keep at the center. */
  focus?: Focus[];
}

/** What reshape uses to frame cropped footage, and where it reports the
 * subjects its framing cuts. */
export interface ReframeOptions {
  looks?: Looks;
  reframe?: Reframe;
  focus?: Focus[];
  notes?: SubjectNote[];
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

/** Does a video or picture clip cover its frame (a shot a new shape
 * crops), where it rests? */
export function fillsFrame(p: Project, c: Clip): boolean {
  const m = mediaSize(p, c);
  return !!m && fullFrame(p, c as VisualClip, m);
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
 * clip in `pictures` refits as a picture the master's frame in size.
 * `room`: the width a lone title wraps within, a fraction of q's width
 * (default its safe area's). */
function refitClip(master: Project, q: Project, c: Clip, fit: VersionFit, grouped = false, pictures = new Set<Id>(), room?: number, frame: ReframeOptions = {}): Clip {
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
    // Cropped footage framed on its subject, or where the caller says.
    if (full && fit === "fill" && (c.type === "video" || c.type === "image")) {
      const r = reframeShot(master, q, c, v, lookFor(frame.looks, c), frame.reframe ?? "subject", frame.focus?.find((x) => x.clip_id === c.id));
      frame.notes?.push(...r.notes);
      v = r.clip;
    }
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
    const width = room ?? 1 - s.left - s.right;
    // The new frame's wrap width (titleWrap's, for where it lands), or the
    // title's own when narrower: its pixels against the short side, as its
    // type's (a fraction of 1920 is not the same fraction of 1080).
    const own = (c.style.maxWidth * a.w * short(b)) / short(a) / b.w;
    const fitStyle = (kk: number) => ({ ...scaleStyle(c.style, kk, Infinity), maxWidth: +Math.min(own, width).toFixed(3) });
    const wide = fittedSize(q, { ...c, style: { ...fitStyle(k), maxWidth: 1 } }).w;
    let kk = k * (wide > width * b.w ? Math.max(0.75, (width * b.w) / wide) : 1);
    // A word that cannot wrap (a 170-size wordmark on 9:16) still has to
    // fit: shrink until the wrapped lines are no wider than the safe area.
    let out = fitStyle(kk);
    for (let i = 0; i < 3; i++) {
      const t = { ...c, style: out };
      const w = fittedSize(q, t).w - 2 * textPad(q, t);
      if (w <= width * b.w * 1.03) break;
      kk *= (width * b.w) / w;
      out = fitStyle(kk);
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
 *
 * `stacks`: side-by-side compositions (sideBySide) a tall frame stacks
 * instead (stackPlans), clear of the burned `captions`.
 */
function placeSets(master: Project, q: Project, sets: VisualClip[][], stacks: VisualClip[][][] = [], follows = new Map<VisualClip[], VisualClip[]>(), captions: Span[] = []): Project {
  const refit = new Map(q.tracks.flatMap((t) => t.clips).map((c) => [c.id, c as VisualClip]));
  const measured = new Map(sets.map((set) => [set, measureSet(master, q, refit, set)]));
  const of = (set: VisualClip[]) => measured.get(set)!;
  const plans = stackPlans(master, q, stacks.map((comp) => comp.map(of)), new Map([...follows].map(([f, l]) => [of(f), of(l)])), captions);
  const placed = new Map<Id, Clip>();
  for (const m of measured.values()) {
    const plan = plans.get(m) ?? ownPlan(master, q, m, captions);
    if ("clips" in plan) plan.clips.forEach((c) => placed.set(c.id, c));
    else layOut(master, q, m, plan, placed);
  }
  if (!placed.size) return q;
  return { ...q, tracks: q.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => placed.get(c.id) ?? c) })) };
}

/** A set of overlays as placeSets measures it: the master's frame it rests
 * at, its parts' boxes there and their union, the parts refit to the new
 * frame, and the size it has there (a group's layout grown with the short
 * side; a lone layer's own refit box). */
interface Measured {
  set: VisualClip[];
  rest: number;
  before: Rect[];
  was: Rect;
  now: VisualClip[];
  group: boolean;
  size: { w: number; h: number };
}

function measureSet(master: Project, q: Project, refit: Map<Id, VisualClip>, set: VisualClip[]): Measured {
  const g = Math.min(q.width, q.height) / Math.min(master.width, master.height);
  const rest = restOf(master, set);
  const before = set.map((c) => boxOf(master, c, rest - c.start));
  const was = union(before);
  const now = set.map((c) => refit.get(c.id)!);
  const group = set.length > 1;
  const own = boxOf(q, now[0], rest - now[0].start);
  const size = group ? { w: (was.right - was.left) * g, h: (was.bottom - was.top) * g } : { w: own.right - own.left, h: own.bottom - own.top };
  return { set, rest, before, was, now, group, size };
}

/** Where a set goes on the new frame: `f` times its size, its box's top
 * left corner at (left, top) in pixels; or its parts already placed. */
type Plan = { f: number; left: number; top: number } | { clips: VisualClip[] };

/** A set on its own: kept in its place in the safe area (placeSets), above
 * the burned captions showing with it. */
function ownPlan(master: Project, q: Project, m: Measured, captions: Span[] = []): Plan {
  const { was, now, group, size } = m;
  const centered = Math.abs((was.left + was.right) / 2 - master.width / 2) < master.width * 0.01;
  const safeA = areaOf(master, centered), safeB = areaOf(q, centered);
  safeB.bottom = aboveCaptions(q, safeB, spanOf(m.set), captions);
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
  return { f, left: startAt(share(was.left, was.right, roomA.left, roomA.right), w, room.left, room.right), top: startAt(share(was.top, was.bottom, roomA.top, roomA.bottom), h, room.top, room.bottom) };
}

/** Move a set's parts to its plan, keyed motion laid out again around the
 * rest (ADR-067). */
function layOut(master: Project, q: Project, m: Measured, plan: { f: number; left: number; top: number }, placed: Map<Id, Clip>) {
  const g = Math.min(q.width, q.height) / Math.min(master.width, master.height);
  const { rest, before, was, now, group, size } = m;
  const { f, left, top } = plan;
  const w = size.w * f, h = size.h * f;
  // How much farther (or nearer) the edges are, each way, new over old.
  const ratio = (b: number, a: number) => (a > 1 && b > 1 ? b / a : g);
  const kx = { out: ratio(q.width - left, master.width - was.left), back: ratio(left + w, was.right) };
  const ky = { out: ratio(q.height - top, master.height - was.top), back: ratio(top + h, was.bottom) };
  const floor = minTextSize(q.width, q.height);
  now.forEach((c, i) => {
    // A group's type shrinks with it, but not under the readable size (a
    // split screen's labels fitted to a square frame).
    const fc = c.type === "text" && f < 1 ? Math.min(1, Math.max(f, floor / c.style.size)) : f;
    const v = Math.abs(fc - 1) > 1e-6 ? shrink(c, fc) : c;
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

// ---- side by side, stacked on a tall frame ------------------------------------------

/** When something shows on the timeline, frames. */
interface Span {
  from: number;
  to: number;
  /** A caption's box top on the new frame, pixels. */
  top?: number;
}

const spanOf = (set: Clip[]): Span => ({ from: Math.min(...set.map((c) => c.start)), to: Math.max(...set.map(clipEnd)) });

/** The bottom of a room on q's frame that leaves the band of the captions
 * burned in during `span` free (a gap above the highest), keeping at least
 * half the room. */
function aboveCaptions(q: Project, room: Rect, span: Span, captions: Span[]): number {
  const top = Math.min(...captions.filter((c) => c.top !== undefined && c.from < span.to && span.from < c.to).map((c) => c.top!));
  if (!Number.isFinite(top)) return room.bottom;
  return Math.max(room.top + (room.bottom - room.top) * 0.5, Math.min(room.bottom, top - 0.025 * Math.min(q.width, q.height)));
}

const inRect = ([x, y]: number[], r: Rect) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

/** Do two spans share at least half of the shorter one? */
const together = (a: Span, b: Span) => Math.min(a.to, b.to) - Math.max(a.from, b.from) >= 0.5 * Math.min(a.to - a.from, b.to - b.from);

type Kind = "picture" | "text" | "other";

/** A set as a composition sees it: a picture (footage, a picture or a
 * floating window a quarter of the frame or more each way, with its border
 * or label if grouped), a title (or a group with one), or anything else. */
function kindOf(master: Project, set: VisualClip[], was: Rect): Kind {
  const media = set.some((c) => c.type === "video" || c.type === "compound" || (c.type === "image" && !getAsset(master, c.assetId)?.sticker));
  if (media && was.right - was.left >= master.width * 0.25 && was.bottom - was.top >= master.height * 0.25) return "picture";
  return set.some((c) => c.type === "text") ? "text" : "other";
}

/**
 * The side-by-side compositions of a wide frame, for a tall version to
 * stack (ADR-091): a picture in one horizontal half with a title or another
 * picture in the other half, on screen together and level with each other
 * (a floating window beside its headline, a split screen). Each comes back
 * as its sets; a set beside several (a window between two labels) joins
 * them into one. Measured where each set rests.
 */
export function sideBySide(master: Project, sets: VisualClip[][]): VisualClip[][][] {
  const half = master.width / 2;
  const info = sets.map((set) => {
    const rest = restOf(master, set);
    const was = union(set.map((c) => boxOf(master, c, rest - c.start)));
    return { was, kind: kindOf(master, set, was), span: spanOf(set) };
  });
  // Mostly (60%) in its half: a headline may lean over the center line.
  const inHalf = (b: Rect, left: boolean) => (left ? Math.min(b.right, half) - b.left : b.right - Math.max(b.left, half)) >= 0.6 * (b.right - b.left);
  const beside = (a: Rect, b: Rect) => {
    if (!((a.left + a.right) / 2 < half && (b.left + b.right) / 2 > half && inHalf(a, true) && inHalf(b, false))) return false;
    return Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) >= 0.3 * Math.min(a.bottom - a.top, b.bottom - b.top);
  };
  // A title on a picture (a split screen's label) rides on it; it is not
  // what stands beside it.
  const center = (r: Rect) => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
  const onPicture = info.map((a) => a.kind !== "picture" && info.some((b) => b !== a && b.kind === "picture" && together(a.span, b.span) && inRect(center(a.was), b.was)));
  const root = sets.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  for (let i = 0; i < sets.length; i++)
    for (let j = i + 1; j < sets.length; j++) {
      const [a, b] = [info[i], info[j]];
      if (a.kind === "other" || b.kind === "other" || (a.kind !== "picture" && b.kind !== "picture") || onPicture[i] || onPicture[j]) continue;
      if (together(a.span, b.span) && (beside(a.was, b.was) || beside(b.was, a.was))) root[find(i)] = find(j);
    }
  const comps = new Map<number, VisualClip[][]>();
  sets.forEach((set, i) => comps.set(find(i), [...(comps.get(find(i)) ?? []), set]));
  return [...comps.values()].filter((c) => c.length > 1);
}

/** What rides on a composition's sets: an overlay showing with one, for
 * half its own time or more, whose center lies on it (a label on a split
 * screen's half, a logo on a window), or a shape it lies on (a glow behind
 * a window, up to six times its size). Each follower to its smallest such
 * set. */
export function followersOf(master: Project, sets: VisualClip[][], comps: VisualClip[][][]): Map<VisualClip[], VisualClip[]> {
  const items = new Set(comps.flat());
  const out = new Map<VisualClip[], VisualClip[]>();
  if (!items.size) return out;
  const info = new Map(
    sets.map((set) => {
      const rest = restOf(master, set);
      const was = union(set.map((c) => boxOf(master, c, rest - c.start)));
      return [set, { was, span: spanOf(set), kind: kindOf(master, set, was) }];
    }),
  );
  const area = (r: Rect) => (r.right - r.left) * (r.bottom - r.top);
  const center = (r: Rect) => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
  for (const set of sets) {
    if (items.has(set)) continue;
    const a = info.get(set)!;
    const lead = [...items]
      .map((s) => ({ s, l: info.get(s)! }))
      .filter(({ l }) => Math.min(a.span.to, l.span.to) - Math.max(a.span.from, l.span.from) >= 0.5 * (a.span.to - a.span.from))
      .filter(({ l }) => inRect(center(a.was), l.was) || (a.kind === "other" && inRect(center(l.was), a.was) && area(a.was) <= 6 * area(l.was)))
      .sort((x, y) => area(x.l.was) - area(y.l.was))[0];
    if (lead) out.set(set, lead.s);
  }
  return out;
}

/** A cell a layout cut from a picture (apply_layout's cover crop): one
 * cropped video or picture, alone or with its border shapes, unturned and
 * with no crop keys, so it can be cut again to another shape. */
function cellOf(m: Measured): VideoClip | ImageClip | undefined {
  const pics = m.set.filter((c): c is VideoClip | ImageClip => c.type === "video" || c.type === "image");
  if (pics.length !== 1 || m.set.some((c) => c !== pics[0] && !(c.type === "color" && c.shape))) return undefined;
  const c = pics[0], k = c.crop;
  if (k.left + k.right + k.top + k.bottom < 0.002 || Math.abs(c.transform.rotation) > 1e-3 || Object.keys(c.keyframes ?? {}).some((p) => p.startsWith("crop."))) return undefined;
  return c;
}

/** Every value of a path, static and keyed, moved so the rest value `from`
 * becomes `to` and the keys' offsets from it scale by k. */
function rekey(c: VisualClip, path: (typeof KEYED)[number], from: number, to: number, k: number): VisualClip {
  return mapPath(c, path, (v) => +(to + (v - from) * k).toFixed(5));
}

/**
 * A layout's cell cut again to a box of the new frame (pixels): the same
 * part of the picture at its middle, as much more of it as the new shape
 * shows, at the master's zoom; its border shapes drawn around the box.
 * Keyed slides keep their pixels, keyed scales their proportion.
 */
function recut(master: Project, q: Project, m: Measured, pic: VideoClip | ImageClip, box: Rect): VisualClip[] {
  const rel = m.rest - pic.start;
  const S = fittedSize(q, pic), k = pic.crop;
  const zoom = 1 / Math.max(1 - k.left - k.right, 1 - k.top - k.bottom);
  const w = box.right - box.left, h = box.bottom - box.top, cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
  const s = Math.max(w / S.w, h / S.h) * zoom;
  const fw = Math.min(1, w / (S.w * s)), fh = Math.min(1, h / (S.h * s));
  const u = k.left + (1 - k.left - k.right) / 2, v = k.top + (1 - k.top - k.bottom) / 2;
  const cl = Math.max(0, Math.min(1 - fw, u - fw / 2)), ct = Math.max(0, Math.min(1 - fh, v - fh / 2));
  const crop = { left: +cl.toFixed(5), right: +(1 - fw - cl).toFixed(5), top: +ct.toFixed(5), bottom: +(1 - fh - ct).toFixed(5) };
  const x = (cx - q.width / 2 - ((crop.left - crop.right) / 2) * S.w * s) / q.width, y = (cy - q.height / 2 - ((crop.top - crop.bottom) / 2) * S.h * s) / q.height;
  const sm = paramAt(pic, "transform.scale", rel);
  let out: VisualClip = { ...pic, crop };
  out = rekey(out, "transform.scale", sm, s, s / sm);
  if (out.transform.scaleY !== undefined) out = rekey(out, "transform.scaleY", paramAt(pic, "transform.scaleY", rel), s, s / sm);
  out = rekey(out, "transform.x", paramAt(pic, "transform.x", rel), x, master.width / q.width);
  out = rekey(out, "transform.y", paramAt(pic, "transform.y", rel), y, master.height / q.height);
  return m.set.map((c) => {
    if (c === pic) return out;
    // A border: the box's size, around its center.
    const sh = c as ColorClip;
    let b: VisualClip = { ...sh, shape: { ...sh.shape!, width: +(w / q.width).toFixed(5), height: +(h / q.height).toFixed(5) } };
    b = rekey(b, "transform.x", paramAt(sh, "transform.x", rel), (cx - q.width / 2) / q.width, master.width / q.width);
    return rekey(b, "transform.y", paramAt(sh, "transform.y", rel), (cy - q.height / 2) / q.height, master.height / q.height);
  });
}

/**
 * Plans for the side-by-side compositions on a tall frame (ADR-091): each
 * stacked in the safe column, pictures above (left to right becomes top to
 * bottom) and titles below (in reading order), every one fitted to the
 * column's width (a title wraps to it and never grows), centered on it,
 * the stack centered in the column's height, all shrunk alike when it
 * would not fit. A layout's cell is cut again, wider, before anything
 * shrinks. Burned captions keep their band: the stack ends above the
 * highest caption showing with it. What sat on an item (a label on a
 * window, a glow behind it) follows it: the same place in its box, scaled
 * as it was.
 */
function stackPlans(master: Project, q: Project, comps: Measured[][], follows: Map<Measured, Measured>, captions: Span[]): Map<Measured, Plan> {
  const plans = new Map<Measured, Plan>();
  if (!comps.length) return plans;
  const g = Math.min(q.width, q.height) / Math.min(master.width, master.height);
  const gap = 0.025 * Math.min(q.width, q.height);
  /** Each stacked item's box on the new frame, for its followers. */
  const placedAt = new Map<Measured, Rect>();
  for (const comp of comps) {
    const span = { from: Math.min(...comp.map((m) => spanOf(m.set).from)), to: Math.max(...comp.map((m) => spanOf(m.set).to)) };
    // The safe area, and on any tall frame clear of the apps' buttons too,
    // as check_project judges a 4:5 frame.
    const s = areaOf(q, false);
    const area = { left: Math.max(s.left, VERTICAL_SAFE.left * q.width), right: Math.min(s.right, (1 - VERTICAL_SAFE.right) * q.width), top: Math.max(s.top, VERTICAL_SAFE.top * q.height), bottom: Math.min(s.bottom, (1 - VERTICAL_SAFE.bottom) * q.height) };
    area.bottom = aboveCaptions(q, area, span, captions);
    const colW = area.right - area.left, colH = area.bottom - area.top;
    const kinds = new Map(comp.map((m) => [m, kindOf(master, m.set, m.was)]));
    const order = [...comp.filter((m) => kinds.get(m) === "picture").sort((a, b) => a.was.left - b.was.left), ...comp.filter((m) => kinds.get(m) !== "picture").sort((a, b) => a.was.top - b.was.top)];
    const items = order.map((m) => {
      const cell = cellOf(m);
      const text = kinds.get(m) !== "picture";
      const f = text ? Math.min(1, colW / m.size.w) : colW / m.size.w;
      return { m, cell, text, f, w: m.size.w * f, h: m.size.h * f, k: 1 };
    });
    const gaps = gap * (items.length - 1), room = colH - gaps;
    const sum = (list: typeof items) => list.reduce((n, it) => n + it.h * it.k, 0);
    const pics = items.filter((it) => !it.text), texts = items.filter((it) => it.text);
    // Too tall: a cell gives up height first (cut wider, down to a 2.4:1
    // strip), then the pictures shrink (to half), then the titles, never
    // under the readable size.
    const cells = items.filter((it) => it.cell);
    if (sum(items) > room && cells.length) {
      const each = Math.max(colW / 2.4, (room - (sum(items) - sum(cells))) / cells.length);
      for (const it of cells) it.h = Math.min(it.h, each);
    }
    if (sum(items) > room && pics.length) {
      const k = Math.max(0.5, (room - sum(texts)) / sum(pics));
      pics.forEach((it) => (it.k = Math.min(1, k)));
    }
    if (sum(items) > room && texts.length) {
      const floor = Math.max(...texts.map((it) => Math.min(1, minTextSize(q.width, q.height) / (Math.max(...it.m.now.map((c) => (c.type === "text" ? c.style.size : 0))) * it.f || 1))));
      const k = Math.max(floor, (room - sum(pics)) / sum(texts));
      texts.forEach((it) => (it.k = Math.min(1, k)));
    }
    let y = area.top + Math.max(0, (room - sum(items)) / 2);
    for (const it of items) {
      const w = it.w * it.k, h = it.h * it.k, left = area.left + (colW - w) / 2;
      const to = { left, top: y, right: left + w, bottom: y + h };
      plans.set(it.m, it.cell ? { clips: recut(master, q, it.m, it.cell, to) } : { f: it.f * it.k, left, top: y });
      placedAt.set(it.m, to);
      y += h + gap;
    }
  }
  // What sat on an item, or behind it: the same place in its new box.
  for (const [m, lead] of follows) {
    const R = placedAt.get(lead);
    if (!R) continue;
    const cx = (m.was.left + m.was.right) / 2, cy = (m.was.top + m.was.bottom) / 2;
    const L = lead.was;
    const F = Math.min((R.right - R.left) / ((L.right - L.left) * g), (R.bottom - R.top) / ((L.bottom - L.top) * g));
    // A label shrinks with its picture, never under the readable size, and never grows.
    const type = Math.max(0, ...m.now.map((c) => (c.type === "text" ? c.style.size : 0)));
    const f = type ? Math.min(1, Math.max(F, minTextSize(q.width, q.height) / type)) : F;
    const nx = R.left + ((cx - L.left) / (L.right - L.left)) * (R.right - R.left), ny = R.top + ((cy - L.top) / (L.bottom - L.top)) * (R.bottom - R.top);
    const w = m.size.w * f, h = m.size.h * f;
    // What was inside the item stays inside it (a label kept readable on a
    // smaller picture would otherwise poke out of its edge).
    const keep = (lo: number, size: number, min: number, max: number) => (size <= max - min ? Math.max(min, Math.min(max - size, lo)) : lo);
    const wasIn = m.was.left >= L.left - 1 && m.was.right <= L.right + 1 && m.was.top >= L.top - 1 && m.was.bottom <= L.bottom + 1;
    plans.set(m, wasIn ? { f, left: keep(nx - w / 2, w, R.left, R.right), top: keep(ny - h / 2, h, R.top, R.bottom) } : { f, left: nx - w / 2, top: ny - h / 2 });
  }
  return plans;
}

/** A caption on a tall frame: its type kept against the short side, as a
 * title's is, wrapped in and centered on the column the apps leave, at the
 * height captions take there (lib/captionLooks.ts). */
function placeCaption(master: Project, q: Project, c: TextClip): TextClip {
  const k = Math.min(q.width, q.height) / q.height / (Math.min(master.width, master.height) / master.height);
  const fit = captionFit(q, scaleStyle(c.style, k, c.style.maxWidth), c.transform.x);
  return { ...c, style: fit.style, transform: { ...c.transform, x: fit.x, y: captionY(q, c.transform.y) } };
}

/** The master in another shape. Compound timelines first, since a
 * compound clip's box is what its timeline draws: one played as a picture
 * refits as one (asPicture), a whole scene nested at rest as a frame of
 * its own, its overlays placed as the root's are. */
export function reshape(p: Project, ratio: VersionRatio, fit: VersionFit, frame: ReframeOptions = {}): Project {
  if (ratio === "original") return p;
  const [rw, rh] = ratio.split(":").map(Number);
  const [width, height] = canvasSize(rw, rh, Math.min(p.width, p.height));
  if (width === p.width && height === p.height) return p;
  const q: Project = { ...p, width, height, canvasFixed: true };
  const pictures = pictureCompounds(p);
  const a: Frame = { w: p.width, h: p.height }, b: Frame = { w: width, h: height };
  // A wide frame made tall: captions take the tall frame's caption place,
  // and what stood side by side is stacked (ADR-091). Made narrower but not
  // tall (16:9 to 1:1), what stood side by side moves and scales as one
  // group, so a headline is not pushed onto its window.
  const tall = height > width && p.width > p.height;
  const narrower = p.width > p.height && width / height < p.width / p.height - 0.01;
  // One timeline refit as a frame: each clip on its own, then its overlays placed.
  const asFrame = (m: Project, out: Project): Track[] => {
    const caption = (c: Clip): c is TextClip => tall && c.type === "text" && !!c.caption;
    let sets = overlaySets(m).filter((s) => !s.some(caption));
    const comps = narrower ? sideBySide(m, sets) : [];
    const follows = followersOf(m, sets, comps);
    const stacks = tall ? comps : [];
    if (narrower && !tall && comps.length) {
      const units = comps.map((comp) => [...comp, ...[...follows].filter(([, lead]) => comp.includes(lead)).map(([f]) => f)]);
      const merged = new Set(units.flat());
      sets = [...sets.filter((s) => !merged.has(s)), ...units.map((u) => u.flat())];
      follows.clear();
    }
    const grouped = new Set(sets.filter((s) => s.length > 1).flatMap((s) => s.map((c) => c.id)));
    // Where a lone title wraps: across the safe column when stacked, within
    // even margins when centered (titleWrap: 0.62 of a 9:16 frame, clear of
    // the buttons on the right), else within the safe width.
    const s = safeArea(out);
    const rooms = new Map<Id, number>();
    for (const set of sets) {
      const c = set[0];
      if (set.length > 1 || c.type !== "text") continue;
      const box = boxOf(m, c, restOf(m, set) - c.start);
      if (stacks.some((comp) => comp.includes(set))) rooms.set(c.id, Math.min(1 - s.left - s.right, 1 - VERTICAL_SAFE.left - VERTICAL_SAFE.right));
      else if (Math.abs((box.left + box.right) / 2 - m.width / 2) < m.width * 0.01) rooms.set(c.id, titleWrap(out, 0));
    }
    const fitted = { ...out, tracks: m.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (caption(c) ? placeCaption(m, out, c) : refitClip(m, out, c, fit, grouped.has(c.id), pictures, rooms.get(c.id), frame))) })) };
    // The captions burned in, where the stacks must leave room for them.
    const shown = fitted.tracks.flatMap((t) => (t.hidden ? [] : t.clips.filter((c): c is TextClip => caption(c) && !c.disabled)));
    const captions = shown.map((c) => ({ ...spanOf([c]), top: boxOf(fitted, c).top }));
    return placeSets(m, fitted, sets, stacks, follows, captions).tracks;
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

/** The captions as a version has them: burned in (a hidden track of
 * nothing but captions shown; a caption turned off stays off), none, or as
 * the project has them. */
export function versionCaptions(p: Project, mode: VersionCaptions): Project {
  if (mode === "none") return withoutCaptions(p);
  if (mode === "as_project") return p;
  const captionsOnly = (t: Track) => t.hidden && t.clips.length > 0 && t.clips.every((c) => c.type === "text" && c.caption);
  return p.tracks.some(captionsOnly) ? { ...p, tracks: p.tracks.map((t) => (captionsOnly(t) ? { ...t, hidden: false } : t)) } : p;
}

/** One version of the master: cut down, reshaped, textless, as asked.
 * `keepEnd` frames of the end are kept in a cut-down (default: the end
 * card's length when the master has one). `looks` frame cropped footage on
 * its subject; `notes` collects where a framing cuts one. */
export function versionProject(p: Project, v: VersionSpec, keepEnd?: number, looks?: Looks, notes?: SubjectNote[]): Project {
  let q = p;
  if (v.duration !== undefined) {
    const frames = Math.max(1, secondsToFrames(v.duration, p.fps));
    const card = endCardStart(p);
    q = cutDown(q, frames, keepEnd ?? (card === undefined ? 0 : projectDuration(p) - card));
  }
  const [rw, rh] = v.ratio === "original" ? [p.width, p.height] : v.ratio.split(":").map(Number);
  q = versionCaptions(q, v.captions ?? (rh > rw ? "burn" : "as_project"));
  q = reshape(q, v.ratio, v.fit ?? "fill", { looks, reframe: v.reframe, focus: v.focus, notes });
  if (v.textless) q = textless(q);
  return { ...q, name: versionName(p.name, v) };
}

/** What an agent asks export_versions for: explicit versions, or every
 * ratio at every duration (the master's own length when none is given),
 * plus a textless master in the first ratio. At most `limit`. */
export function expandVersions(a: { versions?: VersionSpec[]; ratios?: VersionRatio[]; durations?: number[]; textless?: boolean; fit?: VersionFit; captions?: VersionCaptions; reframe?: Reframe; focus?: Focus[] }, masterSeconds: number, limit = 12): VersionSpec[] {
  // What every version shares, unless it says otherwise.
  const shared = { ...(a.fit ? { fit: a.fit } : {}), ...(a.captions ? { captions: a.captions } : {}), ...(a.reframe ? { reframe: a.reframe } : {}), ...(a.focus?.length ? { focus: a.focus } : {}) };
  const out: VersionSpec[] = [...(a.versions ?? [])].map((v) => ({ ...shared, ...v }));
  if (a.ratios?.length || a.durations?.length) {
    const ratios = a.ratios?.length ? a.ratios : (["original"] as VersionRatio[]);
    // A duration as long as the master (or longer) is the master itself.
    const durations = [...new Set((a.durations ?? []).map((d) => (d >= masterSeconds - 0.05 ? undefined : d)))];
    for (const ratio of ratios) for (const duration of durations.length ? durations : [undefined]) out.push({ ratio, ...(duration !== undefined ? { duration } : {}), ...shared });
  }
  if (a.textless) out.push({ ratio: out[0]?.ratio ?? "original", textless: true, ...shared });
  if (!out.length) throw new Error("say which versions: versions, or ratios and/or durations");
  if (out.length > limit) throw new Error(`${out.length} versions is more than ${limit} in one call; split them`);
  const names = out.map((v) => versionName("", v));
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup !== undefined) throw new Error(`two versions are the same (${dup.trim() || "the master"}); name them apart`);
  return out;
}
