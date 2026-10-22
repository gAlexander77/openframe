// Frame planning: which layers are visible at a timeline frame, bottom to
// top, with every parameter resolved (keyframes, animations, filters,
// transitions). Pure, so the exact picture for any frame is testable without
// a GPU; the compositor only draws what this returns. Preview and export use
// the same plan, which is what makes export look like the preview.

import { ANIMATIONS, effectDefaults, FILTERS, IDENTITY_ANIM, type AnimState } from "../catalog";
import { resolveGrade, type GradeParams } from "../grade";
import { ease, paramAt } from "../keyframes";
import { findCompound, getAsset, sourceTimeAt, timelineEnd } from "../project/ops";
import { correctionAt } from "../analysis/stabilize";
import { fittedSize, sourceSize } from "./size";
import { spokenWord } from "../captions";
import { isKinetic, kineticAt, unitOf, type KineticFrame } from "../kinetic";
import { frameAt, framesToSeconds } from "../time";
import { MOTION_SAMPLES, MOVING_TRANSITIONS, samplesFor, shutterOffsets, travel, type Placement } from "../motionBlur";
import { resolveShape, type ResolvedShape } from "../shapes";
import { resolveShadow } from "../shadow";
import { resolveBorder } from "../border";
import { styleKeyed, textStyleAt } from "../textAnim";
import { resolveTilt, type Tilt } from "../tilt";
import { matteClip, mattesAt } from "../trackMatte";
import { wiggleAt } from "../wiggle";
import type {
  Adjust,
  AdjustmentClip,
  BlendMode,
  Border,
  ChromaKey,
  Clip,
  Crop,
  DropShadow,
  EdgeMode,
  Id,
  Mask,
  MatteMode,
  Project,
  TextClip,
  Track,
  VisualClip,
} from "../project/types";

/** How a plan is drawn. The default is export quality. */
export interface PlanOptions {
  /** Most shutter samples a moving layer with motion blur gets
   * (ADR-058); 1 draws every layer once. Default MOTION_SAMPLES.full. */
  motionSamples?: number;
}

export type LayerSource =
  | {
      kind: "video";
      assetId: Id;
      /** seconds into the source */
      time: number;
      /** Successive frames walk backward through the source: the engine
       * decodes GOP windows forward and hands them out in reverse. */
      reverse?: true;
      /** Frame blending: the following source frame and its share, 0..1. */
      next?: { time: number; w: number };
    }
  | { kind: "image"; assetId: Id; time?: number }
  /** `kinetic`: the animations its letters, words or lines play now. */
  | { kind: "text"; clip: TextClip; word?: number; kinetic?: KineticFrame }
  | { kind: "color"; color: string }
  /** A shape layer (ADR-057): a color clip's shape at this frame, its
   * fill `color` unless the shape has a gradient. */
  | { kind: "shape"; color: string; shape: ResolvedShape }
  /** A compound clip's nested timeline at inner frame `frame`, planned like
   * the project's own: the compositor draws `items` into a canvas-sized
   * picture first, and that picture is this layer's source (ADR-037). */
  | { kind: "compound"; compoundId: Id; frame: number; items: PlanItem[] };

export interface Tone {
  shadows: [number, number, number];
  highlights: [number, number, number];
  amount: number;
}

export interface ResolvedEffect {
  type: string;
  params: Record<string, number>;
}

