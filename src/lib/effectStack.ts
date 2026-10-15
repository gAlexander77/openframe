import { EFFECTS, effectDefaults } from "./catalog";
import { findClip, updateClip } from "./project/ops";
import type { Clip, Effect, Id, Project } from "./project/types";

export type EffectClip = Clip & { effects: Effect[] };
export const EFFECT_ACTIONS = ["move_up", "move_down", "reset", "remove", "clear", "enable", "disable"] as const;
export type EffectAction = typeof EFFECT_ACTIONS[number];

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
