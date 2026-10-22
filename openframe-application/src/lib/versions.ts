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
// given a clip's focus. A compound that draws only part of its frame (a
// title card) refits as one picture, a split screen that filled the frame
// fills the new one, text never ends under the frame's readable size, and
// a version's overrides move, resize or hide a clip by hand (ADR-101). A
// card grows as one picture to the readable size and is restacked when it
// then does not fit, a shape that spans the frame keeps its share of it,
// and every title ends inside the zone check_project judges, with room for
// the outline it may suggest (ADR-103). A shorter cut keeps the opening
// and the end card, cutting the middle out of the picture tracks; the
// music runs from the start and fades at the new end.

import { titleWrap } from "./ads";
import { titleZone, VERTICAL_SAFE } from "./align";
import { minTextSize } from "./brandKit";
import { canvasSize } from "./canvas";
import { EFFECTS } from "./catalog";
import { CAPTION_WRAP, captionFit, captionMax, captionY } from "./captionLooks";
import { withoutCaptions } from "./captions";
import { seenLetters, seenTexts, type Measured as CheckMeasured } from "./designCheck";
import { paramAt } from "./keyframes";
import { clipEnd, findCompound, getAsset, liftRange, projectDuration } from "./project/ops";
import type { Clip, ColorClip, CompoundClip, Id, ImageClip, Keyframe, Project, TextClip, TextStyle, Track, VideoClip, VisualClip } from "./project/types";
import { fittedSize, textPad } from "./render/size";
import { lookFor, reframeShot, type Focus, type Looks, type OptionNote, type Reframe, type ShotTargets, type SubjectNote } from "./reframe";
import { anchorOf, reanchor } from "./anchors";
import { calloutReports, calloutsOf, followCallouts, followed, shotTargets, type CalloutReport } from "./versionCallouts";
import { maskReach } from "./mask";
import { lookReach } from "./textLook";
import { framesToSeconds, secondsToFrames } from "./time";

export type VersionRatio = "16:9" | "9:16" | "1:1" | "4:5" | "original";
export const VERSION_RATIOS: VersionRatio[] = ["16:9", "9:16", "1:1", "4:5", "original"];
export type VersionFit = "fill" | "blur" | "fit";
export const VERSION_FITS: VersionFit[] = ["fill", "blur", "fit"];
/** What a version does with the captions (add_captions' clips): burned in
 * (their track shown, even when the master hides it), none, or as the
 * project has them. */
export type VersionCaptions = "burn" | "none" | "as_project";
export const VERSION_CAPTIONS: VersionCaptions[] = ["burn", "none", "as_project"];
/** What a version does with a full-frame shot's keyed push (a zoom the
 * editor keyed, frame_region's push-in): keeps it (default), relaxes it
 * to half its zoom, or holds the shot at its widest. A tall master's
 * pushes frame a narrow column; on a wider version the same zoom crops the
 * picture's top and bottom as the master did, a rocket's nose with it. */
export type VersionPushes = "keep" | "relax" | "hold";
export const VERSION_PUSHES: VersionPushes[] = ["keep", "relax", "hold"];

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
  /** Keyed pushes of full-frame and fitted shots: kept (default), relaxed or held. */
  pushes?: VersionPushes;
  /** Clips moved, resized or hidden by hand in this version, after the
   * automatic adaptation (applyOverrides). */
  overrides?: VersionOverride[];
}

/** A clip placed by hand in one version (export_versions overrides): a
 * title raised, a headline made larger, a clip hidden in that shape only.
 * Applied after the automatic adaptation, so it is the last word, and kept
 * in a saved version project. */
export interface VersionOverride {
  clip_id: Id;
  /** Where it rests in the version (its transform.x and .y, fractions of
   * the version's frame from its center); keyed motion moves with it. */
  x?: number;
  y?: number;
  /** Times its size as the version adapted it (a title's type, any other
   * layer's scale), about its own center. */
  scale?: number;
  /** Off in this version (true), or on though the master hides it (false). */
  hidden?: boolean;
}

/** What reshape uses to frame cropped footage, and where it reports the
 * subjects its framing cuts. */
export interface ReframeOptions {
  looks?: Looks;
  reframe?: Reframe;
  focus?: Focus[];
  notes?: SubjectNote[];
  pushes?: VersionPushes;
  /** What the callouts over a shot point at (ADR-122), by the shot's id. */
  targets?: (id: Id) => ShotTargets | undefined;
  /** Hears what became of the caller's focus, pushes and overrides
   * (ADR-123); `framed` the shots a focus framed, `eased` those pushes
   * relaxed or held. */
  said?: OptionNote[];
  framed?: Id[];
  eased?: Id[];
}

/** A shot's keyed scale eased toward its widest (least) value: `r` 0.5
 * halves each key's zoom as a ratio, 0 holds the widest throughout. The
 * picture never gets smaller than at its widest, so it still covers the
 * frame where it did. */
