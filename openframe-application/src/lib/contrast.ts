// What check_project measures instead of guessing (ADR-068, ADR-097): the
// contrast of a title against the rendered picture behind it, by WCAG 2.x's
// relative luminance, with what the title draws around its letters (a box,
// a shadow, an outline, a glow) taken into account, and how a music clip's
// sound ends. The app renders and decodes (automation.ts); these turn
// pixels and samples into numbers, so they are tested.

import { parseColor } from "./shapes";
import { fontWeight } from "./textLook";
import type { TextStyle } from "./project/types";

/** WCAG 2.x relative luminance of an sRGB color, channels 0..1. */
export function luminance([r, g, b]: readonly number[]): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two luminances, 1..21. */
export const contrastRatio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** A box of a picture, in its pixels: left, top, right, bottom. */
export interface PixelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Backdrop {
  /** The contrast most of the letters have, at least: the 10th percentile
   * of the ratio over the pixels behind them, so a few stray pixels (a
   * spark, a highlight) do not decide it but a bright half does. */
  ratio: number;
  /** The backdrop pixel with that ratio, channels 0..1, as the picture has
   * it (before the title's box, shadow or outline). */
  backdrop: [number, number, number];
}

/** A color, channels 0..1, alpha last. */
type Rgba = readonly number[];

/** What a title draws, as the contrast measure sees it: its fill (one
 * color, or a gradient's two ends), and what lies around its letters, from
 * the bottom up as the rasterizer draws it (engine/text.ts: the box, the
 * glow, the shadow under the outermost part, the second outline, the
 * outline), each a color and the share of the letters' edge it covers.
 * `opacity` is the clip's: the whole title is drawn that translucent. */
export interface TitleLook {
  fills: readonly Rgba[];
  around: { what: "box" | "glow" | "shadow" | "outline"; rgba: Rgba; cover: number }[];
  opacity: number;
}

const mix = (a: Rgba, b: Rgba, k: number) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k);

/** The contrast of the letters with what is around them over one backdrop
 * color: the title's layers mixed over it by how much they cover, the fill
 * over those, and both at the clip's opacity over the backdrop. */
export function letterContrast(look: TitleLook, backdrop: Rgba): number {
  let around: Rgba = backdrop;
  for (const l of look.around) around = mix(around, l.rgba, (l.rgba[3] ?? 1) * l.cover);
  const surround = mix(backdrop, around, look.opacity);
  let worst = Infinity;
  for (const f of look.fills) {
    const letters = mix(backdrop, mix(around, f, f[3] ?? 1), look.opacity);
    worst = Math.min(worst, contrastRatio(luminance(letters), luminance(surround)));
  }
  return worst;
}

/** The backdrop pixels of a `width`-wide RGBA picture inside `box`, at most
 * about 4000 of them on a grid, channels 0..1; empty when the box misses. */
export function boxPixels(rgba: ArrayLike<number>, width: number, box: PixelBox): [number, number, number][] {
  const height = Math.floor(rgba.length / 4 / width);
  const l = Math.max(0, Math.floor(box.left)), r = Math.min(width, Math.ceil(box.right));
  const t = Math.max(0, Math.floor(box.top)), b = Math.min(height, Math.ceil(box.bottom));
  if (r <= l || b <= t) return [];
  const step = Math.max(1, Math.floor(Math.sqrt(((r - l) * (b - t)) / 4000)));
  const px: [number, number, number][] = [];
  for (let y = t; y < b; y += step)
    for (let x = l; x < r; x += step) {
      const i = (y * width + x) * 4;
      px.push([rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255]);
    }
  return px;
}

/**
 * A title's contrast over backdrop pixels (boxPixels): the ratio at the
 * 10th percentile, worst first, so light text is judged by the bright part
 * of what is behind it and dark text by the dark part, and a few stray
 * pixels do not decide it. Null without pixels.
 */
export function measureLook(look: TitleLook, px: readonly (readonly number[])[]): Backdrop | null {
  if (!px.length) return null;
  const rated = px.map((rgb) => ({ ratio: letterContrast(look, rgb), rgb })).sort((a, b) => a.ratio - b.ratio);
  const at = rated[Math.floor(0.1 * (rated.length - 1) + 0.5)];
  return { ratio: +at.ratio.toFixed(2), backdrop: [at.rgb[0], at.rgb[1], at.rgb[2]] };
}

/**
 * The contrast of plain text colors (channels 0..1, alpha last; a gradient
 * gives both ends) with the RGBA pixels of a `width`-wide picture inside
 * `box`: measureLook with nothing around the letters.
 */
export function measureBackdrop(colors: readonly Rgba[], rgba: ArrayLike<number>, width: number, box: PixelBox): Backdrop | null {
  return measureLook({ fills: colors, around: [], opacity: 1 }, boxPixels(rgba, width, box));
}

// ---- what a title's look adds ----------------------------------------------------

/** The standard normal distribution function. */
function phi(z: number): number {
  // Abramowitz and Stegun 7.1.26, to 1.5e-7.
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + (z < 0 ? -erf : erf));
}

/** How thick a letter's strokes are, a share of the type size: about a
 * ninth for a regular weight, a seventh for bold. */
const stem = (weight: number) => 0.075 + (0.1 * (weight - 100)) / 800;

/** Where the eye compares the letters with what is around them: just past
 * their edge, a fiftieth of the type size (a pixel or two). */
const EDGE = 0.02;

/** An outline this share of the type size or wider rings every letter in
 * its own color: broadcast subtitles draw 2-3 px around 50-60 px type. */
const SOLID_OUTLINE = 0.04;

