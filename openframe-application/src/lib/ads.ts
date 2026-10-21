// Ad elements: the parts nearly every product ad, brand spot and social ad
// has, built from ordinary clips (text with boxes, solids, the logo
// picture) in the brand's colors and fonts, laid out inside the title-safe
// area and animated, so an agent adds a finished end card or lower third in
// one call (add_ad_element) and can still edit every part. Each element's
// clips share a group (they move together) and its name.
//
// Layout rules from broadcast and social ad specs: everything inside the
// 90% title-safe area (5% margins); on 9:16, clear of what TikTok, Reels
// and Shorts cover (lib/align.ts VERTICAL_SAFE), a centered element on the
// frame's center line; an element too big for that built smaller as a
// whole; headlines about 9% of the frame's height and no type under the
// readable floor (brandKit minTextSize); type over footage carries a
// shadow and an outline, or sits in a box.

import { VERTICAL_SAFE } from "./align";
import { brandOf, LIFT, minTextSize, pickLogo, readableOn, roleStyle, textOn, typeScale, withAlpha, type LogoVariant } from "./brandKit";
import { seenLetters, seenTexts } from "./designCheck";
import { placeStack } from "./overlays";
import { clipForAsset, createColorClip, createTextClip, createTrack, DEFAULT_TEXT_STYLE, uid } from "./project/defaults";
import { addClip, addTrack, findClip, getAsset } from "./project/ops";
import type { Adjust, Animation, Asset, Clip, ColorClip, Cutout, Grade, Id, ImageClip, Project, TextClip, TextStyle, VideoClip } from "./project/types";
import { effectDefaults, FILTERS } from "./catalog";
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

/**
 * The width a title centered at `x` (a fraction of the width from the
 * canvas's center) wraps within, as a fraction of the width: twice the room
 * on its nearer side of the safe area, so its lines stay inside it. A
 * centered title on 16:9, 1:1 or 4:5 gets the 90% title-safe width (0.9,
 * the style's old default); on 9:16 the column the apps' buttons leave
 * (0.62 centered, 0.7 on the column's own center at x -0.04). At least a
 * quarter of the width.
 */