function easePush(c: VisualClip, r: number): VisualClip {
  const keys = c.keyframes?.["transform.scale"];
  if (!keys?.length) return c;
  const least = Math.min(...keys.map((k) => Math.abs(k.v)));
  if (!(least > 0)) return c;
  const to = (v: number) => +(Math.sign(v) * least * Math.pow(Math.abs(v) / least, r)).toFixed(5);
  if (r === 0) {
    const { "transform.scale": _, ...rest } = c.keyframes!;
    return { ...c, transform: { ...c.transform, scale: to(keys[0].v) }, keyframes: rest };
  }
  return { ...c, transform: { ...c.transform, scale: to(c.transform.scale) }, keyframes: { ...c.keyframes, "transform.scale": keys.map((k) => ({ ...k, v: to(k.v) })) } };
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

/** The title-safe area as check_project judges a version (align.ts's
 * titleZone, the one both use): on any frame taller than wide (4:5 as well
 * as 9:16) the column the vertical apps' buttons and captions leave;
 * ads.ts's safeArea gives 4:5 plain margins, and a 4:5 version's lower
 * third landed under the buttons the check then named. */
function safeOf(p: Pick<Project, "width" | "height">): { left: number; top: number; right: number; bottom: number } {
  return titleZone(p);
}

/** titleWrap within that area: the width a title centered at `x` wraps in. */
function wrapOf(p: Pick<Project, "width" | "height">, x = 0): number {
  if (!(p.height > p.width)) return titleWrap(p, x);
  const s = safeOf(p), cx = 0.5 + x;
  return +Math.max(0.25, Math.min(1 - s.left - s.right, 2 * Math.min(cx - s.left, 1 - s.right - cx))).toFixed(3);
}

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

/** Does a compound's timeline draw its whole frame where it rests (a scene
 * nested whole), rather than a part of it (a title card, a lockup)? */
function fillsItsFrame(p: Project, id: Id): boolean {
  const b = contentBox(p, id, 0);
  return b.left <= p.width * 0.015 && b.right >= p.width * 0.985 && b.top <= p.height * 0.015 && b.bottom >= p.height * 0.985;
}

/** A compound clip that refits as one picture: placed on the frame (a
 * floating window), or drawing only part of it at rest (a title card built
 * as a compound: a box, a headline and a subhead). Refit part by part, a
 * card's box shrank to the safe width and its headline to its own wrap
 * width, so the headline filled the box edge to edge on 9:16 and the
 * subhead fell on the box's edge; as one picture its parts keep their
 * layout (and its type the readable size, keepReadable). */
function asUnit(p: Project, c: Clip): c is CompoundClip {
  return c.type === "compound" && (placedOnFrame(c) || !fillsItsFrame(p, c.compoundId));
}

/** The compounds some compound clip plays as a picture: their timelines
 * refit as one picture (asPicture), the clip as an overlay (ADR-067), and
 * so does every compound played inside one (it is part of that picture). */
function pictureCompounds(p: Project): Set<Id> {
  const out = new Set<Id>();
  for (const t of [...p.tracks, ...(p.compounds ?? []).flatMap((k) => k.tracks)]) for (const c of t.clips) if (asUnit(p, c)) out.add(c.compoundId);
  for (let grew = true; grew; ) {
    grew = false;
    for (const k of p.compounds ?? []) {
      if (!out.has(k.id)) continue;
      for (const t of k.tracks)
        for (const c of t.clips)
          if (c.type === "compound" && !out.has(c.compoundId)) {
            out.add(c.compoundId);
            grew = true;
          }
    }
  }
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

/**
 * A shot fitted into the master's frame rather than filling it (ADR-123):
 * a video or picture (not a sticker) whose picture spans the frame edge to
 * edge on one axis and covers its middle (the central tenth both ways),
 * with bands on the other, at its first frame or at one of its position or
 * scale keys: a widescreen screen recording in a 9:16 master, pushed in
 * with frame_region fit. Not a window: no crop, closed mask or border, not
 * in a group, not pinned, not turned, and no picture under it covering the
 * frame's middle at its middle (a band of footage or a logo over a
 * background is a layout). A version reframes it as it does a full-frame
 * shot; laid out as a picture-in-picture, Claude film test 4's 16:9
 * version floated its interface shots small in black and ran its rings
 * off the frame.
 */
function fittedShot(p: Project, c: VisualClip): boolean {
  if ((c.type !== "video" && c.type !== "image") || (c.type === "image" && getAsset(p, c.assetId)?.sticker)) return false;
  const k = c.crop, m = c.mask;
  if (k.left + k.right + k.top + k.bottom > 1e-3 || (m && !m.invert && m.shape !== "linear" && m.shape !== "mirror") || c.border || c.group || c.anchor) return false;
  const W = p.width, H = p.height;
  const middle = (b: Rect) => b.left <= W * 0.45 && b.right >= W * 0.55 && b.top <= H * 0.45 && b.bottom >= H * 0.55;
  const ti = p.tracks.findIndex((t) => t.clips.some((x) => x.id === c.id));
  const mid = c.start + Math.floor(c.duration / 2);
  const under = p.tracks.slice(ti + 1).some((t) => t.kind === "video" && !t.hidden && t.clips.some((x) => !x.disabled && (x.type === "video" || x.type === "image" || x.type === "compound") && mid >= x.start && mid < x.start + x.duration && middle(boxOf(p, x, mid - x.start))));
  if (ti >= 0 && under) return false;
  const frames = new Set([0, ...KEYED.flatMap((path) => (c.keyframes?.[path] ?? []).map((key) => key.f))]);
  for (const rel of frames) {
    if (rel < 0 || rel >= c.duration || Math.abs(paramAt(c, "transform.rotation", rel)) > 1e-3) continue;
    const b = boxOf(p, c, rel);
    const spans = (b.left <= W * 0.015 && b.right >= W * 0.985) || (b.top <= H * 0.015 && b.bottom >= H * 0.985);
    if (spans && middle(b)) return true;
  }
  return false;
}

/** Does a video or picture clip cover its frame, or fill one axis of it
 * as a fitted shot (fittedShot): a shot a new shape crops? */
export function fillsFrame(p: Project, c: Clip): boolean {
  const m = mediaSize(p, c);
  return !!m && (fullFrame(p, c as VisualClip, m) || fittedShot(p, c as VisualClip));
}

/** A shape that spans the frame where it rests: both its edges at or past
 * the frame's on one axis (a gradient scrim across the top, a band, a
 * dimmer over everything). It is part of the frame, as footage is: it
 * keeps its share of the new frame instead of its pixels, and is not
 * placed in the safe area like a box. Kept as a box, the Northbound test's
 * scrim (1.02 of the width) became a box with hard edges on 9:16, short of
 * the top. */
function spansFrame(p: Project, c: Clip): boolean {
  if (c.type !== "color" || !c.shape) return false;
  const b = boxOf(p, c, restOf(p, [c]) - c.start);
  const e = 0.005;
  return (b.left <= p.width * e && b.right >= p.width * (1 - e)) || (b.top <= p.height * e && b.bottom >= p.height * (1 - e));
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

/** The share of its frame's short side a text's size is. */
const shareOf = (q: Pick<Project, "width" | "height">, units: number) => (units * q.height) / 1080 / Math.min(q.width, q.height);

/** How much a title's type is scaled into q (k keeps its share of the
 * short side), raised to q's readable size (minTextSize, as check_project
 * judges it) when the master's type met the master's: the lower third's
 * 49 on 16:9 (4.5% of the short side) became 28 on 9:16, under its 31
 * (5%), and the version had made what its check named. */
function readableK(master: Project, q: Project, c: TextClip, k: number): number {
  const met = shareOf(master, c.style.size) >= shareOf(master, minTextSize(master.width, master.height)) - 1e-6;
  return met ? Math.max(k, minTextSize(q.width, q.height) / c.style.size) : k;
}

/** A shape's box (fractions of the frame), stroke and feather (pixels at
 * a 1080-tall one) scaled by kw, kh and ks, keys and all. */
function scaleShape(c: ColorClip, kw: number, kh: number, ks: number): ColorClip {
  const sh = c.shape!;
  const keyed: Record<string, Keyframe[]> = {};
  for (const [path, k] of [["shape.width", kw], ["shape.height", kh], ["shape.stroke.width", ks], ["shape.feather", ks]] as const) {
    const keys = c.keyframes?.[path];
    if (keys?.length) keyed[path] = keys.map((key) => ({ ...key, v: +(key.v * k).toFixed(5) }));
  }
  return {
    ...c,
    shape: {
      ...sh,
      width: +(sh.width * kw).toFixed(5),
      height: +(sh.height * kh).toFixed(5),
      ...(sh.stroke ? { stroke: { ...sh.stroke, width: +(sh.stroke.width * ks).toFixed(2) } } : {}),
      // A feather, like the stroke, keeps its pixels (ADR-108): left as it
      // was, a 120 px glow drew 213 px soft on 9:16 around the same shape.
      ...(sh.feather ? { feather: +(sh.feather * ks).toFixed(2) } : {}),
    },
    ...(Object.keys(keyed).length ? { keyframes: { ...c.keyframes, ...keyed } } : {}),
  };
}

/** A picture's border and drop shadow (pixels at a 1080-tall frame) scaled
 * by k, keys and all: they keep their pixels against the short side, as
 * type and strokes do (ADR-108). Left as they were, a 12 px frame drew 21
 * px on 9:16 around a picture that kept its size. */
function scaleFrame(c: Clip, k: number): Clip {
  if (!("transform" in c) || k === 1 || (!c.border && !c.shadow)) return c;
  const r = (v: number) => +(v * k).toFixed(2);
  const keyed: Record<string, Keyframe[]> = {};
  for (const path of ["border.width", "shadow.blur", "shadow.x", "shadow.y"]) {
    const keys = c.keyframes?.[path];
    if (keys?.length) keyed[path] = keys.map((key) => ({ ...key, v: +(key.v * k).toFixed(5) }));
  }
  return {
    ...c,
    ...(c.border ? { border: { ...c.border, width: r(c.border.width) } } : {}),
    ...(c.shadow ? { shadow: { ...c.shadow, blur: r(c.shadow.blur), x: r(c.shadow.x), y: r(c.shadow.y) } } : {}),
    ...(Object.keys(keyed).length ? { keyframes: { ...c.keyframes, ...keyed } } : {}),
  } as Clip;
}

/**
 * What rides on a clip's picture, scaled as the picture is, keys too: its
 * effects' pixel-sized parameters (a blur's radius, a pixelate's blocks:
 * pixels at a 1080-tall frame, the catalog's `pixels`) and its position
 * wiggle (fractions of the frame's width and height). `g` is how many
 * times larger the picture is drawn, in pixels. Left as they were, a blur
 * on a title drew 1.78 times as wide on 9:16 against the title, and a
 * shake 1.78 times as far up and down but 0.56 as far across (ADR-110).
 */
function scalePixels(c: Clip, g: number, a: Frame, b: Frame): Clip {
  if (!("transform" in c)) return c;
  // To four places: a scale's rounding is not a change.
  const kh = +((g * a.h) / b.h).toFixed(4), kw = +((g * a.w) / b.w).toFixed(4);
  const fx = c.effects.filter((e) => Object.keys(e.params).some((k) => EFFECTS[e.type]?.params[k]?.pixels));
  const shake = (["x", "y"] as const).filter((t) => c.wiggle?.[t]);
  if ((!fx.length && !shake.length && !c.crop.feather) || (kh === 1 && kw === 1)) return c;
  const r = (v: number, k: number) => +(v * k).toFixed(5);
  const keyed: Record<string, Keyframe[]> = {};
  const keys = (path: string, k: number) => {
    const list = c.keyframes?.[path];
    if (list?.length) keyed[path] = list.map((key) => ({ ...key, v: r(key.v, k) }));
  };
  const effects = c.effects.map((e) => {
    if (!fx.includes(e)) return e;
    const params = { ...e.params };
    for (const k of Object.keys(params)) {
      if (!EFFECTS[e.type]?.params[k]?.pixels) continue;
      params[k] = r(params[k], kh);
      keys(`effects.${e.id}.${k}`, kh);
    }
    return { ...e, params };
  });
  const wiggle = { ...c.wiggle };
  for (const t of shake) {
    const k = t === "x" ? kw : kh;
    wiggle[t] = { ...wiggle[t]!, amplitude: r(wiggle[t]!.amplitude, k) };
    keys(`wiggle.${t}.amplitude`, k);
  }
  return { ...c, effects, ...(c.crop.feather ? { crop: { ...c.crop, feather: r(c.crop.feather, kh) } } : {}), ...(shake.length ? { wiggle } : {}), ...(Object.keys(keyed).length ? { keyframes: { ...c.keyframes, ...keyed } } : {}) } as Clip;
}

/** How many times larger clip `c` (now `v`) is drawn in pixels in q than
 * in the master: a title by its size, footage by how it fits and its
 * scale, a solid or a shape by the short side, as their strokes are
 * scaled; undefined where nothing is said (an adjustment clip, a whole
 * scene in a compound, drawn as before). */
function grownBy(master: Project, q: Project, c: Clip, v: Clip, pictures: Set<Id>): number | undefined {
  if (!("transform" in c) || !("transform" in v)) return undefined;
  const a: Frame = { w: master.width, h: master.height }, b: Frame = { w: q.width, h: q.height };
  const s = paramAt(c, "transform.scale", 0), sv = paramAt(v, "transform.scale", 0);
  const ks = s ? sv / s : 1;
  if (c.type === "text" && v.type === "text") return ((v.style.size * b.h) / (c.style.size * a.h)) * ks;
  if (c.type === "compound" && !pictures.has(c.compoundId)) return undefined;
  const m = c.type === "compound" ? a : mediaSize(master, c);
  if (m) return (Math.min(b.w / m.w, b.h / m.h) / Math.min(a.w / m.w, a.h / m.h)) * ks;
  return (short(b) / short(a)) * ks;
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
  // Everything inside shrinks by u as one picture: what rides on each too.
  let v = mapPath(scalePixels(scaleFrame(c, ky), u, a, b) as VisualClip, "transform.x", (x) => +(x * kx).toFixed(5));
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
    return { ...v, crop: { ...v.crop, left: ex + left * kx, right: ex + right * kx, top: ey + top * ky, bottom: ey + bottom * ky } };
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
    // A shot fitted with bands is footage too (ADR-123): framed as a
    // full-frame shot is, from here on.
    const fitted = c.type !== "compound" && !fullFrame(master, c, m) && fittedShot(master, c);
    const full = fullFrame(master, c, m) || fitted;
    // How much larger the picture is drawn, in pixels: a full-frame shot
    // keeps covering (fill) or fitting (blur, fit) the frame; a fitted one
    // keeps its pixels against the short side (its interface as readable
    // as in the master); with fill, either grows where it would not cover
    // the new frame at its widest (a push that pulls back past covering:
    // 02-timeline-play's reveal floated at 1213 x 682 on 16:9); anything
    // smaller keeps its size against the short side.
    let grow = !full ? short(b) / short(a) : fit !== "fill" ? fitB / fitA : fitted ? short(b) / short(a) : Math.max(b.w / m.w, b.h / m.h) / Math.max(a.w / m.w, a.h / m.h);
    if (full && fit === "fill" && c.type !== "compound") {
      const sx = leastScale(c), sy = c.transform.scaleY !== undefined ? Math.min(Math.abs(c.transform.scaleY), ...(c.keyframes?.["transform.scaleY"] ?? []).map((x) => Math.abs(x.v))) : sx;
      const k = c.crop;
      grow = Math.max(grow, b.w / (m.w * fitA * sx * (1 - k.left - k.right)), b.h / (m.h * fitA * sy * (1 - k.top - k.bottom)));
    }
    const kScale = (fitA / fitB) * grow;
    let v = c as VisualClip;
    v = mapPath(v, "transform.scale", (s) => +(s * kScale).toFixed(5));
    if (v.transform.scaleY !== undefined) v = mapPath(v, "transform.scaleY", (s) => +(s * kScale).toFixed(5));
    // A keyed push relaxed or held where the caller asks (ADR-116).
    if (full && frame.pushes && frame.pushes !== "keep" && v.transform.scaleY === undefined) {
      if (new Set((v.keyframes?.["transform.scale"] ?? []).map((k) => k.v)).size > 1) frame.eased?.push(c.id);
      v = easePush(v, frame.pushes === "relax" ? 0.5 : 0);
    }
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
      const focus = frame.focus?.filter((x) => x.clip_id === c.id);
      const r = reframeShot(master, q, c, v, lookFor(frame.looks, c), frame.reframe ?? "subject", focus?.length ? focus : undefined, frame.targets?.(c.id), frame.said);
      if (focus?.length) frame.framed?.push(c.id);
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
    // Never under the new frame's readable size when the master's met its
    // own (readableK), so the set is measured and placed at that size.
    const k = readableK(master, q, c, short(b) / b.h / (short(a) / a.h));
    // A part of a group keeps its lines (it wraps at the same width
    // against its size), so the group's layout holds when it is fitted.
    if (grouped) return { ...c, style: { ...scaleStyle(c.style, k, Infinity), maxWidth: +((c.style.maxWidth * a.w * short(b)) / short(a) / b.w).toFixed(5) } };
    const s = safeOf(q);
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
      out = { ...c, crop: { ...c.crop, left: Math.max(0, cx - w / 2), right: Math.max(0, 1 - cx - w / 2), top: Math.max(0, cy - h / 2), bottom: Math.max(0, 1 - cy - h / 2) } };
    }
    if (c.shape) {
      // A shape's box is fractions of the frame and its stroke pixels at a
      // 1080-tall one: both keep their pixels against the short side; a
      // shape that spans the frame keeps its share of it (a scrim still
      // covers the top half), its stroke its pixels.
      const g = short(b) / short(a);
      out = spansFrame(master, c) ? scaleShape(out as ColorClip, 1, 1, (a.h / b.h) * g) : scaleShape(out as ColorClip, (a.w / b.w) * g, (a.h / b.h) * g, (a.h / b.h) * g);
    }
    if (c.mask && c.mask.shape !== "linear" && c.mask.shape !== "mirror" && !(c.shape && spansFrame(master, c))) {
      const kw = (a.w / b.w) * (short(b) / short(a)), kh = (a.h / b.h) * (short(b) / short(a));
      // Its keys with it: a keyed size kept the master's fractions (ADR-122).
      const keyed: Record<string, Keyframe[]> = {};
      for (const [path, k] of [["mask.width", kw], ["mask.height", kh]] as const) {
        const keys = c.keyframes?.[path];
        if (keys?.length) keyed[path] = keys.map((key) => ({ ...key, v: +(key.v * k).toFixed(5) }));
      }
      out = { ...out, mask: { ...c.mask, width: +(c.mask.width * kw).toFixed(5), height: +(c.mask.height * kh).toFixed(5) }, ...(Object.keys(keyed).length ? { keyframes: { ...out.keyframes, ...keyed } } : {}) } as Clip;
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
  if (c.type === "audio" || c.type === "adjustment" || (c.type === "compound" && !asUnit(q, c))) return false;
  if (c.type === "text") return true;
  if (spansFrame(q, c) || fittedShot(q, c)) return false;
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
  const s = safeOf(p);
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
 * lines stay), a shape's own box, stroke and feather (keys and all), any
 * other layer's scale. A shape fitted by its transform scale kept size
 * keys in the master's fractions under a scale they did not know about:
 * Claude film test 3's frame-wide ring, shrunk to 0.57, drew the Undo
 * button's ring at 0.57 of the button, and a width keyed by hand in the
 * saved version came out 0.57 of what was asked (ADR-122). */
function shrink(c: VisualClip, f: number): VisualClip {
  if (c.type === "text") return { ...c, style: { ...scaleStyle(c.style, f, Infinity), maxWidth: +(c.style.maxWidth * f).toFixed(5) } };
  if (c.type === "color" && c.shape) return scaleShape(c, f, f, f);
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
function placeSets(master: Project, q: Project, sets: VisualClip[][], stacks: VisualClip[][][] = [], follows = new Map<VisualClip[], VisualClip[]>(), captions: Span[] = [], bleeds: VisualClip[][][] = []): Project {
  const refit = new Map(q.tracks.flatMap((t) => t.clips).map((c) => [c.id, c as VisualClip]));
  const measured = new Map(sets.map((set) => [set, measureSet(master, q, refit, set)]));
  const of = (set: VisualClip[]) => measured.get(set)!;
  const followed = new Map([...follows].map(([f, l]) => [of(f), of(l)]));
  const plans = stackPlans(master, q, stacks.map((comp) => comp.map(of)), new Map([...followed].filter(([, l]) => !bleeds.some((b) => b.includes(l.set)))), captions);
  for (const [m, plan] of bleedPlans(master, q, bleeds.map((comp) => comp.map(of)), new Map([...followed].filter(([, l]) => bleeds.some((b) => b.includes(l.set)))))) plans.set(m, plan);
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
type Plan = { f: number; left: number; top: number; room?: Rect } | { clips: VisualClip[] };

/** A set on its own: kept in its place in the safe area (placeSets), above
 * the burned captions showing with it. */
function ownPlan(master: Project, q: Project, m: Measured, captions: Span[] = []): Plan {
  const { was, now, group, size } = m;
  const centered = Math.abs((was.left + was.right) / 2 - master.width / 2) < master.width * 0.01;
  const safeA = areaOf(master, centered), safeB = areaOf(q, centered);
  safeB.bottom = aboveCaptions(q, safeB, spanOf(m.set), captions);
  // Leave the outline room settleTitles measures before fitting the group:
  // moving its type up afterward must not push its logo above the safe area.
  if (group) {
    const margin = Math.max(0, ...now.filter((c): c is TextClip => c.type === "text").map(c => outlineRoom(q, c)));
    safeB.top += margin;
    safeB.bottom -= margin;
  }
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
  return { f, left: startAt(share(was.left, was.right, roomA.left, roomA.right), w, room.left, room.right), top: startAt(share(was.top, was.bottom, roomA.top, roomA.bottom), h, room.top, room.bottom), ...(group ? { room } : {}) };
}

/** Move a set's parts to its plan, keyed motion laid out again around the
 * rest (ADR-067). */
function layOut(master: Project, q: Project, m: Measured, plan: { f: number; left: number; top: number; room?: Rect }, placed: Map<Id, Clip>) {
  const g = Math.min(q.width, q.height) / Math.min(master.width, master.height);
  const { rest, before, was, now, group, size } = m;
  const floor = minTextSize(q.width, q.height);
  const R = plan.room;
  const held = !!R && group && now.some((c) => c.type === "text");
  // Where the plan put the set's center: a retry shrinks about it.
  const cx = plan.left + (size.w * plan.f) / 2, cy = plan.top + (size.h * plan.f) / 2;
  const place = (f: number, left: number, top: number) => {
    const w = size.w * f, h = size.h * f;
    // How much farther (or nearer) the edges are, each way, new over old.
    const ratio = (b: number, a: number) => (a > 1 && b > 1 ? b / a : g);
    const kx = { out: ratio(q.width - left, master.width - was.left), back: ratio(left + w, was.right) };
    const ky = { out: ratio(q.height - top, master.height - was.top), back: ratio(top + h, was.bottom) };
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
      if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5 && v === c && !keyed) {
        placed.delete(c.id);
        return;
      }
      const x0 = paramAt(v, "transform.x", rel), y0 = paramAt(v, "transform.y", rel);
      let moved = mapPath(v, "transform.x", (x) => +(x0 + dx / q.width + ((x - x0) * master.width * (x > x0 ? kx.out : kx.back)) / q.width).toFixed(5));
      moved = mapPath(moved, "transform.y", (y) => +(y0 + dy / q.height + ((y - y0) * master.height * (y > y0 ? ky.out : ky.back)) / q.height).toFixed(5));
      placed.set(c.id, moved);
    });
    return union(now.map((c) => boxOf(q, (placed.get(c.id) ?? c) as VisualClip, rest - c.start)));
  };
  let f = plan.f;
  let u = place(f, plan.left, plan.top);
  if (!held || !R) return;
  // Type held at the readable size makes a group larger than planned: the
  // rest of it shrinks more until it fits its room (a 4:5 end card's url
  // held at 43 ran past the apps' column), then it is moved back inside.
  for (let i = 0; i < 4 && (u.right - u.left > R.right - R.left + 0.5 || u.bottom - u.top > R.bottom - R.top + 0.5); i++) {
    f *= 0.99 * Math.min((R.right - R.left) / (u.right - u.left), (R.bottom - R.top) / (u.bottom - u.top), 1);
    u = place(f, cx - (size.w * f) / 2, cy - (size.h * f) / 2);
  }
  const into = (lo: number, hi: number, min: number, max: number) => (hi - lo > max - min ? 0 : lo < min ? min - lo : hi > max ? max - hi : 0);
  const sx = into(u.left, u.right, R.left, R.right), sy = into(u.top, u.bottom, R.top, R.bottom);
  if (Math.abs(sx) < 0.5 && Math.abs(sy) < 0.5) return;
  for (const c of now) {
    let v = mapPath((placed.get(c.id) ?? c) as VisualClip, "transform.x", (x) => +(x + sx / q.width).toFixed(5));
    v = mapPath(v, "transform.y", (y) => +(y + sy / q.height).toFixed(5));
    placed.set(c.id, v);
  }
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
function cellOf(m: Pick<Measured, "set">): VideoClip | ImageClip | undefined {
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
  followerPlans(master, q, follows, placedAt, plans);
  return plans;
}

/**
 * A split screen that filled the master's frame edge to edge (its cells
 * together covering it, ADR-101) fills the version's frame too: on a tall
 * frame its cells are stacked full width, each as tall as its share of the
 * master's width; on a narrower frame that is not tall they stay side by
 * side, full height. The master's gutter is kept against the short side;
 * each cell is cut again to its new box (recut). Stacked in the safe
 * column instead, it left most of a 9:16 frame black. What sat on a cell
 * (its label) follows it, inside the safe area.
 */
function bleedPlans(master: Project, q: Project, comps: Measured[][], follows: Map<Measured, Measured>): Map<Measured, Plan> {
  const plans = new Map<Measured, Plan>();
  if (!comps.length) return plans;
  const g = Math.min(q.width, q.height) / Math.min(master.width, master.height);
  const tall = q.height > q.width;
  const placedAt = new Map<Measured, Rect>();
  for (const comp of comps) {
    const cells = [...comp].sort((a, b) => a.was.left - b.was.left);
    const widths = cells.map((m) => m.was.right - m.was.left);
    const sum = widths.reduce((x, y) => x + y, 0);
    const gap = cells.length > 1 ? Math.max(0, (master.width - sum) / (cells.length - 1)) * g : 0;
    const total = (tall ? q.height : q.width) - gap * (cells.length - 1);
    let at = 0;
    cells.forEach((m, i) => {
      const size = (total * widths[i]) / sum;
      const box = tall ? { left: 0, right: q.width, top: at, bottom: at + size } : { left: at, right: at + size, top: 0, bottom: q.height };
      at += size + gap;
      plans.set(m, { clips: recut(master, q, m, cellOf(m)!, box) });
      placedAt.set(m, box);
    });
  }
  followerPlans(master, q, follows, placedAt, plans, areaOf(q, false));
  return plans;
}

/** Does this side-by-side composition fill the frame edge to edge with
 * cells (a full-bleed split screen)? */
function fullBleed(master: Project, comp: VisualClip[][]): boolean {
  if (comp.length < 2 || !comp.every((set) => cellOf({ set }))) return false;
  const b = union(comp.map((set) => union(set.map((c) => boxOf(master, c, restOf(master, set) - c.start)))));
  return b.left <= master.width * 0.03 && b.right >= master.width * 0.97 && b.top <= master.height * 0.03 && b.bottom >= master.height * 0.97;
}

/** What sat on an item (a label on a window, a glow behind it) placed at
 * the same place in the item's new box, scaled as it was, a label never
 * under the readable size; text inside `safe` too when it fits there. */
function followerPlans(master: Project, q: Project, follows: Map<Measured, Measured>, placedAt: Map<Measured, Rect>, plans: Map<Measured, Plan>, safe?: Rect) {
  const g = Math.min(q.width, q.height) / Math.min(master.width, master.height);
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
    // A label on a full-frame cell keeps clear of the apps' buttons too.
    const S = safe && type ? { left: Math.max(R.left, safe.left), right: Math.min(R.right, safe.right), top: Math.max(R.top, safe.top), bottom: Math.min(R.bottom, safe.bottom) } : R;
    const in2 = S.right - S.left >= w && S.bottom - S.top >= h ? S : R;
    plans.set(m, wasIn ? { f, left: keep(nx - w / 2, w, in2.left, in2.right), top: keep(ny - h / 2, h, in2.top, in2.bottom) } : { f, left: nx - w / 2, top: ny - h / 2 });
  }
}

/** A caption on a tall frame: its type kept against the short side, as a
 * title's is, wrapped in and centered on the column the apps leave, at the
 * height captions take there (lib/captionLooks.ts). */
function placeCaption(master: Project, q: Project, c: TextClip): TextClip {
  const k = Math.min(q.width, q.height) / q.height / (Math.min(master.width, master.height) / master.height);
  const fit = captionFit(q, scaleStyle(c.style, k, c.style.maxWidth), c.transform.x);
  return { ...c, style: fit.style, transform: { ...c.transform, x: fit.x, y: captionY(q, c.transform.y) } };
}

/** How a version places the captions itself, as its frame's captions
 * rather than as overlays: "tall" on a tall version of a wide master (the
 * apps' column, ADR-091); "open" on a version that is not tall of a tall
 * master (16:9 or 1:1 of a short: out of the apps' place), or a landscape
 * version of a square one (ADR-118); undefined otherwise. */
function captionPlace(a: Frame, b: Frame): "tall" | "open" | undefined {
  if (b.h > b.w && a.w > a.h) return "tall";
  if ((b.w >= b.h && a.h > a.w) || (b.w > b.h && a.w === a.h)) return "open";
  return undefined;
}

/**
 * How much a version scales its master's captions ("open" captionPlace),
 * all by one factor so a caption made larger on purpose (a countdown)
 * stays larger: their pixels against the short side, as a title's, and on
 * a landscape frame brought down until the typical caption (the median)
 * is no larger than captions are there (captionMax, 72: 6.7% of the
 * height). A short's pop captions are about a tenth of the phone's width;
 * kept so on 16:9 they took a tenth of its height, two lines a fifth of
 * the picture, and read large for a website (Claude film test 2). On a
 * square, seen at a phone's width in a feed as the short is, they keep
 * their size.
 */
function captionScale(m: Project, q: Project): number {
  const k = short({ w: q.width, h: q.height }) / q.height / (short({ w: m.width, h: m.height }) / m.height);
  if (!(q.width > q.height)) return k;
  const sizes = m.tracks.flatMap((t) => t.clips.flatMap((c) => (c.type === "text" && c.caption && !c.disabled ? [c.style.size * k] : []))).sort((x, y) => x - y);
  return sizes.length ? k * Math.min(1, captionMax(q) / sizes[Math.floor(sizes.length / 2)]) : k;
}

/** A caption on a version that is not tall, from a tall or square master
 * ("open" captionPlace): scaled by `k` (captionScale), never under the
 * frame's readable size (minTextSize, as check_project judges it); a tall
 * master's caption (under the middle, clear of the apps' buttons there)
 * goes where captions sit on this frame (centered, y 0.36 as add_captions
 * places them, wrapping at the captions' width), all at one height; its
 * box kept inside the title-safe area. */
function placeOpenCaption(m: Project, q: Project, c: TextClip, k: number): TextClip {
  const z = titleZone(q);
  const floor = minTextSize(q.width, q.height) / c.style.size, wrap = +Math.min(1 - z.left - z.right, CAPTION_WRAP).toFixed(3);
  let kk = Math.max(k, floor);
  let v: TextClip = { ...c, style: { ...scaleStyle(c.style, kk, Infinity), maxWidth: wrap }, ...(m.height > m.width ? { transform: { ...c.transform, x: 0, y: captionY(q, 0.36) } } : {}) };
  // A word wider than the safe width cannot wrap (a countdown's LIFTOFF.
  // at twice the captions' size on a square): it shrinks to fit, never
  // under the readable size, as a title does (refitClip), measured as
  // check_project measures it, the letters with their outline.
  for (let i = 0; i < 4; i++) {
    const r = lookReach(v.style, q.height / 1080);
    const w = fittedSize(q, v).w - 2 * Math.max(0, textPad(q, v) - Math.max(r.box, r.stroke + r.stroke2)), room = (1 - z.left - z.right) * q.width;
    if (w <= room || kk <= floor) break;
    kk = Math.max(floor, (0.99 * kk * room) / w);
    v = { ...v, style: { ...scaleStyle(c.style, kk, Infinity), maxWidth: wrap } };
  }
  const over = boxOf(q, v).bottom - q.height * (1 - z.bottom);
  if (over > 0) v = { ...v, transform: { ...v.transform, y: +(v.transform.y - over / q.height).toFixed(5) } };
  return v;
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
  // A tall master made square or wide: its captions leave the apps' place
  // for this frame's, at a landscape caption's size on 16:9 (ADR-118).
  const place = captionPlace(a, b);
  // Callouts (ADR-122): rings, spotlights and pinned clips point at a part
  // of a picture. The crop keeps what they point at, and they are kept on
  // it (followCallouts, reanchor) instead of laid out with the titles.
  const callouts = calloutsOf(p);
  // One timeline refit as a frame: each clip on its own, then its overlays placed.
  const asFrame = (m: Project, out: Project): Track[] => {
    // Each nested scene is a frame too: its rings belong to its shots,
    // rather than the root timeline's overlay layout.
    const local = calloutsOf(m), kept = followed(local);
    const framing: ReframeOptions = { ...frame, targets: (id) => shotTargets(m, local, id) };
    const caption = (c: Clip): c is TextClip => !!place && c.type === "text" && !!c.caption;
    const k = place === "open" ? captionScale(m, out) : 1;
    const placeOne = (c: TextClip) => (place === "tall" ? placeCaption(m, out, c) : placeOpenCaption(m, out, c, k));
    let sets = overlaySets(m)
      .filter((s) => !s.some(caption))
      .map((s) => s.filter((c) => !kept.has(c.id) && !anchorOf(c)))
      .filter((s) => s.length);
    const comps = narrower ? sideBySide(m, sets) : [];
    const follows = followersOf(m, sets, comps);
    // A split screen that filled the frame fills the new one (bleedPlans).
    const bleeds = comps.filter((comp) => fullBleed(m, comp));
    const others = comps.filter((comp) => !bleeds.includes(comp));
    const stacks = tall ? others : [];
    if (narrower && !tall && others.length) {
      const units = others.map((comp) => [...comp, ...[...follows].filter(([, lead]) => comp.includes(lead)).map(([f]) => f)]);
      const merged = new Set(units.flat());
      sets = [...sets.filter((s) => !merged.has(s)), ...units.map((u) => u.flat())];
      for (const [f, lead] of [...follows]) if (merged.has(lead) || merged.has(f)) follows.delete(f);
    }
    const grouped = new Set(sets.filter((s) => s.length > 1).flatMap((s) => s.map((c) => c.id)));
    // Where a lone title wraps: across the safe column when stacked, within
    // even margins when centered (titleWrap: 0.62 of a 9:16 frame, clear of
    // the buttons on the right), else within the safe width.
    const s = safeOf(out);
    const rooms = new Map<Id, number>();
    for (const set of sets) {
      const c = set[0];
      if (set.length > 1 || c.type !== "text") continue;
      const box = boxOf(m, c, restOf(m, set) - c.start);
      if (stacks.some((comp) => comp.includes(set))) rooms.set(c.id, Math.min(1 - s.left - s.right, 1 - VERTICAL_SAFE.left - VERTICAL_SAFE.right));
      else if (Math.abs((box.left + box.right) / 2 - m.width / 2) < m.width * 0.01) rooms.set(c.id, wrapOf(out, 0));
    }
    // Pixels at a 1080-tall frame that keep their pixels against the short side.
    const px = (a.h / b.h) * (short(b) / short(a));
    const fitted = { ...out, tracks: m.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => scaleFrame(caption(c) ? placeOne(c) : refitClip(m, out, c, fit, grouped.has(c.id), pictures, rooms.get(c.id), framing), px)) })) };
    // The captions burned in, where the stacks must leave room for them.
    const shown = fitted.tracks.flatMap((t) => (t.hidden ? [] : t.clips.filter((c): c is TextClip => caption(c) && !c.disabled)));
    const captions = shown.map((c) => ({ ...spanOf([c]), top: boxOf(fitted, c).top }));
    return followCallouts(m, placeSets(m, fitted, sets, stacks, follows, captions, bleeds), local).tracks;
  };
  let out: Project = q;
  if (p.compounds) {
    out = { ...q, compounds: p.compounds.map((k) => (pictures.has(k.id) ? { ...k, tracks: k.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => asPicture(p, a, b, c)) })) } : k)) };
    out = { ...out, compounds: out.compounds!.map((k) => (pictures.has(k.id) ? k : { ...k, tracks: asFrame({ ...p, tracks: k.tracks }, { ...out, tracks: k.tracks }) })) };
  }
  const settled = separateTitles(p, settleTitles(keepReadable(p, { ...out, tracks: asFrame(p, out) }, pictures), pictures), pictures);
  // Callouts back on what they point at, as this version shows it.
  const done = reanchor(followCallouts(p, settled, callouts));
  // What rides on each picture, once its size is settled (ADR-110).
  const was = new Map([...p.tracks, ...(p.compounds ?? []).filter((k) => !pictures.has(k.id)).flatMap((k) => k.tracks)].flatMap((t) => t.clips.map((c) => [c.id, c] as const)));
  const ride = (tracks: Track[]) =>
    tracks.map((t) => ({
      ...t,
      clips: t.clips.map((v) => {
        const c = was.get(v.id);
        const g = c && grownBy(p, done, c, v, pictures);
        return !g ? v : scalePixels(v, g, a, b);
      }),
    }));
  return { ...done, tracks: ride(done.tracks), ...(done.compounds ? { compounds: done.compounds.map((k) => (pictures.has(k.id) ? k : { ...k, tracks: ride(k.tracks) })) } : {}) };
}

