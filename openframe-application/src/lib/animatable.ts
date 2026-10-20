// Which parameter paths animate: the paths whose keyframes the renderer
// (render/plan.ts, shapes.ts, grade.ts, wiggle.ts) and the mixer (audio.ts,
// engine/soundFx.ts) read. add_keyframe and set_param with `at` check a path
// against this list, so a key on a path nothing reads is refused, naming
// what does animate, instead of being reported as keyframed while nothing
// moves (the launch film's style.letterSpacing, ADR-066). One table: a path
// the renderer learns to interpolate is one row here.

import { DEFAULT_ADJUST } from "./project/defaults";
import { HSL_BANDS, WHEELS } from "./grade";
import { SHADOW_PARAMS } from "./shadow";
import { BORDER_PARAMS } from "./border";
import { SHAPE_PARAMS } from "./shapes";
import { TILT_PARAMS } from "./tilt";
import { WIGGLE_TARGETS } from "./wiggle";
import type { Clip } from "./project/types";

interface Row {
  /** The path as a model reads it: `<a|b>` is one of the choices. */
  path: string;
  /** Which clips it animates on. */
  on: (c: Clip) => boolean;
  /** Why this clip's key would not show yet, and what turns it on. */
  needs?: (c: Clip) => string | null;
}

const any = (xs: readonly string[]) => `<${xs.join("|")}>`;
const visual = (c: Clip) => "transform" in c;
const graded = (c: Clip) => "adjust" in c;
const sound = (c: Clip) => "volume" in c;

const ROWS: Row[] = [
  { path: "transform.x", on: visual },
  { path: "transform.y", on: visual },
  { path: "transform.scale", on: visual },
  // The vertical scale is drawn only once the scale is not uniform.
  { path: "transform.scaleY", on: visual, needs: (c) => ("transform" in c && c.transform.scaleY === undefined ? "its scale is uniform: set_uniform_scale with uniform false first, or key transform.scale" : null) },
  { path: "transform.rotation", on: visual },
  { path: "transform.anchorX", on: visual },
  { path: "transform.anchorY", on: visual },
  // Perspective tilt (ADR-069 to ADR-071's render work).
  { path: `transform.${any(TILT_PARAMS)}`, on: visual },
  { path: `shadow.${any(SHADOW_PARAMS)}`, on: visual, needs: (c) => ("shadow" in c && c.shadow ? null : "it has no drop shadow: set_shadow first") },
  { path: `border.${any(BORDER_PARAMS)}`, on: visual, needs: (c) => ("border" in c && c.border ? null : "it has no border: set_border first") },
  { path: "opacity", on: (c) => "opacity" in c },
  { path: "volume", on: sound },
  { path: "pan", on: sound },
  { path: `adjust.${any(Object.keys(DEFAULT_ADJUST))}`, on: graded },
  { path: `adjust.hsl.${any(HSL_BANDS)}.<hue|saturation|lightness>`, on: graded },
  { path: `adjust.wheels.${any(WHEELS)}.<r|g|b|y>`, on: graded },
  { path: "adjust.lut.intensity", on: graded },
  { path: "adjust.colorize.amount", on: graded, needs: (c) => ("adjust" in c && c.adjust.colorize ? null : "it is not colorized: set_colorize first") },
  { path: "effects.<index|id|type>.<param>", on: (c) => "effects" in c },
  { path: "mask.<x|y|width|height|rotation|feather|radius>", on: visual, needs: (c) => ("mask" in c && c.mask ? null : "it has no mask: set_mask first") },
  { path: `shape.${any(SHAPE_PARAMS)}`, on: (c) => c.type === "color" && !!c.shape },
  { path: `wiggle.${any(WIGGLE_TARGETS)}.<amplitude|strength>`, on: visual },
  { path: "lowpass.cutoff", on: sound, needs: (c) => ("lowpass" in c && c.lowpass ? null : "it has no low-pass filter: set_audio_filter type lowpass first") },
  { path: "highpass.cutoff", on: sound, needs: (c) => ("highpass" in c && c.highpass ? null : "it has no high-pass filter: set_audio_filter type highpass first") },
  { path: "reverb.mix", on: sound, needs: (c) => ("reverb" in c && c.reverb ? null : "it has no reverb: set_reverb first") },
  { path: "echo.mix", on: sound, needs: (c) => ("echo" in c && c.echo ? null : "it has no echo: set_echo first") },
  // Titles: the type's size, tracking and color, drawn per frame once the
  // text renderer interpolates them (the 2026-10-18 render work).
  { path: "style.size", on: (c) => c.type === "text" },
  { path: "style.letterSpacing", on: (c) => c.type === "text" },
  { path: "style.color", on: (c) => c.type === "text" },
];

/** A row's path as a pattern: `<a|b>` one of the choices, `<index|id|type>`
 * and `<param>` any segment. */
const patterns = ROWS.map((r) => new RegExp(`^${r.path.replace(/\./g, "\\.").replace(/<([^>]+)>/g, (_, g: string) => (g === "param" || g === "index|id|type" ? "[^.]+" : `(?:${g})`))}$`));

/** Shape keys that only draw when the shape has the part they shape. */
function shapeNeeds(c: Clip, path: string): string | null {
  if (c.type !== "color" || !c.shape) return null;
  if (path === "shape.stroke.width" && !c.shape.stroke) return "the shape has no outline: set_shape stroke_width first";
  if (path === "shape.gradient.angle" && !c.shape.gradient) return "the shape has no gradient: set_shape gradient first";
  if (path === "shape.height" && c.shape.kind === "line") return "a line has no height: key shape.stroke.width for its thickness";
  return null;
}

/** The paths that animate on this clip, as a model reads them. */
export function animatablePaths(c: Clip): string[] {
  return ROWS.filter((r) => r.on(c)).map((r) => r.path);
}

/** Every path that animates on some clip, for the guide. */
export const ANIMATABLE_PATHS = ROWS.map((r) => r.path);

/**
 * Why a keyframe on `path` would not move anything on this clip, or null
 * when it animates. `path` is as stored (an effect's by its id; the
 * commands resolve effects.<index|type> first).
 */
export function keyframeProblem(c: Clip, path: string): string | null {
  const i = patterns.findIndex((re, j) => ROWS[j].on(c) && re.test(path));
  if (i < 0) {
    const known = patterns.some((re) => re.test(path));
    return `${path} does not animate on ${c.type} clips${known ? "" : " (nothing draws or plays a keyframe there)"}. Animatable on this clip: ${animatablePaths(c).join(", ") || "nothing"}`;
  }
  const why = ROWS[i].needs?.(c) ?? shapeNeeds(c, path);
  return why ? `${path} would not show on clip ${c.id} yet: ${why}` : null;
}
