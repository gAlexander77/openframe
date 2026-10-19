import { EFFECTS } from "./catalog";
import { pasteEffectStack, type EffectClipboard } from "./effectStack";
import { NAMED_EASES } from "./keyframes";
import type { Ease, Keyframe, Project } from "./project/types";

export interface EffectPreset { id: string; name: string; stack: EffectClipboard }
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export function presetName(name: string) {
  const clean = name.trim();
  if (!clean || clean.length > 80) throw new Error("Preset names need 1–80 characters.");
  return clean;
}

/** Local storage and command JSON are untrusted. Reject incomplete snapshots. */
export function readEffectPreset(raw: unknown): EffectPreset {
  if (!obj(raw) || typeof raw.id !== "string" || !raw.id || typeof raw.name !== "string" || !obj(raw.stack)) throw new Error("Invalid effect preset.");
  const s = raw.stack;
  if (!obj(s.fps) || !finite(s.fps.num) || !finite(s.fps.den) || s.fps.num <= 0 || s.fps.den <= 0 || !Array.isArray(s.effects) || !s.effects.length || !obj(s.keyframes)) throw new Error("Invalid preset timing or effects.");
  const ids = new Set<string>();
  const effects = s.effects.map((e) => {
    if (!obj(e) || typeof e.id !== "string" || !e.id || ids.has(e.id) || typeof e.type !== "string" || !Object.hasOwn(EFFECTS, e.type) || !obj(e.params)) throw new Error("Invalid preset effect.");
    ids.add(e.id);
    const params: Record<string, number> = {};
    for (const [key, def] of Object.entries(EFFECTS[e.type].params)) {
      const v = e.params[key] ?? def.default;
      if (!finite(v)) throw new Error("Invalid effect parameter.");
      params[key] = Math.max(def.min, Math.min(def.max, v));
    }
    return { id: e.id, type: e.type, enabled: e.enabled !== false, params };
  });
  const keyframes: Record<string, Keyframe[]> = {};
  for (const [path, keys] of Object.entries(s.keyframes)) {
    const fx = effects.find((e) => path.startsWith(`effects.${e.id}.`));
    const key = fx && path.slice(`effects.${fx.id}.`.length);
    const def = fx && Object.hasOwn(EFFECTS[fx.type].params, key!) ? EFFECTS[fx.type].params[key!] : undefined;
    if (!def || !Array.isArray(keys)) throw new Error("Invalid preset animation path.");
    keyframes[path] = keys.map((k) => {
      if (!obj(k) || !finite(k.f) || !finite(k.v)) throw new Error("Invalid preset keyframe.");
      const e = k.ease;
      if (e !== undefined && !(typeof e === "string" && (NAMED_EASES as string[]).includes(e)) && !(Array.isArray(e) && e.length === 4 && e.every(finite))) throw new Error("Invalid preset easing.");
      return { f: k.f, v: Math.max(def.min, Math.min(def.max, k.v)), ...(e !== undefined ? { ease: structuredClone(e) as Ease } : {}) };
    });
  }
  return { id: raw.id, name: presetName(raw.name), stack: { effects, keyframes, fps: { num: s.fps.num, den: s.fps.den } } };
}

/** Reads a stored library entry by entry: one bad preset (say, an effect a
 * later version renamed) must not hide the others, or be erased by the next
 * save. Unreadable entries come back raw so they can be written back. */
export function readPresetLibrary(data: unknown): { presets: EffectPreset[]; unreadable: unknown[] } {
  if (!Array.isArray(data)) throw new Error("Invalid preset library.");
  const presets: EffectPreset[] = [], unreadable: unknown[] = [];
  for (const raw of data) {
    try { presets.push(readEffectPreset(raw)); } catch { unreadable.push(raw); }
  }
  return { presets, unreadable };
}

export function applyEffectPreset(p: Project, ids: string[], raw: unknown) {
  return pasteEffectStack(p, ids, readEffectPreset(raw).stack);
}