/** How much of the letters' edge a soft copy of them covers: a Gaussian
 * blur (canvas shadowBlur is twice its sigma) of strokes `t` thick, offset
 * `o` (all in type sizes), averaged over the side it leans to and the
 * side it leaves. */
function softCover(t: number, blur: number, o: number): number {
  const sigma = Math.max(1e-3, blur / 2);
  const at = (d: number) => Math.max(0, phi((d + t) / sigma) - phi(d / sigma));
  return (at(EDGE - o) + at(EDGE + o)) / 2;
}

/**
 * A title's look for the contrast measure, from its style: fill color or
 * gradient, then (bottom up) its box, glow, shadow and outlines with how
 * much of the letters' edge each covers, at the clip's opacity. Lengths
 * are style pixels (1080p) and only their ratio to the type size matters.
 */
export function titleLook(s: TextStyle, opacity = 1): TitleLook {
  const size = Math.max(1, s.size);
  const c = (css: string) => parseColor(css) ?? [1, 1, 1, 1];
  const fills = s.gradient ? [c(s.gradient.from), c(s.gradient.to)] : [c(s.color)];
  const outline = Math.max(0, s.stroke?.width ?? 0), outline2 = Math.max(0, s.stroke2?.width ?? 0);
  const t = stem(fontWeight(s));
  const around: TitleLook["around"] = [];
  if (s.background) around.push({ what: "box", rgba: c(s.background.color), cover: 1 });
  if (s.glow && s.glow.blur > 0) {
    const once = softCover(t + (2 * (outline + outline2)) / size, s.glow.blur / size, 0);
    const n = Math.max(1, Math.min(3, Math.round(s.glow.strength ?? 1)));
    const g = c(s.glow.color);
    // Drawn n times: what one pass leaves uncovered, n passes leave less of.
    around.push({ what: "glow", rgba: [g[0], g[1], g[2], 1], cover: 1 - (1 - (g[3] ?? 1) * once) ** n });
  }
  // The shadow is cast by the outermost part drawn (engine/text.ts).
  if (s.shadow) around.push({ what: "shadow", rgba: c(s.shadow.color), cover: softCover(t + (2 * (outline + outline2)) / size, s.shadow.blur / size, Math.hypot(s.shadow.x, s.shadow.y) / size) });
  if (outline2 > 0) around.push({ what: "outline", rgba: c(s.stroke2!.color), cover: Math.min(1, (outline + outline2) / (SOLID_OUTLINE * size)) });
  if (outline > 0) around.push({ what: "outline", rgba: c(s.stroke!.color), cover: Math.min(1, outline / (SOLID_OUTLINE * size)) });
  return { fills, around, opacity };
}

/** A fix for a title that measures low, as style changes to try and say:
 * a dark box behind light type (a light box behind dark type), or a
 * solid outline. */
export function contrastFixes(s: TextStyle): { say: string; style: TextStyle }[] {
  const fill = parseColor(s.gradient?.from ?? s.color) ?? [1, 1, 1, 1];
  const light = luminance(fill) >= 0.18;
  const box = light ? "#000000a6" : "#ffffffd9", ink = light ? "#000000" : "#ffffff";
  const pad = Math.max(8, Math.round(s.size * 0.25)), width = Math.max(2, Math.round(s.size * 0.05));
  return [
    { say: `style.background {color: "${box}", padding: ${pad}, radius: ${Math.round(pad / 2)}}`, style: { ...s, background: { color: box, padding: pad, radius: Math.round(pad / 2) } } },
    { say: `style.stroke {color: "${ink}", width: ${width}}`, style: { ...s, stroke: { color: ink, width } } },
  ];
}

/** A color, channels 0..1, as #rrggbb. */
export const hex = (rgb: readonly number[]) => `#${rgb.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;

export interface Tail {
  /** RMS level of the last tenth of a second, dBFS. */
  endDb: number;
  /** RMS level of the three seconds before the last one, dBFS. */
  bodyDb: number;
  /** The last second in quarters, dBFS, first to last: whether it falls
   * away (a fade in the audio) or holds (a cut). */
  lastSecond?: number[];
}

const db = (x: Float32Array, from: number, to: number) => {
  let e = 0;
  const a = Math.max(0, from), b = Math.min(x.length, to);
  for (let i = a; i < b; i++) e += x[i] * x[i];
  return b > a ? +(10 * Math.log10(e / (b - a) + 1e-12)).toFixed(1) : -120;
};

/** How loud a clip's sound is at its very end against just before: mono
 * samples at `rate` that end where the clip ends (four seconds or so). */
export function tailLevels(x: Float32Array, rate: number): Tail {
  const n = x.length, q = Math.round(rate / 4);
  return { endDb: db(x, n - Math.round(rate / 10), n), bodyDb: db(x, n - 4 * rate, n - rate), lastSecond: [4, 3, 2, 1].map((k) => db(x, n - k * q, n - (k - 1) * q)) };
}

/**
 * Does the sound end by itself, judged by its last second: silent at the
 * very end, or 18 dB or more under what came before (a fade, a last chord
 * ringing out), or falling away through the last second, each quarter no
 * louder than the one before, the last 8 dB under the first and the very
 * end 12 dB under the body (a fade written into the audio that the clip
 * ends a little early). A one-second linear fade's last quarter second is
 * only 17 dB down, which the old quarter-second rule called abrupt.
 */
export function endsByItself(t: Tail): boolean {
  if (t.endDb < -50 || t.endDb <= t.bodyDb - 18) return true;
  const s = t.lastSecond;
  if (!s || s.length < 2) return false;
  const falls = s.every((v, i) => i === 0 || v <= s[i - 1] + 1.5);
  return falls && s.at(-1)! <= s[0] - 8 && t.endDb <= t.bodyDb - 12;
}
