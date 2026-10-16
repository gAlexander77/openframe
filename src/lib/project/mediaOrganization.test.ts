import { expect, it } from "vitest";
import { createProject, normalizeProject } from "./defaults";
import { editFolder, organizeMedia } from "./mediaOrganization";
import { DEFAULT_MEDIA_BROWSER, filterMedia } from "../mediaLibrary";

const project = () => normalizeProject({ assets: [{ id: "a", src: "a.png", kind: "image" }, { id: "b", src: "b.png", kind: "image" }] });
it("creates folders, assigns favorites and renames membership without touching tracks", () => {
  const p = project();
  const organized = organizeMedia(editFolder(p, "create", " B-roll "), ["a"], { folder: "B-roll", favorite: true });
  const renamed = editFolder(organized, "rename", "B-roll", "Scenes");
  expect(renamed.assets[0]).toMatchObject({ folder: "Scenes", favorite: true });
  expect(renamed.tracks).toBe(p.tracks);
  expect(p.assets[0].folder).toBeUndefined();
  expect(filterMedia(renamed.assets, new Map(), { ...DEFAULT_MEDIA_BROWSER, folder: "Scenes", favorites: true })).toEqual([renamed.assets[0]]);
  const deleted = editFolder(renamed, "delete", "Scenes");
  expect(deleted.assets[0].folder).toBeUndefined();
  expect(deleted.assets[0].favorite).toBe(true);
  expect(deleted.assets).toHaveLength(2);
});
it("rejects duplicate folders and stale asset/folder references", () => {
  const p = editFolder(project(), "create", "Scenes");
  expect(() => editFolder(p, "create", " scenes ")).toThrow("already exists");
  expect(() => editFolder(p, "rename", "missing", "new")).toThrow();
  expect(() => organizeMedia(p, ["a"], { folder: "missing" })).toThrow();
  expect(() => organizeMedia(p, ["missing"], { favorite: true })).toThrow();
});
it("loads old projects and round trips new organization, repairing invalid annotations", () => {
  expect(normalizeProject(createProject()).mediaFolders).toBeUndefined();
  const p = organizeMedia(editFolder(project(), "create", "Scenes"), ["a"], { folder: "Scenes", favorite: true });
  expect(normalizeProject(JSON.parse(JSON.stringify(p)))).toMatchObject({ mediaFolders: ["Scenes"], assets: p.assets });
  const repaired = normalizeProject({ ...p, mediaFolders: [" Scenes ", "scenes", null], assets: [{ ...p.assets[0], folder: " scenes ", favorite: "true" }] });
  expect(repaired.mediaFolders).toEqual(["Scenes"]);
  expect(repaired.assets[0]).toMatchObject({ folder: "Scenes", favorite: undefined });
});
