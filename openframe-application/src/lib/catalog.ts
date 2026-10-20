// The catalogs: every animation, effect, transition and filter the editor
// knows, as data. The inspector builds its controls from these, the
// renderer looks up how to draw them, and agents discover them through
// list_catalog. Adding an entry here (plus its shader, for effects and
// transitions) is the whole job of adding one.

import { BLUR_MAX } from "./blur";
import { KINETIC_ANIMATIONS, type TextAnimation } from "./kinetic";
import type { Adjust, BlendMode, ClipLabel } from "./project/types";

export interface ParamDef {
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
  /** Shown after the number. */
  unit?: string;
  /** Names for the whole values min..max: a choice, not a slider. */
  options?: string[];
  /** Pixels at a 1080-tall frame (drawn larger on a taller one, as a
   * title's size): export_versions scales it with the picture it is on
   * (ADR-110). */
  pixels?: boolean;
}

// ---- animations --------------------------------------------------------------

/** What an animation can change about a layer while it plays. */
export interface AnimState {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  /** Extra blur radius in canvas pixels at 1080p. */
  blur: number;
}

export const IDENTITY_ANIM: AnimState = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blur: 0 };

export interface AnimationDef {
  label: string;
  /** In/out animations: the state the layer starts from (in) or ends at
   * (out); the layer travels between it and identity. */
  from?: Partial<AnimState>;
  /** Loop animations: the state at phase 0..1 of each cycle. */
  loop?: (phase: number) => Partial<AnimState>;
  /** Spring overshoot on the in-animation (pop). */
  overshoot?: boolean;
  /** Titles only (lib/kinetic.ts): played by each letter, word or line,
   * or drawn as a sweep. */
  text?: TextAnimation;
}

export const ANIMATIONS: Record<string, AnimationDef> = {
  fade: { label: "Fade", from: { opacity: 0 } },
  zoomIn: { label: "Zoom in", from: { scale: 0.6, opacity: 0 } },
  zoomOut: { label: "Zoom out", from: { scale: 1.5, opacity: 0 } },
  slideLeft: { label: "Slide left", from: { x: 0.6 } },
  slideRight: { label: "Slide right", from: { x: -0.6 } },
  slideUp: { label: "Slide up", from: { y: 0.6 } },
  slideDown: { label: "Slide down", from: { y: -0.6 } },
  rise: { label: "Rise", from: { y: 0.08, opacity: 0 } },
  drop: { label: "Drop", from: { y: -0.08, opacity: 0 } },
  pop: { label: "Pop", from: { scale: 0.2, opacity: 0 }, overshoot: true },
  spin: { label: "Spin", from: { rotation: -180, scale: 0.3, opacity: 0 } },
  tilt: { label: "Tilt", from: { rotation: -12, opacity: 0, y: 0.05 } },
  blurIn: { label: "Blur", from: { blur: 40, opacity: 0 } },
  // loops ("combo" in CapCut): continuous motion for the clip's whole life
  pulse: { label: "Pulse", loop: (t) => ({ scale: 1 + 0.06 * Math.sin(t * Math.PI * 2) }) },
  sway: { label: "Sway", loop: (t) => ({ rotation: 4 * Math.sin(t * Math.PI * 2) }) },
  float: { label: "Float", loop: (t) => ({ y: 0.015 * Math.sin(t * Math.PI * 2) }) },
  shake: { label: "Shake", loop: (t) => ({ x: 0.006 * Math.sin(t * Math.PI * 22), y: 0.006 * Math.cos(t * Math.PI * 17) }) },
  flicker: { label: "Flicker", loop: (t) => ({ opacity: 0.75 + 0.25 * Math.sign(Math.sin(t * Math.PI * 14)) }) },
  heartbeat: {
    label: "Heartbeat",
    loop: (t) => ({ scale: 1 + 0.08 * Math.max(0, Math.sin(t * Math.PI * 4)) ** 8 }),
  },
  // Kinetic typography: titles only, each letter, word or line on its own.
  ...KINETIC_ANIMATIONS,
};

export const isLoopAnimation = (type: string) => !!ANIMATIONS[type]?.loop;

/** Animations that only a title can play (typewriter, word pop...). */
export const isTextAnimation = (type: string) => !!ANIMATIONS[type]?.text;

// ---- clip labels -------------------------------------------------------------------

