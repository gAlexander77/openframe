// Groups (Premiere's Group, Ctrl+G): clips that select, move, copy and
// delete together while each keeps its own track and settings. A group is
// just a shared id on its clips; a clip alone in its group is no group.

import { uid } from "./defaults";
import { framesToSeconds } from "../time";
import type { Clip, Id, Project } from "./types";

const all = (p: Project) => p.tracks.flatMap((t) => t.clips);

/** `ids` plus every clip grouped with any of them. */
export function expandGroups(p: Project, ids: Id[]): Id[] {
  const groups = new Set(all(p).filter((c) => ids.includes(c.id) && c.group).map((c) => c.group));
  if (!groups.size) return ids;
  return [...new Set([...ids, ...all(p).filter((c) => c.group && groups.has(c.group)).map((c) => c.id)])];
}

function setGroup(p: Project, pick: (c: Clip) => boolean, group: Id | undefined): Project {
  return {
    ...p,
    tracks: p.tracks.map((t) =>
      t.locked || !t.clips.some(pick)
        ? t
        : {
            ...t,
            clips: t.clips.map((c) => {
              if (!pick(c)) return c;
              const { group: _, ...rest } = c;
              return (group ? { ...rest, group } : rest) as Clip;
            }),
          },
    ),
  };
}

/** One new group of the clips (two or more), leaving any old groups. */
export function groupClips(p: Project, ids: Id[]): Project {
  const set = new Set(ids);
  if (set.size < 2) return p;
  return setGroup(p, (c) => set.has(c.id), uid("g"));
}

/** Break up every group a clip in `ids` belongs to. */
export function ungroupClips(p: Project, ids: Id[]): Project {
  const groups = new Set(all(p).filter((c) => ids.includes(c.id) && c.group).map((c) => c.group));
  return groups.size ? setGroup(p, (c) => !!c.group && groups.has(c.group), undefined) : p;
}

/** Fresh group ids for pasted copies, so they never join the originals; a
 * copy whose group mates stayed behind pastes ungrouped. */
export function regroupCopies(clips: Clip[]): Clip[] {
  const count = new Map<Id, number>();
  for (const c of clips) if (c.group) count.set(c.group, (count.get(c.group) ?? 0) + 1);
  const fresh = new Map<Id, Id>();
  return clips.map((original) => {
    const c = "inserts" in original && original.inserts ? { ...original, inserts: original.inserts.map(i => ({ ...structuredClone(i), id: uid("insert") })) } : original;
    if (!c.group) return c;
    if (count.get(c.group)! < 2) {
      const { group: _, ...rest } = c;
      return rest as Clip;
    }
    if (!fresh.has(c.group)) fresh.set(c.group, uid("g"));
    return { ...c, group: fresh.get(c.group) } as Clip;
  });
}

/**
 * Premiere's out-of-sync numbers: for a linked picture and sound of the
 * same file (Extract audio's group) at the same speed, how many frames
 * one is ahead of where the other's source time says it belongs, by clip
 * id (both get it, opposite signs). Pairs in sync are left out.
 */
export function syncOffsets(p: Project): Map<Id, number> {
  const out = new Map<Id, number>();
  const timed = all(p).filter((c): c is Extract<Clip, { type: "video" | "audio" }> => (c.type === "video" || c.type === "audio") && !!c.group && !c.speedCurve && !c.freeze);
  const sec = (c: (typeof timed)[number]) => framesToSeconds(c.start, p.fps) - c.in / c.speed;
  for (const a of timed) {
    if (a.type !== "audio") continue;
    const v = timed.find((x) => x.type === "video" && x.group === a.group && x.assetId === a.assetId && x.speed === a.speed && !!x.reverse === !!a.reverse);
    if (!v) continue;
    const frames = Math.round((sec(a) - sec(v)) * (p.fps.num / p.fps.den));
    if (frames) {
      out.set(a.id, frames);
      out.set(v.id, -frames);
    }
  }
  return out;
}
