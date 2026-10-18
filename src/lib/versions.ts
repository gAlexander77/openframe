// Deliverables: the versions of an ad a campaign ships (16:9, 9:16, 1:1,
// 4:5; 30, 15 and 6 second cut-downs; a textless master), each made from
// the master as a separate project document and never saved over it, so
// export_versions renders them one after another while the editor keeps
// the master open and untouched.
//
// A new shape refits every layer: full-frame footage fills the new frame
// (or fits it over a blurred copy of itself, CapCut's Canvas: Blur), and
// titles, logos and boxes keep their pixel size against the frame's short
// side, staying where they were relative to the frame and clamped inside
// its title-safe area (on 9:16, clear of the apps' buttons). A shorter cut
// keeps the opening and the end card, cutting the middle out of the
// picture tracks; the music runs from the start and fades at the new end.

import { safeArea } from "./ads";
import { canvasSize } from "./canvas";
import { paramAt } from "./keyframes";
import { clipEnd, getAsset, liftRange, projectDuration } from "./project/ops";
import type { Clip, Id, Project, TextStyle, Track, VisualClip } from "./project/types";
import { fittedSize } from "./render/size";
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

/** Does the picture cover the frame at its first frame (a full-frame shot,
 * not a picture-in-picture or a logo)? */
function fullFrame(p: Project, c: VisualClip, m: Frame): boolean {
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

/** One clip refit from frame `a` (the master's) to project `q`'s frame. */
function refitClip(master: Project, q: Project, c: Clip, fit: VersionFit): Clip {
  if (c.type === "audio" || c.type === "adjustment" || c.type === "compound") return c;
  const a: Frame = { w: master.width, h: master.height }, b: Frame = { w: q.width, h: q.height };
  const m = mediaSize(master, c);
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
    const s = safeArea(q);
    const room = 1 - s.left - s.right;
    const style = scaleStyle(c.style, k, +room.toFixed(3));
    const wide = fittedSize(q, { ...c, style: { ...style, maxWidth: 1 } }).w;
    const shrink = wide > room * b.w ? Math.max(0.75, (room * b.w) / wide) : 1;
    return { ...c, style: shrink < 1 ? scaleStyle(c.style, k * shrink, +room.toFixed(3)) : style };
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
    if (c.mask && c.mask.shape !== "linear" && c.mask.shape !== "mirror") {
      const kw = (a.w / b.w) * (short(b) / short(a)), kh = (a.h / b.h) * (short(b) / short(a));
      out = { ...out, mask: { ...c.mask, width: +(c.mask.width * kw).toFixed(5), height: +(c.mask.height * kh).toFixed(5) } } as Clip;
    }
    return out;
  }
  return c;
}

/** A layer's box on q's frame at its first frame at rest, in pixels. */
function boxOf(q: Project, c: VisualClip) {
  const s = fittedSize(q, c);
  const sc = paramAt(c, "transform.scale", 0), scy = c.transform.scaleY !== undefined ? paramAt(c, "transform.scaleY", 0) : sc;
  const { left, right, top, bottom } = c.crop;
  const w = s.w * Math.abs(sc) * (1 - left - right), h = s.h * Math.abs(scy) * (1 - top - bottom);
  const rad = (c.transform.rotation * Math.PI) / 180;
  const hw = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2, hh = (Math.abs(Math.sin(rad)) * w + Math.abs(Math.cos(rad)) * h) / 2;
  const cx = q.width / 2 + paramAt(c, "transform.x", 0) * q.width + ((left - right) / 2) * s.w * sc;
  const cy = q.height / 2 + paramAt(c, "transform.y", 0) * q.height + ((top - bottom) / 2) * s.h * scy;
  return { left: cx - hw, right: cx + hw, top: cy - hh, bottom: cy + hh };
}

/** Is this a layer to keep inside the safe area (a title, logo, sticker,
 * box), rather than footage or a background that fills the frame? */
function isOverlay(q: Project, c: Clip): c is VisualClip {
  if (c.type === "audio" || c.type === "adjustment" || c.type === "compound") return false;
  if (c.type === "text") return true;
  const b = boxOf(q, c);
  return b.right - b.left < q.width * 0.95 || b.bottom - b.top < q.height * 0.95;
}

/** Shift overlays into the safe area: a group as one (a lower third's
 * name and title keep their alignment), each other layer alone; one wider
 * than the area is centered across it. */
function clampOverlays(q: Project): Project {
  const s = safeArea(q);
  const area = { left: s.left * q.width, right: q.width * (1 - s.right), top: s.top * q.height, bottom: q.height * (1 - s.bottom) };
  const all = q.tracks.flatMap((t) => t.clips).filter((c) => !c.disabled && isOverlay(q, c)) as VisualClip[];
  const sets = new Map<string, VisualClip[]>();
  for (const c of all) {
    const key = c.group ?? c.id;
    sets.set(key, [...(sets.get(key) ?? []), c]);
  }
  const shift = new Map<Id, { dx: number; dy: number }>();
  for (const set of sets.values()) {
    const boxes = set.map((c) => boxOf(q, c));
    const box = { left: Math.min(...boxes.map((b) => b.left)), right: Math.max(...boxes.map((b) => b.right)), top: Math.min(...boxes.map((b) => b.top)), bottom: Math.max(...boxes.map((b) => b.bottom)) };
    const fit = (lo: number, hi: number, min: number, max: number) => (hi - lo > max - min ? (min + max) / 2 - (lo + hi) / 2 : lo < min ? min - lo : hi > max ? max - hi : 0);
    const dx = fit(box.left, box.right, area.left, area.right), dy = fit(box.top, box.bottom, area.top, area.bottom);
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) for (const c of set) shift.set(c.id, { dx: dx / q.width, dy: dy / q.height });
  }
  if (!shift.size) return q;
  const move = (c: Clip): Clip => {
    const d = shift.get(c.id);
    if (!d) return c;
    let v = c as VisualClip;
    v = mapPath(v, "transform.x", (x) => +(x + d.dx).toFixed(5));
    v = mapPath(v, "transform.y", (y) => +(y + d.dy).toFixed(5));
    return v;
  };
  return { ...q, tracks: q.tracks.map((t) => ({ ...t, clips: t.clips.map(move) })) };
}

/** The master in another shape. */
export function reshape(p: Project, ratio: VersionRatio, fit: VersionFit): Project {
  if (ratio === "original") return p;
  const [rw, rh] = ratio.split(":").map(Number);
  const [width, height] = canvasSize(rw, rh, Math.min(p.width, p.height));
  if (width === p.width && height === p.height) return p;
  const q: Project = { ...p, width, height, canvasFixed: true };
  const tracks = (ts: Track[]) => ts.map((t) => ({ ...t, clips: t.clips.map((c) => refitClip(p, q, c, fit)) }));
  const out: Project = { ...q, tracks: tracks(p.tracks), ...(p.compounds ? { compounds: p.compounds.map((k) => ({ ...k, tracks: tracks(k.tracks) })) } : {}) };
  return clampOverlays(out);
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
