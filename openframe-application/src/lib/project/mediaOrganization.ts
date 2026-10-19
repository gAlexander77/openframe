import { deleteClips } from "./ops";
import type { Clip, Project } from "./types";

export function folderName(value: string) {
  const name = value.trim();
  if (!name || name.length > 80) throw new Error("Folder names need 1–80 characters.");
  return name;
}

/** Rename/delete moves membership atomically; deleting never deletes footage. */
export function editFolder(p: Project, action: "create" | "rename" | "delete", name: string, newName?: string): Project {
  const folders = p.mediaFolders ?? [];
  const next = action === "delete" ? "" : folderName(action === "rename" ? newName ?? "" : name);
  if (action !== "create" && !folders.includes(name)) throw new Error("Folder no longer exists.");
  if (action !== "delete" && folders.some((f) => (action === "create" || f !== name) && f.toLocaleLowerCase() === next.toLocaleLowerCase())) throw new Error("That folder already exists.");
  return { ...p, mediaFolders: action === "create" ? [...folders, next] : folders.flatMap((f) => f !== name ? [f] : action === "delete" ? [] : [next]),
    assets: action === "create" ? p.assets : p.assets.map((a) => a.folder === name ? { ...a, folder: next || undefined } : a) };
}

export function organizeMedia(p: Project, ids: string[], patch: { folder?: string; favorite?: boolean }): Project {
  if (patch.folder && !p.mediaFolders?.includes(patch.folder)) throw new Error("Folder no longer exists.");
  if (ids.some((id) => !p.assets.some((a) => a.id === id))) throw new Error("Media no longer exists.");
  return { ...p, assets: p.assets.map((a) => ids.includes(a.id) ? { ...a, ...patch, ...(patch.folder === "" ? { folder: undefined } : {}) } : a) };
}

const shows = (gone: Set<string>) => (c: Clip) => "assetId" in c && gone.has(c.assetId);
/** Every asset a clip shows, on the timeline or inside a compound clip. */
const usedAssets = (p: Project) => new Set([...p.tracks, ...(p.compounds ?? []).flatMap((k) => k.tracks)].flatMap((t) => t.clips.flatMap((c) => ("assetId" in c ? [c.assetId] : []))));

/** Media no clip uses (stickers, which the library does not list, are
 * left alone). */
export function unusedMedia(p: Project): string[] {
  const used = usedAssets(p);
  return p.assets.filter((a) => !a.sticker && !used.has(a.id)).map((a) => a.id);
}

/** Remove media from the project; the files stay where they are. Media a
 * clip still shows is refused unless `withClips`, which deletes those
 * clips too (inside compound clips as well), never on a locked track. */
export function removeMedia(p: Project, ids: string[], withClips = false): Project {
  const gone = new Set(ids);
  const missing = ids.find((id) => !p.assets.some((a) => a.id === id));
  if (missing) throw new Error("Media no longer exists.");
  const uses = shows(gone);
  const used = usedAssets(p);
  const inUse = p.assets.find((a) => gone.has(a.id) && used.has(a.id));
  if (inUse && !withClips) throw new Error(`${inUse.name} is used on the timeline; remove its clips too, or delete them first.`);
  const top = p.tracks.flatMap((t) => t.clips.filter(uses).map((c) => ({ c, locked: t.locked })));
  if (top.some((u) => u.locked)) throw new Error("Some of its clips are on a locked track.");
  const q = top.length ? deleteClips(p, top.map((u) => u.c.id)) : p;
  return {
    ...q,
    ...(q.compounds ? { compounds: q.compounds.map((k) => ({ ...k, tracks: k.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !uses(c)) })) })) } : {}),
    assets: q.assets.filter((a) => !gone.has(a.id)),
  };
}
