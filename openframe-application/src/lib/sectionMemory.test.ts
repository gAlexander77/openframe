import { describe, expect, it } from "vitest";
import { readSectionMemory, rememberSection, SECTION_MEMORY_LIMIT } from "./sectionMemory";

describe("section memory", () => {
  it("reads only open and closed choices", () => {
    expect(readSectionMemory({ Basic: false, Effects: true, Bad: "yes", "": true })).toEqual({ Basic: false, Effects: true });
    expect(readSectionMemory(null)).toEqual({});
    expect(readSectionMemory(["Basic"])).toEqual({});
  });

  it("remembers the newest choice per section", () => {
    let m = rememberSection({}, "Basic", false);
    m = rememberSection(m, "Effects", true);
    m = rememberSection(m, "Basic", true);
    expect(m).toEqual({ Effects: true, Basic: true });
    expect(Object.keys(m)).toEqual(["Effects", "Basic"]);
  });

  it("forgets the oldest past its limit", () => {
    let m = {};
    for (let i = 0; i <= SECTION_MEMORY_LIMIT; i++) m = rememberSection(m, `s${i}`, true);
    expect(Object.keys(m)).toHaveLength(SECTION_MEMORY_LIMIT);
    expect(m).not.toHaveProperty("s0");
  });
});