export interface Layer {
  /** The clip's id; inside a compound clip, prefixed with the path of
   * compound clips that show it ("outer/inner"), so a compound played
   * twice gets a decoder and a cache entry per appearance. */
  clipId: Id;
  source: LayerSource;
  x: number;
  y: number;
  scale: number;
  /** Vertical scale, when the clip's scale is not uniform. */
  scaleY?: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  blend: BlendMode;
  crop: Crop;
  adjust: Adjust;
  tone?: Tone;
  /** HSL, curves, wheels and LUT; absent when the clip has none. */
  grade?: GradeParams;
  effects: ResolvedEffect[];
  mask?: Mask;
  chromaKey?: ChromaKey;
  /** Remove background: the matte video and the time in it that matches
   * the source frame (ADR-033). */
  matte?: { src: string; time: number };
  /** Extra blur from an animation, canvas pixels at 1080p. */
  blur: number;
  /** Seconds since the clip started, for time-driven effects. */
  time: number;
  /** Motion blur (ADR-058): the placements to average over the shutter,
   * in order; absent when the layer holds still or blur is off. */
  motion?: Placement[];
  /** Mirrored or repeated copies past the picture's edges (ADR-059). */
  edge?: EdgeMode;
  /** Track matte (ADR-056): the matte clip's own layer at this frame
   * (null: it has no picture here) and how it cuts this one. */
  trackMatte?: { layer: Layer | null; mode: MatteMode };
  /** Drop shadow (ADR-070), keyframes applied; cast by the finished layer. */
  shadow?: DropShadow;
  /** Border (ADR-099), keyframes applied; drawn around the finished layer
   * before its shadow. */
  border?: Border;
  /** Perspective tilt (ADR-070), keyframes applied; absent when flat. */
  tilt?: Tilt;
}

export type PlanItem =
  | { kind: "layer"; layer: Layer }
  | {
      kind: "transition";
      type: string;
      progress: number;
      from: Layer;
      to: Layer;
      /** Motion blur on a transition that moves the pictures: average
       * `samples` progress values spread `spread` wide around progress. */
      motion?: { spread: number; samples: number };
    }
  | {
      kind: "adjust";
      mask?: Mask;
      clipId: Id;
      opacity: number;
      adjust: Adjust;
      tone?: Tone;
      grade?: GradeParams;
      effects: ResolvedEffect[];
      time: number;
    };

const ADJUST_KEYS: (keyof Adjust)[] = [
  "exposure", "brightness", "contrast", "saturation", "vibrance", "temperature", "tint",
  "highlights", "shadows", "whites", "blacks", "hue", "fade", "sharpen", "vignette", "grain",
];

function resolveAdjust(clip: Clip & { adjust: Adjust; filter?: { type: string; intensity: number } }, r: number) {
  const adjust = {} as Adjust;
  for (const k of ADJUST_KEYS) adjust[k] = paramAt(clip, `adjust.${k}`, r);
  let tone: Tone | undefined;
  const def = clip.filter && FILTERS[clip.filter.type];
  if (def) {
    const k = clip.filter!.intensity;
    for (const [key, v] of Object.entries(def.adjust) as [keyof Adjust, number][]) {
      adjust[key] = adjust[key] + v * k;
    }
    if (def.tone) tone = { ...def.tone, amount: def.tone.amount * k };
  }
  return { adjust, tone };
}

function resolveEffects(clip: Clip & { effects: { id: Id; type: string; enabled: boolean; params: Record<string, number> }[] }, r: number) {
  return clip.effects
    .filter((e) => e.enabled)
    .map((e) => ({
      type: e.type,
      // A parameter the effect was made without (a glow's radius, added
      // later: ADR-117) draws at its default, not at whatever the shader
      // was last given.
      params: { ...effectDefaults(e.type), ...Object.fromEntries(Object.keys(e.params).map((k) => [k, paramAt(clip, `effects.${e.id}.${k}`, r)])) },
    }));
}

/** The mask's numbers that animate (CapCut keys every mask parameter). */
const MASK_PARAMS = ["x", "y", "width", "height", "rotation", "feather", "radius"] as const;

/** The clip's mask at frame r, keyframes applied; the stored object when
 * nothing on it is animated. */
