// Ad elements: the parts nearly every product ad, brand spot and social ad
// has, built from ordinary clips (text with boxes, solids, the logo
// picture) in the brand's colors and fonts, laid out inside the title-safe
// area and animated, so an agent adds a finished end card or lower third in
// one call (add_ad_element) and can still edit every part. Each element's
// clips share a group (they move together) and its name.
//
// Layout rules from broadcast and social ad specs: everything inside the
// 90% title-safe area (5% margins); on 9:16, clear of what TikTok, Reels
// and Shorts cover (lib/align.ts VERTICAL_SAFE); headlines about 9% of the
// frame's height; type over footage carries a shadow or sits in a box.

import { VERTICAL_SAFE } from "./align";
import { brandOf, LIFT, pickLogo, readableOn, roleStyle, textOn, typeScale, withAlpha, type LogoVariant } from "./brandKit";
import { placeOnTop } from "./overlays";
import { clipForAsset, createColorClip, createTextClip, createTrack, uid } from "./project/defaults";
import { addClip, addTrack, findClip, getAsset } from "./project/ops";
import type { Animation, Clip, ColorClip, Cutout, Id, ImageClip, Project, TextClip, TextStyle, VideoClip } from "./project/types";
import { fittedSize } from "./render/size";
import { secondsToFrames } from "./time";

export type AdElement = "end_card" | "lower_third" | "offer_badge" | "cta_button" | "logo_reveal";
export const AD_ELEMENTS: AdElement[] = ["end_card", "lower_third", "offer_badge", "cta_button", "logo_reveal"];

export const AD_LABELS: Record<AdElement, string> = {
  end_card: "End card",
  lower_third: "Lower third",
  offer_badge: "Offer badge",
  cta_button: "Call to action",
  logo_reveal: "Logo reveal",
};

/** Seconds each element lasts unless told (lower thirds hold 3 to 6 s). */
export const AD_SECONDS: Record<AdElement, number> = { end_card: 3, lower_third: 4, offer_badge: 3, cta_button: 3, logo_reveal: 2.5 };

export type Spot = "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";
export const SPOTS: Spot[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];

const DEFAULT_SPOT: Record<AdElement, Spot> = { end_card: "center", lower_third: "bottom-left", offer_badge: "top-right", cta_button: "bottom", logo_reveal: "center" };

export type AdBackground = "brand" | "primary" | "scrim" | "none";

export interface AdOptions {
  /** Timeline frame it starts at; frames it lasts (default AD_SECONDS). */
  start: number;
  duration?: number;
  headline?: string;
  subline?: string;
  cta?: string;
  url?: string;
  logo?: LogoVariant | "auto" | "none";
  position?: Spot;
  background?: AdBackground;
  glow?: boolean;
  flash?: boolean;
}

/** The title-safe area, as fractions of the canvas from each edge. */
export function safeArea(p: Pick<Project, "width" | "height">): { left: number; top: number; right: number; bottom: number } {
  return p.height / p.width >= 1.5 ? { ...VERTICAL_SAFE } : { left: 0.05, top: 0.05, right: 0.05, bottom: 0.05 };
}

/** One clip of an element, before placement: its look, when it enters
 * after the element starts, and where it sits in the element's own layout
 * (pixels from the element's center). */
interface Part {
  clip: Clip;
  delay: number;
  /** Center offset in canvas pixels, set by the layout. */
  dx: number;
  dy: number;
  /** Fills the canvas (a background): not laid out or placed. */
  full?: boolean;
}

const anim = (p: Project, type: string, seconds: number, extra: Partial<Animation> = {}): Animation => ({ type, duration: Math.max(1, secondsToFrames(seconds, p.fps)), ...extra });

/** The size a part draws at, in canvas pixels. */
function sizeOf(p: Project, c: Clip): { w: number; h: number } {
  if (c.type === "audio" || c.type === "adjustment") return { w: 0, h: 0 };
  const s = fittedSize(p, c);
  return { w: s.w * Math.abs(c.transform.scale), h: s.h * Math.abs(c.transform.scaleY ?? c.transform.scale) };
}

