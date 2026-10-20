// The pro grade's math and data rules (ADR-020): HSL secondaries, color
// wheels, how a clip's grade resolves at a frame, how stored grades are
// cleaned, and a CPU reference of the shader stage. The GLSL in
// src/engine/shaders.ts mirrors these functions line for line; tests pin
// the math here and the color drive compares the viewer against it.

import { applyCurves, cleanCurve, CURVE_CHANNELS, isIdentityCurves, type Curves } from "./curves";
import { paramAt } from "./keyframes";
import { applyLut, type Lut } from "./lut";
import { cleanColorize, colorizeTint } from "./colorize";
import type { Clip, Grade, HslBand, HslShift, Project, Wheel, WheelName } from "./project/types";

export const HSL_BANDS: HslBand[] = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta"];
/** Band centers, degrees of hue (red 0, yellow 60, green 120, ...). Uneven
 * like Lightroom's: the eye separates warm hues more finely. */
export const HSL_CENTERS = [0, 30, 60, 120, 180, 240, 280, 320];
/** Hue ±100 turns a range this many degrees. */
export const HSL_HUE_RANGE = 30;
export const WHEELS: WheelName[] = ["lift", "gamma", "gain", "offset"];
export const WHEEL_CHANNELS = ["r", "g", "b", "y"] as const;

type Rgb = [number, number, number];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// ---- HSL -------------------------------------------------------------------------

/** HSL with hue 0..1, as the shader computes it. */
export function rgbToHsl([r, g, b]: Rgb): Rgb {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d < 1e-6) return [0, 0, l];
  const s = d / Math.max(1 - Math.abs(2 * l - 1), 1e-6);
  let h: number;
  if (mx === r) h = ((((g - b) / d) % 6) + 6) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb([h, s, l]: Rgb): Rgb {
  const k = [0, 4, 2].map((o) => clamp01(Math.abs((((h * 6 + o) % 6) + 6) % 6 - 3) - 1));
  const c = s * (1 - Math.abs(2 * l - 1));
  return [l + c * (k[0] - 0.5), l + c * (k[1] - 0.5), l + c * (k[2] - 0.5)];
}

/** The two bands a hue sits between and how far toward the second (eased).
 * Every hue's weights sum to 1, so moving all eight sliders together is one
 * uniform change with no seams between ranges. */
export function bandsAt(hueDeg: number): { a: number; b: number; t: number } {
  const h = ((hueDeg % 360) + 360) % 360;
  let a = 0;
  for (let k = 0; k < 8; k++) if (h >= HSL_CENTERS[k]) a = k;
  const next = a === 7 ? 360 : HSL_CENTERS[a + 1];
  const t = smooth(0, 1, (h - HSL_CENTERS[a]) / (next - HSL_CENTERS[a]));
  return { a, b: (a + 1) % 8, t };
}

/** Apply HSL shifts given as 24 numbers (hue, saturation, lightness per band
 * in HSL_BANDS order, each -1..1). Near-gray pixels have no reliable hue, so
 * the effect fades out below 15% chroma. */
export function applyHsl(c: Rgb, shifts: ArrayLike<number>): Rgb {
  const chroma = Math.max(...c) - Math.min(...c);
  const m = smooth(0, 0.15, chroma);
  if (m <= 0) return c;
  const hsl = rgbToHsl(c);
  const { a, b, t } = bandsAt(hsl[0] * 360);
  const adj = [0, 1, 2].map((i) => (shifts[a * 3 + i] * (1 - t) + shifts[b * 3 + i] * t) * m);
  const h = (((hsl[0] + (adj[0] * HSL_HUE_RANGE) / 360) % 1) + 1) % 1;
  const s = clamp01(hsl[1] * (1 + adj[1]));
  const l = adj[2] >= 0 ? hsl[2] + (1 - hsl[2]) * adj[2] * 0.5 : hsl[2] * (1 + adj[2] * 0.5);
  return hslToRgb([h, s, l]);
}

/** Swatch color for a band (UI). */
export const bandColor = (band: HslBand) => `hsl(${HSL_CENTERS[HSL_BANDS.indexOf(band)]} 90% 55%)`;

// ---- wheels -----------------------------------------------------------------------

