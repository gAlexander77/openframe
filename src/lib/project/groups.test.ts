import { expect, it } from "vitest";
import { createColorClip, createProject, createTrack } from "./defaults";
import { expandGroups, groupClips, regroupCopies, ungroupClips } from "./groups";

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
