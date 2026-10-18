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
  /** The user chose the canvas (a Home preset, the Details ratio or size, an
   * agent's set_project). The first clip then keeps it rather than setting
   * it, as CapCut's ratio does once picked. Absent = adapts (Original). */
  canvasFixed?: boolean;
  fps: Rational;
  /** Audio mix rate, 48000 unless an agent asks otherwise. */
  sampleRate: number;
  /** Color behind every layer (CSS hex). */
  background: string;
  assets: Asset[];
  /** Flat virtual folders; source files stay in place. Absent = none. */
  mediaFolders?: string[];
  /** Display order, top to bottom. Visual tracks composite bottom-up, so the
   * top track is drawn last and covers the ones below it. */
  tracks: Track[];
  markers: Marker[];
  /** .cube LUTs clips can use (Grade.lut). The table stays in its file;
   * only the reference lives here. Absent = none imported. */
  luts?: LutFile[];
  /** Nested timelines that compound clips play (ADR-037). Absent = none. */
  compounds?: Compound[];
  /** The brand kit an ad keeps to (set_brand): colors by role, two fonts,
   * logos. Absent = none set; ad elements then use neutral defaults. */
  brand?: Brand;
  createdAt: number;
  updatedAt: number;
}

/** A brand kit (lib/brandKit.ts): what titles, buttons, badges and end
 * cards draw with, so every part of an ad agrees. Colors are CSS colors. */
export interface Brand {
  name?: string;
  colors: {
    /** Buttons, bars, the main brand color. */
    primary: string;
    /** A second brand color: panels, the lower third's second line. */
    secondary: string;
    /** Highlights: badges, marker sweeps, labels. */
    accent: string;
    /** Behind end cards and text boxes. */
    background: string;
    /** Text over footage and over the background. */
    text: string;
  };
  /** At most two families, as ad typography wants: headings and the rest. */
  fonts: { heading: string; body: string };
  /** Image assets: main (full color), light (for dark backgrounds), dark
   * (for light ones), icon (the mark alone). */
  logos?: { main?: Id; light?: Id; dark?: Id; icon?: Id };
  url?: string;
  tagline?: string;
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
  /** Library sticker this image was rendered from (src/lib/stickers.ts);
   * adding that sticker again reuses this asset. */
  sticker?: string;
  folder?: string;
  favorite?: boolean;
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
  /** -1 (left) .. 1 (right), added to each clip's pan; absent = center. */
  pan?: number;
  /** Solo: while any track is soloed, only soloed tracks sound (Premiere's
   * and Resolve's S). Absent = off. */
  solo?: boolean;
  /** Row height on the timeline; absent = the usual height for its kind. */
  height?: "small" | "large";
}

/** A nested timeline (CapCut's compound clip, Premiere's nested sequence):
 * tracks and markers like the project's own, at the project's frame rate
 * and canvas. Compound clips play it; editing it changes every one of them.
 * Stored flat in Project.compounds, so a compound inside a compound is just
 * a compound clip on one of these tracks (never, even indirectly, itself). */
