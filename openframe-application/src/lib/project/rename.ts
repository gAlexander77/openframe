// Renaming clips and media (Premiere's Rename, CapCut's clip name). A clip's
// own name wins over its media's on the timeline; an empty one gives the
// clip its media's name (or its words, for text) back. Media always keeps a
// name, so the library never shows a blank card.

import { findClip, updateClip } from "./ops";
import type { Clip, Id, Project } from "./types";

/** Longest name kept, as Home's project rename allows. */
export const NAME_MAX = 120;

/** A name as typed: trimmed, runs of spaces and line breaks as one space.
 * Throws when too long; an empty result means "no name of its own". */
export function cleanName(value: string): string {
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length > NAME_MAX) throw new Error(`Use a name of at most ${NAME_MAX} characters.`);
  return name;
}

/** Does what was typed in a rename field change the shown name? Spacing
 * alone does not, so Enter on an untouched field stores nothing. */
export const changesName = (shown: string, typed: string) => typed.replace(/\s+/g, " ").trim() !== shown.replace(/\s+/g, " ").trim();

/** Give clips a name, or clear their own name with an empty one. Locked
 * tracks refuse, as every other clip edit does. */
export function renameClips(p: Project, ids: Id[], value: string): Project {
  const name = cleanName(value);
  for (const id of ids) {
    const loc = findClip(p, id);
    if (!loc) throw new Error(`No clip with id ${id}.`);
    if (loc.track.locked) throw new Error(`Track ${loc.track.name} is locked.`);
  }
  return ids.reduce(
    (q, id) =>
      updateClip(q, id, (c) => {
        if (name) return c.name === name ? c : ({ ...c, name } as Clip);
        if (c.name === undefined) return c;
        const { name: _, ...rest } = c;
        return rest as Clip;
      }),
    p,
  );
}

/** Rename an imported file in the project; the file on disk keeps its name.
 * Clips without a name of their own show the new one. */
export function renameMedia(p: Project, assetId: Id, value: string): Project {
  const name = cleanName(value);
  if (!name) throw new Error("Media needs a name.");
  const asset = p.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error(`No media with id ${assetId}.`);
  if (asset.name === name) return p;
  return { ...p, assets: p.assets.map((a) => (a.id === assetId ? { ...a, name } : a)) };
}