/** Per-channel wheel values, each (luminance + balance) / 100. */
export interface WheelParams {
  lift: Rgb;
  gamma: Rgb;
  gain: Rgb;
  offset: Rgb;
}

/** Resolve-style primaries (research §6.2), per channel x in 0..1:
 *   lift raises/lowers blacks with white pinned, gain scales with black
 *   pinned, gamma bends the midtones (a power), offset moves everything.
 * Full scale: lift ±0.5, gain ×0..2, gamma exponent 2^∓1, offset ±0.5. */
export function applyWheels(c: Rgb, w: WheelParams): Rgb {
  return [0, 1, 2].map((i) => {
    let x = c[i];
    x = x + w.lift[i] * 0.5 * (1 - x);
    x = x * (1 + w.gain[i]);
    x = Math.sign(x) * Math.abs(x) ** 2 ** -w.gamma[i];
    return x + w.offset[i] * 0.5;
  }) as Rgb;
}

// The wheel is a vectorscope: the puck's angle is the hue as the scope draws
// it (Rec.709 Cb right, Cr up), its distance from center the strength. The
// balance it sets has zero luma, so moving a puck never brightens the image;
// the luminance ring (y) does that.
const KR = 0.2126;
const KB = 0.0722;
const KG = 1 - KR - KB;

/** Puck (x right, y up, |p| <= 1) to balance r/g/b in -100..100 units. */
export function puckToBalance(x: number, y: number): { r: number; g: number; b: number } {
  const cb = x * 0.5;
  const cr = y * 0.5;
  const r = 2 * (1 - KR) * cr;
  const b = 2 * (1 - KB) * cb;
  const g = -(KR * r + KB * b) / KG;
  return { r: r * 100, g: g * 100, b: b * 100 };
}

/** Where the puck sits for a balance (its luma part ignored). */
export function balanceToPuck(r: number, g: number, b: number): [number, number] {
  const Y = KR * r + KG * g + KB * b;
  const cb = (b - Y) / (2 * (1 - KB));
  const cr = (r - Y) / (2 * (1 - KR));
  return [cb / 50, cr / 50];
}

/** Puck for "push toward this hue" (degrees, red 0) at amount 0..100. */
export function hueToPuck(hueDeg: number, amount: number): [number, number] {
  const [r, g, b] = hslToRgb([(((hueDeg % 360) + 360) % 360) / 360, 1, 0.5]);
  const [x, y] = balanceToPuck(r, g, b);
  const len = Math.hypot(x, y) || 1;
  return [(x / len) * (amount / 100), (y / len) * (amount / 100)];
}

/** The saturated color a wheel shows at an angle (degrees counterclockwise
 * from the +Cb axis), so the wheel and the vectorscope agree. */
export function wheelColor(angleDeg: number): Rgb {
  const a = (angleDeg * Math.PI) / 180;
  const { r, g, b } = puckToBalance(Math.cos(a), Math.sin(a));
  const v = [r, g, b];
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  return v.map((x) => (x - lo) / (hi - lo)) as Rgb;
}

// ---- resolve at a frame -------------------------------------------------------------

/** A clip's grade with every keyframe resolved, ready for the shader. Parts
 * that would change nothing are left out so the GPU skips them. */
export interface GradeParams {
  /** 24 numbers: hue, saturation, lightness per band, each -1..1. */
  hsl?: number[];
  wheels?: WheelParams;
  curves?: Curves;
  lut?: { src: string; intensity: number };
  /** Colorize (ADR-105): the color as straight RGB, the amount 0..1. */
  colorize?: { rgb: [number, number, number]; amount: number };
}

type Graded = Clip & { adjust: Grade };

const animates = (c: Clip, prefix: string) => !!c.keyframes && Object.keys(c.keyframes).some((k) => k.startsWith(prefix));

