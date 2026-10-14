// Frame planning: which layers are visible at a timeline frame, bottom to
// top, with every parameter resolved (keyframes, animations, filters,
// transitions). Pure, so the exact picture for any frame is testable without
// a GPU; the compositor only draws what this returns. Preview and export use
// the same plan, which is what makes export look like the preview.

import { ANIMATIONS, FILTERS, IDENTITY_ANIM, type AnimState } from "../catalog";
import { resolveGrade, type GradeParams } from "../grade";
import { ease, paramAt } from "../keyframes";
import { getAsset, sourceTimeAt } from "../project/ops";
import { framesToSeconds } from "../time";
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
  VisualClip,
} from "../project/types";

export type LayerSource =
  | { kind: "video"; assetId: Id; /** seconds into the source */ time: number }
  | { kind: "image"; assetId: Id }
  | { kind: "text"; clip: TextClip }
  | { kind: "color"; color: string };

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
  clipId: Id;
  source: LayerSource;
  x: number;
  y: number;
  scale: number;
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

/** Resolve a visual clip at timeline frame f. `f` may lie outside the clip
 * (a transition borrows frames past its edges): parameters clamp to the
 * clip's range, and the source time keeps running (handles) — the decoder
 * holds the last/first frame when the source runs out. */
export function layerAt(p: Project, clip: VisualClip, f: number): Layer | null {
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
    source = { kind: "video", assetId: clip.assetId, time: Math.min(Math.max(t, 0), max) };
  } else if (clip.type === "image") source = { kind: "image", assetId: clip.assetId };
  else if (clip.type === "text") source = { kind: "text", clip };
  else source = { kind: "color", color: clip.color };

  const anim = animationAt(clip, r);
  const { adjust, tone } = resolveAdjust(clip, r);
  return {
    clipId: clip.id,
    source,
    x: paramAt(clip, "transform.x", r) + anim.x,
    y: paramAt(clip, "transform.y", r) + anim.y,
    scale: paramAt(clip, "transform.scale", r) * anim.scale,
    rotation: paramAt(clip, "transform.rotation", r) + anim.rotation,
    flipX: clip.transform.flipX,
    flipY: clip.transform.flipY,
    opacity: Math.max(0, Math.min(1, paramAt(clip, "opacity", r) * anim.opacity)),
    blend: clip.blend,
    crop: clip.crop,
    adjust,
    tone,
    grade: resolveGrade(p, clip, r),
    effects: resolveEffects(clip, r),
    mask: clip.mask,
    chromaKey: clip.chromaKey?.enabled ? clip.chromaKey : undefined,
    blur: anim.blur,
    time: framesToSeconds(r, p.fps),
  };
}

/** The fill drawn behind a clip that does not cover the canvas: the clip
 * itself scaled up to cover and blurred, or a solid color. Untransformed,
 * like CapCut's, so the fill stays still while the clip animates. */
export function canvasLayer(p: Project, clip: VisualClip, layer: Layer): Layer | null {
  const fill = clip.canvas;
  if (!fill) return null;
  const base: Layer = { ...layer, clipId: `${clip.id}#canvas`, x: 0, y: 0, rotation: 0, flipX: false, flipY: false, opacity: 1, blend: "normal", mask: undefined, chromaKey: undefined, effects: [], blur: 0 };
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
    clipId: clip.id,
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
export function planFrame(p: Project, f: number): PlanItem[] {
  const items: PlanItem[] = [];
  for (let ti = p.tracks.length - 1; ti >= 0; ti--) {
    const track = p.tracks[ti];
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
      const from = layerAt(p, a, f);
      const to = layerAt(p, b, f);
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
        clipId: a.id,
        opacity: paramAt(a, "opacity", r),
        adjust,
        tone,
        grade: resolveGrade(p, a, r),
        effects: resolveEffects(a, r),
        time: framesToSeconds(r, p.fps),
      });
    } else if (clip.type !== "audio") {
      const layer = layerAt(p, clip, f);
      if (layer && layer.opacity > 0) {
        const fill = "canvas" in clip && clip.canvas ? canvasLayer(p, clip, layer) : null;
        if (fill) items.push({ kind: "layer", layer: fill });
        items.push({ kind: "layer", layer });
      }
    }
  }
  return items;
}
