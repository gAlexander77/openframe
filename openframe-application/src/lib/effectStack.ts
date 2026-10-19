import { EFFECTS, effectDefaults } from "./catalog";
import { findClip, updateClip } from "./project/ops";
import { uid } from "./project/defaults";
import { framesToSeconds, secondsToFrames, type Rational } from "./time";
import type { Clip, Effect, Id, Keyframe, Project } from "./project/types";

export type EffectClip = Clip & { effects: Effect[] };
export const EFFECT_ACTIONS = ["move_up", "move_down", "reset", "remove", "clear", "enable", "disable"] as const;
export type EffectAction = typeof EFFECT_ACTIONS[number];

export interface EffectClipboard {
  effects: Effect[];
  keyframes: Record<string, Keyframe[]>;
  fps: Rational;
}

/** A detached snapshot: later edits to the source must not change the copy. */
export function copyEffectStack(p: Project, clipId: Id): EffectClipboard {
  const clip = effectClip(p, clipId);
  const prefixes = clip.effects.map(e => `effects.${e.id}.`);
  return structuredClone({
    effects: clip.effects,
    keyframes: Object.fromEntries(Object.entries(clip.keyframes ?? {}).filter(([path]) => prefixes.some(prefix => path.startsWith(prefix)))),
    fps: p.fps,
  });
}

/** Append independent instances, keeping animation time in seconds across
 * projects. Keys beyond a shorter clip's end stay: they define interpolation
 * inside the clip too, just as they do after a trim. */
export function pasteEffectStack(p: Project, ids: Id[], copied: EffectClipboard): Project {
  const targets = [...new Set(ids)];
  for (const id of targets) {
    effectClip(p, id);
    if (findClip(p, id)!.track.locked) throw new Error("Unlock the track before pasting effects");
  }
  if (!copied.effects.length) return p;
  let next = p;
  for (const id of targets) {
    const clip = effectClip(next, id);
    const keyframes = { ...clip.keyframes };
    const added = copied.effects.map(fx => {
      const fresh = uid("fx"), prefix = `effects.${fx.id}.`;
      for (const [path, keys] of Object.entries(copied.keyframes)) {
        if (!path.startsWith(prefix)) continue;
        const byFrame = new Map<number, Keyframe>();
        for (const key of [...keys].sort((a, b) => a.f - b.f)) {
          const f = secondsToFrames(framesToSeconds(key.f, copied.fps), p.fps);
          byFrame.set(f, { ...structuredClone(key), f });
        }
        keyframes[`effects.${fresh}.${path.slice(prefix.length)}`] = [...byFrame.values()];
      }
      return { ...structuredClone(fx), id: fresh, params: { ...effectDefaults(fx.type), ...fx.params } };
    });
    next = updateClip(next, id, () => ({ ...clip, effects: [...clip.effects, ...added], keyframes: Object.keys(keyframes).length ? keyframes : undefined }));
  }
  return next;
}

export function effectClip(p: Project, id: Id): EffectClip {
  const loc = findClip(p, id);
  if (!loc) throw new Error(`No clip with id ${id}`);
  if (!("effects" in loc.clip)) throw new Error(`${loc.clip.type} clips take no video effects`);
  return loc.clip;
}

/** Only stack operations: transforms, grading and other keys stay untouched.
 * IDs survive moves; reset/remove discard only that effect's animation. */
export function editEffects(p: Project, clipId: Id, action: EffectAction, effectId?: Id): Project {
  const clip = effectClip(p, clipId);
  if (findClip(p, clipId)!.track.locked) throw new Error("Unlock the track before editing effects");
  const index = effectId === undefined ? -1 : clip.effects.findIndex(e => e.id === effectId);
  if (effectId !== undefined && index < 0) throw new Error(`No effect with id ${effectId}`);
  if (!["clear", "enable", "disable"].includes(action) && index < 0) throw new Error(`${action} needs an effect_id`);
  let effects = clip.effects;
  let keyframes = clip.keyframes;
  if (action === "move_up" || action === "move_down") {
    const to = index + (action === "move_up" ? -1 : 1);
    if (to < 0 || to >= effects.length) return p;
    effects = [...effects];
    [effects[index], effects[to]] = [effects[to], effects[index]];
  } else if (action === "enable" || action === "disable") {
    const enabled = action === "enable";
    if (!effects.some(e => (effectId === undefined || e.id === effectId) && e.enabled !== enabled)) return p;
    effects = effects.map(e => effectId === undefined || e.id === effectId ? { ...e, enabled } : e);
  } else {
    if (action === "reset" && !EFFECTS[effects[index].type]) throw new Error("This effect has no known defaults");
    const prefix = action === "clear" ? "effects." : `effects.${effectId}.`;
    const kept = Object.entries(keyframes ?? {}).filter(([path]) => !path.startsWith(prefix));
    keyframes = kept.length ? Object.fromEntries(kept) : undefined;
    if (action === "clear") {
      if (!effects.length && kept.length === Object.keys(clip.keyframes ?? {}).length) return p;
      effects = [];
    } else if (action === "remove") effects = effects.filter(e => e.id !== effectId);
    else effects = effects.map(e => e.id === effectId ? { ...e, params: effectDefaults(e.type) } : e);
  }
  return updateClip(p, clipId, () => ({ ...clip, effects, keyframes }));
}