/** Resolve a clip's grade at frame r (relative to the clip start). */
export function resolveGrade(p: Project, clip: Graded, r: number): GradeParams | undefined {
  const g = clip.adjust;
  const out: GradeParams = {};
  if (g.hsl || animates(clip, "adjust.hsl.")) {
    const v = HSL_BANDS.flatMap((band) => (["hue", "saturation", "lightness"] as const).map((k) => paramAt(clip, `adjust.hsl.${band}.${k}`, r) / 100));
    if (v.some((x) => x !== 0)) out.hsl = v;
  }
  if (g.wheels || animates(clip, "adjust.wheels.")) {
    const w = {} as WheelParams;
    let any = false;
    for (const name of WHEELS) {
      const at = (ch: string) => paramAt(clip, `adjust.wheels.${name}.${ch}`, r);
      const y = at("y");
      w[name] = [(y + at("r")) / 100, (y + at("g")) / 100, (y + at("b")) / 100];
      any ||= w[name].some((x) => x !== 0);
    }
    if (any) out.wheels = w;
  }
  if (g.curves && !isIdentityCurves(g.curves)) out.curves = g.curves;
  if (g.lut) {
    const file = p.luts?.find((l) => l.id === g.lut!.id);
    const intensity = Math.max(0, Math.min(1, paramAt(clip, "adjust.lut.intensity", r)));
    if (file && intensity > 0) out.lut = { src: file.src, intensity };
  }
  if (g.colorize) {
    const tint = colorizeTint(g.colorize);
    const amount = Math.max(0, Math.min(1, paramAt(clip, "adjust.colorize.amount", r))) * (tint?.alpha ?? 0);
    if (tint && amount > 0) out.colorize = { rgb: tint.rgb, amount };
  }
  return out.hsl || out.wheels || out.curves || out.lut || out.colorize ? out : undefined;
}

/** CPU reference of the shader's grade stage: LUT, curves, wheels, HSL. */
export function gradeRgb(rgb: Rgb, g: GradeParams, lut?: Lut, curveTable?: Uint8Array): Rgb {
  let c = rgb.map(clamp01) as Rgb;
  if (g.lut && lut) {
    const o = applyLut(lut, c);
    c = c.map((v, i) => v + (o[i] - v) * g.lut!.intensity) as Rgb;
  }
  if (curveTable) c = applyCurves(curveTable, c.map(clamp01) as Rgb);
  if (g.wheels) c = applyWheels(c.map(clamp01) as Rgb, g.wheels);
  if (g.hsl) c = applyHsl(c.map(clamp01) as Rgb, g.hsl);
  return c.map(clamp01) as Rgb;
}

// ---- stored shape -------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Clean the grade fields of a stored `adjust` (untrusted JSON): unknown
 * bands and wheels dropped, numbers defaulted to 0, curves sorted and
 * clamped, empty parts removed. Returns a new object. */
export function cleanGrade<T extends Record<string, unknown>>(a: T): T {
  const out: Record<string, unknown> = { ...a };
  delete out.hsl;
  delete out.curves;
  delete out.wheels;
  delete out.lut;
  delete out.colorize;
  const colorize = cleanColorize(a.colorize);
  if (colorize) out.colorize = colorize;
  if (isObj(a.hsl)) {
    const hsl: Partial<Record<HslBand, HslShift>> = {};
    for (const band of HSL_BANDS) {
      const b = a.hsl[band];
      if (isObj(b)) hsl[band] = { hue: num(b.hue), saturation: num(b.saturation), lightness: num(b.lightness) };
    }
    if (Object.keys(hsl).length) out.hsl = hsl;
  }
  if (isObj(a.curves)) {
    const curves: Curves = {};
    for (const ch of CURVE_CHANNELS) {
      const pts = cleanCurve(a.curves[ch]);
      if (pts) curves[ch] = pts;
    }
    if (Object.keys(curves).length) out.curves = curves;
  }
  if (isObj(a.wheels)) {
    const wheels: Partial<Record<WheelName, Wheel>> = {};
    for (const name of WHEELS) {
      const w = a.wheels[name];
      if (isObj(w)) wheels[name] = { r: num(w.r), g: num(w.g), b: num(w.b), y: num(w.y) };
    }
    if (Object.keys(wheels).length) out.wheels = wheels;
  }
  if (isObj(a.lut) && typeof a.lut.id === "string") {
    out.lut = { id: a.lut.id, intensity: typeof a.lut.intensity === "number" ? clamp01(a.lut.intensity) : 1 };
  }
  return out as T;
}
