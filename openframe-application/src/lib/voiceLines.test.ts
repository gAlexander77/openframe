import { describe, expect, it } from "vitest";
import { runCommand } from "./commands";
import { createProject, createTrack } from "./project/defaults";
import { addTrack, findClip } from "./project/ops";
import type { Asset, Project } from "./project/types";
import { captionFor, retakeLine, voiceClips } from "./voiceLines";

const speech = (id: string, seconds: number, text: string): Asset => ({ id, kind: "audio", name: `${id}.wav`, src: `${id}.wav`, duration: seconds, hasVideo: false, hasAudio: true, speech: { text, voice: "af_heart", speed: 0.95 } });

/** A 30 fps voiceover: three lines of 2 s at 0, 2.5 and 5 s, a caption
 * each, and a music bed. */
function fixture(): Project {
  let p: Project = { ...createProject(), assets: [speech("a1", 2, "One."), speech("a2", 2, "Two."), speech("a3", 2, "Three.")] };
  const vo = createTrack("audio", "Voiceover");
  p = addTrack(p, vo);
  ["a1", "a2", "a3"].forEach((id, i) => (p = runCommand(p, "add_media_clip", { asset_id: id, start: i * 2.5, track_id: vo.id })));
  p = runCommand(p, "add_captions", { captions: ["One.", "Two.", "Three."].map((text, i) => ({ text, start: i * 2.5, end: i * 2.5 + 2 })) });
  return p;
}
const voices = (p: Project) => voiceClips(p);
const caps = (p: Project) => p.tracks.flatMap((t) => t.clips).filter((c) => c.type === "text" && c.caption).sort((a, b) => a.start - b.start);

describe("voice lines", () => {
  it("finds the voice clips and each one's caption", () => {
    const p = fixture();
    expect(voices(p).map((c) => (c as { assetId: string }).assetId)).toEqual(["a1", "a2", "a3"]);
    expect(voices(p).map((c) => (captionFor(p, c) as { text: string } | undefined)?.text)).toEqual(["One.", "Two.", "Three."]);
  });
});

describe("a retake", () => {
  const take = (seconds: number): Asset => speech("new", seconds, "Two, again.");

  it("puts a shorter take in place: same clip, new file, the caption follows, the old file leaves", () => {
    const p = fixture();
    const id = voices(p)[1].id;
    const r = retakeLine(p, { clipId: id, asset: take(1.5), frames: 45, caption: "Two, again." });
    const c = findClip(r.project, id)!.clip as { assetId: string; start: number; duration: number; in: number };
    expect(c).toMatchObject({ assetId: "new", start: 75, duration: 45, in: 0 });
    expect(r.shift).toBe(-15);
    expect(caps(r.project).map((x) => [x.start, x.duration, (x as { text: string }).text])).toEqual([
      [0, 60, "One."],
      [75, 45, "Two, again."],
      [150, 60, "Three."],
    ]);
    expect(r.project.assets.map((a) => a.id)).toEqual(["a1", "a3", "new"]);
    // Nothing after it moved.
    expect(voices(r.project)[2].start).toBe(150);
  });

  it("refuses a longer take that would run into the next line, saying by how much", () => {
    const p = fixture();
    expect(() => retakeLine(p, { clipId: voices(p)[1].id, asset: take(3), frames: 90 })).toThrow(/0\.50 s too long.*ripple true/);
  });

  it("with ripple moves the lines and captions after it by the difference, and nothing before", () => {
    const p = fixture();
    const id = voices(p)[1].id;
    const r = retakeLine(p, { clipId: id, asset: take(3), frames: 90, ripple: true });
    expect(r.shift).toBe(30);
    expect(voices(r.project).map((c) => [c.start, c.duration])).toEqual([
      [0, 60],
      [75, 90],
      [180, 60],
    ]);
    expect(caps(r.project).map((x) => [x.start, x.duration])).toEqual([
      [0, 60],
      [75, 90],
      [180, 60],
    ]);
  });

  it("keeps a file another clip still plays", () => {
    let p = fixture();
    p = runCommand(p, "add_media_clip", { asset_id: "a2", start: 20 });
    const r = retakeLine(p, { clipId: voices(p)[1].id, asset: take(1), frames: 30 });
    expect(r.project.assets.some((a) => a.id === "a2")).toBe(true);
  });
});
