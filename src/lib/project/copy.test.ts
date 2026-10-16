import { expect, it } from "vitest";
import { createProject, createTextClip } from "./defaults";
import { copyProject } from "./copy";

it("copies every edit independently while preserving internal references", () => {
  const p = createProject({ name: "Original" });
  p.tracks[0].clips.push(createTextClip("Hello", 0, 60));
  const copy = copyProject(p, " Alternate ");
  expect(copy.id).not.toBe(p.id);
  expect(copy.name).toBe("Alternate");
  expect(copy.tracks).toEqual(p.tracks);
  copy.tracks[0].name = "Changed";
  expect(p.tracks[0].name).toBe("Main");
});

it("rejects empty names and identities that could overwrite the source", () => {
  const p = createProject();
  expect(() => copyProject(p, " ")).toThrow();
  expect(() => copyProject(p, "x".repeat(121))).toThrow();
  expect(() => copyProject(p, "Other", p.id)).toThrow();
});