/** The outline check_project suggests for a title (contrast.ts's
 * contrastFixes: 5% of its size), in canvas pixels past what it draws
 * around its letters now: the room a version leaves for it. */
function outlineRoom(q: Project, c: TextClip): number {
  const s = c.style;
  const suggested = Math.max(2, Math.round(s.size * 0.05));
  return Math.max(0, suggested - Math.max(s.background?.padding ?? 0, (s.stroke?.width ?? 0) + (s.stroke2?.width ?? 0))) * (q.height / 1080);
}

/**
 * The version's titles kept inside the area check_project judges them by
 * (titleZone), measured as it measures them (seenLetters: the letters with
 * their box and outline, through a card's compound clip), with room for
 * the outline it would suggest: the Northbound test's titles were wrapped
 * to the edge of the 9:16 column exactly, so the outline the check then
 * suggested for contrast pushed them under the apps' buttons. A lone title
 * centered on the frame shrinks a little to stay centered (never under the
 * readable size); a group, a card or any other title moves inside.
 */
function settleTitles(q: Project, pictures: Set<Id>): Project {
  const W = q.width, H = q.height;
  const z = titleZone(q);
  const zone: Rect = { left: z.left * W, right: W * (1 - z.right), top: z.top * H, bottom: H * (1 - z.bottom) };
  const floor = minTextSize(W, H);
  // What moves together: a card (its outermost compound clip), a group's
  // overlays (an ad element's parts), or a title alone.
  const movers = new Map<string, { texts: ReturnType<typeof seenTexts>; clips: VisualClip[] }>();
  const root = q.tracks.flatMap((t) => t.clips);
  for (const s of seenTexts(q)) {
    if (s.c.caption || (s.via.length && !pictures.has(s.via[0].compoundId))) continue;
    const key = s.via.length ? s.via[0].id : s.c.group ? `group ${s.c.group}` : s.c.id;
    const clips = s.via.length ? [s.via[0]] : s.c.group ? root.filter((c): c is VisualClip => c.group === s.c.group && !c.disabled && isOverlay(q, c)) : [s.c];
    movers.set(key, { texts: [...(movers.get(key)?.texts ?? []), s], clips });
  }
  const changed = new Map<Id, Clip>();
  const into = (lo: number, hi: number, min: number, max: number) => (hi - lo > max - min + 0.5 ? (min + max) / 2 - (lo + hi) / 2 : lo < min ? min - lo : hi > max ? max - hi : 0);
  for (const { texts, clips } of movers.values()) {
    const boxOfAll = (view: Project, list: typeof texts) => {
      const boxes = list.flatMap((s) => seenLetters(view, s, undefined, outlineRoom(view, s.c))?.box ?? []);
      return boxes.length ? union(boxes) : null;
    };
    let u = boxOfAll(q, texts);
    if (!u || (u.left >= zone.left - 0.5 && u.right <= zone.right + 0.5 && u.top >= zone.top - 0.5 && u.bottom <= zone.bottom + 0.5)) continue;
    let moving = clips;
    const lone = texts.length === 1 && !texts[0].via.length && clips.length === 1 ? texts[0].c : undefined;
    if (lone && Math.abs((u.left + u.right) / 2 - W / 2) < W * 0.01) {
      // Centered: kept centered, a little smaller, within even margins.
      const even = 2 * Math.min(W / 2 - zone.left, zone.right - W / 2);
      const k = Math.max(floor / lone.style.size, Math.min(1, even / (u.right - u.left)));
      if (k < 1 - 1e-4) {
        const smaller = shrink(lone, k) as TextClip;
        moving = [smaller];
        u = boxOfAll({ ...q, tracks: q.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === lone.id ? smaller : c)) })) }, [{ ...texts[0], c: smaller }])!;
      }
    }
    const dx = into(u.left, u.right, zone.left, zone.right), dy = into(u.top, u.bottom, zone.top, zone.bottom);
    for (const c of moving) {
      let v = mapPath(c, "transform.x", (x) => +(x + dx / W).toFixed(5));
      v = mapPath(v, "transform.y", (y) => +(y + dy / H).toFixed(5));
      changed.set(c.id, v);
    }
  }
  if (!changed.size) return q;
  return { ...q, tracks: q.tracks.map((t) => (t.clips.some((c) => changed.has(c.id)) ? { ...t, clips: t.clips.map((c) => changed.get(c.id) ?? c) } : t)) };
}

