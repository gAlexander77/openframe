// Animated title styles (ADR-071): style.size, style.letterSpacing and
// style.color keyframe like any number, so a title can grow, track out or
// change color over time. The plan resolves them per frame and the text
// rasterizer draws the title again at each new value.
//
// A keyframe holds a number, so a keyed color holds its 0xRRGGBB value
// (#ff3366 is 16724838) and moves between keys channel by channel, in the
// key's ease. Alpha does not key: a keyed color is opaque (fade the title
// with opacity).

import { ease, paramAt } from "./keyframes";
import { parseColor } from "./shapes";
import type { Clip, Keyframe, TextClip, TextStyle } from "./project/types";

/** The style values that animate, as style.<name>. */
export const TEXT_STYLE_PARAMS = ["size", "letterSpacing", "color"] as const;

/** Keyframe paths whose values are colors (0xRRGGBB), not amounts. */
export const COLOR_PATHS: ReadonlySet<string> = new Set(["style.color"]);

/** A CSS color as a color key's number, 0xRRGGBB; undefined when it is
 * not a color. */
export function colorKey(css: string): number | undefined {
  const c = parseColor(css);
  if (!c) return undefined;
  const [r, g, b] = c.map((v) => Math.round(v * 255));
  return (r << 16) | (g << 8) | b;
}

/** A color key's number as #rrggbb (out-of-range numbers clamped). */
export function keyColor(v: number): string {
  const n = Math.min(0xffffff, Math.max(0, Math.round(Number.isFinite(v) ? v : 0)));
  return `#${n.toString(16).padStart(6, "0")}`;
}

const channels = (v: number) => {
  const n = Math.min(0xffffff, Math.max(0, Math.round(v)));
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** A keyed color at frame `f`: each channel eased from one key to the
 * next; held before the first key and after the last. */
export function colorAt(keys: Keyframe[], f: number): string {
  if (f <= keys[0].f) return keyColor(keys[0].v);
  const last = keys[keys.length - 1];
  if (f >= last.f) return keyColor(last.v);
  let i = 0;
  while (keys[i + 1].f <= f) i++;
  const a = keys[i], b = keys[i + 1];
  const t = ease(a.ease, (f - a.f) / (b.f - a.f));
  const [ca, cb] = [channels(a.v), channels(b.v)];
  const [r, g, bl] = ca.map((v, k) => Math.min(255, Math.max(0, Math.round(v + (cb[k] - v) * t))));
  return keyColor((r << 16) | (g << 8) | bl);
}

/** The title's style keys, if any. */
export const styleKeyed = (clip: Clip) => TEXT_STYLE_PARAMS.some((k) => !!clip.keyframes?.[`style.${k}`]?.length);

/** The title's style at clip frame `r`, keys applied; the stored style
 * itself when nothing on it is keyed, so an unanimated title rasterizes
 * once, as before. */
export function textStyleAt(clip: TextClip, r: number): TextStyle {
  // set_param on style.color once stored the key's kind of number (it
  // writes CSS since ADR-099, and the loader converts old ones): read it so.
  const raw = clip.style.color as unknown;
  if (!styleKeyed(clip)) return typeof raw === "number" ? { ...clip.style, color: keyColor(raw) } : clip.style;
  const keys = clip.keyframes!;
  const s = { ...clip.style, ...(typeof raw === "number" ? { color: keyColor(raw) } : {}) };
  // Hundredths of a pixel: smooth on screen, and a held value hits the
  // rasterizer's cache.
  const hundredths = (v: number) => Math.round(v * 100) / 100;
  if (keys["style.size"]?.length) s.size = Math.max(1, hundredths(paramAt(clip, "style.size", r)));
  if (keys["style.letterSpacing"]?.length) s.letterSpacing = hundredths(paramAt(clip, "style.letterSpacing", r));
  if (keys["style.color"]?.length) s.color = colorAt(keys["style.color"], r);
  return s;
}
