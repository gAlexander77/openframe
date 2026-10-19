import { expect, it } from "vitest";
import { applyCaptionLook, CAPTION_LOOKS, lookStyle } from "./captionLooks";
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
