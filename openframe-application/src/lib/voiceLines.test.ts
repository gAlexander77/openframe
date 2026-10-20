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

describe("a retake of a line captioned a few words at a time (ADR-115)", () => {
  /** Line two's caption cut into three chunks, styled and animated by hand. */
  function chunked(): Project {
    let p = fixture();
    const two = caps(p)[1];
    p = runCommand(p, "delete_clips", { clip_ids: [two.id] });
    p = runCommand(p, "add_captions", { captions: [{ text: "Two", start: 2.5, end: 3 }, { text: "and two", start: 3, end: 3.8, words: [3, 3.4] }, { text: "more.", start: 3.8, end: 4.5 }], style: { color: "#8fe9ff", highlight: "#ffffff" } });
    const ids = caps(p).filter((c) => c.start >= 75 && c.start < 135).map((c) => c.id);
    for (const id of ids) p = runCommand(p, "set_animation", { clip_id: id, slot: "in", type: "pop" });
    return p;
  }

  it("puts the new take's chunks where the line's were, each like its first, the rest untouched", () => {
    const p = chunked();
    const id = voices(p)[1].id;
    expect(caps(p).map((c) => (c as { text: string }).text)).toEqual(["One.", "Two", "and two", "more.", "Three."]);
    const r = retakeLine(p, { clipId: id, asset: take2(2.2), frames: 66, ripple: true, chunks: [{ start: 0.1, end: 0.9, text: "Two,", words: [0.1] }, { start: 0.9, end: 2.2, text: "once more.", words: [0.9, 1.5] }] });
    const after = caps(r.project) as unknown as { id: string; text: string; start: number; duration: number; wordTimes?: number[]; style: { color: string; highlight?: string }; animIn?: { type: string } }[];
    expect(after.map((c) => c.text)).toEqual(["One.", "Two,", "once more.", "Three."]);
    expect(r.captionIds).toEqual([after[1].id, after[2].id]);
    // At the line's start (75) plus each chunk's time, its words from its own start.
    expect(after.slice(1, 3).map((c) => [c.start, c.duration, c.wordTimes])).toEqual([[78, 24, [0]], [102, 39, [0, 18]]]);
    // Styled and animated as the line's first chunk was.
    expect(after[2]).toMatchObject({ style: { color: "#8fe9ff", highlight: "#ffffff" }, animIn: { type: "pop" } });
    // The take grew 0.2 s: the next line and its caption moved with it.
    expect(r.shift).toBe(6);
    expect(after[3].start).toBe(156);
  });

  function take2(seconds: number): Asset {
    return speech("new2", seconds, "Two, once more.");
  }
});
