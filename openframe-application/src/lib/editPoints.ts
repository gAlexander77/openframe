import { clipEnd, findClip, rollBounds, rollEdit, trimClip, trimStop, type Edge } from "./project/ops";
import type { Id, Project } from "./project/types";

export interface EditPoint { clipId: Id; edge: Edge }
export interface EditLanding extends EditPoint { requested: number; frame: number; stopped?: string }
export const edgeFrame = (p: Project, e: EditPoint) => {
  const c = findClip(p, e.clipId)?.clip;
  return c ? e.edge === "start" ? c.start : clipEnd(c) : null;
};

/** Stable ties choose the earlier frame, then the outgoing edge, then
 * track order. A cut selects one side; both sides are an explicit roll selection. */
export function nearestEdit(p: Project, frame: number, tracks?: Id[], direction?: -1 | 1): EditPoint[] {
  const candidates = p.tracks.filter((t) => !t.locked && (!tracks?.length || tracks.includes(t.id)))
    .flatMap((t) => t.clips.flatMap((c) => [{ clipId: c.id, edge: "end" as const, frame: clipEnd(c) }, { clipId: c.id, edge: "start" as const, frame: c.start }]));
  const list = candidates.filter((e) => !direction || direction * (e.frame - frame) > 0)
    .sort((a, b) => Math.abs(a.frame - frame) - Math.abs(b.frame - frame) || a.frame - b.frame || (a.edge === b.edge ? 0 : a.edge === "end" ? -1 : 1));
  return list.length ? [{ clipId: list[0].clipId, edge: list[0].edge }] : [];
}

/** Both touching sides only; a gap never becomes a roll. */
export function cutSides(p: Project, e: EditPoint): EditPoint[] {
  const loc = findClip(p, e.clipId);
  if (!loc || loc.track.locked) return [];
  const other = loc.track.clips[loc.clipIndex + (e.edge === "start" ? -1 : 1)];
  if (!other || (e.edge === "start" ? clipEnd(other) !== loc.clip.start : other.start !== clipEnd(loc.clip))) return [e];
  return [e, { clipId: other.id, edge: e.edge === "start" ? "end" : "start" }];
}

/** Plan from the original document, then apply each cut once. All clamping
 * belongs to the existing trim/roll ops, including ramps and reverse. */
export function moveEdits(p: Project, edits: EditPoint[], target: { to: number } | { by: number }, ripple = false): { project: Project; edges: EditLanding[] } {
  const unique = edits.filter((e, i) => edits.findIndex((o) => o.clipId === e.clipId && o.edge === e.edge) === i);
  const requested = (e: EditPoint) => Math.round("to" in target ? target.to : (edgeFrame(p, e) ?? 0) + target.by);
  let q = p;
  const done = new Set<EditPoint>();
  const reasons = new Map<EditPoint, string>();
  for (const e of unique) {
    if (done.has(e)) continue;
    const loc = findClip(q, e.clipId);
    if (!loc || loc.track.locked) { reasons.set(e, loc ? "locked track" : "missing clip"); continue; }
    const f = requested(e);
    const pair = unique.find((o) => o !== e && !done.has(o) && o.edge !== e.edge && cutSides(p, e).some((side) => side.clipId === o.clipId && side.edge === o.edge));
    if (pair) {
      const left = e.edge === "end" ? e : pair, right = e.edge === "start" ? e : pair;
      const b = rollBounds(q, left.clipId, right.clipId);
      if (b) {
        if (f < b.lo || f > b.hi) {
          const [c, why] = f < b.lo ? b.loBy : b.hiBy;
          for (const side of [e, pair]) reasons.set(side, `${why} (${c.id})`);
        }
        q = rollEdit(q, left.clipId, right.clipId, f);
        done.add(pair); done.add(e);
        continue;
      }
    }
    const stop = trimStop(q, e.clipId, e.edge, f, ripple);
    if (stop) reasons.set(e, stop.why);
    q = trimClip(q, e.clipId, e.edge, f, ripple);
    done.add(e);
  }
  return { project: q, edges: unique.map((e) => ({ ...e, requested: requested(e), frame: edgeFrame(q, e) ?? 0, ...(reasons.has(e) ? { stopped: reasons.get(e) } : {}) })) };
}