export function titleWrap(p: Pick<Project, "width" | "height">, x = 0): number {
  const s = safeArea(p);
  const cx = 0.5 + x;
  const room = 2 * Math.min(cx - s.left, 1 - s.right - cx);
  return +Math.max(0.25, Math.min(1 - s.left - s.right, room)).toFixed(3);
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

/** Type over footage: the soft shadow and a thin dark outline, so it reads
 * on a bright, busy shot too (a thin tagline was lost on bright footage
 * with the shadow alone); type on a card or in a box needs neither. */
const OVER_FOOTAGE: Partial<TextStyle> = { shadow: LIFT, stroke: { color: "#000000b3", width: 2 } };

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

type Rect = { left: number; right: number; top: number; bottom: number };

/** An element shrinks to fit its room no further than this: past it, the
 * logo and gaps would be tiny while the text sits at its floor. */
const MIN_FIT = 0.5;

/** A spot as its vertical and horizontal sides. */
function sides(spot: Spot): ["top" | "middle" | "bottom", "left" | "center" | "right"] {
  if (spot === "center") return ["middle", "center"];
  if (spot === "top" || spot === "bottom") return [spot, "center"];
  if (spot === "left" || spot === "right") return ["middle", spot];
  return spot.split("-") as ["top" | "bottom", "left" | "right"];
}

/** Where an element at `spot` may sit, in canvas pixels: the safe area,
 * made even about the center line for a centered spot (on 9:16 the apps'
 * buttons take the right 19%, so a centered card keeps that margin on the
 * left too and sits on the frame's center line, not 4% left of it). An
 * offer badge keeps to its half of the frame, as a corner sticker does: a
 * wide one drifted to the middle. */
function roomFor(p: Project, element: AdElement, spot: Spot): Rect {
  const s = safeArea(p);
  const W = p.width, H = p.height;
  const room = { left: s.left * W, right: W - s.right * W, top: s.top * H, bottom: H - s.bottom * H };
  const [, h] = sides(spot);
  if (h === "center") {
    const m = Math.max(room.left, W - room.right);
    return { ...room, left: m, right: W - m };
  }
  if (element === "offer_badge") return h === "right" ? { ...room, left: Math.max(room.left, W / 2) } : { ...room, right: Math.min(room.right, W / 2) };
  return room;
}

/** The laid-out parts' bounds around the element's center, rotation
 * included (a tilted badge reaches past its unrotated box). */
function bounds(p: Project, parts: Part[]): Rect {
  const laid = parts.filter((x) => !x.full);
  const boxes = laid.map((x) => {
    const z = sizeOf(p, x.clip);
    const rad = (("transform" in x.clip ? x.clip.transform.rotation : 0) * Math.PI) / 180;
    const hw = (Math.abs(Math.cos(rad)) * z.w + Math.abs(Math.sin(rad)) * z.h) / 2, hh = (Math.abs(Math.sin(rad)) * z.w + Math.abs(Math.cos(rad)) * z.h) / 2;
    return { left: x.dx - hw, right: x.dx + hw, top: x.dy - hh, bottom: x.dy + hh };
  });
  if (!boxes.length) return { left: 0, right: 0, top: 0, bottom: 0 };
  return { left: Math.min(...boxes.map((b) => b.left)), right: Math.max(...boxes.map((b) => b.right)), top: Math.min(...boxes.map((b) => b.top)), bottom: Math.max(...boxes.map((b) => b.bottom)) };
}

/** Move the laid-out element so its bounds sit at `spot` inside `room`:
 * the parts' offsets become canvas fractions. */
function place(p: Project, parts: Part[], spot: Spot, room: Rect) {
  const laid = parts.filter((x) => !x.full);
  if (!laid.length) return;
  const { left, right, top, bottom } = bounds(p, laid);
  const W = p.width, H = p.height;
  const [v, h] = sides(spot);
  const sx = h === "left" ? room.left - left : h === "right" ? room.right - right : (room.left + room.right) / 2 - (left + right) / 2;
  const sy = v === "top" ? room.top - top : v === "bottom" ? room.bottom - bottom : (room.top + room.bottom) / 2 - (top + bottom) / 2;
  for (const x of laid) {
    const t = (x.clip as { transform: { x: number; y: number } }).transform;
    t.x = +((x.dx + sx - W / 2) / W).toFixed(5);
    t.y = +((x.dy + sy - H / 2) / H).toFixed(5);
  }
}

/** A text part in a style, wrapping inside `room` (its box's padding
 * included) and never smaller than the readable floor. */
function textPart(p: Project, words: string, style: Partial<TextStyle>, room: Rect): TextClip {
  const pad = ((style.background?.padding ?? 0) * p.height) / 1080;
  const size = Math.max(style.size ?? DEFAULT_TEXT_STYLE.size, Math.ceil(minTextSize(p.width, p.height)));
  return createTextClip(words, 0, 1, { maxWidth: +Math.max(0.1, (room.right - room.left - 2 * pad) / p.width).toFixed(3), ...style, size });
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

/** The parts of one element, laid out (not yet placed or timed), wrapping
 * inside `room`; `fit` below 1 builds it that much smaller (type, logo,
 * boxes and gaps alike) to fit the room. */
function build(p: Project, element: AdElement, o: AdOptions, room: Rect, fit = 1): Part[] {
  const b = brandOf(p);
  const c = b.colors;
  const k = typeScale(p.width, p.height) * fit;
  const H = (p.height / 1080) * fit;
  const part = (clip: Clip, delay = 0, full = false): Part => ({ clip, delay, dx: 0, dy: 0, full });
  // A text part; its box and letter spacing shrink with the rest.
  const text = (words: string, st: Partial<TextStyle>) =>
    textPart(p, words, { ...st, ...(st.letterSpacing ? { letterSpacing: +(st.letterSpacing * fit).toFixed(2) } : {}), ...(st.background ? { background: { ...st.background, padding: +(st.background.padding * fit).toFixed(2) } } : {}) }, room);
  const fadeOut = anim(p, "fade", 0.35);

  if (element === "lower_third") {
    const box = withAlpha(c.background, 0.9);
    const name = text(o.headline ?? b.name ?? "Your Name", { font: b.fonts.heading, size: Math.round(60 * k), bold: true, align: "left", color: textOn(box, c.text), background: { color: box, padding: 18, radius: 6 } });
    const title = text(o.subline ?? b.tagline ?? "Title or role", { font: b.fonts.body, size: Math.round(38 * k), bold: false, align: "left", color: readableOn(c.primary), background: { color: c.primary, padding: 12, radius: 6 } });
    const parts = [part({ ...name, animIn: anim(p, "rise", 0.45), animOut: fadeOut }), part({ ...title, animIn: anim(p, "rise", 0.45), animOut: fadeOut }, 0.15)];
    stack(p, parts, [6 * H]);
    alignLeft(p, parts);
    // A logo asked for sits left of the name and title, as tall as both
    // (a broadcast lower third's bug); none unless asked (ADR-121).
    const logoId = o.logo === undefined || o.logo === "none" ? undefined : pickLogo(b, o.logo, box);
    const block = bounds(p, parts);
    const logo = logoId && logoPart(p, logoId, (block.bottom - block.top) / p.height, 0.2 * fit);
    if (logo) {
      const z = sizeOf(p, logo);
      parts.unshift({ ...part({ ...logo, animIn: anim(p, "pop", 0.45), animOut: fadeOut }), dx: block.left - 16 * H - z.w / 2, dy: (block.top + block.bottom) / 2 });
    }
    return parts;
  }

  if (element === "offer_badge") {
    const tilt = -4;
    const main = text(o.headline ?? "-30%", roleStyle(b, "badge", k));
    const parts = [part({ ...main, transform: { ...main.transform, rotation: tilt }, animIn: anim(p, "pop", 0.45), animLoop: anim(p, "pulse", 1.4), animOut: fadeOut })];
    if (o.subline) {
      const sub = text(o.subline, { font: b.fonts.heading, size: Math.round(30 * k), bold: true, letterSpacing: 4, case: "upper", color: readableOn(c.secondary), background: { color: c.secondary, padding: 12, radius: 8 } });
      parts.push(part({ ...sub, transform: { ...sub.transform, rotation: tilt }, animIn: anim(p, "pop", 0.4), animOut: fadeOut }, 0.15));
      stack(p, parts, [10 * H]);
    }
    return parts;
  }

  if (element === "cta_button") {
    const button = text(o.cta ?? "Shop now", roleStyle(b, "cta", k));
    const parts = [part({ ...button, animIn: anim(p, "pop", 0.45), animLoop: anim(p, "pulse", 1.2), animOut: fadeOut })];
    const under = o.subline ?? o.url;
    if (under) {
      parts.push(part({ ...text(under, { font: b.fonts.body, size: Math.round(36 * k), bold: false, color: c.text, ...OVER_FOOTAGE }), animIn: anim(p, "fade", 0.4), animOut: fadeOut }, 0.3));
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
    const logo = logoId && logoPart(p, logoId, 0.16 * fit, 0.45 * fit);
    if (logo) {
      laid.push(part({ ...logo, animIn: anim(p, "pop", 0.5) }, 0.1));
      gaps.push(40 * H);
    }
    const headline = text(o.headline ?? b.tagline ?? b.name ?? "Your headline here", { ...roleStyle(b, "headline", k), color: ink, ...(bg.fill ? { shadow: undefined } : OVER_FOOTAGE) });
    laid.push(part({ ...headline, animIn: anim(p, "wordRise", 0.7) }, 0.25));
    gaps.push(44 * H);
    // A button the color of the card would vanish: it takes the accent then.
    const fillBtn = bg.fill && bg.fill.toLowerCase() === c.primary.toLowerCase() ? c.accent : c.primary;
    const cta = text(o.cta ?? "Shop now", { ...roleStyle(b, "cta", k), color: readableOn(fillBtn), background: { color: fillBtn, padding: 30, radius: 999 } });
    laid.push(part({ ...cta, animIn: anim(p, "pop", 0.45), animLoop: anim(p, "pulse", 1.2) }, 0.55));
    gaps.push(30 * H);
    const url = o.url ?? b.url;
    if (url) laid.push(part({ ...text(url, { font: b.fonts.body, size: Math.round(40 * k), bold: false, color: ink, ...(bg.fill ? {} : OVER_FOOTAGE) }), opacity: 0.9, animIn: anim(p, "fade", 0.4) }, 0.8));
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
  const logo = logoId && logoPart(p, logoId, 0.26 * fit, 0.6 * fit);
  if (logo) {
    const glow = o.glow
      ? { effects: [{ id: uid("fx"), type: "glow", enabled: true, params: { ...effectDefaults("glow"), amount: 0, threshold: 45 } }] }
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
    const style: Partial<TextStyle> = { font: b.fonts.heading, size: Math.round(72 * k), bold: true, letterSpacing: 10, case: "upper", color: ink, ...(bg.fill ? {} : OVER_FOOTAGE), ...(o.glow ? { glow: { color: c.accent, blur: 28, strength: 1 } } : {}) };
    laid.push(part({ ...text(words, style), animIn: anim(p, "letterRise", 0.8), animOut: anim(p, "fade", 0.4) }, logo ? 0.35 : 0));
    gaps.push(18 * H);
  }
  const sub = o.subline ?? b.tagline;
  if (sub) laid.push(part({ ...text(sub, { font: b.fonts.body, size: Math.round(34 * k), bold: false, color: ink, ...(bg.fill ? {} : OVER_FOOTAGE) }), animIn: anim(p, "fade", 0.5), animOut: anim(p, "fade", 0.4) }, 0.7));
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
export function addAdElement(p: Project, element: AdElement, o: AdOptions): { project: Project; clipIds: Id[]; notes: string[] } {
  const spot = element === "end_card" ? "center" : (o.position ?? DEFAULT_SPOT[element]);
  const duration = Math.max(1, o.duration ?? secondsToFrames(AD_SECONDS[element], p.fps));
  const end = o.start + duration;
  // Too big for its room (a long headline on 9:16, whose safe area is half
  // the frame's height): built again smaller, every part and gap alike, a
  // few times since rounded sizes, wrapping and the text floor make it
  // inexact.
  const layout = (room: Rect) => {
    let fit = 1;
    let parts = build(p, element, o, room, fit);
    for (let i = 0; i < 4; i++) {
      const b = bounds(p, parts);
      const k = Math.min((room.right - room.left) / Math.max(1, b.right - b.left), (room.bottom - room.top) / Math.max(1, b.bottom - b.top));
      if (k >= 1 || fit <= MIN_FIT) break;
      fit = Math.max(MIN_FIT, fit * k * 0.99);
      parts = build(p, element, o, room, fit);
    }
    place(p, parts, spot, room);
    return parts;
  };
  const room = roomFor(p, element, spot);
  let parts = layout(room);
  // Clear of the captions showing then (ADR-121): the third film test's
  // lower third sat on its voiceover's captions. The room gives up the
  // captions' side of the frame and the element is laid out again in it.
  const notes: string[] = [];
  const band = captionBand(p, o.start, end);
  const box = placedBox(p, parts);
  if (band && box && crosses(box, band.box)) {
    const gap = 0.02 * p.height;
    const below = (band.box.top + band.box.bottom) / 2 > p.height / 2;
    const cleared = below ? { ...room, bottom: Math.min(room.bottom, band.box.top - gap) } : { ...room, top: Math.max(room.top, band.box.bottom + gap) };
    const y = (v: number) => +(v / p.height - 0.5).toFixed(3);
    const which = band.ids.length === 1 ? `the caption ${band.ids[0]}` : `${band.ids.length} captions`;
    if (cleared.bottom - cleared.top > 0.15 * p.height) {
      parts = layout(cleared);
      notes.push(`Placed ${below ? "above" : "below"} the captions showing then (${which}, ${below ? `from y ${y(band.box.top)}` : `down to y ${y(band.box.bottom)}`}); captions stay the top layer.`);
    } else notes.push(`The captions showing then (${which}) leave too little room, so the ${AD_LABELS[element].toLowerCase()} crosses them: give another position, or move the captions (set_caption_look y).`);
  }
  const group = parts.length > 1 ? uid("g") : undefined;
  const clips = parts.map((x) => {
    const start = Math.min(end - 1, o.start + secondsToFrames(x.delay, p.fps));
    // A flash is only as long as its fade.
    const len = x.clip.name === "Flash" ? Math.min(end - start, secondsToFrames(0.4, p.fps)) : end - start;
    return { ...x.clip, id: uid("c"), start, duration: Math.max(1, len), name: x.clip.name ?? AD_LABELS[element], ...(group ? { group } : {}) } as Clip;
  });
  // The element lands as one block on rows of its own (ADR-121). Its parts
  // used to land one at a time on whatever row was free: the film test's
  // end card put its card on Titles, its icon on Spotlight and its headline
  // on Callouts, so moving one of those tracks hid the icon under the card.
  return { project: placeStack(p, clips, AD_LABELS[element], true), clipIds: clips.map((c) => c.id), notes };
}

/** The captions shown during [start, end) frames, as one box around their
 * letters (canvas pixels), with their ids. */
function captionBand(p: Project, start: number, end: number): { box: Rect; ids: Id[] } | undefined {
  const seen = seenTexts(p).filter((s) => s.c.caption && s.start < end && s.start + s.duration > start);
  const boxes = seen.flatMap((s) => {
    const g = seenLetters(p, s);
    return g ? [{ box: g.box, id: s.c.id }] : [];
  });
  if (!boxes.length) return undefined;
  return {
    box: { left: Math.min(...boxes.map((b) => b.box.left)), right: Math.max(...boxes.map((b) => b.box.right)), top: Math.min(...boxes.map((b) => b.box.top)), bottom: Math.max(...boxes.map((b) => b.box.bottom)) },
    ids: boxes.map((b) => b.id),
  };
}

/** The placed parts' box in canvas pixels (a background that fills the
 * frame left out). */
function placedBox(p: Project, parts: Part[]): Rect | undefined {
  const laid = parts.filter((x) => !x.full && "transform" in x.clip);
  if (!laid.length) return undefined;
  const boxes = laid.map((x) => {
    const t = (x.clip as { transform: { x: number; y: number } }).transform;
    const z = sizeOf(p, x.clip);
    const cx = (0.5 + t.x) * p.width, cy = (0.5 + t.y) * p.height;
    return { left: cx - z.w / 2, right: cx + z.w / 2, top: cy - z.h / 2, bottom: cy + z.h / 2 };
  });
  return { left: Math.min(...boxes.map((b) => b.left)), right: Math.max(...boxes.map((b) => b.right)), top: Math.min(...boxes.map((b) => b.top)), bottom: Math.max(...boxes.map((b) => b.bottom)) };
}

const crosses = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// ---- text behind the subject ------------------------------------------------------

/** Why layers cannot go behind a clip's subject, or null when they can. */
export function behindProblem(p: Project, clipId: Id, layerIds: Id[]): string | null {
  const v = findClip(p, clipId);
  if (!v) return `no clip with id ${clipId}`;
  if (v.clip.type !== "video" && v.clip.type !== "image") return `clip ${clipId} is a ${v.clip.type} clip; the subject must be in a video or picture clip`;
  if (v.track.locked) return `track ${v.track.name} is locked`;
  if (!layerIds.length) return "name the title (or titles) to put behind the subject";
  for (const id of layerIds) {
    const l = findClip(p, id);
    if (!l) return `no clip with id ${id}`;
    if (id === clipId || l.clip.type === "audio" || l.clip.type === "adjustment") return `clip ${id} cannot go behind the subject: give titles, stickers or pictures`;
    if (l.track.locked) return `track ${l.track.name} is locked`;
    if (l.clip.start >= v.clip.start + v.clip.duration || l.clip.start + l.clip.duration <= v.clip.start) return `clip ${id} does not play while the ${v.clip.type === "image" ? "picture shows" : "video does"}`;
  }
  return null;
}

/** What makes the copy show only the subject: a video's matte, or a
 * picture with its background cut out (a new image asset, added with it). */
export type SubjectCut = { cutout: Cutout } | { asset: Asset };

/**
 * Put titles (or stickers) behind a clip's subject, the "text behind the
 * person" look: a copy of the clip goes on a new track above them showing
 * only the subject (a video with its background matte on, a picture as
 * its cut-out), so the subject covers the text while the original below
 * shows the background. The copy is silent, has no canvas fill (it would
 * cover the text), and is grouped with the original so they move
 * together. A layer below the clip moves to a track just above it first.
 */
export function putBehindSubject(p: Project, clipId: Id, layerIds: Id[], cut: SubjectCut): { project: Project; subjectId: Id; placed: BehindPlace; graded: GradeCopied[] } {
  const problem = behindProblem(p, clipId, layerIds);
  if (problem) throw new Error(problem);
  const original = findClip(p, clipId)!.clip as VideoClip | ImageClip;
  if ((original.type === "video") !== "cutout" in cut) throw new Error(original.type === "video" ? "a video's subject needs its matte" : "a picture's subject needs its cut-out picture");
  const index = (id: Id) => p.tracks.findIndex((t) => t.clips.some((c) => c.id === id));
  for (const id of layerIds) {
    if (index(id) < index(clipId)) continue;
    // Below or beside the clip: lift it onto its own track right above.
    const clip = findClip(p, id)!.clip;
    const track = createTrack("video", "Text");
    p = addTrack({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== id) })) }, track, index(clipId));
    p = addClip(p, track.id, clip);
  }
  const top = Math.min(...layerIds.map(index));
  const group = original.group ?? uid("g");
  const { canvas: _fill, transitionOut: _cut, ...rest } = original;
  // A transition into or out of the clip dissolves the original while
  // the copy, on its own track, would stay sharp: the copy fades across
  // the half of each transition that falls inside the clip instead.
  const track0 = findClip(p, clipId)!.track;
  const before = track0.clips.find((c) => c.start + c.duration === original.start && "transitionOut" in c && c.transitionOut);
  const into = before && "transitionOut" in before ? before.transitionOut : undefined;
  const fades = {
    ...(into ? { animIn: { type: "fade", duration: Math.max(1, Math.ceil(into.duration / 2)) } } : {}),
    ...(original.transitionOut ? { animOut: { type: "fade", duration: Math.max(1, Math.ceil(original.transitionOut.duration / 2)) } } : {}),
  };
  let subject: VideoClip | ImageClip =
    "cutout" in cut
      ? ({ ...rest, ...fades, id: uid("c"), name: "Subject", muted: true, cutout: { ...cut.cutout, enabled: true }, group } as VideoClip)
      : ({ ...rest, ...fades, id: uid("c"), name: "Subject", assetId: cut.asset.id, group } as ImageClip);
  if ("asset" in cut && !p.assets.some((a) => a.id === cut.asset.id)) p = { ...p, assets: [...p.assets, cut.asset] };
  // The copy sits above the titles, so above any grade (an adjustment
  // layer) between them and the original: that grade reaches the original
  // and not the copy, which would play ungraded over its own picture (the
  // Northbound test's rocket, without its teal and orange). It takes that
  // grade itself.
  const graded: GradeCopied[] = [];
  const below = p.tracks.slice(top, index(clipId)).filter((t) => !t.hidden && t.kind === "video");
  for (const t of [...below].reverse())
    for (const a of t.clips) {
      if (a.type !== "adjustment" || a.disabled || a.start >= subject.start + subject.duration || a.start + a.duration <= subject.start) continue;
      const g = withGradeOf(subject, a);
      subject = g.clip;
      graded.push({ adjustment_clip_id: a.id, track: t.name, copied: g.copied, ...(g.left.length ? { not_copied: g.left } : {}), ...(a.start > subject.start || a.start + a.duration < subject.start + subject.duration ? { note: "the adjustment layer covers only part of the copy's time; the copy carries its grade throughout" } : {}) });
    }
  const track = createTrack("video", "Subject");
  p = addTrack(p, track, top);
  p = addClip(p, track.id, subject);
  if (!original.group) p = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, group } : c)) })) };
  const above = p.tracks[top + 1];
  return { project: p, subjectId: subject.id, placed: { track_id: track.id, track: track.name, above_track_id: above.id, above: above.name }, graded };
}