/** Nearby independent titles form a vertical stack too. Wrapping one must
 * make room for the others, retaining the master's order and pixel gap.
 * Explicit groups and compound cards already keep their layout together. */
function separateTitles(master: Project, q: Project, pictures: Set<Id>): Project {
  const run = (before: Track[], after: Track[]) => {
    const m = { ...master, tracks: before }, view = { ...q, tracks: after };
    // Use the check's rendered lines, box padding and outline, excluding
    // empty shadow/glow margins. Raster boxes can overlap in the master
    // while its letters and background boxes still have a positive gap.
    const measured = (p: Project) => seenTexts(p).filter((s) => !s.via.length && !s.c.caption && !s.c.group).flatMap((s) => {
      const g = seenLetters(p, s);
      return g ? [{ c: s.c, box: g.box }] : [];
    });
    const original = measured(m), current = measured(view);
    const titles = original.map(({ c }) => c);
    const now = new Map(current.map(({ c }) => [c.id, c]));
    const boxes = new Map(original.map(({ c, box }) => [c.id, box]));
    const fittedBoxes = new Map(current.map(({ c, box }) => [c.id, box]));
    const neighbors = new Map(titles.map((c) => [c.id, new Set<Id>()]));
    for (const a of titles) for (const b of titles) {
      if (a === b || a.start >= clipEnd(b) || b.start >= clipEnd(a)) continue;
      const x = boxes.get(a.id)!, y = boxes.get(b.id)!;
      const gap = y.top - x.bottom;
      if (gap >= -0.5 && gap <= master.height * 0.1 && Math.min(x.right, y.right) > Math.max(x.left, y.left)) {
        neighbors.get(a.id)!.add(b.id);
        neighbors.get(b.id)!.add(a.id);
      }
    }
    const visited = new Set<Id>(), moved = new Map<Id, Clip>();
    for (const c of titles) {
      if (visited.has(c.id)) continue;
      const ids: Id[] = [], todo = [c.id];
      while (todo.length) {
        const id = todo.pop()!;
        if (visited.has(id)) continue;
        visited.add(id); ids.push(id); todo.push(...neighbors.get(id)!);
      }
      if (ids.length < 2 || ids.some((id) => !now.has(id))) continue;
      ids.sort((a, b) => boxes.get(a)!.top - boxes.get(b)!.top);
      const list = ids.map((id) => now.get(id)!);
      const fitted = list.map((v) => fittedBoxes.get(v.id)!);
      const k = Math.min(q.width, q.height) / Math.min(master.width, master.height);
      const gaps = ids.slice(1).map((id, i) => Math.max(0, boxes.get(id)!.top - boxes.get(ids[i])!.bottom) * k);
      // Nothing grew into the next title: preserve the version's placement.
      if (fitted.every((b, i) => !i || b.top >= fitted[i - 1].bottom + gaps[i - 1] - 0.5)) continue;
      const heights = fitted.map((b) => b.bottom - b.top), total = heights.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
      const z = titleZone(q), low = z.top * q.height, high = (1 - z.bottom) * q.height;
      const first = fitted[0], last = fitted.at(-1)!;
      const oldFirst = boxes.get(ids[0])!, oldLast = boxes.get(ids.at(-1)!)!;
      const correction = ((oldFirst.top + oldLast.bottom) / 2 - (oldFirst.top + oldFirst.bottom + oldLast.top + oldLast.bottom) / 4) * k;
      const center = (first.top + first.bottom + last.top + last.bottom) / 4 + correction;
      let top = Math.max(low, Math.min(high - total, center - total / 2));
      list.forEach((v, i) => {
        const dy = (top - fitted[i].top) / q.height;
        moved.set(v.id, mapPath(v, "transform.y", (y) => +(y + dy).toFixed(6)));
        top += heights[i] + (gaps[i] ?? 0);
      });
    }
    return after.map((t) => ({ ...t, clips: t.clips.map((c) => moved.get(c.id) ?? c) }));
  };
  return { ...q, tracks: run(master.tracks, q.tracks), ...(q.compounds ? { compounds: q.compounds.map((c) => {
    const old = master.compounds?.find((x) => x.id === c.id);
    return old && !pictures.has(c.id) ? { ...c, tracks: run(old.tracks, c.tracks) } : c;
  }) } : {}) };
}

