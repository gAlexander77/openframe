import { expect, it } from "vitest";
import { createProject } from "./project/defaults";
import { resolveProjectPath, rewriteProjectPaths } from "./projectFiles";
it("resolves relative paths without changing absolute locations", () => {
  expect(resolveProjectPath("media/a.gif", "C:/edits/project.json")).toBe("C:/edits/media/a.gif");
  expect(resolveProjectPath("../a.gif", "/edits/folder/project.json")).toBe("/edits/a.gif");
  expect(resolveProjectPath("https://example.test/a", "/edits/p.json")).toBe("https://example.test/a");
});
it("rewrites media paths recursively without mutating the document", () => {
  const p = createProject(); p.luts = [{ id: "lut", name: "Look", src: "look.cube", size: 2, kind: "3d" }];
  const q = rewriteProjectPaths(p, s => `media/${s}`);
  expect(q.luts?.[0].src).toBe("media/look.cube"); expect(p.luts[0].src).toBe("look.cube"); expect(q.name).toBe(p.name);
});
