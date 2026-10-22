import { copyEffectStack, editEffects, pasteEffectStack } from "./effectStack";
import { uid } from "./project/defaults";
import { findClip, updateClip } from "./project/ops";
import type { Clip, Keyframe, LutFile, Project, Insert } from "./project/types";
import { framesToSeconds, secondsToFrames, type Rational } from "./time";

export const ATTRIBUTE_GROUPS = ["transform", "color", "audio", "effects"] as const;
export type AttributeGroup = typeof ATTRIBUTE_GROUPS[number];
export const ATTRIBUTE_LABELS: Record<AttributeGroup, string> = { transform: "Transform, crop, opacity, shadow and border", color: "Color adjustments and filter", audio: "Volume, pan, mute, fades, EQ and compressor", effects: "Effects and effect animation" };
// A picture-in-picture's frame (its shadow and border) goes with where it
// sits, and a voice's compressor with its EQ (ADR-109): a look made once
// pastes onto the other insets or lines.
const fields = { transform: ["transform", "crop", "opacity", "blend", "shadow", "border"], color: ["adjust", "filter"], audio: ["volume", "pan", "muted", "fadeIn", "fadeOut", "fadeInCurve", "fadeOutCurve", "pitch", "voice", "mono", "saturation", "ringMod", "eq", "compressor", "inserts", "fill", "highpass", "lowpass", "echo", "reverb", "tapeStop"], effects: ["effects"] } as const;
export const supportsAttributes = (c: Clip, group: AttributeGroup) => fields[group][0] in c;
export interface AttributeClipboard { clip: Clip; fps: Rational; luts: LutFile[] }
export function copyAttributes(p: Project, id: string): AttributeClipboard {
  const clip = findClip(p, id)?.clip;
  if (!clip) throw new Error("Source clip no longer exists.");
  return structuredClone({ clip, fps: p.fps, luts: p.luts ?? [] });
}
const matches = (path: string, group: AttributeGroup) => fields[group].some((field) => path === field || path.startsWith(`${field}.`));

export function pasteAttributes(p: Project, ids: string[], copied: AttributeClipboard, groups: AttributeGroup[], replaceEffects = false): Project {
  if (!groups.length || !ids.length) return p;
  for (const group of groups) if (!ATTRIBUTE_GROUPS.includes(group) || !supportsAttributes(copied.clip, group)) throw new Error("The source does not have those attributes.");
  for (const id of ids) {
    const target = findClip(p, id);
    if (!target || target.track.locked) throw new Error("Select existing clips on unlocked tracks.");
    if (groups.some((group) => !supportsAttributes(target.clip, group))) throw new Error("Some targets cannot receive the selected attributes.");
  }
  let next = p;
  const source = structuredClone(copied.clip);
  if (groups.includes("color") && "adjust" in source && source.adjust.lut) {
    const lut = copied.luts.find((l) => l.id === source.adjust.lut!.id);
    if (!lut) throw new Error("The source LUT is missing. Relink/import it before copying color.");
    let targetLut = p.luts?.find((l) => l.src === lut.src && l.kind === lut.kind && l.size === lut.size);
    if (!targetLut) { targetLut = { ...lut, id: uid("lut") }; next = { ...next, luts: [...next.luts ?? [], targetLut] }; }
    source.adjust.lut.id = targetLut.id;
  }
  const nonEffects = groups.filter((g) => g !== "effects");
  for (const id of new Set(ids)) {
    const target = findClip(next, id)!.clip;
    const patch: Record<string, unknown> = {};
    for (const group of nonEffects) for (const field of fields[group]) patch[field] = structuredClone((source as unknown as Record<string, unknown>)[field]);
    if (Array.isArray(patch.inserts)) patch.inserts = (patch.inserts as Insert[]).map(i => ({ ...i, id: uid("insert") }));
    if (target.type === "compound") for (const field of ["pitch", "voice", "mono", "saturation", "ringMod"]) delete patch[field];
    if (groups.includes("audio")) for (const field of ["fadeIn", "fadeOut"]) patch[field] = Math.min(Math.floor(target.duration / 2), Math.max(0, secondsToFrames(framesToSeconds(patch[field] as number, copied.fps), p.fps)));
    const keyframes = Object.fromEntries(Object.entries(target.keyframes ?? {}).filter(([path]) => !nonEffects.some((g) => matches(path, g))));
    for (const [path, keys] of Object.entries(source.keyframes ?? {})) {
      if (!nonEffects.some((g) => matches(path, g))) continue;
      const byFrame = new Map<number, Keyframe>();
      for (const key of [...keys].sort((a, b) => a.f - b.f)) {
        const f = secondsToFrames(framesToSeconds(key.f, copied.fps), p.fps);
        byFrame.set(f, { ...structuredClone(key), f });
      }
      keyframes[path] = [...byFrame.values()];
    }
    next = updateClip(next, id, (c) => ({ ...c, ...patch, keyframes: Object.keys(keyframes).length ? keyframes : undefined }) as Clip);
  }
  if (groups.includes("effects")) {
    if (replaceEffects) for (const id of ids) next = editEffects(next, id, "clear");
    const sourceProject = { ...p, fps: copied.fps, tracks: [{ ...p.tracks[0], clips: [source] }] };
    next = pasteEffectStack(next, ids, copyEffectStack(sourceProject, source.id));
  }
  return next;
}