/** Every timeline's clips: the project's and each compound's, with the
 * compound they are in. */
const timelines = (p: Project) => [{ k: undefined as Id | undefined, tracks: p.tracks }, ...(p.compounds ?? []).map((k) => ({ k: k.id as Id | undefined, tracks: k.tracks }))];

/** How large a title must grow to read on q (minTextSize, as check_project
 * judges it): to q's floor when the master's type met the master's floor,
 * else to keep its share of the short side. `sa` and `sb`: the scale the
 * master and the version draw it at (a compound clip's). 1 or less: as it is. */
function readableNeed(p: Project, q: Project, before: TextClip, now: TextClip, sa = 1, sb = 1): number {
  const floorOf = (x: Project) => shareOf(x, minTextSize(x.width, x.height));
  const a = shareOf(p, before.style.size * sa), b = shareOf(q, now.style.size * sb);
  const target = a >= floorOf(p) - 1e-6 ? floorOf(q) : Math.min(floorOf(q), a);
  return b > 0 ? target / b : 1;
}

/**
 * Text no version leaves under its frame's readable size (minTextSize, as
 * check_project judges it) when the master's met its own: the lower
 * third's 49 on 16:9 (4.5% of the short side) kept its pixels on 9:16 as
 * size 28, under 9:16's 31 (5%), so the version made what its check
 * named. Text the master had smaller keeps at least its share of the short
 * side. A title grows about its own center, keeping its wrap width; a
 * picture compound (a card) grows as one picture instead (readableCards).
 */
function keepReadable(p: Project, out: Project, pictures: Set<Id>): Project {
  const was = new Map(timelines(p).flatMap(({ tracks }) => tracks.flatMap((t) => t.clips.filter((c): c is TextClip => c.type === "text").map((c) => [c.id, c] as const))));
  const bump = (c: TextClip): TextClip => {
    const before = was.get(c.id);
    if (!before || c.disabled) return c;
    const k = readableNeed(p, out, before, c);
    return k > 1 + 1e-6 ? { ...c, style: scaleStyle(c.style, k, Infinity) } : c;
  };
  const fix = (tracks: Track[]) => tracks.map((t) => (t.clips.some((c) => c.type === "text") ? { ...t, clips: t.clips.map((c) => (c.type === "text" ? bump(c) : c)) } : t));
  const bumped = { ...out, tracks: fix(out.tracks), ...(out.compounds ? { compounds: out.compounds.map((k) => (pictures.has(k.id) ? k : { ...k, tracks: fix(k.tracks) })) } : {}) };
  return readableCards(p, bumped, pictures);
}

/** A clip's least scale where it rests and through its keys. */
const leastScale = (c: VisualClip) => Math.min(Math.abs(c.transform.scale), ...(c.keyframes?.["transform.scale"] ?? []).map((x) => Math.abs(x.v)));

/** The titles a picture compound shows, through the compounds nested in
 * it, each with the scale it is drawn at (times `scale`). */
function cardTexts(q: Project, id: Id, scale: number, depth = 0): { c: TextClip; s: number }[] {
  const k = findCompound(q, id);
  if (!k || depth > 5) return [];
  return k.tracks.flatMap((t) =>
    t.hidden || t.kind !== "video"
      ? []
      : t.clips.flatMap((c) => (c.disabled ? [] : c.type === "text" ? [{ c, s: scale }] : c.type === "compound" ? cardTexts(q, c.compoundId, scale * leastScale(c), depth + 1) : [])),
  );
}

/**
 * Picture compounds (title cards) whose type a version drew under the
 * frame's readable size grow as one picture to meet it, so their parts
 * keep their layout (ADR-103). Raised title by title instead, the
 * Northbound test's end card on 9:16 kept its offsets at a third of the
 * master's while its tagline, pill and url grew to the floor: the pill
 * sat on the tagline. A card that then would not fit its room (a 16:9
 * wordmark on a 9:16 frame) is restacked (fitCard).
 */
function readableCards(p: Project, out: Project, pictures: Set<Id>): Project {
  if (!pictures.size) return out;
  const was = new Map(timelines(p).flatMap(({ tracks }) => tracks.flatMap((t) => t.clips.map((c) => [c.id, c] as const))));
  // Captions the version placed itself keep their band (ADR-091, ADR-118).
  const placed = !!captionPlace({ w: p.width, h: p.height }, { w: out.width, h: out.height }) || out.height > out.width;
  const captions = placed ? out.tracks.flatMap((t) => (t.hidden ? [] : t.clips.filter((c): c is TextClip => c.type === "text" && !!c.caption && !c.disabled))).map((c) => ({ ...spanOf([c]), top: boxOf(out, c).top })) : [];
  let q = out;
  // The cards on the project's timeline and on the scenes nested whole in it.
  for (const { k, tracks } of timelines(out)) {
    if (k && pictures.has(k)) continue;
    for (const t of tracks)
      for (const c of t.clips) {
        if (c.type !== "compound" || c.disabled || !pictures.has(c.compoundId)) continue;
        const m = was.get(c.id);
        const before = new Map(m?.type === "compound" ? cardTexts(p, m.compoundId, leastScale(m)).map((x) => [x.c.id, x] as const) : []);
        const need = Math.max(1, ...cardTexts(q, c.compoundId, leastScale(c)).map((x) => {
          const b = before.get(x.c.id);
          return b ? readableNeed(p, q, b.c, x.c, b.s, x.s) : 1;
        }));
        if (need <= 1 + 1e-4) continue;
        const view: Project = { ...q, tracks };
        const rest = restOf(view, [c]);
        const box = boxOf(view, c, rest - c.start);
        const room = areaOf(q, Math.abs((box.left + box.right) / 2 - q.width / 2) < q.width * 0.01);
        room.bottom = aboveCaptions(q, room, spanOf([c]), captions);
        const floor = minTextSize(q.width, q.height);
        const fitted = fitCard(q, view, c, need, room, floor, m?.type === "compound" ? titlesPlace(p, k === undefined ? p.tracks : (findCompound(p, k)?.tracks ?? p.tracks), m) : undefined);
        const swap = (ts: Track[]) => ts.map((x) => (x.clips.some((y) => y.id === c.id) ? { ...x, clips: x.clips.map((y) => (y.id === c.id ? fitted.clip : y)) } : x));
        q = {
          ...q,
          ...(k === undefined ? { tracks: swap(q.tracks) } : {}),
          compounds: q.compounds!.map((x) => (x.id === c.compoundId ? { ...x, tracks: fitted.tracks } : k !== undefined && x.id === k ? { ...x, tracks: swap(x.tracks) } : x)),
        };
      }
  }
  return q;
}

/** Where a card's titles sat up and down the master's safe area, 0 (at its
 * top) to 1 (at its bottom): their box through the card's compound clip,
 * where it rests. A soft glow behind them makes the card's own box taller
 * than its titles, and placed by that box a card went to the top. */
function titlesPlace(p: Project, tracks: Track[], m: CompoundClip): number | undefined {
  const k = findCompound(p, m.compoundId);
  if (!k) return undefined;
  const view: Project = { ...p, tracks };
  const rel = restOf(view, [m]) - m.start;
  const S = paramAt(m, "transform.scale", rel), Y = paramAt(m, "transform.y", rel) * p.height;
  const inner: Project = { ...p, tracks: k.tracks };
  const texts = k.tracks.flatMap((t) => (t.hidden ? [] : t.clips.filter((x): x is TextClip => x.type === "text" && !x.disabled)));
  if (!texts.length) return undefined;
  const u = union(texts.map((x) => boxOf(inner, x, restOf(inner, [x]) - x.start)));
  const top = p.height / 2 + Y + (u.top - p.height / 2) * S, bottom = p.height / 2 + Y + (u.bottom - p.height / 2) * S;
  const a = areaOf(p, false);
  return share(top, bottom, a.top, a.bottom);
}

/**
 * A card grown `F` times about its center (its smallest type then at the
 * frame's readable size), fitted to its room (pixels of q's frame) as one
 * picture: when it fits, it only moves inside. When it does not, its
 * layout shrinks to the room as the whole card would (`r`), and its parts
 * are restacked so nothing overlaps: type that would fall under the floor
 * is held there and wraps within the card's width, a word too wide for
 * the room shrinks to it, a row of parts side by side that is still too
 * wide stacks (left to right becoming top to bottom), and the rows are
 * laid out again in their order with their gaps, shrunk with the layout.
 * A panel behind the titles keeps its margins around them (shrunk too); a
 * soft glow behind them is fitted to the new stack as it was to the old.
 * Never type grown inside a layout that shrank around it.
 */
