import { boxesAt } from "./align";
import { paramAt, upsertKey } from "./keyframes";
import { findClip, setParam, updateClip } from "./project/ops";
import type { Project } from "./project/types";

export interface GroupMove { x?: number; y?: number; scale?: number; rotation?: number }

/** Rigid rotation and uniform scale in pixels, then a canvas-fraction offset. */
export function groupPoint(point: { x: number; y: number }, center: { x: number; y: number }, width: number, height: number, move: GroupMove) {
  const angle = (move.rotation ?? 0) * Math.PI / 180, scale = move.scale ?? 1;
  const x = (point.x - center.x) * scale, y = (point.y - center.y) * scale;
  return { x: center.x + x * Math.cos(angle) - y * Math.sin(angle) + (move.x ?? 0) * width,
    y: center.y + x * Math.sin(angle) + y * Math.cos(angle) + (move.y ?? 0) * height };
}

/** All members are evaluated at the same timeline frame (clamped to each
 * member's span). Explicit keying creates keys even on previously static paths. */
export function transformGroup(p: Project, ids: string[], move: GroupMove, frame?: number, key = false): Project {
  if (!Object.values(move).every(v => v === undefined || Number.isFinite(v)) || (move.scale ?? 1) <= 0) throw new Error("Group transform needs finite values and a positive scale");
  ids = [...new Set(ids)];
  for (const id of ids) {
    const loc = findClip(p, id);
    if (!loc) throw new Error(`Unknown clip ${id}`);
    if (loc.track.locked) throw new Error("Unlock all group tracks before transforming");
  }
  const visuals = ids.filter(id => "transform" in findClip(p, id)!.clip);
  if (visuals.length < 2) throw new Error("Choose at least two visual group members");
  const at = frame ?? Math.max(...visuals.map(id => findClip(p, id)!.clip.start));
  const items = boxesAt(p, visuals, at);
  const left = Math.min(...items.map(i => i.box.cx - i.box.hw)), right = Math.max(...items.map(i => i.box.cx + i.box.hw));
  const top = Math.min(...items.map(i => i.box.cy - i.box.hh)), bottom = Math.max(...items.map(i => i.box.cy + i.box.hh));
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
  for (const { clip, rel } of items) {
    const value = (path: string) => paramAt(clip, `transform.${path}`, rel);
    const point = groupPoint({ x: (0.5 + value("x")) * p.width, y: (0.5 + value("y")) * p.height }, center, p.width, p.height, move);
    const values: Record<string, number> = { x: point.x / p.width - 0.5, y: point.y / p.height - 0.5, scale: value("scale") * (move.scale ?? 1), rotation: value("rotation") + (move.rotation ?? 0) };
    if (clip.transform.scaleY !== undefined) values.scaleY = value("scaleY") * (move.scale ?? 1);
    for (const [name, v] of Object.entries(values)) {
      const path = `transform.${name}`;
      const animated = !!clip.keyframes?.[path]?.length;
      // A key on an animated path the move leaves as it is would only split
      // its curve and reshape its ease (an x move bent a keyed scale, ADR-099).
      if (animated && Math.abs(v - value(name)) < 1e-9) continue;
      if (key || animated) p = updateClip(p, clip.id, c => ({ ...c, keyframes: { ...c.keyframes, [path]: upsertKey(c.keyframes?.[path] ?? [], { ...c.keyframes?.[path]?.find(k => k.f === rel), f: rel, v }) } }));
      else p = setParam(p, [clip.id], path, v);
    }
  }
  return p;
}
