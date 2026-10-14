// The project document: the single source of truth that the UI edits, the
// engine renders, undo snapshots, the autosave writes, and automation (agents,
// pipelines, the headless renderer) reads and writes as JSON. Documented for
// humans and agents in docs/Project format.md — change both together.
//
// Units: timeline positions are integer frames (ADR-004); source offsets are
// seconds; positions in the frame are fractions of the canvas, so a project
// survives an aspect-ratio change.

import type { Curves } from "../curves";
import type { Rational } from "../time";

export type { CurvePoints, Curves } from "../curves";

export type Id = string;

export interface Project {
  schema: 1;
  id: Id;
  name: string;
  /** Canvas size in pixels. */
  width: number;
  height: number;
  fps: Rational;
  /** Audio mix rate, 48000 unless an agent asks otherwise. */
  sampleRate: number;
  /** Color behind every layer (CSS hex). */
  background: string;
  assets: Asset[];
  /** Display order, top to bottom. Visual tracks composite bottom-up, so the
   * top track is drawn last and covers the ones below it. */
  tracks: Track[];
  markers: Marker[];
  /** .cube LUTs clips can use (Grade.lut). The table stays in its file;
   * only the reference lives here. Absent = none imported. */
  luts?: LutFile[];
  createdAt: number;
  updatedAt: number;
}

export type AssetKind = "video" | "audio" | "image";

export interface Asset {
  id: Id;
  kind: AssetKind;
  name: string;
  /** Where the bytes are: an absolute path on desktop, an OPFS file name on
   * the web, or an http(s) URL. */
  src: string;
  /** Edit-friendly copy (desktop: made by ffmpeg) when the webview cannot
   * decode the original. Preview and export read this when present. */
  proxy?: string;
  /** Seconds. Images report 0: they last as long as their clip. */
  duration: number;
  width?: number;
  height?: number;
  /** Average source frame rate; absent for audio and images. */
  fps?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Bytes on disk, for the media panel. */
  size?: number;
  videoCodec?: string;
  audioCodec?: string;
  /** Clockwise rotation from container metadata (phone footage). */
  rotation?: 0 | 90 | 180 | 270;
}

/** An imported .cube LUT. `src` is a platform location, like Asset.src. */
export interface LutFile {
  id: Id;
  name: string;
  src: string;
  kind: "1d" | "3d";
  /** Entries per axis (17, 33, 65 for 3D; up to 65536 for 1D). */
  size: number;
}

export type TrackKind = "video" | "audio";

export interface Track {
  id: Id;
  kind: TrackKind;
  name: string;
  /** The main track: magnetic (gapless) when the magnet is on, the way
   * CapCut's main track behaves. Exactly one video track carries it. */
  main?: boolean;
  /** Sorted by start, never overlapping. */
  clips: Clip[];
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  /** Linear gain, 1 = 0 dB. */
  volume: number;
}

export interface Marker {
  id: Id;
  frame: number;
  label: string;
  color: string;
}

// ---- Clips ---------------------------------------------------------------

export type Ease =
  | "linear"
  | "hold"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  /** Cubic bezier control points, as in CSS `cubic-bezier()`. */
  | [number, number, number, number];

export interface Keyframe {
  /** Frame relative to the clip's start. */
  f: number;
  v: number;
  /** Shape of the curve leaving this keyframe toward the next. */
  ease?: Ease;
}

interface ClipBase {
  id: Id;
  /** Timeline frame where the clip begins. */
  start: number;
  /** Length on the timeline in frames, at least 1. */
  duration: number;
  name?: string;
  /** Kept on the timeline, skipped by preview and export. */
  disabled?: boolean;
  /** Animated parameters by path ("transform.x", "opacity", "volume",
   * "adjust.exposure", "adjust.hsl.red.hue", "adjust.wheels.lift.y",
   * "adjust.lut.intensity", "effects.<effectId>.<param>"). A path with
   * keyframes ignores its static value. */
  keyframes?: Record<string, Keyframe[]>;
}