export function resolveMask(clip: VisualClip | AdjustmentClip, r: number): Mask | undefined {
  const m = clip.mask;
  if (!m || !MASK_PARAMS.some((k) => clip.keyframes?.[`mask.${k}`]?.length)) return m;
  const out = { ...m };
  for (const k of MASK_PARAMS) if (m[k] !== undefined || clip.keyframes?.[`mask.${k}`]?.length) out[k] = paramAt(clip, `mask.${k}`, r);
  return out;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mixAnim(from: Partial<AnimState>, t: number): AnimState {
  const s = { ...IDENTITY_ANIM, ...from };
  return {
    x: lerp(s.x, 0, t),
    y: lerp(s.y, 0, t),
    scale: lerp(s.scale, 1, t),
    rotation: lerp(s.rotation, 0, t),
    opacity: lerp(s.opacity, 1, t),
    blur: lerp(s.blur, 0, t),
  };
}

/** Overshooting ease for "pop": goes ~10% past the target, then settles. */
const easeOutBack = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;

/** Combined state of the clip's in, out and loop animations at frame r. */
export function animationAt(clip: VisualClip, r: number): AnimState {
  let s = { ...IDENTITY_ANIM };
  const apply = (o: AnimState) => {
    s = {
      x: s.x + o.x,
      y: s.y + o.y,
      scale: s.scale * o.scale,
      rotation: s.rotation + o.rotation,
      opacity: s.opacity * o.opacity,
      blur: s.blur + o.blur,
    };
  };
  // A title's per-letter, word or line animations are drawn by the text
  // rasterizer (layerAt's kinetic), not by moving the whole layer.
  const text = clip.type === "text";
  const inDef = clip.animIn && !(text && isKinetic(clip.animIn, ANIMATIONS)) ? ANIMATIONS[clip.animIn.type] : undefined;
  if (inDef?.from && r < clip.animIn!.duration) {
    const p = r / clip.animIn!.duration;
    apply(mixAnim(inDef.from, inDef.overshoot ? easeOutBack(p) : ease("easeOut", p)));
  }
  const outDef = clip.animOut && !(text && isKinetic(clip.animOut, ANIMATIONS)) ? ANIMATIONS[clip.animOut.type] : undefined;
  if (outDef?.from && r >= clip.duration - clip.animOut!.duration) {
    const p = (r - (clip.duration - clip.animOut!.duration)) / clip.animOut!.duration;
    apply(mixAnim(outDef.from, 1 - ease("easeIn", p)));
  }
  const loopDef = clip.animLoop && !(text && unitOf(clip.animLoop, ANIMATIONS)) ? ANIMATIONS[clip.animLoop.type] : undefined;
  if (loopDef?.loop) {
    const period = Math.max(1, clip.animLoop!.duration);
    const phase = (r % period) / period;
    apply({ ...IDENTITY_ANIM, ...loopDef.loop(phase) });
  }
  return s;
}

/** Compounds nest at most this deep. normalizeProject and the store refuse
 * cycles; this only bounds the work if one slipped through. */
const MAX_DEPTH = 16;

/** Resolve a visual clip at timeline frame f. `f` may lie outside the clip
 * (a transition borrows frames past its edges): parameters clamp to the
 * clip's range, and the source time keeps running (handles) — the decoder
 * holds the last/first frame when the source runs out. `prefix` is the
 * path of compound clips the clip is seen through ("" on the project's own
 * timeline). */
export function layerAt(p: Project, clip: VisualClip, f: number, prefix = "", depth = 0, opts: PlanOptions = {}): Layer | null {
  const r = Math.min(Math.max(f - clip.start, 0), clip.duration - 1);
  let source: LayerSource;
  if (clip.type === "video") {
    const asset = getAsset(p, clip.assetId);
    // Look up a quarter source-frame past the edge, never at the edge itself:
    // containers stamp frame 59 at 30208/15360 s, two ulps after 59/30, and
    // MKV rounds stamps to the millisecond, so an exact-edge lookup returns
    // the previous frame (found by the framecode drive). A quarter frame
    // clears both and still lands inside the intended frame at any speed,
    // which keeps 2x showing frames 0, 2, 4... as Premiere does.
    const raw = sourceTimeAt(clip, f, p.fps);
    let t = raw + 0.25 / (asset?.fps || 60);
    const max = asset && asset.duration > 0 ? asset.duration - 1e-3 : Infinity;
    // Frame blending: frame i, and i + 1 by the fraction past i. The look-up
    // then lands a quarter into frame i itself, since past three quarters the
    // usual lookahead would already reach i + 1.
    let next: { time: number; w: number } | undefined;
    if (clip.frameBlend && !clip.reverse && !clip.freeze && asset?.fps) {
      const pos = raw * asset.fps;
      const i = Math.floor(pos + 1e-6);
      const w = pos - i;
      if (w > 0.01 && w < 0.99 && (i + 1.25) / asset.fps < max) {
        t = (i + 0.25) / asset.fps;
        next = { time: (i + 1.25) / asset.fps, w: +w.toFixed(4) };
      }
    }
    source = { kind: "video", assetId: clip.assetId, time: Math.min(Math.max(t, 0), max), ...(clip.reverse && !clip.freeze ? { reverse: true as const } : {}), ...(next ? { next } : {}) };
  } else if (clip.type === "image") source = { kind: "image", assetId: clip.assetId, time: (clip.imageIn ?? 0) + framesToSeconds(f - clip.start, p.fps) };
  else if (clip.type === "text") {
    const word = clip.style.highlight ? spokenWord(clip.text, clip.wordTimes, r) : undefined;
    const kinetic = kineticAt(clip, r, ANIMATIONS);
    // Keyed size, spacing and color (ADR-071): the title as it is now.
    const style = textStyleAt(clip, r);
    source = { kind: "text", clip: style === clip.style ? clip : { ...clip, style }, ...(word !== undefined ? { word } : {}), ...(kinetic ? { kinetic } : {}) };
  }
  else if (clip.type === "color") {
    const shape = resolveShape(clip, r);
    source = shape ? { kind: "shape", color: clip.color, shape } : { kind: "color", color: clip.color };
  }
  else {
    // The nested timeline is a source like a file, sampled at whole frames
    // of the same rate; past its end (an inner edit shortened it) there is
    // nothing to show.
    const k = findCompound(p, clip.compoundId);
    const inner = Math.max(0, frameAt(sourceTimeAt(clip, f, p.fps), p.fps));
    const items = k && depth < MAX_DEPTH && inner < timelineEnd(k.tracks) ? planTracks(p, k.tracks, inner, `${prefix}${clip.id}/`, depth + 1, opts) : [];
    source = { kind: "compound", compoundId: clip.compoundId, frame: inner, items };
  }

  const { adjust, tone } = resolveAdjust(clip, r);
  const fps = p.fps.num / p.fps.den;
  // Stabilization's correction for this source frame, applied to every
  // shutter sample alike: it undoes the camera's shake, not a move.
  const stab = clip.type === "video" && clip.stabilize && source.kind === "video" ? { s: clip.stabilize, c: correctionAt(clip.stabilize, source.time), a: getAsset(p, clip.assetId) } : null;
  // A keyed title that is not centered: its width at rest, and which way
  // its growth goes.
  // Measured at whole frames (motion blur's samples share their frame's),
  // so a blurred title is not measured once per shutter sample.
  const grows = clip.type === "text" && clip.style.align !== "center" && styleKeyed(clip) ? { clip, rest: sourceSize(p, clip).w, side: clip.style.align === "left" ? 1 : -1, at: new Map<number, number>() } : null;
  /** The picture's placement at clip frame `rr` (fractional for motion
   * blur's samples): keyframes, animations, wiggle, stabilization, anchor. */
  const placeAt = (rr: number) => {
    const anim = animationAt(clip, rr);
    let x = paramAt(clip, "transform.x", rr) + anim.x + wiggleAt(clip, "x", rr, fps);
    let y = paramAt(clip, "transform.y", rr) + anim.y + wiggleAt(clip, "y", rr, fps);
    const ws = wiggleAt(clip, "scale", rr, fps);
    let scale = (paramAt(clip, "transform.scale", rr) + ws) * anim.scale;
    let scaleY = clip.transform.scaleY !== undefined ? (paramAt(clip, "transform.scaleY", rr) + ws) * anim.scale : undefined;
    const rotation = paramAt(clip, "transform.rotation", rr) + anim.rotation + wiggleAt(clip, "rotation", rr, fps);
    // Stabilization moves the picture onto the smooth camera path, in the
    // picture's own axes (so it turns and mirrors with it), zoomed to hide
    // the edges it uncovers.
    if (stab?.a?.width && stab.a.height) {
      const { s, c, a } = stab;
      const fit = Math.min(p.width / a.width!, p.height / a.height!);
      const lx = c.x * a.width! * fit * scale * s.zoom * (clip.transform.flipX ? -1 : 1);
      const ly = c.y * a.height! * fit * (scaleY ?? scale) * s.zoom * (clip.transform.flipY ? -1 : 1);
      const rad = (rotation * Math.PI) / 180;
      x += (Math.cos(rad) * lx - Math.sin(rad) * ly) / p.width;
      y += (Math.sin(rad) * lx + Math.cos(rad) * ly) / p.height;
      scale *= s.zoom;
      if (scaleY !== undefined) scaleY *= s.zoom;
    }
    // A keyed title grows from its aligned side (ADR-071): left-aligned type
    // keeps its left edge as it tracks out or grows, as After Effects'
    // does; centered type grows both ways.
    if (grows) {
      const fr = Math.round(rr);
      const now = grows.at.get(fr) ?? sourceSize(p, { ...grows.clip, style: textStyleAt(grows.clip, fr) }).w;
      grows.at.set(fr, now);
      const lx = ((now - grows.rest) / 2) * grows.side * scale * (clip.transform.flipX ? -1 : 1);
      const rad = (rotation * Math.PI) / 180;
      x += (Math.cos(rad) * lx) / p.width;
      y += (Math.sin(rad) * lx) / p.height;
    }
    // The anchor point sits at the position; the picture's center moves off
    // it by the anchor's offset, scaled, mirrored and turned with the picture.
    const ax = paramAt(clip, "transform.anchorX", rr), ay = paramAt(clip, "transform.anchorY", rr);
    if (ax || ay) {
      const sh = anchorShift(p, clip, { ax, ay, scale, scaleY, rotation });
      x += sh.dx;
      y += sh.dy;
    }
    return { anim, x, y, scale, scaleY, rotation };
  };
  const { anim, x, y, scale, scaleY, rotation } = placeAt(r);
  const motion = clip.motionBlur ? shutterPath(p, clip, r, clip.motionBlur.shutter, opts, placeAt) : undefined;
  const cut = clip.type === "video" && clip.cutout?.enabled ? clip.cutout : undefined;
  const shadow = resolveShadow(clip, r);
  const border = resolveBorder(clip, r);
  const tilt = resolveTilt(clip, r);
  return {
    clipId: prefix + clip.id,
    source,
    x,
    y,
    scale,
    ...(scaleY !== undefined ? { scaleY } : {}),
    rotation,
    flipX: clip.transform.flipX,
    flipY: clip.transform.flipY,
    opacity: Math.max(0, Math.min(1, paramAt(clip, "opacity", r) * anim.opacity)),
    blend: clip.blend,
    crop: clip.crop,
    adjust,
    tone,
    grade: resolveGrade(p, clip, r),
    effects: resolveEffects(clip, r),
    mask: resolveMask(clip, r),
    chromaKey: clip.chromaKey?.enabled ? clip.chromaKey : undefined,
    // Matte frames carry their source frame's timestamp minus `from`, so
    // the same lookup (quarter frame past the edge) lands on the same frame.
    // Past the matte (a clip trimmed longer since) the picture shows whole,
    // in preview and export alike, rather than a held matte that no longer
    // fits; the inspector offers Update (ADR-033).
    matte: cut && source.kind === "video" && source.time >= cut.from - 1e-3 && source.time < cut.to + 1e-3 ? { src: cut.src, time: source.time - cut.from } : undefined,
    blur: anim.blur,
    time: framesToSeconds(r, p.fps),
    ...(motion ? { motion } : {}),
    ...(clip.edge ? { edge: clip.edge } : {}),
    ...(shadow ? { shadow } : {}),
    ...(border ? { border } : {}),
    ...(tilt ? { tilt } : {}),
  };
}

/** Motion blur's placements over the shutter around clip frame `r`, or
 * undefined when the picture travels less than half a pixel (ADR-058).
 * The travel along five instants sets the sample count, about one per
 * two pixels, as After Effects adds samples to fast moves. */
function shutterPath(p: Project, clip: VisualClip, r: number, shutter: number, opts: PlanOptions, placeAt: (rr: number) => Placement): Placement[] | undefined {
  const most = opts.motionSamples ?? MOTION_SAMPLES.full;
  const open = Math.max(0, Math.min(720, shutter)) / 360;
  if (most <= 1 || open === 0) return undefined;
  const at = (dt: number): Placement => {
    const t = placeAt(Math.min(Math.max(r + dt, 0), clip.duration - 1));
    return { x: t.x, y: t.y, scale: t.scale, ...(t.scaleY !== undefined ? { scaleY: t.scaleY } : {}), rotation: t.rotation };
  };
  const { w, h } = fittedSize(p, clip);
  const n = samplesFor(travel([0, 1, 2, 3, 4].map((k) => at((k / 4 - 0.5) * open)), w, h, p.width, p.height), most);
  return n > 1 ? shutterOffsets(n, shutter).map(at) : undefined;
}

/** How far (canvas fractions) the picture's center sits from its position
 * for an anchor point: minus the anchor's offset from the center, scaled,
 * mirrored and rotated with the picture. */
export function anchorShift(
  p: Project,
  clip: VisualClip,
  t: { ax: number; ay: number; scale: number; scaleY?: number; rotation: number },
): { dx: number; dy: number } {
  if (!t.ax && !t.ay) return { dx: 0, dy: 0 };
  const { w, h } = fittedSize(p, clip);
  const lx = t.ax * w * t.scale * (clip.transform.flipX ? -1 : 1);
  const ly = t.ay * h * (t.scaleY ?? t.scale) * (clip.transform.flipY ? -1 : 1);
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return { dx: -(cos * lx - sin * ly) / p.width, dy: -(sin * lx + cos * ly) / p.height };
}

/** The fill drawn behind a clip that does not cover the canvas: the clip
 * itself scaled up to cover and blurred, or a solid color. Untransformed,
 * like CapCut's, so the fill stays still while the clip animates. */
export function canvasLayer(p: Project, clip: VisualClip, layer: Layer): Layer | null {
  const fill = clip.canvas;
  if (!fill) return null;
  const base: Layer = { ...layer, clipId: `${layer.clipId}#canvas`, x: 0, y: 0, rotation: 0, flipX: false, flipY: false, opacity: 1, blend: "normal", mask: undefined, chromaKey: undefined, matte: undefined, effects: [], blur: 0, shadow: undefined, border: undefined, tilt: undefined };
  if (fill.type === "color") return { ...base, source: { kind: "color", color: fill.color } };
  if (clip.type !== "video" && clip.type !== "image") return null;
  const a = getAsset(p, clip.assetId);
  if (!a?.width || !a.height) return null;
  // Scale that turns "fit" into "cover" for this source in this canvas.
  const fit = Math.min(p.width / a.width, p.height / a.height);
  const cover = Math.max(p.width / a.width, p.height / a.height);
  return {
    ...base,
    // Keep the clip's own source (and so its decode cursor's frame).
    clipId: layer.clipId,
    scale: (cover / fit) * 1.04,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    effects: [{ type: "blur", params: { amount: fill.amount } }],
  };
}

/** Transition window around a cut: `half` frames before, the rest after. */
export function transitionWindow(cut: number, duration: number) {
  const before = Math.floor(duration / 2);
  return { from: cut - before, to: cut - before + duration };
}

/** Everything to draw at frame f, bottom track first. */
export const planFrame = (p: Project, f: number, opts: PlanOptions = {}): PlanItem[] => planTracks(p, p.tracks, f, "", 0, opts);

/** Every item of a plan, compound clips' nested items included (after the
 * layer that shows them), for code that must visit every source. */
export function* walkPlan(plan: PlanItem[]): Generator<PlanItem> {
  for (const item of plan) {
    yield item;
    const layers = item.kind === "layer" ? [item.layer] : item.kind === "transition" ? [item.from, item.to] : [];
    for (const l of layers) {
      // A track matte's layer draws like any other, so its source loads too.
      if (l.trackMatte?.layer) yield* walkPlan([{ kind: "layer", layer: l.trackMatte.layer }]);
      if (l.source.kind === "compound") yield* walkPlan(l.source.items);
    }
  }
}

/** Every layer a plan draws, at any depth. */
export const planLayers = (plan: PlanItem[]): Layer[] =>
  [...walkPlan(plan)].flatMap((i) => (i.kind === "layer" ? [i.layer] : i.kind === "transition" ? [i.from, i.to] : []));

/** One timeline's tracks at frame f: the project's, or a compound's seen
 * through the compound clips in `prefix`. */
function planTracks(p: Project, tracks: Track[], f: number, prefix: string, depth: number, opts: PlanOptions): PlanItem[] {
  const items: PlanItem[] = [];
  // Track mattes (ADR-056): matte clips are not drawn; the clip each one
  // cuts carries the matte's layer.
  const mattes = mattesAt(tracks, f);
  const withMatte = (layer: Layer, clip: VisualClip, ti: number): Layer => {
    const m = clip.trackMatte && matteClip(tracks, ti, clip, f);
    if (m === undefined || !clip.trackMatte) return layer;
    return { ...layer, trackMatte: { layer: m ? layerAt(p, m, f, prefix, depth, opts) : null, mode: clip.trackMatte.mode } };
  };
  for (let ti = tracks.length - 1; ti >= 0; ti--) {
    const track = tracks[ti];
    if (track.kind !== "video" || track.hidden) continue;
    const clips = track.clips;
    let handled = false;
    // Transitions take precedence over the two clips they join.
    for (let i = 0; i < clips.length - 1 && !handled; i++) {
      const a = clips[i] as VisualClip;
      const tr = "transitionOut" in a ? a.transitionOut : undefined;
      if (!tr) continue;
      const b = clips[i + 1] as VisualClip;
      const cut = a.start + a.duration;
      if (b.start !== cut || a.disabled || b.disabled || mattes.has(a.id) || mattes.has(b.id)) continue;
      const w = transitionWindow(cut, tr.duration);
      if (f < w.from || f >= w.to) continue;
      const from = layerAt(p, a, f, prefix, depth, opts);
      const to = layerAt(p, b, f, prefix, depth, opts);
      if (from && to) {
        // A transition that moves the pictures blurs with them when either
        // side has motion blur on (ADR-058).
        const mb = a.motionBlur ?? b.motionBlur;
        const spread = mb ? Math.min(720, Math.max(0, mb.shutter)) / 360 / tr.duration : 0;
        const samples = spread && MOVING_TRANSITIONS.has(tr.type) ? samplesFor(spread * Math.max(p.width, p.height), opts.motionSamples ?? MOTION_SAMPLES.full) : 1;
        items.push({ kind: "transition", type: tr.type, progress: (f - w.from + 0.5) / tr.duration, from: withMatte(from, a, ti), to: withMatte(to, b, ti), ...(samples > 1 ? { motion: { spread, samples } } : {}) });
        handled = true;
      }
    }
    if (handled) continue;
    const clip = clips.find((c) => c.start <= f && f < c.start + c.duration);
    if (!clip || clip.disabled || mattes.has(clip.id)) continue;
    if (clip.type === "adjustment") {
      const r = f - clip.start;
      const a = clip as AdjustmentClip;
      const { adjust, tone } = resolveAdjust(a, r);
      items.push({
        kind: "adjust",
        mask: resolveMask(a, r),
        clipId: prefix + a.id,
        opacity: paramAt(a, "opacity", r),
        adjust,
        tone,
        grade: resolveGrade(p, a, r),
        effects: resolveEffects(a, r),
        time: framesToSeconds(r, p.fps),
      });
    } else if (clip.type !== "audio") {
      const layer = layerAt(p, clip, f, prefix, depth, opts);
      if (layer && layer.opacity > 0) {
        const fill = "canvas" in clip && clip.canvas ? canvasLayer(p, clip, layer) : null;
        if (fill) items.push({ kind: "layer", layer: fill });
        items.push({ kind: "layer", layer: withMatte(layer, clip, ti) });
      }
    }
  }
  return items;
}
