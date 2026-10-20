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
  /** Master linear gain, applied to preview and export. */
  masterVolume?: number;
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
  /** Timed image frames repeat for the length of the clip. */
  animated?: boolean;
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
  /** A voiceover line this file was spoken from on this machine
   * (add_voiceover, retake_voiceover, text to speech): review_voiceover
   * compares what it hears with `text`, retake_voiceover reads it again. */
  speech?: SpeechInfo;
  /** What this file's sound is, set by the tool that made it (a sound
   * effect, an ambience bed, a generated score); a spoken file is dialog
   * by its `speech`. Stems and placement go by it (lib/audioRoles.ts). */
  role?: TrackRole;
  /** The built-in sound this file was made from (lib/sfx.ts, an effect;
   * lib/ambience.ts, a bed with its seed): adding it again reuses it. */
  sound?: { id: string; seed?: number };
  /** The song's grid, given (set_music_grid) or known from making it
   * (generate_music): analyze_music, mark_beats and check_project read
   * the song through it. */
  musicGrid?: MusicGrid;
}

export interface SpeechInfo {
  /** The line as written, pause marks included ("Meet OpenFrame. [pause 0.4] It's free."). */
  text: string;
  /** What its caption shows, when it differs from the words. */
  caption?: string;
  /** A voice id, or a blend ("af_heart:60,af_bella:40"). */
  voice: string;
  speed: number;
  /** Words respelled for the voice ({"MCP": "M C P"}). */
  pronounce?: Record<string, string>;
  quality?: "best" | "draft";
  finish?: "natural" | "clean" | "raw";
  /** The pace the line is meant to have: slow (an end card's tagline) or
   * fast, so review_voiceover does not flag it for being so. */
  pace?: "slow" | "normal" | "fast";
  /** The words a second it was read to, [lowest, highest], as asked: a
   * band asked wins over the pace (lib/voicePace.ts, ADR-104). Takes
   * saved before readAs kept a kind's band here (bandSource reads them). */
  wps?: [number, number];
  /** The kind of read (narration, ad, social) whose band, moved for the
   * pace, it was read to when no band was asked; none: narration's. */
  readAs?: "narration" | "ad" | "social";
  /** The speed was chosen to land on that, not asked for: a retake with
   * new words chooses again. */
  speedChosen?: boolean;
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

/** What an audio track's sound is, as a stem (Premiere's and Resolve's
 * dialog, music and effects): dialog (a voice), music, effects (sound
 * effects) or ambience (natural sound beds, room tone). */
export type TrackRole = "dialog" | "music" | "effects" | "ambience";

export interface Track {
  color?: ClipLabel;
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
  /** Audio tracks: the stem it is (add_voiceover's dialog, add_sound_effect's
   * effects...), set by the tool that made it or update_track. Absent =
   * judged from its clips' files (lib/audioRoles.ts trackRole). */
  role?: TrackRole;
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
  /** A mark of a clip's media (a beat, a bar, a part or the drop of a
   * song: analyze_music, mark_beats, set_music_grid, generate_music): the
   * clip and the second of its file the marker stands on. It follows the
   * clip when the clip is moved, trimmed, split or sped up, or put in a
   * compound clip (through the compound clip that plays it), and goes when
   * nothing plays that second any more (lib/markers.ts followClips). */
  follows?: { clip: Id; at: number };
}

/** The parts a song's grid names. */
export type MusicPart = "intro" | "verse" | "build" | "drop" | "breakdown" | "outro";

/** A song's grid as someone who knows it gives it (a cue sheet, the
 * composer's notes), in its file's own seconds, 4/4: analysis reads the
 * song through it instead of guessing (set_music_grid, ADR-101). */
export interface MusicGrid {
  /** Beats a minute. */
  bpm: number;
  /** A bar's first beat. */
  firstDownbeat: number;
  /** The parts, each from its `at` to the next one's; a drop after another part is a drop. */
  sections?: { at: number; label: MusicPart }[];
}

// ---- Clips ---------------------------------------------------------------

export type Ease =
  | "linear"
  | "hold"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  /** Overshooting eases no bezier can draw (ADR-062): a damped spring
   * that settles on the next value, Penner's elastic and bounce. Readers
   * that predate them should treat an unknown name as linear. */
  | "spring"
  | "elastic"
  | "bounce"
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
  /** Perspective tilt (ADR-070), degrees: rotateX tips the top away,
   * rotateY turns the right side away (CSS's), seen from `perspective`
   * pixels at 1080p in front of the canvas center (absent 2000). Absent
   * = flat; readers that predate them draw the picture flat. */
  rotateX?: number;
  rotateY?: number;
  perspective?: number;
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
  /** Colorize (ADR-105): the picture's brightness in one color, before
   * the rest of its color settings. */
  colorize?: Colorize;
}