function fitCard(q: Project, view: Project, c: CompoundClip, F: number, room: Rect, floor: number, place?: number): { clip: CompoundClip; tracks: Track[] } {
  const W = q.width, H = q.height;
  const k = findCompound(q, c.compoundId)!;
  const rel = restOf(view, [c]) - c.start;
  const was = boxOf(view, c, rel);
  let clip = shrink(c, F) as CompoundClip;
  const grown = boxOf(view, clip, rel);
  const shift = (v: CompoundClip, dx: number, dy: number) => mapPath(mapPath(v, "transform.x", (x) => +(x + dx / W).toFixed(5)), "transform.y", (y) => +(y + dy / H).toFixed(5)) as CompoundClip;
  clip = shift(clip, (was.left + was.right) / 2 - (grown.left + grown.right) / 2, (was.top + was.bottom) / 2 - (grown.top + grown.bottom) / 2);
  const S = paramAt(clip, "transform.scale", rel), X = paramAt(clip, "transform.x", rel) * W, Y = paramAt(clip, "transform.y", rel) * H;
  const drawn = (r: Rect): Rect => ({ left: W / 2 + X + (r.left - W / 2) * S, right: W / 2 + X + (r.right - W / 2) * S, top: H / 2 + Y + (r.top - H / 2) * S, bottom: H / 2 + Y + (r.bottom - H / 2) * S });
  const inner: Project = { ...q, tracks: k.tracks };
  const restIn = (x: VisualClip) => restOf(inner, [x]) - x.start;
  const parts = k.tracks.flatMap((t) => (t.hidden || t.kind !== "video" ? [] : t.clips.filter((x): x is VisualClip => !x.disabled && "transform" in x)));
  const at = new Map(parts.map((x) => [x.id, drawn(boxOf(inner, x, restIn(x)))]));
  const D = (x: VisualClip) => at.get(x.id)!;
  const center = (r: Rect): [number, number] => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
  const size = (r: Rect) => ({ w: r.right - r.left, h: r.bottom - r.top });
  const texts = parts.filter((x) => x.type === "text");
  // Behind the titles: a part (not a title) that a title's middle lies on;
  // a soft one (a glow: feathered, fading to transparent, or lightening)
  // draws less than its box and need not stay in the room.
  const behind = parts.filter((x) => x.type !== "text" && texts.some((t) => inRect(center(D(t)), D(x))));
  const soft = (x: VisualClip) =>
    ["screen", "add", "lighten", "colorDodge"].includes(x.blend) || (x.type === "color" && !!x.shape && ((x.shape.feather ?? 0) > 0 || /transparent|#[0-9a-f]{6}00$|#[0-9a-f]{3}0$/i.test(x.shape.gradient?.to ?? "")));
  const panels = behind.filter((x) => !soft(x)), glows = behind.filter(soft);
  const fg = parts.filter((x) => !behind.includes(x));
  if (!fg.length) return { clip, tracks: k.tracks };
  const into = (lo: number, hi: number, min: number, max: number) => (hi - lo > max - min ? (min + max) / 2 - (lo + hi) / 2 : lo < min ? min - lo : hi > max ? max - hi : 0);
  const U = union(fg.map(D));
  const whole = union([U, ...panels.map(D)]);
  const roomW = room.right - room.left, roomH = room.bottom - room.top;
  // The share of the grown card's layout that fits the room.
  const r = Math.min(1, roomW / size(whole).w, roomH / size(whole).h);
  if (r > 1 - 1e-4) {
    // It fits as one picture: its titles where they sat in the master's
    // safe area, the whole inside the room.
    const dy = place === undefined ? 0 : startAt(place, U.bottom - U.top, room.top, room.bottom) - U.top;
    const w2 = { ...whole, top: whole.top + dy, bottom: whole.bottom + dy };
    return { clip: shift(clip, into(w2.left, w2.right, room.left, room.right), dy + into(w2.top, w2.bottom, room.top, room.bottom)), tracks: k.tracks };
  }
  // Restacked. The panels' margins around the titles, shrunk with the layout.
  const margin = {
    l: Math.max(0, ...panels.map((x) => U.left - D(x).left)) * r,
    r: Math.max(0, ...panels.map((x) => D(x).right - U.right)) * r,
    t: Math.max(0, ...panels.map((x) => U.top - D(x).top)) * r,
    b: Math.max(0, ...panels.map((x) => D(x).bottom - U.bottom)) * r,
  };
  const left = room.left + margin.l, right = room.right - margin.r, innerW = right - left;
  // Each part at the layout's share; type held at the floor, wrapping
  // within the card's width; a part still wider than that shrinks to it.
  const placed = new Map<Id, { v: VisualClip; box: Rect }>();
  for (const x of fg) {
    const f = x.type === "text" ? Math.max(r, Math.min(1, floor / (x.style.size * S))) : r;
    // Only type held over the layout's share wraps anew (at the layout's
    // share every part fits, by the share's choice).
    const make = (ff: number): VisualClip => {
      const v = shrink(x, ff);
      return v.type === "text" && ff > r + 1e-6 ? { ...v, style: { ...v.style, maxWidth: +Math.min(v.style.maxWidth, innerW / (W * S)).toFixed(5) } } : v;
    };
    let v = make(f);
    let b = drawn(boxOf(inner, v, restIn(x)));
    if (size(b).w > innerW + 0.5) {
      v = make((f * innerW) / size(b).w);
      b = drawn(boxOf(inner, v, restIn(x)));
    }
    placed.set(x.id, { v, box: b });
  }
  const now = (x: VisualClip) => size(placed.get(x.id)!.box);
  // Rows: parts shown together and level with each other (their heights
  // overlap by 30%), as the card had them.
  const rows: VisualClip[][] = [];
  for (const x of [...fg].sort((a, b) => D(a).top - D(b).top)) {
    const row = rows.find((rw) => rw.some((y) => together(spanOf([x]), spanOf([y])) && Math.min(D(x).bottom, D(y).bottom) - Math.max(D(x).top, D(y).top) >= 0.3 * Math.min(size(D(x)).h, size(D(y)).h)));
    if (row) row.push(x);
    else rows.push([x]);
  }
  const gapMin = 0.025 * Math.min(W, H);
  // A row still too wide stacks, left to right becoming top to bottom.
  const laid: { parts: VisualClip[]; gap: number; alone: boolean }[] = [];
  rows.forEach((rw, i) => {
    const byX = [...rw].sort((a, b) => D(a).left - D(b).left);
    const gap = i ? (union(rw.map(D)).top - union(rows[i - 1].map(D)).bottom) * r : 0;
    const width = byX.reduce((n, x, j) => n + now(x).w + (j ? Math.max(0, D(x).left - D(byX[j - 1]).right) * r : 0), 0);
    if (rw.length > 1 && width > innerW + 0.5) byX.forEach((x, j) => laid.push({ parts: [x], gap: j ? gapMin : gap, alone: true }));
    else laid.push({ parts: rw, gap, alone: false });
  });
  // Each row's extent about its middle: its parts' middles keep their
  // offsets from it (shrunk with the layout), each part its new height.
  const ext = laid.map((rw) => {
    const cy = center(union(rw.parts.map(D)))[1];
    const spans = rw.parts.map((x) => {
      const dy = (center(D(x))[1] - cy) * r, h = now(x).h;
      return [dy - h / 2, dy + h / 2];
    });
    return { lo: Math.min(...spans.map((s) => s[0])), hi: Math.max(...spans.map((s) => s[1])), cy };
  });
  const total = ext.reduce((n, e) => n + e.hi - e.lo, 0) + laid.reduce((n, rw) => n + rw.gap, 0);
  const [ux, uy] = center(U);
  // The stack where the card's titles sat in the master's safe area (a
  // glow's box would otherwise push it to the top), inside the room.
  let y = place === undefined ? uy - total / 2 : startAt(place, total, room.top + margin.t, room.bottom - margin.b);
  y += into(y, y + total, room.top + margin.t, room.bottom - margin.b);
  const target = new Map<Id, [number, number]>();
  laid.forEach((rw, i) => {
    y += rw.gap;
    const e = ext[i];
    for (const x of rw.parts) {
      const w = now(x).w;
      // Its offset from the card's middle shrinks with the layout; a part
      // stacked out of its row is centered on the card.
      let nx = rw.alone ? ux : ux + (center(D(x))[0] - ux) * r;
      nx += into(nx - w / 2, nx + w / 2, left, right);
      target.set(x.id, [nx, y - e.lo + (center(D(x))[1] - e.cy) * r]);
    }
    y += e.hi - e.lo;
  });
  const U2 = union(
    fg.map((x) => {
      const [nx, ny] = target.get(x.id)!, s = now(x);
      return { left: nx - s.w / 2, right: nx + s.w / 2, top: ny - s.h / 2, bottom: ny + s.h / 2 };
    }),
  );
  // A panel keeps its margins around the new stack; a glow its place and
  // size in the stack's box, each way.
  const boxes = new Map<Id, Rect>();
  for (const x of panels) {
    const b = D(x);
    boxes.set(x.id, { left: U2.left - (U.left - b.left) * r, right: U2.right + (b.right - U.right) * r, top: U2.top - (U.top - b.top) * r, bottom: U2.bottom + (b.bottom - U.bottom) * r });
  }
  const gx = size(U2).w / Math.max(1, size(U).w), gy = size(U2).h / Math.max(1, size(U).h);
  const [vx, vy] = center(U2);
  for (const x of glows) {
    const b = D(x), [bx, by] = center(b), s = size(b);
    const nx = vx + (bx - ux) * gx, ny = vy + (by - uy) * gy;
    boxes.set(x.id, { left: nx - (s.w * gx) / 2, right: nx + (s.w * gx) / 2, top: ny - (s.h * gy) / 2, bottom: ny + (s.h * gy) / 2 });
  }
  // Back to the card's own frame: pixels divided by its scale.
  const moveTo = (v: VisualClip, from: Rect, cx: number, cy: number): VisualClip => {
    const [bx, by] = center(from);
    return mapPath(mapPath(v, "transform.x", (val) => +(val + (cx - bx) / S / W).toFixed(5)), "transform.y", (val) => +(val + (cy - by) / S / H).toFixed(5));
  };
  const tracks = k.tracks.map((t) => ({
    ...t,
    clips: t.clips.map((x): Clip => {
      const done = placed.get(x.id);
      if (done) {
        const [nx, ny] = target.get(x.id)!;
        return moveTo(done.v, done.box, nx, ny);
      }
      const b = boxes.get(x.id);
      if (!b || !("transform" in x)) return x;
      const old = D(x as VisualClip), ax = size(b).w / Math.max(1, size(old).w), ay = size(b).h / Math.max(1, size(old).h);
      const v = x.type === "color" && x.shape ? scaleShape(x, ax, ay, Math.min(ax, ay)) : shrink(x as VisualClip, Math.min(ax, ay));
      return moveTo(v, old, ...center(b));
    }),
  }));
  return { clip, tracks };
}

// ---- by hand: a version's overrides ----------------------------------------------------

/**
 * A version's overrides (export_versions overrides), after the automatic
 * adaptation: each named clip moved to x and y, resized by scale and
 * hidden or shown, on the project's timeline or inside a compound. A clip
 * in a group (an ad element: a lower third's name and title) carries its
 * group when moved or resized, so its layout holds; hidden is the clip
 * alone. An id the version does not have is an error naming it.
 */
export function applyOverrides(q: Project, list: VersionOverride[]): Project {
  for (const o of list) {
    const where = timelines(q).find(({ tracks }) => tracks.some((t) => t.clips.some((c) => c.id === o.clip_id)));
    if (!where) throw new Error(`overrides: no clip ${o.clip_id} in this version (describe_project's clip ids; a clip inside a compound clip by its own id)`);
    const view: Project = { ...q, tracks: where.tracks };
    const anchor = where.tracks.flatMap((t) => t.clips).find((c) => c.id === o.clip_id)!;
    const moved = o.x !== undefined || o.y !== undefined || o.scale !== undefined;
    if (moved && !("transform" in anchor)) throw new Error(`overrides: ${o.clip_id} is ${anchor.type === "audio" ? "a sound" : "an adjustment layer"}, with nothing to place`);
    const members = (!moved ? [] : anchor.group ? where.tracks.flatMap((t) => t.clips).filter((c) => c.group === anchor.group && "transform" in c) : [anchor]) as VisualClip[];
    const rest = moved ? restOf(view, members) : 0;
    const ax = moved ? paramAt(anchor, "transform.x", rest - anchor.start) : 0, ay = moved ? paramAt(anchor, "transform.y", rest - anchor.start) : 0;
    const s = o.scale ?? 1;
    const dx = o.x === undefined ? 0 : o.x - ax, dy = o.y === undefined ? 0 : o.y - ay;
    const changed = new Map<Id, Clip>();
    for (const c of members) {
      let v: VisualClip = c;
      if (Math.abs(s - 1) > 1e-9) {
        v = shrink(v, s);
        // A group's parts keep their places against the anchor, scaled.
        if (c !== anchor) {
          v = mapPath(v, "transform.x", (x) => +(ax + (x - ax) * s).toFixed(5));
          v = mapPath(v, "transform.y", (y) => +(ay + (y - ay) * s).toFixed(5));
        }
      }
      if (dx) v = mapPath(v, "transform.x", (x) => +(x + dx).toFixed(5));
      if (dy) v = mapPath(v, "transform.y", (y) => +(y + dy).toFixed(5));
      changed.set(c.id, v);
    }
    if (o.hidden !== undefined) {
      const c = (changed.get(anchor.id) ?? anchor) as Clip;
      const shown = { ...c } as Clip & { disabled?: boolean };
      if (o.hidden) shown.disabled = true;
      else delete shown.disabled;
      changed.set(anchor.id, shown);
    }
    const tracks = where.tracks.map((t) => (t.clips.some((c) => changed.has(c.id)) ? { ...t, clips: t.clips.map((c) => changed.get(c.id) ?? c) } : t));
    q = where.k === undefined ? { ...q, tracks } : { ...q, compounds: q.compounds!.map((k) => (k.id === where.k ? { ...k, tracks } : k)) };
  }
  return q;
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

/** A picture or graphic a version draws over or under its burned
 * captions, as an agent reads it. */
export interface CaptionCollision {
  clip_id: Id;
  caption_clip_id: Id;
  /** Version seconds: the first moment they meet. */
  at: number;
  /** Over the captions (drawn above them) or under them. */
  layer: "over" | "under";
  /** The visible part of the clip there, canvas pixels. */
  box: Rect;
  note: string;
  /** What the version did about it: a picture-in-picture moved clear of
   * the captions (clearCaptions), and how to place it otherwise. */
  done?: string;
}

/** A collision with the share of the caption's letters' height it
 * crosses, and the override that clears it, when one does. */
type Collision = CaptionCollision & { depth: number; fix?: { y: number; scale: number } };

/** What a layer shows of itself, in pixels: its box, or with a closed
 * mask (a porthole's circle) the mask's part of it. */
function visibleBox(q: Project, c: VisualClip, rel: number): Rect {
  const b = boxOf(q, c, rel);
  const m = "mask" in c ? c.mask : undefined;
  if (!m || m.invert || Math.abs(paramAt(c, "transform.rotation", rel)) > 1e-3) return b;
  const w = b.right - b.left, h = b.bottom - b.top;
  const now = { ...m, ...Object.fromEntries((["x", "y", "width", "height", "rotation"] as const).map((k) => [k, paramAt(c, `mask.${k}`, rel)])) };
  const r = maskReach(now, w / Math.max(1, h));
  if (!r) return b;
  return { left: Math.max(b.left, b.left + (0.5 + r.left) * w), right: Math.min(b.right, b.left + (0.5 + r.right) * w), top: Math.max(b.top, b.top + (0.5 + r.top) * h), bottom: Math.min(b.bottom, b.top + (0.5 + r.bottom) * h) };
}

/**
 * The pictures and graphics a version draws across its burned captions
 * (Claude film test 2: the porthole picture-in-picture sat under the 16:9
 * version's captions and nothing said so): every overlay that is not text
 * (a picture-in-picture, a shape, a sticker, a card) showing with a
 * caption, its visible part (a mask's) crossing the caption's letters and
 * box. One per overlay, at the first moment, with the override that
 * raises it clear. ADR-116.
 */
export function captionCollisions(q: Project): CaptionCollision[] {
  return collide(q).map(({ fix: _, depth: __, ...c }) => c);
}

function collide(q: Project): Collision[] {
  const captions = seenTexts(q).filter((s) => s.c.caption && !s.via.length);
  if (!captions.length) return [];
  const order = new Map(q.tracks.map((t, i) => [t.id, i]));
  const out: Collision[] = [];
  const margin = 0.02 * Math.min(q.width, q.height);
  for (const [ti, t] of q.tracks.entries()) {
    // The main track's shots are what captions sit on, framed or not.
    if (t.kind !== "video" || t.hidden || t.main) continue;
    for (const c of t.clips) {
      if (c.disabled || c.type === "text" || !isOverlay(q, c)) continue;
      for (const s of captions) {
        const from = Math.max(c.start, s.start), to = Math.min(c.start + c.duration, s.start + s.duration);
        if (to <= from) continue;
        // Where both rest: the middle of their time together.
        const f = Math.floor((from + to) / 2);
        const letters = seenLetters(q, s, f)?.box;
        if (!letters) continue;
        const v = visibleBox(q, c, f - c.start);
        const w = Math.min(v.right, letters.right) - Math.max(v.left, letters.left), h = Math.min(v.bottom, letters.bottom) - Math.max(v.top, letters.top);
        if (w < 4 || h < 4) continue;
        const layer = ti < (order.get(s.track.id) ?? Infinity) ? "over" : "under";
        // The override that puts it above the caption: moved up; when it
        // would then leave the frame, also made smaller (about its own
        // center, as an override scales) to fit the room above.
        const rel = f - c.start, y0 = paramAt(c, "transform.y", rel), top = q.height * 0.05;
        const room = letters.top - margin - top, tall = v.bottom - v.top;
        const k = tall > room ? Math.max(0.1, room / tall) : 1;
        const cy = q.height / 2 + y0 * q.height;
        const y = y0 + (letters.top - margin - (cy + (v.bottom - cy) * k)) / q.height;
        // A callout (a ring, a pinned clip) points at what is under it:
        // moving it would take it off that (ADR-122), so the captions move.
        const pointer = !!anchorOf(c) || (c.type === "color" && c.shape?.fill === false);
        const fix = pointer ? "it points at what is under it, so " : room < tall * 0.25 ? "" : `an override {clip_id: "${c.id}", y: ${+y.toFixed(3)}${k < 1 ? `, scale: ${+k.toFixed(2)}` : ""}} puts it above the caption, or `;
        const at = +framesToSeconds(f, q.fps).toFixed(2);
        out.push({
          clip_id: c.id,
          caption_clip_id: s.c.id,
          at,
          layer,
          box: { left: Math.round(v.left), top: Math.round(v.top), right: Math.round(v.right), bottom: Math.round(v.bottom) },
          note: `${c.id} (${c.type === "color" ? "a shape" : c.type === "compound" ? "a compound clip" : "a picture"}) is drawn ${layer} the caption ${s.c.id} at ${at} s in this shape, across ${Math.round(h)} px of its letters: ${fix}move the captions (set_caption_look, or the version's overrides)`,
          depth: h / Math.max(1, letters.bottom - letters.top),
          ...(fix && !pointer ? { fix: { y: +y.toFixed(3), scale: +k.toFixed(2) } } : {}),
        });
        break;
      }
    }
  }
  return out;
}

/** A picture-in-picture, as a version may move it: a video, a picture (not
 * a sticker) or a floating window (a compound clip playing footage and no
 * titles), alone: not part of a group (an ad element) or a layout's cut
 * cell (a split screen's half), which keep their designed places. */
function isInset(q: Project, c: Clip): boolean {
  if (c.group || c.disabled) return false;
  if (c.type === "video" || c.type === "image") {
    const k = c.crop;
    return k.left + k.right + k.top + k.bottom < 0.002 && !(c.type === "image" && getAsset(q, c.assetId)?.sticker);
  }
  if (c.type !== "compound") return false;
  const inside = (id: Id, depth = 0): Clip[] => (depth > 4 ? [] : (findCompound(q, id)?.tracks ?? []).flatMap((t) => t.clips.flatMap((x) => (x.type === "compound" ? [x, ...inside(x.compoundId, depth + 1)] : [x]))));
  const all = inside(c.compoundId);
  return all.some((x) => x.type === "video" || (x.type === "image" && !getAsset(q, x.assetId)?.sticker)) && !all.some((x) => x.type === "text");
}

/**
 * A version's pictures-in-picture kept clear of its burned captions, as
 * tall versions keep titles and cards above them (ADR-118): one that
 * crosses a caption's letters in this shape, where the master kept it
 * clear (`master`: the master with the captions as the version burns
 * them), is moved by the override the collision names (up, and smaller
 * when it would leave the frame), unless the version's overrides place it
 * (`keep`). Designed layouts (a group, a card, a shape, a split screen's
 * cell) are left where the layout puts them and only named. Claude film
 * test 2's porthole sat under the 16:9 version's captions until the
 * tester moved it by hand. `moved` hears each, with what was done.
 */
export function clearCaptions(master: Project, q: Project, keep = new Set<Id>(), moved: CaptionCollision[] = []): Project {
  // What the master draws across its captions is its design; a touch (a
  // ring grazing the letters' outline, under a quarter of their height) is
  // not (the film's porthole grazed its caption by 7 px).
  const was = new Set(collide(master).filter((x) => x.depth >= 0.25).map((x) => x.clip_id));
  if (q.height > q.width) {
    const done = new Set<Id>();
    // collide names the first caption a ring crosses. Re-measure after
    // every move, so later captions and rings also leave room for each other.
    const count = q.tracks.reduce((n, t) => n + t.clips.length, 0);
    for (let i = 0; i < count; i++) {
      const hits = collide(q).filter(h => !keep.has(h.clip_id) && !keep.has(h.caption_clip_id));
      let changed = false;
      for (const hit of hits) {
        const c = q.tracks.flatMap(t => t.clips).find(c => c.id === hit.clip_id);
        if (!c || !(anchorOf(c) || (c.type === "color" && c.shape?.fill === false))) continue;
        if (calloutsOf(q).some(k => k.id === c.id && k.title === hit.caption_clip_id)) continue;
        const s = seenTexts(q).find(s => s.c.id === hit.caption_clip_id && !s.via.length);
        const box = s && seenLetters(q, s, secondsToFrames(hit.at, q.fps))?.box;
        if (!s || !box) continue;
        const dy = hit.box.top - 0.02 * Math.min(q.width, q.height) - box.bottom;
        if (box.top + dy < titleZone(q).top * q.height) continue;
        const y = +(s.c.transform.y + dy / q.height).toFixed(5);
        q = applyOverrides(q, [{ clip_id: s.c.id, y }]);
        if (!done.has(hit.clip_id)) moved.push({ ...hit, done: `captions moved above the ring in this version; ${s.c.id} y ${y}` });
        done.add(hit.clip_id);
        changed = true;
        break;
      }
      if (!changed) break;
    }
  }
  const done = new Map<Id, { hit: CaptionCollision; y: number; scale: number }>();
  const root = new Map(q.tracks.flatMap((t) => t.clips.map((c) => [c.id, c] as const)));
  // A fix is measured at one moment; a taller caption later may need a second.
  for (let i = 0; i < 3; i++) {
    const hits = collide(q).filter((h) => h.fix && !was.has(h.clip_id) && !keep.has(h.clip_id) && isInset(q, root.get(h.clip_id)!));
    if (!hits.length) break;
    q = applyOverrides(q, hits.map((h) => ({ clip_id: h.clip_id, y: h.fix!.y, scale: h.fix!.scale })));
    for (const { fix, depth: _, ...h } of hits) {
      const before = done.get(h.clip_id);
      done.set(h.clip_id, { hit: before?.hit ?? h, y: fix!.y, scale: (before?.scale ?? 1) * fix!.scale });
    }
  }
  const now = new Map(q.tracks.flatMap((t) => t.clips.map((c) => [c.id, c] as const)));
  for (const { hit, y, scale } of done.values()) {
    const s = +scale.toFixed(2);
    // Where it shows now, for the check sheet's outline.
    const c = now.get(hit.clip_id) as VisualClip, v = visibleBox(q, c, secondsToFrames(hit.at, q.fps) - c.start);
    const box = { left: Math.round(v.left), top: Math.round(v.top), right: Math.round(v.right), bottom: Math.round(v.bottom) };
    // The note says what it was; done what the version did.
    const note = `${hit.note.replace(" is drawn ", " was drawn ").replace(/: .*$/, "")}, where the master keeps it clear`;
    moved.push({ ...hit, box, note, done: `moved clear of the captions in this version: y ${y}${s < 1 ? `, ${s} times its size` : ""}; an override {clip_id: "${hit.clip_id}", y, scale} places it otherwise` });
  }
  return q;
}

// ---- what a version says about itself (ADR-123) ---------------------------------------

export type { OptionNote } from "./reframe";

/** Footage a version shows much smaller in its frame than the master did:
 * a picture floating in black (ADR-123). */
export interface CoverageReport {
  clip_id: Id;
  /** Version seconds: its worst moment. */
  at: number;
  /** The share of the frame footage covers there, in the version and in
   * the master at the same moment of the clip. */
  covered: number;
  master: number;
  note: string;
}

/** What a version says besides its subjects, captions and callouts: what
 * became of the caller's focus, pushes and overrides, and footage that
 * covers much less of its frame than of the master's. */
export interface VersionSays {
  options: OptionNote[];
  coverage: CoverageReport[];
}

/** Why a focus named a clip this version did not frame by it. */
function focusMissed(m: Project, v: VersionSpec, id: Id, reshaped: boolean): string {
  const c = m.tracks.flatMap((t) => t.clips).find((x) => x.id === id);
  const inside = !c && timelines(m).some(({ tracks }) => tracks.some((t) => t.clips.some((x) => x.id === id)));
  if (inside) return `${id} is inside a compound clip: focus frames footage on the project's timeline (the compound clip is the picture there); overrides {clip_id: "${id}", x, y, scale} place it`;
  if (!c) return `no clip ${id} in this version${v.duration !== undefined ? " (the cut-down may have cut it out)" : ""}: focus takes describe_project's clip ids`;
  if (!reshaped) return `this version keeps the master's shape, so nothing is cropped and the focus on ${id} changes nothing`;
  if (c.type !== "video" && c.type !== "image") return `${id} is a ${c.type === "text" ? "title" : c.type === "color" ? "shape or solid" : c.type === "compound" ? "compound clip" : c.type + " clip"}, not footage a version crops: overrides {clip_id: "${id}", x, y} place it`;
  if ((v.fit ?? "fill") !== "fill" && fillsFrame(m, c)) return `focus frames what fit "fill" crops; with fit "${v.fit}" this version scales ${id} about the master's framing and the focus changes nothing`;
  return `${id} neither fills the master's frame nor spans it edge to edge (a picture-in-picture or a window), so this version places it as an overlay at its size: overrides {clip_id: "${id}", x, y, scale} place it`;
}

/**
 * The share of a frame its footage covers at timeline frame f: videos and
 * pictures (not stickers) on the visible tracks of the timeline, at least
 * half opaque, by what they show (a closed mask's part), on a grid of
 * points; a picture over a blurred copy of itself (fit "blur") covers it
 * all. ponytail: footage inside compound clips is not counted.
 */
function footageCover(p: Project, f: number): number {
  const boxes: Rect[] = [];
  for (const t of p.tracks) {
    if (t.kind !== "video" || t.hidden) continue;
    for (const c of t.clips) {
      if (c.disabled || f < c.start || f >= c.start + c.duration) continue;
      if ((c.type !== "video" && c.type !== "image") || (c.type === "image" && getAsset(p, c.assetId)?.sticker)) continue;
      if (c.canvas?.type === "blur") return 1;
      if (paramAt(c, "opacity", f - c.start) < 0.5) continue;
      boxes.push(visibleBox(p, c, f - c.start));
    }
  }
  const N = 24;
  let hit = 0;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const x = ((i + 0.5) / N) * p.width, y = ((j + 0.5) / N) * p.height;
      if (boxes.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom)) hit++;
    }
  return hit / (N * N);
}

/** A clip's own box on its frame at its frame rel, clipped to the frame, as
 * a share of it. */
function ownShare(p: Project, c: VisualClip, rel: number): number {
  const b = visibleBox(p, c, rel);
  const w = Math.max(0, Math.min(b.right, p.width) - Math.max(b.left, 0)), h = Math.max(0, Math.min(b.bottom, p.height) - Math.max(b.top, 0));
  return (w * h) / (p.width * p.height);
}

/**
 * Footage version q shows floating in its frame where master p filled it
 * (ADR-123): every half second of q, the share of the frame its footage
 * covers against the master's at the same moment of the largest picture
 * showing; one report a clip, at its worst moment, where the version's
 * share is under 0.7 and 0.15 or more under the master's. Claude film test
 * 4's fitted interface shots came out as small pictures in black on 16:9
 * and nothing said so.
 */
export function coverageReports(p: Project, q: Project, fit: VersionFit = "fill"): CoverageReport[] {
  const master = new Map(p.tracks.flatMap((t) => t.clips.map((c) => [c.id, c] as const)));
  const step = Math.max(1, secondsToFrames(0.5, q.fps));
  const worst = new Map<Id, { f: number; cv: number; cm: number; c: VisualClip; m: VisualClip }>();
  for (let f = 0; f < projectDuration(q); f += step) {
    const showing = q.tracks
      .filter((t) => t.kind === "video" && !t.hidden)
      .flatMap((t) => t.clips)
      .filter((c): c is VideoClip | ImageClip => !c.disabled && f >= c.start && f < c.start + c.duration && (c.type === "video" || (c.type === "image" && !getAsset(q, c.assetId)?.sticker)));
    if (!showing.length) continue;
    const c = showing.reduce((a, b) => (ownShare(q, b, f - b.start) > ownShare(q, a, f - a.start) ? b : a));
    const m = master.get(c.id) as VisualClip | undefined;
    if (!m || f - c.start >= m.duration) continue;
    const cv = footageCover(q, f), cm = footageCover(p, m.start + f - c.start);
    if (cv >= 0.7 || cm - cv < 0.15) continue;
    const was = worst.get(c.id);
    if (!was || cv < was.cv) worst.set(c.id, { f, cv, cm, c, m });
  }
  return [...worst.values()].map(({ f, cv, cm, c, m }) => {
    const at = +framesToSeconds(f, q.fps).toFixed(2);
    const own = ownShare(q, c, f - c.start), was = ownShare(p, m, f - c.start);
    const k = +Math.sqrt(was / Math.max(1e-6, own)).toFixed(2);
    const shot = fillsFrame(p, m);
    const fix =
      shot && fit !== "fill" ? `fit "${fit}" shows it whole; fit "fill" (the default) crops it to cover the frame, "blur" fills around it`
      : shot ? `an override {clip_id: "${c.id}", scale: ${k}} enlarges it`
      : `this version places it as a picture-in-picture at its size against the frame's short side: an override {clip_id: "${c.id}", scale: ${k}} gives it the share it had`;
    return { clip_id: c.id, at, covered: +cv.toFixed(2), master: +cm.toFixed(2), note: `footage covers ${Math.round(cv * 100)}% of this frame at ${at} s (${Math.round(cm * 100)}% of the master's), ${c.id} floating in the empty rest: ${fix}` };
  });
}

/**
 * After the overrides: what points into a picture an override moved or
 * resized (a ring, a spotlight's hole, anything pinned to it) follows it
 * there, unless an override placed that too (ADR-123). The overrides came
 * after the callouts were written, so Claude film test 4's rings stayed
 * where the picture had been.
 */
function carryPinned(master: Project, q: Project, list: VersionOverride[], said: OptionNote[]): Project {
  const hand = new Set(list.map((o) => o.clip_id));
  const moved = new Set(list.filter((o) => o.x !== undefined || o.y !== undefined || o.scale !== undefined).map((o) => o.clip_id));
  const riders = calloutsOf(master).filter((k) => k.follows && k.shot && moved.has(k.shot) && !hand.has(k.id));
  if (!riders.length) return q;
  const placed = followCallouts(master, q, riders.filter((k) => !k.anchored));
  // reanchor writes every pinned clip: those an override placed keep it.
  const kept = new Map(placed.tracks.flatMap((t) => t.clips).filter((c) => hand.has(c.id) && anchorOf(c)).map((c) => [c.id, c] as const));
  const out = reanchor(placed);
  for (const shot of moved) {
    const ids = riders.filter((k) => k.shot === shot).map((k) => k.id);
    if (ids.length) said.push({ option: "overrides", clip_id: shot, note: `${ids.join(", ")} (pointing into ${shot}) moved with it, on what ${ids.length > 1 ? "they point" : "it points"} at` });
  }
  return kept.size ? { ...out, tracks: out.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => kept.get(c.id) ?? c) })) } : out;
}