export interface Compound {
  id: Id;
  name: string;
  /** Top to bottom, one main video track, as Project.tracks. */
  tracks: Track[];
  markers: Marker[];
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

export type ClipLabel = "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "purple" | "pink";

interface ClipBase {
  id: Id;
  /** Timeline frame where the clip begins. */
  start: number;
  /** Length on the timeline in frames, at least 1. */
  duration: number;
  name?: string;
  /** Kept on the timeline, skipped by preview and export. */
  disabled?: boolean;
  /** Clips sharing a group select, move, copy and delete together
   * (Premiere's Group). */
  group?: Id;
  /** A color label (Premiere's Label, Resolve's Clip Color), for sorting
   * an edit by eye; the timeline paints the clip with it. */
  labelColor?: ClipLabel;
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
  /** 1 = fit inside the canvas (contain). With `scaleY` set, the
   * horizontal scale only. */
  scale: number;
  /** Vertical scale when it differs from `scale` (CapCut's Uniform scale
   * off); absent means uniform. */
  scaleY?: number;
  /** Premiere's anchor point: the point of the picture, as fractions of its
   * own width and height from its center, that sits at the position and
   * that scale and rotation turn about. Absent: the center. */
  anchorX?: number;
  anchorY?: number;
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
  /** Text clips: play it by each letter, word or line instead of the whole
   * title (lib/kinetic.ts). Absent: the animation's own (whole, unless it
   * is a typewriter-like preset). */
  unit?: "letter" | "word" | "line";
  /** Per unit: 0 moves every unit together, 1 one after another. Absent:
   * the preset's, else 0.5. */
  stagger?: number;
  /** Per unit: which moves first. Absent: forward (a typewriter's out:
   * backward). */
  order?: "forward" | "backward" | "center" | "random";
}

export interface Mask {
  /** heart and star came later (ADR-049): readers that predate them draw
   * no mask for them. */
  shape: "linear" | "mirror" | "circle" | "rectangle" | "heart" | "star";
  /** Center, as an offset from the layer center in layer fractions. */
  x: number;
  y: number;
  /** Size along the mask's own axes, as fractions of the layer's width and
   * height. The shape turns rigidly on the layer (ADR-049). */
  width: number;
  height: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** 0..1 softness of the edge. */
  feather: number;
  invert: boolean;
  /** Rectangle only: round corners, 0 square to 1 a radius of half the
   * shorter side. Absent = 0. */
  radius?: number;
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

/** CapCut's Remove background (ADR-032, ADR-033): a matte a segmentation
 * model made once on this machine, multiplied into the clip's alpha. The
 * matte is a file beside the media, not data in the project, and can be
 * made again from the asset at any time. */
export interface Cutout {
  /** Off keeps the matte, so turning it back on is instant. */
  enabled: boolean;
  /** The matte: a grayscale video (luma = alpha) stored like imported
   * media, an app-data path on desktop or an OPFS key on the web. */
  src: string;
  /** Source seconds the matte covers; its time 0 is `from`. */
  from: number;
  to: number;
  /** The model that made it (a Hugging Face id). */
  model: string;
}

/** CapCut's Enhance voice, Premiere's Dynamics: the platform's
 * DynamicsCompressorNode, then a makeup gain. */
export interface Compressor {
  /** dBFS where compression starts, -60..0. */
  threshold: number;
  /** dB in over the threshold for each dB out, 1..20. */
  ratio: number;
  /** Soft knee, dB, 0..40. */
  knee: number;
  /** Seconds, 0..1. */
  attack: number;
  release: number;
  /** dB added on top of the node's own makeup gain (Web Audio raises the
   * output by about 0.6 of the full-scale reduction itself), 0..24. The
   * presets add none: more put their peaks past full scale. */
  makeup: number;
}

export interface Sound {
  /** Linear gain, 1 = 0 dB, up to 4 (+12 dB). */
  volume: number;
  /** -1 (left) .. 1 (right). */
  pan: number;
  /** Frames. */
  fadeIn: number;
  fadeOut: number;
  muted: boolean;
  /** Three-band equalizer, dB per band (-12..12); absent = flat. */
  eq?: { low?: number; mid?: number; high?: number };
  /** Dynamics after the EQ, before volume (lib/audio.ts); absent = none. */
  compressor?: Compressor;
  /** Premiere's Fill Left / Fill Right: one channel played on both (a lav
   * recorded on one side). Absent = the channels as recorded. */
  fill?: "left" | "right";
}

/** One point of a speed curve. */
export interface SpeedPoint {
  /** Frame relative to the clip's start. May be fractional, and may lie
   * outside the clip after a trim (like keyframes), so extending the clip
   * again brings the original ramp back. */
  f: number;
  /** Playback rate there, 0.1..10. */
  speed: number;
}

/** Variable speed (CapCut's Curve, Premiere's time remapping). Between
 * points the rate changes exponentially, a straight line on the graph's
 * log axis; before the first and after the last point it holds. */
export interface SpeedCurve {
  /** Preset the curve came from (lib/speed.ts PRESETS), for the UI. */
  preset?: string;
  /** Sorted by f, at least one. */
  points: SpeedPoint[];
}

export interface Timed {
  assetId: Id;
  /** Seconds into the source where playback begins: the earliest source
   * time it reads, or the latest when `reverse` is set. */
  in: number;
  /** 1 = normal. 0.5 = half speed (clip lasts twice as long). Ignored while
   * `speedCurve` is set. */
  speed: number;
  /** Replaces `speed` with a rate that varies over the clip. */
  speedCurve?: SpeedCurve;
  /** Play the source backward from `in`. */
  reverse?: boolean;
  /** CapCut's "Change pitch": absent (off) keeps the pitch at any speed;
   * on lets it rise and fall with the speed, like tape. */
  changePitch?: boolean;
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
  /** A second outline around the first (sticker style), `width` pixels at
   * 1080p beyond it. */
  stroke2?: { color: string; width: number };
  shadow?: { color: string; blur: number; x: number; y: number };
  /** A soft light around the letters (neon), behind them: `blur` pixels at
   * 1080p; `strength` 1..3 draws it that many times, brighter. */
  glow?: { color: string; blur: number; strength?: number };
  /** Fill with a linear gradient across the whole text instead of `color`:
   * `angle` in degrees, 0 left to right, 90 top to bottom. */
  gradient?: { from: string; to: string; angle: number };
  /** The color the Highlight and Underline animations draw in. Absent: a
   * warm yellow marker, an underline in the text color. */
  accent?: string;
  background?: { color: string; padding: number; radius: number };
  /** Text is laid out within this fraction of the canvas width. */
  maxWidth: number;
  /** Karaoke: the word being spoken (wordTimes) drawn in this color, as
   * CapCut's caption highlight does. Absent: no highlight. */
  highlight?: string;
  /** CapCut's Aa / AA / aa: shown in this case, the typed text kept as is.
   * Absent: as typed. Title capitalizes each word's first letter. */
  case?: "upper" | "lower" | "title";
}

/** Stabilization's per-frame corrections (src/lib/analysis/stabilize.ts). */
export interface Stabilize {
  level: "least-crop" | "recommended" | "most-stable";
  /** Source second of the first analyzed frame; analyzed frames per second. */
  from: number;
  rate: number;
  /** Moves onto the smooth camera path, fractions of the picture's width
   * and height, one per analyzed frame. */
  x: number[];
  y: number[];
  /** Scale that hides the edges the moves uncover. */
  zoom: number;
}

export type VideoClip = ClipBase &
  Visual &
  Sound &
  Timed & {
    type: "video";
    stabilize?: Stabilize;
    cutout?: Cutout;
    /** Premiere's Frame Blending: between two source frames (slow motion,
     * or a source rate unlike the project's), mix them by where the frame
     * falls instead of repeating one. */
    frameBlend?: boolean;
  };
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
    /** Frames from the clip's start at which each word of `text` (split on
     * whitespace) is spoken, from speech recognition. Ignored when the word
     * count no longer matches the text. */
    wordTimes?: number[];
  };
export type ColorClip = ClipBase & Visual & { type: "color"; color: string };
/** Applies its color, filter and effects to everything composited below it
 * (Premiere's adjustment layer, CapCut's effect/filter tracks). */
export type AdjustmentClip = ClipBase &
  Pick<Visual, "opacity" | "adjust" | "filter" | "effects"> & {
    type: "adjustment";
  };

/** Plays a compound (Project.compounds) the way a video clip plays a file:
 * `in` is seconds into the inner timeline, `speed` its rate. Its visual and
 * sound settings apply to the inner timeline's composited picture and mix.
 * Speed curves, reverse and freeze are not supported on it yet. */
export type CompoundClip = ClipBase & Visual & Sound & Omit<Timed, "assetId"> & { type: "compound"; compoundId: Id };

export type Clip =
  | VideoClip
  | AudioClip
  | ImageClip
  | TextClip
  | ColorClip
  | AdjustmentClip
  | CompoundClip;

export type ClipType = Clip["type"];
export type VisualClip = Exclude<Clip, AudioClip | AdjustmentClip>;