/** Premiere's Tint: white becomes `color`, black stays black, grays
 * become darker shades of it; mixed over the picture by `amount`, 0..1.
 * Keyframe adjust.colorize.amount. */
export interface Colorize {
  /** CSS color; its alpha multiplies `amount`. */
  color: string;
  amount: number;
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
  /** After Effects' track matte (ADR-056): this clip shows only where the
   * matte clip's picture is (alpha) or is bright (luma), or the reverse.
   * The matte clip is not drawn itself. Absent = no matte. */
  trackMatte?: TrackMatte;
  /** After Effects' motion blur (ADR-058): while the transform moves, the
   * picture is averaged over the shutter. Absent = off. */
  motionBlur?: MotionBlur;
  /** What fills the canvas around a picture that moved or shrank off it
   * (ADR-059): mirrored or repeated copies of it. Absent = nothing. */
  edge?: EdgeMode;
  /** After Effects' wiggle() on transform values (ADR-062): seeded smooth
   * noise added to x, y, rotation or scale. Absent = none. */
  wiggle?: Partial<Record<WiggleTarget, Wiggle>>;
  /** A drop shadow cast by the finished picture (ADR-070): after its
   * mask, matte and effects, so a rounded or compound window casts its own
   * shape. Absent = none. */
  shadow?: DropShadow;
  /** A border (stroke) around the finished picture (ADR-099): outside its
   * shape after its mask, matte and effects, so a rounded mask gets a
   * rounded border; drawn before the shadow, which it casts too. Absent =
   * none. */
  border?: Border;
}

/** A border around a picture. Keyframe border.width, border.opacity. */
export interface Border {
  /** CSS color; its alpha multiplies `opacity`. */
  color: string;
  /** Pixels at 1080p, outside the picture's edge, 0..200. */
  width: number;
  /** 0..1 */
  opacity: number;
}

/** A drop shadow. Keyframe shadow.blur, shadow.x, shadow.y, shadow.opacity. */
export interface DropShadow {
  /** CSS color; its alpha multiplies `opacity`. */
  color: string;
  /** Softness: twice the Gaussian's sigma, pixels at 1080p, 0..600 (as
   * CSS box-shadow's blur radius). */
  blur: number;
  /** How far the shadow falls, pixels at 1080p, x right and y down. */
  x: number;
  y: number;
  /** 0..1 */
  opacity: number;
}

export type CanvasFill = { type: "blur"; amount: number } | { type: "color"; color: string };

export type MatteMode = "alpha" | "alphaInverted" | "luma" | "lumaInverted";

export interface TrackMatte {
  /** The matte: absent = whatever clip is on the video track directly
   * above at each frame (survives cuts); a clip id = that clip, on any
   * video track of the same timeline. */
  clipId?: Id;
  mode: MatteMode;
}

export interface MotionBlur {
  /** Shutter angle in degrees, 1..720: 180 (After Effects' default)
   * blurs over half a frame, centered on it. */
  shutter: number;
}

export type EdgeMode = "mirror" | "repeat";

export type WiggleTarget = "x" | "y" | "rotation" | "scale";

/** One transform value's wiggle. Keyframe `wiggle.<target>.amplitude` or
 * `.strength` to ramp it. */
export interface Wiggle {
  /** Wiggles per second (Hz), 0.1..30. */
  frequency: number;
  /** Largest deviation, in the value's own units: canvas fractions for x
   * and y, degrees for rotation, scale factor for scale. */
  amplitude: number;
  /** Multiplies the amplitude, 0..1 (absent = 1). */
  strength?: number;
  /** Same seed, same motion; another seed, another path. */
  seed: number;
}

/** A shape layer (ADR-057): a color clip drawn as a rectangle, ellipse or
 * line instead of filling the canvas. Every number keyframes by path
 * (shape.width, shape.radius, shape.stroke.width, shape.draw,
 * shape.gradient.angle). */
export interface Shape {
  kind: "rectangle" | "ellipse" | "line";
  /** The box, as fractions of the canvas width and height. A line runs
   * across the width (turn it with transform.rotation); its height is
   * unused. */
  width: number;
  height: number;
  /** Rectangle corners: 0 square .. 1 a radius of half the shorter side
   * (a pill). Absent = 0. */
  radius?: number;
  /** false: outline only. Absent = filled (the clip's color or gradient).
   * Lines have no fill. */
  fill?: boolean;
  /** A two-color fill in place of the clip's color (a line's color, on a
   * line). Linear (kind absent or "linear"): `angle` in degrees, 0 runs
   * left to right, 90 top to bottom. Radial (ADR-069): `from` at the
   * center and `to` at `radius`, both elliptical with the box; x and y
   * move the center by fractions of the box's width and height from its
   * middle (absent 0), radius is a fraction of the box's half size (absent
   * 1: the box's sides). Readers that predate radial draw it linear. */
  gradient?: { from: string; to: string; angle: number; kind?: "linear" | "radial"; x?: number; y?: number; radius?: number };
  /** The outline (a line's thickness and color), centered on the path.
   * Width in pixels at a 1080-pixel-tall canvas. */
  stroke?: { color: string; width: number };
  /** Trim paths: the share of the outline (or line) drawn, 0..1, from its
   * start (a rectangle's and ellipse's top center, clockwise; a line's
   * left end). Absent = 1. Fills are not trimmed. */
  draw?: number;
  /** A soft edge (ADR-069): the edge fades out over this many pixels at
   * 1080p, centered on it, with a Gaussian's falloff, so a feathered
   * ellipse is a soft glow. Absent = 0, a crisp edge. */
  feather?: number;
}

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

