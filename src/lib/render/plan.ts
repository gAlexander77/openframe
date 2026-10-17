// Frame planning: which layers are visible at a timeline frame, bottom to
// top, with every parameter resolved (keyframes, animations, filters,
// transitions). Pure, so the exact picture for any frame is testable without
// a GPU; the compositor only draws what this returns. Preview and export use
// the same plan, which is what makes export look like the preview.

import { ANIMATIONS, FILTERS, IDENTITY_ANIM, type AnimState } from "../catalog";
import { resolveGrade, type GradeParams } from "../grade";
import { ease, paramAt } from "../keyframes";
import { findCompound, getAsset, sourceTimeAt, timelineEnd } from "../project/ops";
import { correctionAt } from "../analysis/stabilize";
import { fittedSize } from "./size";
import { spokenWord } from "../captions";
import { frameAt, framesToSeconds } from "../time";
import type {
  Adjust,
  AdjustmentClip,
  BlendMode,
  ChromaKey,
  Clip,
  Crop,
  Id,
  Mask,
  Project,
  TextClip,
  Track,
  VisualClip,
} from "../project/types";

export type LayerSource =
  | {
      kind: "video";
      assetId: Id;
      /** seconds into the source */
      time: number;
      /** Successive frames walk backward through the source: the engine
       * decodes GOP windows forward and hands them out in reverse. */
      reverse?: true;
    }
  | { kind: "image"; assetId: Id }
  | { kind: "text"; clip: TextClip; word?: number }
  | { kind: "color"; color: string }
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
}

export type PlanItem =
  | { kind: "layer"; layer: Layer }
  | { kind: "transition"; type: string; progress: number; from: Layer; to: Layer }
  | {
      kind: "adjust";
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
      params: Object.fromEntries(Object.keys(e.params).map((k) => [k, paramAt(clip, `effects.${e.id}.${k}`, r)])),
    }));
}

/** The mask's numbers that animate (CapCut keys every mask parameter). */
const MASK_PARAMS = ["x", "y", "width", "height", "rotation", "feather", "radius"] as const;

/** The clip's mask at frame r, keyframes applied; the stored object when
 * nothing on it is animated. */
function resolveMask(clip: VisualClip, r: number): Mask | undefined {
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
  const inDef = clip.animIn && ANIMATIONS[clip.animIn.type];
  if (inDef?.from && r < clip.animIn!.duration) {
    const p = r / clip.animIn!.duration;
    apply(mixAnim(inDef.from, inDef.overshoot ? easeOutBack(p) : ease("easeOut", p)));
  }
  const outDef = clip.animOut && ANIMATIONS[clip.animOut.type];
  if (outDef?.from && r >= clip.duration - clip.animOut!.duration) {
    const p = (r - (clip.duration - clip.animOut!.duration)) / clip.animOut!.duration;
    apply(mixAnim(outDef.from, 1 - ease("easeIn", p)));
  }
  const loopDef = clip.animLoop && ANIMATIONS[clip.animLoop.type];
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
export function layerAt(p: Project, clip: VisualClip, f: number, prefix = "", depth = 0): Layer | null {
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
    const t = sourceTimeAt(clip, f, p.fps) + 0.25 / (asset?.fps || 60);
    const max = asset && asset.duration > 0 ? asset.duration - 1e-3 : Infinity;
    source = { kind: "video", assetId: clip.assetId, time: Math.min(Math.max(t, 0), max), ...(clip.reverse && !clip.freeze ? { reverse: true as const } : {}) };
  } else if (clip.type === "image") source = { kind: "image", assetId: clip.assetId };
  else if (clip.type === "text") {
    const word = clip.style.highlight ? spokenWord(clip.text, clip.wordTimes, r) : undefined;
    source = { kind: "text", clip, ...(word !== undefined ? { word } : {}) };
  }
  else if (clip.type === "color") source = { kind: "color", color: clip.color };
  else {
    // The nested timeline is a source like a file, sampled at whole frames
    // of the same rate; past its end (an inner edit shortened it) there is
    // nothing to show.
    const k = findCompound(p, clip.compoundId);
    const inner = Math.max(0, frameAt(sourceTimeAt(clip, f, p.fps), p.fps));
    const items = k && depth < MAX_DEPTH && inner < timelineEnd(k.tracks) ? planTracks(p, k.tracks, inner, `${prefix}${clip.id}/`, depth + 1) : [];
    source = { kind: "compound", compoundId: clip.compoundId, frame: inner, items };
  }

  const anim = animationAt(clip, r);
  const { adjust, tone } = resolveAdjust(clip, r);
  let x = paramAt(clip, "transform.x", r) + anim.x;
  let y = paramAt(clip, "transform.y", r) + anim.y;
  let scale = paramAt(clip, "transform.scale", r) * anim.scale;
  let scaleY = clip.transform.scaleY !== undefined ? paramAt(clip, "transform.scaleY", r) * anim.scale : undefined;
  const rotation = paramAt(clip, "transform.rotation", r) + anim.rotation;
  // Stabilization moves the picture onto the smooth camera path, in the
  // picture's own axes (so it turns and mirrors with it), zoomed to hide
  // the edges it uncovers.
  if (clip.type === "video" && clip.stabilize && source.kind === "video") {
    const a = getAsset(p, clip.assetId);
    if (a?.width && a.height) {
      const s = clip.stabilize;
      const c = correctionAt(s, source.time);
      const fit = Math.min(p.width / a.width, p.height / a.height);
      const lx = c.x * a.width * fit * scale * s.zoom * (clip.transform.flipX ? -1 : 1);
      const ly = c.y * a.height * fit * (scaleY ?? scale) * s.zoom * (clip.transform.flipY ? -1 : 1);
      const rad = (rotation * Math.PI) / 180;
      x += (Math.cos(rad) * lx - Math.sin(rad) * ly) / p.width;
      y += (Math.sin(rad) * lx + Math.cos(rad) * ly) / p.height;
      scale *= s.zoom;
      if (scaleY !== undefined) scaleY *= s.zoom;
    }
  }
  const cut = clip.type === "video" && clip.cutout?.enabled ? clip.cutout : undefined;
  // The anchor point sits at the position; the picture's center moves off
  // it by the anchor's offset, scaled, mirrored and turned with the picture.
  const ax = paramAt(clip, "transform.anchorX", r), ay = paramAt(clip, "transform.anchorY", r);
  if (ax || ay) {
    const sh = anchorShift(p, clip, { ax, ay, scale, scaleY, rotation });
    x += sh.dx;
    y += sh.dy;
  }
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
  };
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
  const base: Layer = { ...layer, clipId: `${layer.clipId}#canvas`, x: 0, y: 0, rotation: 0, flipX: false, flipY: false, opacity: 1, blend: "normal", mask: undefined, chromaKey: undefined, matte: undefined, effects: [], blur: 0 };
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
export const planFrame = (p: Project, f: number): PlanItem[] => planTracks(p, p.tracks, f, "", 0);