/** One version of the master: cut down, reshaped, textless, as asked.
 * `keepEnd` frames of the end are kept in a cut-down (default: the end
 * card's length when the master has one). `looks` frame cropped footage on
 * its subject; `notes` collects where a framing cuts one; `moved` the
 * pictures-in-picture moved clear of the captions (clearCaptions);
 * `callouts` the rings, spotlights and pinned clips it leaves off the frame
 * or off what they point at (ADR-122); `says` what became of the focus,
 * pushes and overrides, and footage left floating (ADR-123). */
export function versionProject(p: Project, v: VersionSpec, keepEnd?: number, looks?: Looks, notes?: SubjectNote[], moved?: CaptionCollision[], callouts?: CalloutReport[], says?: VersionSays): Project {
  let q = p;
  // A focus path's times as frames of its clip, before a cut-down moves it.
  const starts = new Map(p.tracks.flatMap((t) => t.clips.map((c) => [c.id, c.start] as const)));
  const focus = v.focus?.map((f) => (f.at === undefined || !starts.has(f.clip_id) ? f : { ...f, rel: secondsToFrames(f.at, p.fps) - starts.get(f.clip_id)! }));
  if (v.duration !== undefined) {
    const frames = Math.max(1, secondsToFrames(v.duration, p.fps));
    const card = endCardStart(p);
    q = cutDown(q, frames, keepEnd ?? (card === undefined ? 0 : projectDuration(p) - card));
  }
  const [rw, rh] = v.ratio === "original" ? [p.width, p.height] : v.ratio.split(":").map(Number);
  q = versionCaptions(q, v.captions ?? (rh > rw ? "burn" : "as_project"));
  const master = q;
  const said: OptionNote[] = [], framed: Id[] = [], eased: Id[] = [];
  const shaped = reshape(q, v.ratio, v.fit ?? "fill", { looks, reframe: v.reframe, focus, notes, pushes: v.pushes, said, framed, eased });
  q = shaped === q || v.textless ? shaped : clearCaptions(q, shaped, new Set((v.overrides ?? []).map((o) => o.clip_id)), moved);
  if (v.textless) q = textless(q);
  // By hand, last: the version's overrides, and what points into a picture they move.
  if (v.overrides?.length) q = carryPinned(master, applyOverrides(q, v.overrides), v.overrides, said);
  if (callouts && shaped !== master) callouts.push(...calloutReports(master, q));
  if (says) {
    // A focus or a push that changed nothing says why (ADR-123).
    for (const id of new Set((v.focus ?? []).map((f) => f.clip_id))) if (!framed.includes(id)) said.unshift({ option: "focus", clip_id: id, note: focusMissed(master, v, id, shaped !== master) });
    if (v.pushes && v.pushes !== "keep" && !eased.length) said.push({ option: "pushes", note: shaped === master ? `this version keeps the master's shape, so pushes "${v.pushes}" changes nothing` : `pushes "${v.pushes}" changed nothing: no shot this version crops or fits has a keyed zoom (frame_region moves, or keys on transform.scale)` });
    says.options.push(...said);
    if (shaped !== master) says.coverage.push(...coverageReports(master, q, v.fit ?? "fill"));
  }
  return { ...q, name: versionName(p.name, v) };
}