/** A low-pass or high-pass filter on a clip's sound, 24 dB per octave
 * (lib/soundFx.ts, ADR-060). */
export interface AudioFilter {
  /** Hz, 20..20000. Keyframeable (lowpass.cutoff, highpass.cutoff); between
   * keys it moves on a log scale, the same octaves each second. */
  cutoff: number;
  /** Peak at the cutoff, dB, 0..24; 0 is a smooth slope. */
  resonance: number;
}

/** A room around a clip's sound: a convolution reverb whose impulse
 * response is made from these three numbers. */
export interface Reverb {
  /** 0..1: pre-delay (5 to 50 ms) and how slowly the reflections build. */
  size: number;
  /** Seconds for the tail to fall 60 dB (RT60), 0.1..10. */
  decay: number;
  /** Wet share at equal power, 0..1. Keyframeable (reverb.mix). */
  mix: number;
}

/** Repeats of a clip's sound. */
export interface Echo {
  /** Seconds between repeats, 0.01..2. */
  time: number;
  /** Each repeat's level against the one before, 0..0.9. */
  feedback: number;
  /** Wet share at equal power, 0..1. Keyframeable (echo.mix). */
  mix: number;
}

/** The sound slows to a stop, pitch falling with it, over the clip's last
 * `duration` seconds (0.05..10), as a turntable losing power. */
export interface TapeStop {
  duration: number;
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
  /** Sound design (ADR-060), each absent = off. The filters run after the
   * compressor, before the volume; echo and reverb after the volume, so
   * their tails ring past the clip's end. Video and audio clips only. */
  highpass?: AudioFilter;
  lowpass?: AudioFilter;
  echo?: Echo;
  reverb?: Reverb;
  tapeStop?: TapeStop;
  /** How duck_under_speech dipped this clip (music under a voice), kept
   * so a voice line that changes length dips it again the same way
   * (lib/analysis/duck.ts staleDucks, ADR-104). */
  duck?: DuckRecord;
}

/** What duck_under_speech was asked for a music clip, and the volume keys
 * it wrote. */
export interface DuckRecord {
  voiceAboveMusicLu?: number;
  minLineLu?: number;
  maxLineLu?: number;
  depth?: number;
  /** Ducked with every clip of its track in one call (track_id). */
  track?: boolean;
  /** A signature of the volume keys it wrote (duckSignature: their shape,
   * which a move, split or trim keeps): keys changed since, by hand, are
   * not dipped again over them. */
  keys: number;
  /** The timeline frame its first key was written at: keys elsewhere since
   * moved with their clip, away from the voice (staleDucks). */
  at?: number;
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

export interface TextRun {
  /** UTF-16 offsets, end exclusive, in the original text. */
  start: number;
  end: number;
  color?: string;
  gradient?: { from: string; to: string; angle: number };
  weight?: number;
  italic?: boolean;
  underline?: boolean;
  scale?: number;
}

export interface TextStyle {
  runs?: TextRun[];
  font: string;
  /** Pixels at a 1080-pixel-tall canvas; scales with the canvas.
   * style.size, style.letterSpacing and style.color animate (ADR-071). */
  size: number;
  /** CSS color. Keyed (style.color), its keyframes hold 0xRRGGBB numbers
   * (lib/textAnim.ts). */
  color: string;
  bold: boolean;
  /** Font weight, 100 (thin) to 900 (black). Absent: 700 when bold, else
   * 400; present, it wins over bold. */
  weight?: number;
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
export type AudioClip = ClipBase &
  Sound &
  Timed & {
    type: "audio";
    /** Seconds its sound crossfades into the next clip on its track, which
     * starts where it ends (set_crossfade, cut_music): at equal power,
     * ending at the cut, the next clip's sound rising over the seconds
     * before its start (lib/audio.ts soundOverlaps, ADR-104). Absent: a
     * butt cut, each side ramped over the 4 ms click guard. */
    crossfade?: number;
  };
export type ImageClip = ClipBase & Visual & { type: "image"; assetId: Id; imageIn?: number };
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
/** A solid; with `shape`, a shape layer whose fill is `color`. */
export type ColorClip = ClipBase & Visual & { type: "color"; color: string; shape?: Shape };
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