/** Stack parts top to bottom, centered, `gaps[i]` pixels after part i. */
function stack(p: Project, parts: Part[], gaps: number[]) {
  const sizes = parts.map((x) => sizeOf(p, x.clip));
  const total = sizes.reduce((s, z) => s + z.h, 0) + gaps.slice(0, parts.length - 1).reduce((s, g) => s + g, 0);
  let y = -total / 2;
  parts.forEach((x, i) => {
    x.dy = y + sizes[i].h / 2;
    y += sizes[i].h + (gaps[i] ?? 0);
  });
}

/** Line parts up on their left edges (a lower third). */
function alignLeft(p: Project, parts: Part[]) {
  const sizes = parts.map((x) => sizeOf(p, x.clip));
  const widest = Math.max(...sizes.map((z) => z.w));
  parts.forEach((x, i) => (x.dx = -widest / 2 + sizes[i].w / 2));
}

/** Move the laid-out element so its bounds sit at `spot` inside the safe
 * area: the parts' offsets become canvas fractions. */
function place(p: Project, parts: Part[], spot: Spot) {
  const laid = parts.filter((x) => !x.full);
  if (!laid.length) return;
  const sizes = laid.map((x) => sizeOf(p, x.clip));
  const left = Math.min(...laid.map((x, i) => x.dx - sizes[i].w / 2));
  const right = Math.max(...laid.map((x, i) => x.dx + sizes[i].w / 2));
  const top = Math.min(...laid.map((x, i) => x.dy - sizes[i].h / 2));
  const bottom = Math.max(...laid.map((x, i) => x.dy + sizes[i].h / 2));
  const s = safeArea(p);
  const W = p.width, H = p.height;
  const area = { left: s.left * W, right: W - s.right * W, top: s.top * H, bottom: H - s.bottom * H };
  const [v, h] = spot === "center" ? ["middle", "center"] : spot.includes("-") ? spot.split("-") : spot === "top" || spot === "bottom" ? [spot, "center"] : ["middle", spot];
  const sx = h === "left" ? area.left - left : h === "right" ? area.right - right : (area.left + area.right) / 2 - (left + right) / 2;
  const sy = v === "top" ? area.top - top : v === "bottom" ? area.bottom - bottom : (area.top + area.bottom) / 2 - (top + bottom) / 2;
  for (const x of laid) {
    const t = (x.clip as { transform: { x: number; y: number } }).transform;
    t.x = +((x.dx + sx - W / 2) / W).toFixed(5);
    t.y = +((x.dy + sy - H / 2) / H).toFixed(5);
  }
}

/** A text part in a style, wrapping inside the safe area. */
function text(p: Project, words: string, style: Partial<TextStyle>): TextClip {
  const s = safeArea(p);
  return createTextClip(words, 0, 1, { maxWidth: +(1 - s.left - s.right).toFixed(3), ...style });
}

/** The logo picture, scaled to `height` (a canvas fraction) and never
 * wider than `maxWidth`. */
function logoPart(p: Project, assetId: Id, height: number, maxWidth: number): ImageClip | null {
  const a = getAsset(p, assetId);
  if (!a || a.kind !== "image" || !a.width || !a.height) return null;
  const fit = Math.min(p.width / a.width, p.height / a.height);
  const scale = Math.min((height * p.height) / (a.height * fit), (maxWidth * p.width) / (a.width * fit));
  const base = clipForAsset(a, 0, p.fps) as ImageClip;
  return { ...base, transform: { ...base.transform, scale: +scale.toFixed(4) } };
}

/** The solid behind an end card or a logo reveal, and the color the parts
 * on it sit on (undefined over footage). */
function backdrop(p: Project, bg: AdBackground): { clip?: ColorClip; fill?: string } {
  const c = brandOf(p).colors;
  if (bg === "none") return {};
  const color = bg === "primary" ? c.primary : bg === "scrim" ? "#000000" : c.background;
  const clip = { ...createColorClip(color, 0, 1), opacity: bg === "scrim" ? 0.6 : 1 };
  return { clip, fill: bg === "scrim" ? undefined : color };
}

