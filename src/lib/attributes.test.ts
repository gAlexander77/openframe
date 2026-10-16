import { expect, it } from "vitest";
import { copyAttributes, pasteAttributes } from "./attributes";
import { clipForAsset, createColorClip, createProject, createTrack } from "./project/defaults";
import type { ColorClip } from "./project/types";
it("retimes audio fades and leaves source offsets and speed unchanged", () => {
  const p = createProject();
  const a = clipForAsset({ id: "a", src: "a.wav", name: "a", kind: "audio", duration: 10, hasAudio: true, hasVideo: false }, 0, p.fps);
  if (a.type !== "audio") throw new Error();
  a.volume = 0.4; a.fadeIn = 90;
  const b = { ...a, id: "b", start: 400, duration: 30, in: 2, speed: 2, volume: 1, fadeIn: 0 };
  p.tracks = [{ ...createTrack("audio", "Audio"), clips: [a, b] }];
  const copied = copyAttributes(p, a.id); copied.fps = { num: 60, den: 1 };
  const c = pasteAttributes(p, [b.id], copied, ["audio"]).tracks[0].clips[1];
  // 1.5 s at the target rate is 45 frames; a fade stops at half the clip, as in the inspector.
  expect(c).toMatchObject({ volume: 0.4, fadeIn: 15, duration: 30, in: 2, speed: 2, start: 400 });
});
const setup = () => {
  const p = createProject(); const a = createColorClip("#fff", 0, 60), b = createColorClip("#000", 90, 30);
  a.transform.scale = 2; a.adjust.exposure = 20;
  a.effects = [{ id: "fx", type: "blur", params: { amount: 30 }, enabled: true }];
  a.keyframes = { "transform.scale": [{ f: 30, v: 2 }], "adjust.exposure": [{ f: 0, v: 10 }] };
  b.keyframes = { opacity: [{ f: 0, v: 0.5 }], "adjust.exposure": [{ f: 20, v: 5 }] };
  p.tracks[0].clips = [a, b]; return { p, a, b };
};
it("selectively replaces color while preserving timing, transform, effects and unrelated keys", () => {
  const { p, a, b } = setup(); const copy = copyAttributes(p, a.id); a.adjust.exposure = 99;
  const next = pasteAttributes(p, [b.id], copy, ["color"]);
  const c = next.tracks[0].clips[1] as ColorClip;
  expect(c.adjust.exposure).toBe(20); expect(c.start).toBe(90); expect(c.duration).toBe(30);
  expect(c.transform).toEqual(b.transform); expect(c.effects).toEqual(b.effects);
  expect(c.keyframes).toEqual({ opacity: [{ f: 0, v: 0.5 }], "adjust.exposure": [{ f: 0, v: 10 }] });
});
it("retimes copied keys in seconds and gives replacement effects independent IDs", () => {
  const { p, a, b } = setup(); const copy = copyAttributes(p, a.id); copy.fps = { num: 60, den: 1 };
  const c = pasteAttributes(p, [b.id], copy, ["transform", "effects"], true).tracks[0].clips[1] as ColorClip;
  expect(c.keyframes?.["transform.scale"][0].f).toBe(15);
  expect(c.effects[0].id).not.toBe("fx"); expect(c.keyframes?.opacity).toBeUndefined();
});
it("validates every target before editing and copies LUT references across projects", () => {
  const { p, a, b } = setup(); a.adjust.lut = { id: "lut", intensity: 0.8 }; p.luts = [{ id: "lut", name: "Look", src: "look.cube", size: 17, kind: "3d" }];
  const copy = copyAttributes(p, a.id); const target = { ...p, luts: undefined };
  const result = pasteAttributes(target, [b.id], copy, ["color"]);
  expect(result.luts?.[0].src).toBe("look.cube"); expect((result.tracks[0].clips[1] as ColorClip).adjust.lut?.id).toBe(result.luts?.[0].id);
  p.tracks.push({ ...createTrack("video", "Locked"), locked: true, clips: [{ ...b, id: "locked" }] });
  expect(() => pasteAttributes(p, [b.id, "locked"], copy, ["color"])).toThrow("unlocked");
  expect(b.adjust.exposure).toBe(0);
});
