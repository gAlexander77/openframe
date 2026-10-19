import { expect, it } from "vitest";
import { clipForAsset, createColorClip, createProject, createTrack } from "./defaults";
import { expandGroups, groupClips, regroupCopies, syncOffsets, ungroupClips } from "./groups";
import { detachAudio, moveClip } from "./ops";
import type { Asset, VideoClip } from "./types";

const setup = () => {
  const p = createProject();
  const [a, b, c] = [0, 60, 120].map((s) => createColorClip("#fff", s, 30));
  p.tracks = [{ ...createTrack("video", "V", true), clips: [a, b] }, { ...createTrack("video", "W"), clips: [c] }];
  return { p, a, b, c };
};

it("groups clips across tracks so selecting one selects all", () => {
  const { p, a, b, c } = setup();
  const g = groupClips(p, [a.id, c.id]);
  expect(expandGroups(g, [a.id]).sort()).toEqual([a.id, c.id].sort());
  expect(expandGroups(g, [b.id])).toEqual([b.id]);
  expect(groupClips(p, [a.id])).toBe(p);
  const u = ungroupClips(g, [c.id]);
  expect(expandGroups(u, [a.id])).toEqual([a.id]);
  expect(u.tracks.flatMap((t) => t.clips).some((x) => "group" in x)).toBe(false);
});

it("gives pasted copies their own group", () => {
  const { p, a, c } = setup();
  const g = groupClips(p, [a.id, c.id]);
  const clips = g.tracks.flatMap((t) => t.clips).filter((x) => x.group);
  const copies = regroupCopies(clips);
  expect(copies[0].group).toBe(copies[1].group);
  expect(copies[0].group).not.toBe(clips[0].group);
  expect(regroupCopies([clips[0]])[0].group).toBeUndefined();
});

it("links Extract audio's sound to its picture, and counts frames out of sync", () => {
  const p = createProject();
  const asset: Asset = { id: "v", src: "v.mp4", name: "v", kind: "video", duration: 10, width: 640, height: 360, fps: 30, hasAudio: true, hasVideo: true };
  p.assets = [asset];
  const v = { ...(clipForAsset(asset, 0, p.fps) as VideoClip), in: 1 };
  p.tracks[0].clips = [v];
  const q = detachAudio(p, v.id);
  const a = q.tracks.flatMap((t) => t.clips).find((c) => c.type === "audio")!;
  expect(a.group).toBeDefined();
  expect(q.tracks[0].clips[0].group).toBe(a.group);
  expect(expandGroups(q, [a.id]).sort()).toEqual([a.id, v.id].sort());
  expect(syncOffsets(q).size).toBe(0);
  // The sound moved 5 frames later on its own (Alt-drag): +5 and -5.
  const track = q.tracks.find((t) => t.clips.includes(a))!;
  const r = moveClip(q, a.id, track.id, a.start + 5);
  expect(syncOffsets(r).get(a.id)).toBe(5);
  expect(syncOffsets(r).get(v.id)).toBe(-5);
  // Unlinked, nothing is counted.
  expect(syncOffsets(ungroupClips(r, [a.id])).size).toBe(0);
});