/** The parts of one element, laid out (not yet placed or timed). */
function build(p: Project, element: AdElement, o: AdOptions): Part[] {
  const b = brandOf(p);
  const c = b.colors;
  const k = typeScale(p.width, p.height);
  const H = p.height / 1080;
  const part = (clip: Clip, delay = 0, full = false): Part => ({ clip, delay, dx: 0, dy: 0, full });
  const fadeOut = anim(p, "fade", 0.35);

  if (element === "lower_third") {
    const box = withAlpha(c.background, 0.9);
    const name = text(p, o.headline ?? b.name ?? "Your Name", { font: b.fonts.heading, size: Math.round(60 * k), bold: true, align: "left", color: textOn(box, c.text), background: { color: box, padding: 18, radius: 6 } });
    const title = text(p, o.subline ?? b.tagline ?? "Title or role", { font: b.fonts.body, size: Math.round(38 * k), bold: false, align: "left", color: readableOn(c.primary), background: { color: c.primary, padding: 12, radius: 6 } });
    const parts = [part({ ...name, animIn: anim(p, "rise", 0.45), animOut: fadeOut }), part({ ...title, animIn: anim(p, "rise", 0.45), animOut: fadeOut }, 0.15)];
    stack(p, parts, [6 * H]);
    alignLeft(p, parts);
    return parts;
  }

  if (element === "offer_badge") {
    const tilt = -4;
    const main = text(p, o.headline ?? "-30%", roleStyle(b, "badge", k));
    const parts = [part({ ...main, transform: { ...main.transform, rotation: tilt }, animIn: anim(p, "pop", 0.45), animLoop: anim(p, "pulse", 1.4), animOut: fadeOut })];
    if (o.subline) {
      const sub = text(p, o.subline, { font: b.fonts.heading, size: Math.round(30 * k), bold: true, letterSpacing: 4, case: "upper", color: readableOn(c.secondary), background: { color: c.secondary, padding: 12, radius: 8 } });
      parts.push(part({ ...sub, transform: { ...sub.transform, rotation: tilt }, animIn: anim(p, "pop", 0.4), animOut: fadeOut }, 0.15));
      stack(p, parts, [10 * H]);
    }
    return parts;
  }

  if (element === "cta_button") {
    const button = text(p, o.cta ?? "Shop now", roleStyle(b, "cta", k));
    const parts = [part({ ...button, animIn: anim(p, "pop", 0.45), animLoop: anim(p, "pulse", 1.2), animOut: fadeOut })];
    const under = o.subline ?? o.url;
    if (under) {
      parts.push(part({ ...text(p, under, { font: b.fonts.body, size: Math.round(36 * k), bold: false, color: c.text, shadow: LIFT }), animIn: anim(p, "fade", 0.4), animOut: fadeOut }, 0.3));
      stack(p, parts, [18 * H]);
    }
    return parts;
  }

  if (element === "end_card") {
    const bg = backdrop(p, o.background ?? "brand");
    const ink = bg.fill ? textOn(bg.fill, c.text) : c.text;
    const parts: Part[] = [];
    if (bg.clip) parts.push(part({ ...bg.clip, animIn: anim(p, "fade", 0.4) }, 0, true));
    const laid: Part[] = [];
    const gaps: number[] = [];
    const logoId = o.logo === "none" ? undefined : pickLogo(b, o.logo ?? "auto", bg.fill);
    const logo = logoId && logoPart(p, logoId, 0.16, 0.45);
    if (logo) {
      laid.push(part({ ...logo, animIn: anim(p, "pop", 0.5) }, 0.1));
      gaps.push(40 * H);
    }
    const headline = text(p, o.headline ?? b.tagline ?? b.name ?? "Your headline here", { ...roleStyle(b, "headline", k), color: ink, ...(bg.fill ? { shadow: undefined } : {}) });
    laid.push(part({ ...headline, animIn: anim(p, "wordRise", 0.7) }, 0.25));
    gaps.push(44 * H);
    // A button the color of the card would vanish: it takes the accent then.
    const fillBtn = bg.fill && bg.fill.toLowerCase() === c.primary.toLowerCase() ? c.accent : c.primary;
    const cta = text(p, o.cta ?? "Shop now", { ...roleStyle(b, "cta", k), color: readableOn(fillBtn), background: { color: fillBtn, padding: 30, radius: 999 } });
    laid.push(part({ ...cta, animIn: anim(p, "pop", 0.45), animLoop: anim(p, "pulse", 1.2) }, 0.55));
    gaps.push(30 * H);
    const url = o.url ?? b.url;
    if (url) laid.push(part({ ...text(p, url, { font: b.fonts.body, size: Math.round(40 * k), bold: false, color: ink, ...(bg.fill ? {} : { shadow: LIFT }) }), opacity: 0.9, animIn: anim(p, "fade", 0.4) }, 0.8));
    // The headline's own style has no shadow on a solid card.
    for (const x of laid) if (x.clip.type === "text" && !x.clip.style.shadow) delete (x.clip.style as Partial<TextStyle>).shadow;
    stack(p, laid, gaps);
    return [...parts, ...laid];
  }

  // logo_reveal
  const bg = backdrop(p, o.background ?? "none");
  const ink = bg.fill ? textOn(bg.fill, c.text) : c.text;
  const parts: Part[] = [];
  if (bg.clip) parts.push(part({ ...bg.clip, animIn: anim(p, "fade", 0.3), animOut: anim(p, "fade", 0.4) }, 0, true));
  const laid: Part[] = [];
  const gaps: number[] = [];
  const logoId = o.logo === "none" ? undefined : pickLogo(b, o.logo ?? "auto", bg.fill);
  const logo = logoId && logoPart(p, logoId, 0.26, 0.6);
  if (logo) {
    const glow = o.glow
      ? { effects: [{ id: uid("fx"), type: "glow", enabled: true, params: { amount: 0, threshold: 45 } }] }
      : {};
    const clip = { ...logo, ...glow, animIn: anim(p, "pop", 0.6), animOut: anim(p, "fade", 0.4) } as ImageClip;
    // The glow flares as the logo lands, then fades out: a glow left on
    // smears the mark (the drive saw it), and a logo must end crisp.
    if (o.glow) clip.keyframes = { [`effects.${clip.effects[0].id}.amount`]: [{ f: 0, v: 80, ease: "easeOut" }, { f: secondsToFrames(1.2, p.fps), v: 0 }] };
    laid.push(part(clip));
    gaps.push(28 * H);
  }
  const words = o.headline ?? (logo ? undefined : (b.name ?? "Brand"));
  if (words) {
    const style: Partial<TextStyle> = { font: b.fonts.heading, size: Math.round(72 * k), bold: true, letterSpacing: 10, case: "upper", color: ink, ...(bg.fill ? {} : { shadow: LIFT }), ...(o.glow ? { glow: { color: c.accent, blur: 28, strength: 1 } } : {}) };
    laid.push(part({ ...text(p, words, style), animIn: anim(p, "letterRise", 0.8), animOut: anim(p, "fade", 0.4) }, logo ? 0.35 : 0));
    gaps.push(18 * H);
  }
  const sub = o.subline ?? b.tagline;
  if (sub) laid.push(part({ ...text(p, sub, { font: b.fonts.body, size: Math.round(34 * k), bold: false, color: ink, ...(bg.fill ? {} : { shadow: LIFT }) }), animIn: anim(p, "fade", 0.5), animOut: anim(p, "fade", 0.4) }, 0.7));
  stack(p, laid, gaps);
  if (o.flash) {
    // A white flash as the logo lands: added light, gone in a third of a second.
    const at = 0.3;
    const flash = { ...createColorClip("#ffffff", 0, 1), blend: "add" as const, opacity: 0.85, name: "Flash" };
    parts.push({ ...part({ ...flash, keyframes: { opacity: [{ f: 0, v: 0.85, ease: "easeOut" }, { f: secondsToFrames(0.35, p.fps), v: 0 }] } }, at, true), dx: 0, dy: 0 });
  }
  return [...parts, ...laid];
}