/** Every item of a plan, compound clips' nested items included (after the
 * layer that shows them), for code that must visit every source. */
export function* walkPlan(plan: PlanItem[]): Generator<PlanItem> {
  for (const item of plan) {
    yield item;
    const layers = item.kind === "layer" ? [item.layer] : item.kind === "transition" ? [item.from, item.to] : [];
    for (const l of layers) if (l.source.kind === "compound") yield* walkPlan(l.source.items);
  }
}

/** Every layer a plan draws, at any depth. */
export const planLayers = (plan: PlanItem[]): Layer[] =>
  [...walkPlan(plan)].flatMap((i) => (i.kind === "layer" ? [i.layer] : i.kind === "transition" ? [i.from, i.to] : []));

/** One timeline's tracks at frame f: the project's, or a compound's seen
 * through the compound clips in `prefix`. */
function planTracks(p: Project, tracks: Track[], f: number, prefix: string, depth: number): PlanItem[] {
  const items: PlanItem[] = [];
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
      if (b.start !== cut || a.disabled || b.disabled) continue;
      const w = transitionWindow(cut, tr.duration);
      if (f < w.from || f >= w.to) continue;
      const from = layerAt(p, a, f, prefix, depth);
      const to = layerAt(p, b, f, prefix, depth);
      if (from && to) {
        items.push({ kind: "transition", type: tr.type, progress: (f - w.from + 0.5) / tr.duration, from, to });
        handled = true;
      }
    }
    if (handled) continue;
    const clip = clips.find((c) => c.start <= f && f < c.start + c.duration);
    if (!clip || clip.disabled) continue;
    if (clip.type === "adjustment") {
      const r = f - clip.start;
      const a = clip as AdjustmentClip;
      const { adjust, tone } = resolveAdjust(a, r);
      items.push({
        kind: "adjust",
        clipId: prefix + a.id,
        opacity: paramAt(a, "opacity", r),
        adjust,
        tone,
        grade: resolveGrade(p, a, r),
        effects: resolveEffects(a, r),
        time: framesToSeconds(r, p.fps),
      });
    } else if (clip.type !== "audio") {
      const layer = layerAt(p, clip, f, prefix, depth);
      if (layer && layer.opacity > 0) {
        const fill = "canvas" in clip && clip.canvas ? canvasLayer(p, clip, layer) : null;
        if (fill) items.push({ kind: "layer", layer: fill });
        items.push({ kind: "layer", layer });
      }
    }
  }
  return items;
}
