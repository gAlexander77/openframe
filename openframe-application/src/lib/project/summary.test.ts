import { describe, expect, it } from "vitest";
import { createProject } from "./defaults";
import { projectSummary } from "./summary";

describe("projectSummary", () => {
  it("lists a project from the project alone", () => {
    const p = { ...createProject({ name: "Cut short" }), updatedAt: 5 };
    expect(projectSummary(p)).toEqual({ id: p.id, name: "Cut short", updatedAt: 5, width: p.width, height: p.height, duration: 0 });
  });
});
