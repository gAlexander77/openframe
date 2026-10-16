import type { Project } from "./types";

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