/** Clip label colors: muted, as Premiere's, so white clip names stay legible. */
export const CLIP_LABELS: Record<ClipLabel, { label: string; color: string }> = {
  red: { label: "Red", color: "#a83c3c" },
  orange: { label: "Orange", color: "#b0612a" },
  yellow: { label: "Yellow", color: "#9c8424" },
  green: { label: "Green", color: "#3f8a46" },
  cyan: { label: "Cyan", color: "#25838c" },
  blue: { label: "Blue", color: "#3a5fb0" },
  purple: { label: "Purple", color: "#7a4aa8" },
  pink: { label: "Pink", color: "#a8467f" },
};

// ---- effects ---------------------------------------------------------------------

export interface EffectDef {
  label: string;
  category: "Blur" | "Stylize" | "Distort" | "Color" | "Motion" | "Light";
  params: Record<string, ParamDef>;
}

const amount = (d = 50): ParamDef => ({ label: "Amount", min: 0, max: 100, default: d });

export const EFFECTS: Record<string, EffectDef> = {
  // Radius 0.6 px at 1080p per unit: 100 (60 px) was the old maximum and
  // draws as it always has; past it, up to 300 px, the blur runs on a
  // downsampled pyramid for big, soft glows (ADR-069).
  blur: { label: "Blur", category: "Blur", params: { amount: { ...amount(30), max: BLUR_MAX, pixels: true } } },
  zoomBlur: { label: "Zoom blur", category: "Blur", params: { amount: amount(40) } },
  pixelate: { label: "Pixelate", category: "Stylize", params: { size: { label: "Block size", min: 2, max: 120, default: 24, pixels: true } } },
  rgbSplit: { label: "RGB split", category: "Distort", params: { amount: amount(30), angle: { label: "Angle", min: 0, max: 360, default: 0 } } },
  glitch: { label: "Glitch", category: "Distort", params: { amount: amount(50), speed: { label: "Speed", min: 0, max: 100, default: 50 } } },
  vhs: { label: "VHS", category: "Stylize", params: { amount: amount(60) } },
  grain: { label: "Film grain", category: "Stylize", params: { amount: amount(35), size: { label: "Size", min: 1, max: 4, default: 1.5, step: 0.1, pixels: true } } },
  scanlines: { label: "Scanlines", category: "Stylize", params: { amount: amount(40), density: { label: "Density", min: 50, max: 800, default: 300 } } },
  invert: { label: "Invert", category: "Color", params: { amount: amount(100) } },
  posterize: { label: "Posterize", category: "Color", params: { levels: { label: "Levels", min: 2, max: 16, default: 5 } } },
  duotone: { label: "Duotone", category: "Color", params: { amount: amount(100), hue: { label: "Hue", min: 0, max: 360, default: 200 } } },
  mirror: { label: "Mirror", category: "Distort", params: { mode: { label: "Axis", min: 0, max: 2, default: 0, step: 1, options: ["Horizontal", "Vertical", "Both"] } } },
  kaleidoscope: { label: "Kaleidoscope", category: "Distort", params: { segments: { label: "Segments", min: 2, max: 16, default: 6, step: 1 } } },
  fisheye: { label: "Fisheye", category: "Distort", params: { amount: amount(40) } },
  shake: { label: "Camera shake", category: "Motion", params: { amount: amount(40), speed: { label: "Speed", min: 0, max: 100, default: 60 } } },
  zoomPulse: { label: "Zoom pulse", category: "Motion", params: { amount: amount(30), rate: { label: "Rate", unit: "/s", min: 0.25, max: 8, default: 2, step: 0.25 } } },
  // A steady zoom about the center (amount = % larger); keyframed, the
  // zoom punch of beat hits (lib/epic.ts).
  zoom: { label: "Zoom", category: "Motion", params: { amount: amount(20) } },
  // Strobing faster than 3 flashes a second can trigger seizures (WCAG
  // 2.3.1), so the default stays under it; the range is kept for slow
  // pulses' sake and the docs say why.
  flash: { label: "Strobe flash", category: "Light", params: { amount: amount(70), rate: { label: "Rate", unit: "/s", min: 0.5, max: 12, default: 2, step: 0.5 } } },
  // Threshold: the brightness (luma, 0..100) where the glow starts, fully
  // on 20 above it. 60 bloomed a launch's sky, towers and smoke into white
  // smears in the Claude film test (it set 88); at 80 the towers still
  // streaked, at 85 only the exhaust glows (ADR-105). A stored effect keeps
  // the threshold it was added with.
  glow: { label: "Glow", category: "Light", params: { amount: amount(50), threshold: { label: "Threshold", min: 0, max: 100, default: 85 } } },
  lightLeak: { label: "Light leak", category: "Light", params: { amount: amount(55), speed: { label: "Speed", min: 0, max: 100, default: 30 } } },
  // CapCut's Reduce image noise: smooths grain and sensor noise but not
  // edges (a bilateral filter), so detail survives.
  denoise: { label: "Reduce image noise", category: "Blur", params: { amount: amount(50) } },
  motionBlur: { label: "Motion blur", category: "Blur", params: { amount: { ...amount(30), pixels: true }, angle: { label: "Angle", unit: "°", min: 0, max: 180, default: 0 } } },
  sketch: { label: "Sketch", category: "Stylize", params: { amount: amount(50), mix: { label: "Mix", unit: "%", min: 0, max: 100, default: 100 } } },
  halftone: { label: "Halftone", category: "Stylize", params: { size: { label: "Dot size", min: 3, max: 40, default: 10, pixels: true } } },
  // Cinematic bars: black bands that letterbox the picture to a ratio
  // (pillarbox on a wider canvas); amount slides them in, 0 to 100.
  letterbox: { label: "Letterbox", category: "Stylize", params: { ratio: { label: "Ratio", unit: ":1", min: 1, max: 4, default: 2.39, step: 0.01 }, amount: amount(100) } },
  // Premiere 26.3's Magnify: a round lens over part of the picture, for
  // tutorials and screen recordings. Center from the top left, size as a
  // share of the frame's height; keyframe the center to follow a pointer.
  magnify: {
    label: "Magnify",
    category: "Distort",
    params: {
      x: { label: "Center X", unit: "%", min: 0, max: 100, default: 50 },
      y: { label: "Center Y", unit: "%", min: 0, max: 100, default: 50 },
      size: { label: "Size", unit: "%", min: 5, max: 100, default: 35 },
      zoom: { label: "Zoom", unit: "%", min: 100, max: 400, default: 200 },
      feather: { label: "Feather", unit: "%", min: 0, max: 100, default: 8 },
    },
  },
};

