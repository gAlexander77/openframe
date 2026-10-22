import { describe, expect, it } from "vitest";
import { runCommand } from "./commands";
import { highlightMarkers } from "./highlightMarkers";
import { followClips } from "./markers";
import { createProject } from "./project/defaults";

function project() {
  const p = { ...createProject({ fps: { num: 30, den: 1 } }), assets: [{ id: "a", name: "VOD", src: "vod.wav", kind: "audio" as const, duration: 600, hasAudio: true, hasVideo: false }] };
  return runCommand(p, "add_media_clip", { asset_id: "a", start: 5, duration: 600 });
}
describe("highlight range markers", () => {
  it("maps source seconds to timeline frames, follows moves and replaces a reading", () => {
    const p = project(), c = p.tracks.flatMap(t => t.clips)[0];
    const marked = runCommand(p, "add_highlight_markers", { clip_id: c.id, ranges: [{ start: 120, end: 150 }] });
    expect(marked.markers[0]).toMatchObject({ frame: 3750, duration: 900, label: "Highlight 1", follows: { clip: c.id, at: 120 } });
    const moved = followClips(runCommand(marked, "move_clip", { clip_id: c.id, start: 20 }));
    expect(moved.markers[0].frame).toBe(4200);
    expect(highlightMarkers(marked, c.id, [{ start: 200, end: 220 }]).markers).toHaveLength(1);
    expect(p.markers).toHaveLength(0);
  });
  it("accepts an end at the file edge and rejects out-of-clip or invalid ranges atomically", () => {
    const p = project(), c = p.tracks.flatMap(t => t.clips)[0];
    expect(highlightMarkers(p, c.id, [{ start: 580, end: 600 }]).markers[0].duration).toBe(600);
    for (const range of [{ start: 2, end: 1 }, { start: -1, end: 2 }, { start: 2, end: Infinity }, { start: 590, end: 601 }]) expect(() => highlightMarkers(p, c.id, [range])).toThrow();
    expect(() => highlightMarkers(p, "missing", [])).toThrow();
    expect(p.markers).toEqual([]);
  });
});