export interface Transform {
  /** Offset of the layer's center from the canvas center, as a fraction of
   * canvas width/height. 0,0 is centered. */
  x: number;
  y: number;
  /** 1 = fit inside the canvas (contain). */
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

export interface Crop {
  /** Fractions of the source trimmed from each edge. */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Color adjustments. All 0 = unchanged; ranges are -100..100 unless noted. */
export interface Adjust {
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  vibrance: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  /** -180..180 degrees. */
  hue: number;
  fade: number;
  /** 0..100 */
  sharpen: number;
  /** 0..100 */
  vignette: number;
  /** 0..100 */
  grain: number;
}

/** CapCut's eight HSL swatches, in hue order. */
export type HslBand = "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "purple" | "magenta";

/** One HSL range's correction, each -100..100 (0 = unchanged). Hue ±100
 * turns that range ±30° toward its neighbors; saturation -100 is gray. */
export interface HslShift {
  hue: number;
  saturation: number;
  lightness: number;
}

/** A Resolve-style color wheel, each -100..100 (0 = neutral): r/g/b are the
 * color balance the puck sets, y the luminance ring. */
export interface Wheel {
  r: number;
  g: number;
  b: number;
  y: number;
}

export type WheelName = "lift" | "gamma" | "gain" | "offset";

/** The pro grade layered on the Basic sliders, applied in Lumetri's order:
 * LUT, curves, wheels, HSL (ADR-020). Every part is optional and absent
 * means unchanged, so files from before it stay valid and small. */
export interface Grade {
  hsl?: Partial<Record<HslBand, HslShift>>;
  curves?: Curves;
  wheels?: Partial<Record<WheelName, Wheel>>;
  /** A LUT from Project.luts, mixed in at intensity 0..1. */
  lut?: { id: Id; intensity: number };
}

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "colorDodge"
  | "colorBurn"
  | "hardLight"
  | "softLight"
  | "difference"
  | "exclusion"
  | "add";

export interface Effect {
  id: Id;
  /** Key into the effect catalog (src/lib/effects.ts). */
  type: string;
  enabled: boolean;
  params: Record<string, number>;
}

export interface Transition {
  /** Key into the transition catalog. */
  type: string;
  /** Frames, centered on the cut. */
  duration: number;
}

export interface Animation {
  /** Key into the animation catalog (fadeIn, zoomIn, slideLeft, ...). */
  type: string;
  /** Frames. */
  duration: number;
}

export interface Mask {
  shape: "linear" | "mirror" | "circle" | "rectangle";
  /** Center, as an offset from the layer center in layer fractions. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** 0..1 softness of the edge. */
  feather: number;
  invert: boolean;
}

export interface ChromaKey {
  enabled: boolean;
  color: string;
  /** 0..1 how close a pixel must be to the key color to become transparent. */
  similarity: number;
  /** 0..1 edge softness. */
  smoothness: number;
  /** 0..1 key-color spill removal. */
  spill: number;
}

export interface Visual {
  transform: Transform;
  /** 0..1 */
  opacity: number;
  blend: BlendMode;
  crop: Crop;
  adjust: Adjust & Grade;
  /** A look from the filter catalog, mixed in at `intensity` (0..1). */
  filter?: { type: string; intensity: number };
  effects: Effect[];
  mask?: Mask;
  chromaKey?: ChromaKey;
  animIn?: Animation;
  animOut?: Animation;
  /** Repeats for the clip's whole length (CapCut's "combo"). */
  animLoop?: Animation;
  /** Transition into the next clip on the same track, which must be
   * adjacent. The left clip owns it. */
  transitionOut?: Transition;
  /** CapCut's "Canvas": what fills the frame around a clip that does not
   * cover it (a 16:9 shot in a 9:16 project). Blur draws the clip itself
   * scaled to cover and blurred; color draws a solid. */
  canvas?: CanvasFill;
}

export type CanvasFill = { type: "blur"; amount: number } | { type: "color"; color: string };

export interface Sound {
  /** Linear gain, 1 = 0 dB, up to 4 (+12 dB). */
  volume: number;
  /** -1 (left) .. 1 (right). */
  pan: number;
  /** Frames. */
  fadeIn: number;
  fadeOut: number;
  muted: boolean;
}

export interface Timed {
  assetId: Id;
  /** Seconds into the source where the clip begins. */
  in: number;
  /** 1 = normal. 0.5 = half speed (clip lasts twice as long). */
  speed: number;
  /** Hold the frame at `in` for the clip's whole length. */
  freeze?: boolean;
}

export interface TextStyle {
  font: string;
  /** Pixels at a 1080-pixel-tall canvas; scales with the canvas. */
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: "left" | "center" | "right";
  /** Multiple of size. */
  lineHeight: number;
  /** Pixels at 1080p. */
  letterSpacing: number;
  stroke?: { color: string; width: number };
  shadow?: { color: string; blur: number; x: number; y: number };
  background?: { color: string; padding: number; radius: number };
  /** Text is laid out within this fraction of the canvas width. */
  maxWidth: number;
}

export type VideoClip = ClipBase & Visual & Sound & Timed & { type: "video" };
export type AudioClip = ClipBase & Sound & Timed & { type: "audio" };
export type ImageClip = ClipBase & Visual & { type: "image"; assetId: Id };
export type TextClip = ClipBase &
  Visual & {
    type: "text";
    text: string;
    style: TextStyle;
    /** Captions are text clips that came from speech, kept separate so they
     * export as SRT/VTT and restyle together. */
    caption?: boolean;
  };
export type ColorClip = ClipBase & Visual & { type: "color"; color: string };
/** Applies its color, filter and effects to everything composited below it
 * (Premiere's adjustment layer, CapCut's effect/filter tracks). */
export type AdjustmentClip = ClipBase &
  Pick<Visual, "opacity" | "adjust" | "filter" | "effects"> & {
    type: "adjustment";
  };

export type Clip =
  | VideoClip
  | AudioClip
  | ImageClip
  | TextClip
  | ColorClip
  | AdjustmentClip;

export type ClipType = Clip["type"];
export type VisualClip = Exclude<Clip, AudioClip | AdjustmentClip>;