export function effectDefaults(type: string): Record<string, number> {
  const def = EFFECTS[type];
  if (!def) return {};
  return Object.fromEntries(Object.entries(def.params).map(([k, p]) => [k, p.default]));
}

// ---- transitions -------------------------------------------------------------

export interface TransitionDef {
  label: string;
  category: "Basic" | "Wipe" | "Motion" | "Stylized";
}

export const TRANSITIONS: Record<string, TransitionDef> = {
  dissolve: { label: "Cross dissolve", category: "Basic" },
  dipBlack: { label: "Dip to black", category: "Basic" },
  dipWhite: { label: "Dip to white", category: "Basic" },
  wipeLeft: { label: "Wipe left", category: "Wipe" },
  wipeRight: { label: "Wipe right", category: "Wipe" },
  wipeUp: { label: "Wipe up", category: "Wipe" },
  wipeDown: { label: "Wipe down", category: "Wipe" },
  circleOpen: { label: "Circle open", category: "Wipe" },
  clockWipe: { label: "Clock wipe", category: "Wipe" },
  slideLeft: { label: "Slide left", category: "Motion" },
  slideRight: { label: "Slide right", category: "Motion" },
  pushLeft: { label: "Push left", category: "Motion" },
  pushUp: { label: "Push up", category: "Motion" },
  zoomIn: { label: "Zoom in", category: "Motion" },
  zoomOut: { label: "Zoom out", category: "Motion" },
  spin: { label: "Spin", category: "Motion" },
  blur: { label: "Blur", category: "Stylized" },
  pixelate: { label: "Pixelate", category: "Stylized" },
  glitch: { label: "Glitch", category: "Stylized" },
  flash: { label: "Flash", category: "Stylized" },
  // For epic edits: fast moves smeared with motion blur (lib/epic.ts).
  whipLeft: { label: "Whip pan left", category: "Motion" },
  whipRight: { label: "Whip pan right", category: "Motion" },
  zoomPunch: { label: "Zoom punch", category: "Motion" },
  spinBlur: { label: "Spin blur", category: "Motion" },
};

// ---- filters (looks) ---------------------------------------------------------

