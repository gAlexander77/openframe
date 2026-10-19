import { expect, it } from "vitest";
import { applyCaptionLook, CAPTION_LOOKS, captionSized, lookStyle } from "./captionLooks";
import { runCommand } from "./commands";
import { createProject, createTextClip } from "./project/defaults";

it("gives every caption the look's style and height, and leaves titles alone", () => {
  const p = createProject();
  const cap = { ...createTextClip("hello there", 0, 30, { stroke: { color: "#000000", width: 6 } }), caption: true, words: [0, 0.4] } as never;
  const title = createTextClip("Title", 30, 30);
  p.tracks[0].clips = [cap, title];
  const q = applyCaptionLook(p, "boxed");
  const [c, t] = q.tracks[0].clips as ReturnType<typeof createTextClip>[];
  expect(c.style.background).toEqual({ color: "#000000b3", padding: 14, radius: 10 });
  // The box replaces the outline the caption had.
  expect(c.style.stroke).toBeUndefined();
  expect(c.transform.y).toBe(CAPTION_LOOKS.boxed.y);
  expect(c.text).toBe("hello there");
  expect((c as unknown as { words: number[] }).words).toEqual([0, 0.4]);
  expect(t).toBe(title);
});

it("carries the spoken-word highlight in Word pop, and refuses unknown looks", () => {
  expect(lookStyle("pop").highlight).toBe("#2ee59d");
  expect("highlight" in lookStyle("classic")).toBe(false);
  expect(() => lookStyle("sparkly")).toThrow("No caption look");
});

it("sizes captions by the canvas's short side: as many pixels on 9:16 as on 16:9", () => {
  const tall = { width: 1080, height: 1920 };
  expect(captionSized(tall, { size: 64, stroke: { color: "#000", width: 6 } })).toEqual({ size: 36, stroke: { color: "#000", width: 3.38 } });
  expect(captionSized({ width: 1920, height: 1080 }, { size: 64 })).toEqual({ size: 64 });
  // add_captions' default and a look on a tall canvas; a size asked for stays.
  let p = runCommand(createProject({ width: 1080, height: 1920 }), "add_captions", { captions: [{ start: 0, end: 1, text: "Hello" }] });
  const cap = () => p.tracks.flatMap((t) => t.clips)[0] as ReturnType<typeof createTextClip>;
  expect(cap().style.size).toBe(36);
  p = applyCaptionLook(p, "yellow");
  expect(cap().style.size).toBeCloseTo(72 * (1080 / 1920), 1);
  p = runCommand(createProject({ width: 1080, height: 1920 }), "add_captions", { captions: [{ start: 0, end: 1, text: "Hello" }], style: { size: 80 } });
  expect(cap().style.size).toBe(80);
});
