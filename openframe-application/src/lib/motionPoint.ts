import { upsertKey } from "./keyframes";
import { findClip, updateClip } from "./project/ops";
import type { Project } from "./project/types";

/** Move an existing position-key time. Key both axes so the dot stays at
 * that position even when originally only one axis had a key there. */
export function moveMotionPoint(p: Project, id: string, frame: number, x: number, y: number): Project {
  const loc = findClip(p, id);
  if (!loc || !("transform" in loc.clip)) throw new Error("Choose a visual clip");
  if (loc.track.locked) throw new Error("Unlock the clip track before moving its path");
  const c = loc.clip, rel = frame - c.start;
  if (!Number.isInteger(rel) || rel < 0 || rel >= c.duration || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Position and key time must be valid");
  if (!["transform.x", "transform.y"].some(path => c.keyframes?.[path]?.some(k => k.f === rel))) throw new Error("There is no position key at that time");
  return updateClip(p, id, c => {
    const keys = { ...c.keyframes };
    for (const [path, v] of [["transform.x", x], ["transform.y", y]] as const) keys[path] = upsertKey(keys[path] ?? [], { ...keys[path]?.find(k => k.f === rel), f: rel, v });
    return { ...c, keyframes: keys };
  });
}