/** What one version's file reached, as export_video answers it: the
 * loudness measured with a loudness target (integrated LUFS, true peak
 * dBTP), the good news (info: normalized, the limiter's work) and the
 * warnings (note), with the numbered name the file took. export_versions
 * answered none of it, so an agent asking -14 could not see it was met. */
export function versionSound(r: { loudness?: { integrated: number; truePeak: number }; info?: string; note?: string }, renamed?: string): { loudness?: { integrated: number; truePeak: number }; info?: string; note?: string } {
  const note = [r.note, renamed].filter(Boolean).join(" ");
  return { ...(r.loudness ? { loudness: r.loudness } : {}), ...(r.info ? { info: r.info } : {}), ...(note ? { note } : {}) };
}

/** What an agent asks export_versions for: explicit versions, or every
 * ratio at every duration (the master's own length when none is given),
 * plus a textless master in the first ratio. At most `limit`. */
export function expandVersions(a: { versions?: VersionSpec[]; ratios?: VersionRatio[]; durations?: number[]; textless?: boolean; fit?: VersionFit; captions?: VersionCaptions; reframe?: Reframe; focus?: Focus[]; overrides?: VersionOverride[]; pushes?: VersionPushes }, masterSeconds: number, limit = 12): VersionSpec[] {
  // What every version shares, unless it says otherwise.
  const shared = { ...(a.fit ? { fit: a.fit } : {}), ...(a.pushes ? { pushes: a.pushes } : {}), ...(a.captions ? { captions: a.captions } : {}), ...(a.reframe ? { reframe: a.reframe } : {}), ...(a.focus?.length ? { focus: a.focus } : {}), ...(a.overrides?.length ? { overrides: a.overrides } : {}) };
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

/** Master seconds mapped through the same opening/end-card cut as cutDown.
 * Removed moments are omitted; the check sheet labels the frames it shows. */
export function versionCheckFrames(master: Project, version: Project, times: number[], keepEnd?: number): number[] {
  const total = projectDuration(master), length = projectDuration(version);
  const card = endCardStart(master);
  const keep = keepEnd ?? (card === undefined ? 0 : total - card);
  const tail = Math.max(0, Math.min(keep, length - 1));
  return times.flatMap((t) => {
    const f = secondsToFrames(t, master.fps);
    if (length >= total || f < length - tail) return [Math.min(length - 1, f)];
    if (tail && f >= total - tail) return [Math.min(length - 1, f - total + length)];
    return [];
  });
}

/** Apply the checker's cut alternative only to a measured uneven fade.
 * No change to an unmeasured title or the caller's master (ADR-135). */
export function repairVersionFades(p: Project, fades: NonNullable<CheckMeasured["fades"]>): { project: Project; changed: Id[] } {
  const slots = new Map<Id, Set<"animIn" | "animOut">>();
  for (const s of seenTexts(p)) {
    const fade = fades[s.key];
    if (!fade) continue;
    const slot = fade.frame < s.start + s.duration / 2 ? "animIn" : "animOut";
    if (!s.c[slot]) continue;
    if (!slots.has(s.c.id)) slots.set(s.c.id, new Set());
    slots.get(s.c.id)!.add(slot);
  }
  if (!slots.size) return { project: p, changed: [] };
  const tracks = (ts: Track[]) => ts.map((t) => ({ ...t, clips: t.clips.map((c) => {
    if (c.type !== "text" || !slots.has(c.id)) return c;
    const q = { ...c };
    for (const slot of slots.get(c.id)!) delete q[slot];
    return q;
  }) }));
  return { project: { ...p, tracks: tracks(p.tracks), ...(p.compounds ? { compounds: p.compounds.map((k) => ({ ...k, tracks: tracks(k.tracks) })) } : {}) }, changed: [...slots.keys()] };
}