/** Where text_behind_subject put the subject's copy: on a new track, right
 * above the titles' (topmost) track. */
export interface BehindPlace {
  track_id: Id;
  track: string;
  above_track_id: Id;
  above: string;
}

/** A grade the subject's copy took from an adjustment layer it does not
 * sit under: what was copied, in words, and what could not be. */
export interface GradeCopied {
  adjustment_clip_id: Id;
  track: string;
  copied: string[];
  not_copied?: string[];
  note?: string;
}

const ADJUST_RANGE: Partial<Record<keyof Adjust, [number, number]>> = { hue: [-180, 180], sharpen: [0, 100], vignette: [0, 100], grain: [0, 100] };

/**
 * A clip given an adjustment layer's grade as its own, mixed by the
 * layer's opacity: its Basic sliders added to the clip's, its look (or,
 * when the clip has another look, the look's slider moves), its LUT,
 * curves, wheels and HSL where the clip has none, its effects after the
 * clip's. One pass on the clip for two on the frame: close, not exact
 * (two contrasts multiply where their sum is drawn), and a vignette or
 * grain is drawn on the clip's own picture rather than the frame's.
 */
export function withGradeOf<T extends VideoClip | ImageClip>(c: T, a: Clip): { clip: T; copied: string[]; left: string[] } {
  if (a.type !== "adjustment") return { clip: c, copied: [], left: [] };
  const k = Math.max(0, Math.min(1, a.opacity));
  const copied: string[] = [], left: string[] = [];
  const adjust = { ...c.adjust };
  const add = (key: keyof Adjust, v: number) => {
    const [lo, hi] = ADJUST_RANGE[key] ?? [-100, 100];
    adjust[key] = Math.max(lo, Math.min(hi, +(adjust[key] + v).toFixed(2)));
  };
  for (const key of Object.keys(a.adjust) as (keyof (Adjust & Grade))[]) {
    const v = a.adjust[key];
    if (typeof v === "number") {
      if (!v) continue;
      add(key as keyof Adjust, v * k);
      copied.push(`${key} ${+(v * k).toFixed(2)}`);
    } else if (v !== undefined) {
      if (c.adjust[key] === undefined) {
        (adjust as Record<string, unknown>)[key] = key === "lut" ? { ...(v as { id: Id; intensity: number }), intensity: (v as { intensity: number }).intensity * k } : v;
        copied.push(key);
      } else left.push(`${key} (the clip has its own)`);
    }
  }
  let filter = c.filter;
  if (a.filter) {
    const f = a.filter;
    if (!filter) filter = { type: f.type, intensity: +(f.intensity * k).toFixed(3) };
    else if (filter.type === f.type) filter = { type: f.type, intensity: Math.min(1, +(filter.intensity + f.intensity * k).toFixed(3)) };
    else {
      for (const [key, v] of Object.entries(FILTERS[f.type]?.adjust ?? {}) as [keyof Adjust, number][]) add(key, v * f.intensity * k);
      left.push(`the ${f.type} look's toning (the clip has the ${filter.type} look)`);
    }
    copied.push(`filter ${f.type} ${+(f.intensity * k).toFixed(2)}`);
  }
  const effects = [...c.effects, ...a.effects.filter((e) => e.enabled).map((e) => ({ ...e, id: uid("fx") }))];
  if (a.effects.some((e) => e.enabled)) copied.push(...a.effects.filter((e) => e.enabled).map((e) => `effect ${e.type}`));
  if (Object.keys(a.keyframes ?? {}).length) left.push("its keyframes (the copy takes the grade where it rests)");
  return { clip: { ...c, adjust, ...(filter ? { filter } : {}), effects }, copied, left };
}
