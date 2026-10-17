// Groups (Premiere's Group, Ctrl+G): clips that select, move, copy and
// delete together while each keeps its own track and settings. A group is
// just a shared id on its clips; a clip alone in its group is no group.

import { uid } from "./defaults";
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
  return clips.map((c) => {
    if (!c.group) return c;
    if (count.get(c.group)! < 2) {
      const { group: _, ...rest } = c;
      return rest as Clip;
    }
    if (!fresh.has(c.group)) fresh.set(c.group, uid("g"));
    return { ...c, group: fresh.get(c.group) } as Clip;
  });
}
