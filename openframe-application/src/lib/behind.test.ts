// A title behind its subject, checked for what the subject leaves of it
// (ADR-103): the pairs text_behind_subject makes, the coverage measured
// from renders over black and white, and what an agent is told.

import { expect, it } from "vitest";
import { putBehindSubject } from "./ads";
import { alphaOf, behindPairs, hiddenNote, hiddenShare, HIDDEN_LIMIT, titlesInFront } from "./behind";
import { runCommand } from "./commands";
import { createProject } from "./project/defaults";
import type { Project } from "./project/types";

const cut = { enabled: true, src: "matte.mp4", from: 0, to: 5, model: "m" };

function behind() {
  let p: Project = { ...createProject(), assets: [{ id: "v", kind: "video", name: "rocket.mp4", src: "rocket.mp4", duration: 5, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false }] };
  p = runCommand(p, "add_media_clip", { asset_id: "v", start: 0, duration: 4 });
  p = runCommand(p, "add_text", { text: "LEAVE THE GROUND", start: 0.5, duration: 2, style: { size: 160 } });
  p = runCommand(p, "set_animation", { clip_id: p.tracks.flatMap((t) => t.clips).find((c) => c.type === "text")!.id, slot: "in", type: "fade", duration: 0.5 });
  const all = p.tracks.flatMap((t) => t.clips);
  const video = all.find((c) => c.type === "video")!.id, title = all.find((c) => c.type === "text")!.id;
  const r = putBehindSubject(p, video, [title], { cutout: cut });
  return { p: r.project, title, subject: r.subjectId };
}

it("finds a title with its subject's copy above it, measured after its in-animation", () => {
  const { p, title, subject } = behind();
  const pairs = behindPairs(p);
  expect(pairs.map((x) => [x.title.id, x.subject.id])).toEqual([[title, subject]]);
  // In at 0.5 s for 0.5 s: from frame 30, its first moment at 30.
  expect(pairs[0].frames[0]).toBe(30);
  expect(pairs[0].frames.every((f) => f >= 15 && f < 75)).toBe(true);
  // A copy turned off, or below the title, is not over it.
  const off = runCommand(p, "set_clip_enabled", { clip_ids: [subject], enabled: false });
  expect(behindPairs(off)).toEqual([]);
});

it("measures coverage from renders over black and over white", () => {
  // Four pixels: a letter pixel under the subject, a letter pixel clear of
  // it, half a letter pixel under a half-transparent subject edge, empty.
  const px = (rgb: number[][]) => new Uint8ClampedArray(rgb.flatMap((c) => [...c, 255]));
  const letters = alphaOf(px([[255, 255, 255], [200, 200, 200], [128, 128, 128], [0, 0, 0]]), px([[255, 255, 255], [200, 200, 200], [255, 255, 255], [255, 255, 255]]));
  expect([...letters].map((a) => +a.toFixed(2))).toEqual([1, 1, 0.5, 0]);
  const subject = alphaOf(px([[90, 40, 20], [0, 0, 0], [45, 20, 10], [90, 40, 20]]), px([[90, 40, 20], [255, 255, 255], [172, 147, 137], [90, 40, 20]]));
  expect([...subject].map((a) => +a.toFixed(2))).toEqual([1, 0, 0.5, 1]);
  // (1 + 0 + 0.25 + 0) of 2.5 letter pixels.
  expect(hiddenShare(letters, subject)).toBeCloseTo(1.25 / 2.5, 2);
  expect(hiddenShare(new Float32Array(4), subject)).toBe(0);
});

it("tells an agent how much is hidden, against the master, and how to fix it", () => {
  const { p, title, subject } = behind();
  expect(hiddenNote(p, { titleId: title, subjectId: subject, frame: 45, share: HIDDEN_LIMIT - 0.01 }, "LEAVE THE GROUND")).toBeUndefined();
  const say = hiddenNote(p, { titleId: title, subjectId: subject, frame: 45, share: 0.38 }, "LEAVE THE\nGROUND", 0.12)!;
  expect(say.message).toBe(`"LEAVE THE GROUND" is 38% hidden behind the subject (${subject}) at 1.5 s, against 12% in the master: past 25% its words no longer read`);
  expect(say.fix).toContain(`{clip_id: "${subject}", hidden: true}`);
});

it("shows a title in front in a version its subject would hide, unless placed by hand", () => {
  const { p, title, subject } = behind();
  const hid = [{ titleId: title, subjectId: subject, frame: 45, share: 0.41 }];
  const { project: q, off } = titlesInFront(p, hid);
  expect(off).toEqual([subject]);
  expect(q.tracks.flatMap((t) => t.clips).find((c) => c.id === subject)!.disabled).toBe(true);
  // Now the title has no copy above it: nothing to flag.
  expect(behindPairs(q)).toEqual([]);
  // Under the limit, or placed by hand in the version's overrides: as it is.
  expect(titlesInFront(p, [{ ...hid[0], share: 0.18 }]).off).toEqual([]);
  expect(titlesInFront(p, hid, new Set([title])).off).toEqual([]);
  expect(titlesInFront(p, hid, new Set([subject])).project).toBe(p);
});
