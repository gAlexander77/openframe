import { expect, it } from "vitest";
import { clipForAsset, createProject, createTextClip, createTrack } from "../project/defaults";
import { timelineWarnings } from "./warnings";
it("film 5: names processing and graphics losses, including OTIO metadata", () => {
  const p = createProject(), t = createTrack("video", "Titles");
  t.clips.push(createTextClip("Why we explore", 0, 120)); p.tracks.unshift(t);
  expect(timelineWarnings(p, "fcpxml").join(" ")).toMatch(/native Basic Titles/);
  expect(timelineWarnings(p, "otio").join(" ")).toMatch(/other editors may show gaps/);
});

it("names clip and track processing that a colleague cannot hear in either format", () => {
  const p = createProject(), t = createTrack("audio", "Dialog");
  const a = { id: "a", kind: "audio" as const, name: "Voice", src: "v.wav", hasAudio: true, hasVideo: false, duration: 10 };
  p.assets.push(a);
  const c = clipForAsset(a, 0, p.fps);
  if (c.type !== "audio") throw Error("audio");
  t.clips.push({ ...c, eq: { low: -2 } });
  p.tracks.push(t);
  for (const format of ["otio", "fcpxml"] as const) expect(timelineWarnings(p, format).join(" ")).toMatch(/Dialogue cleanup.*final WAV mix/);
});