/**
 * Add an ad element at `o.start`: its clips laid out in the safe area at
 * `o.position` (an end card always centered), each entering at its delay
 * and lasting to the element's end, stacked above everything showing then,
 * grouped and named after the element. Returns the new clip ids.
 */
export function addAdElement(p: Project, element: AdElement, o: AdOptions): { project: Project; clipIds: Id[] } {
  const parts = build(p, element, o);
  place(p, parts, element === "end_card" ? "center" : (o.position ?? DEFAULT_SPOT[element]));
  const duration = Math.max(1, o.duration ?? secondsToFrames(AD_SECONDS[element], p.fps));
  const end = o.start + duration;
  const group = parts.length > 1 ? uid("g") : undefined;
  const ids: Id[] = [];
  for (const x of parts) {
    const start = Math.min(end - 1, o.start + secondsToFrames(x.delay, p.fps));
    // A flash is only as long as its fade.
    const len = x.clip.name === "Flash" ? Math.min(end - start, secondsToFrames(0.4, p.fps)) : end - start;
    const clip = { ...x.clip, id: uid("c"), start, duration: Math.max(1, len), name: x.clip.name ?? AD_LABELS[element], ...(group ? { group } : {}) } as Clip;
    p = placeOnTop(p, clip, AD_LABELS[element]);
    ids.push(clip.id);
  }
  return { project: p, clipIds: ids };
}

