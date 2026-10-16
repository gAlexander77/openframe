import { describe, expect, it } from "vitest";
import { markerText } from "./markerText";
import { createMarker } from "./project/defaults";

const fps = { num: 30, den: 1 };
describe("marker text exports", () => {
  it("sorts notes, keeps exact timecodes, and makes each note one line", () => {
    const markers = [createMarker(38, "  Fix\n audio\tplease "), createMarker(0, "")];
    expect(markerText(markers, fps, 10, "notes")).toEqual({ text: "00:00:00:00 Marker 1\n00:00:01:08 Fix audio please", issues: [], count: 2 });
    expect(markers[0].frame).toBe(38);
  });
  it("keeps NTSC drop-frame timecodes for frame-accurate editing notes", () => {
    expect(markerText([createMarker(1800, "Cut")], { num: 30000, den: 1001 }, 2000, "notes").text).toBe("00:01:00;02 Cut");
  });
  it("writes valid chapter text and names unlabeled chapters", () => {
    const result = markerText([createMarker(0, "Intro"), createMarker(300, "Topic"), createMarker(600)], fps, 900, "chapters");
    expect(result).toEqual({ text: "00:00 Intro\n00:10 Topic\n00:20 Chapter 3", issues: [], count: 3 });
  });
  it("formats hours and floors fractional seconds rather than moving a chapter later", () => {
    expect(markerText([createMarker(108059, "Long video")], fps, 108900, "chapters").text).toBe("01:00:01 Long video");
    expect(markerText([createMarker(300, "NTSC")], { num: 30000, den: 1001 }, 600, "chapters").text).toBe("00:10 NTSC");
  });
  it("reports missing zero, insufficient markers and too-short final chapters", () => {
    const result = markerText([createMarker(60, "A"), createMarker(600, "B")], fps, 899, "chapters");
    expect(result.issues).toContain("Start the first chapter at 00:00.");
    expect(result.issues).toContain("Use at least three chapter markers.");
    expect(result.issues).toContain("Leave at least 10 seconds per chapter, including the last.");
  });
  it("reports duplicate seconds and beyond-end notes without discarding them", () => {
    const result = markerText([createMarker(0, "A"), createMarker(10, "B"), createMarker(900, "C")], fps, 900, "chapters");
    expect(result.count).toBe(3);
    expect(result.text).toContain("00:00 B");
    expect(result.issues).toContain("Chapter timestamps must be distinct after rounding down to seconds.");
    expect(result.issues).toContain("Chapter markers must fall before the end of the timeline.");
  });
  it("handles an empty filtered list", () => {
    expect(markerText([], fps, 0, "notes")).toEqual({ text: "", issues: [], count: 0 });
    expect(markerText([], fps, 0, "chapters").issues).toHaveLength(2);
  });
});