export interface FilterDef {
  label: string;
  category: "Natural" | "Film" | "Mood" | "Black & white";
  adjust: Partial<Adjust>;
  /** Split toning: colors pushed into shadows and highlights (0..1 rgb). */
  tone?: { shadows: [number, number, number]; highlights: [number, number, number]; amount: number };
}

export const FILTERS: Record<string, FilterDef> = {
  vivid: { label: "Vivid", category: "Natural", adjust: { saturation: 30, vibrance: 25, contrast: 12 } },
  bright: { label: "Bright", category: "Natural", adjust: { exposure: 18, shadows: 20, contrast: -5 } },
  warm: { label: "Warm", category: "Natural", adjust: { temperature: 35, tint: 4, saturation: 8 } },
  cool: { label: "Cool", category: "Natural", adjust: { temperature: -35, tint: -3 } },
  golden: { label: "Golden hour", category: "Natural", adjust: { temperature: 45, highlights: -10, saturation: 15, vignette: 20 } },
  teal: {
    label: "Teal & orange",
    category: "Film",
    adjust: { contrast: 18, saturation: 10 },
    tone: { shadows: [0.0, 0.45, 0.55], highlights: [1.0, 0.62, 0.3], amount: 0.35 },
  },
  film: { label: "Film stock", category: "Film", adjust: { contrast: 10, fade: 18, grain: 25, saturation: -10, temperature: 8 } },
  vintage: {
    label: "Vintage",
    category: "Film",
    adjust: { fade: 30, temperature: 25, saturation: -25, contrast: -8, grain: 20, vignette: 30 },
    tone: { shadows: [0.35, 0.25, 0.45], highlights: [1.0, 0.9, 0.65], amount: 0.25 },
  },
  matte: { label: "Matte", category: "Film", adjust: { fade: 35, contrast: -12, saturation: -8 } },
  cinematic: {
    label: "Cinematic",
    category: "Film",
    adjust: { contrast: 22, highlights: -18, shadows: -10, saturation: -6, vignette: 25 },
    tone: { shadows: [0.1, 0.3, 0.45], highlights: [1.0, 0.85, 0.6], amount: 0.22 },
  },
  moody: { label: "Moody", category: "Mood", adjust: { exposure: -12, contrast: 20, saturation: -28, vignette: 40, temperature: -10 } },
  dreamy: { label: "Dreamy", category: "Mood", adjust: { highlights: 20, contrast: -18, fade: 15, saturation: -10, tint: 8 } },
  neon: {
    label: "Neon nights",
    category: "Mood",
    adjust: { contrast: 25, saturation: 40, tint: 25 },
    tone: { shadows: [0.3, 0.0, 0.6], highlights: [0.0, 0.9, 1.0], amount: 0.3 },
  },
  forest: { label: "Forest", category: "Mood", adjust: { temperature: -8, tint: -18, saturation: 12, contrast: 8 } },
  mono: { label: "Mono", category: "Black & white", adjust: { saturation: -100 } },
  noir: { label: "Noir", category: "Black & white", adjust: { saturation: -100, contrast: 40, blacks: -20, vignette: 45 } },
  silver: { label: "Silver", category: "Black & white", adjust: { saturation: -100, fade: 25, highlights: 12, contrast: -6 } },
};

/** Every catalog name, for the list_catalog command and validation. */
export function catalogNames() {
  return {
    animations: Object.keys(ANIMATIONS),
    effects: Object.keys(EFFECTS),
    transitions: Object.keys(TRANSITIONS),
    filters: Object.keys(FILTERS),
  };
}

/** Blend modes, as the inspector's Blend list shows them. */
export const BLEND_MODES: [BlendMode, string][] = [
  ["normal", "Normal"], ["darken", "Darken"], ["multiply", "Multiply"], ["colorBurn", "Color burn"],
  ["lighten", "Lighten"], ["screen", "Screen"], ["colorDodge", "Color dodge"], ["add", "Add"],
  ["overlay", "Overlay"], ["softLight", "Soft light"], ["hardLight", "Hard light"],
  ["difference", "Difference"], ["exclusion", "Exclusion"],
];

/** Fonts every computer running the app can draw; installed and imported
 * fonts come on top of these. */
export const FONTS = ["Inter", "Segoe UI", "Arial", "Arial Black", "Helvetica", "Georgia", "Times New Roman", "Trebuchet MS", "Verdana", "Tahoma", "Impact", "Courier New", "Comic Sans MS"];
