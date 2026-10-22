import { expect, it } from "vitest";
import fixture from "./fixture.json";
import { normalizeProject } from "../project/defaults";
import { toEdl, audioEdls } from "./edl";

it("matches a hand-written CMX list with cuts, a dissolve, a gap and clip names", () => {
  expect(toEdl(normalizeProject(fixture))).toBe(`TITLE: Cuts & layers
FCM: NON-DROP FRAME

001  LONG_SHO V     C       00:00:02:00 00:00:03:20 00:00:00:00 00:00:01:20
* FROM CLIP NAME: Long shot.mp4

002  LONG_SHO V     C       00:00:03:20 00:00:03:20 00:00:01:20 00:00:01:20
002  LONG_SHO V     D 010   00:00:04:20 00:00:07:00 00:00:01:20 00:00:04:00
* FROM CLIP NAME: Long shot.mp4

003  BL       V     C       00:00:00:00 00:00:01:00 00:00:04:00 00:00:05:00

004  LONG_SHO V     C       00:00:08:00 00:00:10:00 00:00:05:00 00:00:07:00
* FROM CLIP NAME: Long shot.mp4
`);
  const audio = audioEdls(normalizeProject(fixture));
  expect(audio).toHaveLength(1);
  expect(audio[0].text).toContain("MUSIC    A     C");
});
it("uses 29.97 drop-frame labels across the minute and tenth-minute boundaries", () => {
  const p = normalizeProject(fixture);
  p.fps = { num: 30000, den: 1001 };
  p.tracks.find(t => t.main)!.clips = [{ ...p.tracks.find(t => t.main)!.clips[2], start: 1800, duration: 16182, in: 1800 * 1001 / 30000 } as typeof p.tracks[0]["clips"][0]];
  const edl = toEdl(p);
  expect(edl).toContain("FCM: DROP FRAME");
  expect(edl).toContain("00:01:00:02 00:10:00:00 00:01:00:02 00:10:00:00");
});
it("does not merge tracks or mutate the project", () => {
  const p = normalizeProject(fixture), before = JSON.stringify(p);
  const edl = toEdl(p);
  expect(edl).not.toContain("Music.wav");
  expect(edl).not.toContain("Nested");
  expect(JSON.stringify(p)).toBe(before);
});
it("centers odd dissolves and keeps a missing incoming handle from making negative source timecodes", () => {
  const p = normalizeProject(fixture), main = p.tracks.find(t => t.main)!;
  if ("transitionOut" in main.clips[0]) main.clips[0].transitionOut!.duration = 9;
  expect(toEdl(p)).toContain("D 009   00:00:04:21 00:00:07:00 00:00:01:21 00:00:04:00");
  if ("in" in main.clips[1]) main.clips[1].in = 0;
  expect(toEdl(p)).toContain("D 009   00:00:00:00 00:00:02:00 00:00:02:00 00:00:04:00");
  expect(toEdl(p)).not.toContain("-00:");
});