// ---- text behind the subject ------------------------------------------------------

/** Why layers cannot go behind a video's subject, or null when they can. */
export function behindProblem(p: Project, videoId: Id, layerIds: Id[]): string | null {
  const v = findClip(p, videoId);
  if (!v) return `no clip with id ${videoId}`;
  if (v.clip.type !== "video") return `clip ${videoId} is a ${v.clip.type} clip; the subject must be in a video clip (Remove background works on video)`;
  if (v.track.locked) return `track ${v.track.name} is locked`;
  if (!layerIds.length) return "name the title (or titles) to put behind the subject";
  for (const id of layerIds) {
    const l = findClip(p, id);
    if (!l) return `no clip with id ${id}`;
    if (id === videoId || l.clip.type === "audio" || l.clip.type === "adjustment") return `clip ${id} cannot go behind the subject: give titles, stickers or pictures`;
    if (l.track.locked) return `track ${l.track.name} is locked`;
    if (l.clip.start >= v.clip.start + v.clip.duration || l.clip.start + l.clip.duration <= v.clip.start) return `clip ${id} does not play while the video does`;
  }
  return null;
}

/**
 * Put titles (or stickers) behind a video's subject, the "text behind the
 * person" look: a copy of the video goes on a new track above them with
 * its background removed by `cutout`, so the subject covers the text while
 * the original below shows the background. The copy is silent, has no
 * canvas fill (it would cover the text), and is grouped with the original
 * so they move together. A layer below the video moves to a track just
 * above it first.
 */
export function putBehindSubject(p: Project, videoId: Id, layerIds: Id[], cutout: Cutout): { project: Project; subjectId: Id } {
  const problem = behindProblem(p, videoId, layerIds);
  if (problem) throw new Error(problem);
  const video = findClip(p, videoId)!.clip as VideoClip;
  const index = (id: Id) => p.tracks.findIndex((t) => t.clips.some((c) => c.id === id));
  for (const id of layerIds) {
    if (index(id) < index(videoId)) continue;
    // Below or beside the video: lift it onto its own track right above.
    const clip = findClip(p, id)!.clip;
    const track = createTrack("video", "Text");
    p = addTrack({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== id) })) }, track, index(videoId));
    p = addClip(p, track.id, clip);
  }
  const top = Math.min(...layerIds.map(index));
  const group = video.group ?? uid("g");
  const { canvas: _fill, transitionOut: _cut, ...rest } = video;
  // A transition into or out of the video dissolves the original while
  // the copy, on its own track, would stay sharp: the copy fades across
  // the half of each transition that falls inside the clip instead.
  const track0 = findClip(p, videoId)!.track;
  const before = track0.clips.find((c) => c.start + c.duration === video.start && "transitionOut" in c && c.transitionOut);
  const into = before && "transitionOut" in before ? before.transitionOut : undefined;
  const fades = {
    ...(into ? { animIn: { type: "fade", duration: Math.max(1, Math.ceil(into.duration / 2)) } } : {}),
    ...(video.transitionOut ? { animOut: { type: "fade", duration: Math.max(1, Math.ceil(video.transitionOut.duration / 2)) } } : {}),
  };
  const subject: VideoClip = { ...rest, ...fades, id: uid("c"), name: "Subject", muted: true, cutout: { ...cutout, enabled: true }, group };
  const track = createTrack("video", "Subject");
  p = addTrack(p, track, top);
  p = addClip(p, track.id, subject);
  if (!video.group) p = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === videoId ? { ...c, group } : c)) })) };
  return { project: p, subjectId: subject.id };
}
