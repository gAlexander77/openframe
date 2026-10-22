import { expect, it } from "vitest";
import { memoryOwners } from "../engine/memory";
import { projectWork } from "./projectWork";

it("releases resources and aborts work on close and replacement, even for the same project", () => {
  projectWork.open();
  let bytes = 100, releases = 0;
  const unregister = memoryOwners.register("test_project_resource", () => ({ bytes, count: Number(bytes > 0) }), () => { bytes = 0; releases++; });
  try {
    const first = projectWork.capture();
    projectWork.close();
    expect(first.aborted).toBe(true);
    expect(bytes).toBe(0);
    projectWork.open();
    bytes = 200;
    const reopened = projectWork.capture();
    projectWork.open();
    expect(reopened.aborted).toBe(true);
    expect(projectWork.capture().aborted).toBe(false);
    expect(bytes).toBe(0);
    expect(releases).toBe(3);
  } finally { unregister(); projectWork.close(); }
});
