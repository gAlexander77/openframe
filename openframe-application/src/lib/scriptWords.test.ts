import { describe, expect, it } from "vitest";
import { wordsToCaptions, type Word } from "./captions";
import { createProject, createTrack } from "./project/defaults";
import type { AudioClip, Project } from "./project/types";
import { assetWords, scriptTimes, withScripts } from "./scriptWords";

const w = (text: string, start: number, end: number): Word => ({ text, start, end });

describe("a known script's words, timed by what was heard", () => {
  it("shows the script where Whisper misheard it, at the times it heard", () => {
    // The launch footage: "All of it, home" heard as "Olivet Helmed".
    const heard = [w(" Bring", 0, 0.3), w(" Olivet", 0.35, 0.8), w(" Helmed.", 0.9, 1.3)];
    const out = scriptTimes("Bring all of it, home.", heard);
    expect(out.map((x) => x.text)).toEqual(["Bring", "all", "of", "it,", "home."]);
    expect(out[0]).toMatchObject({ start: 0, end: 0.3 });
    expect(out[4]).toMatchObject({ start: 0.9, end: 1.3 });
    // In order, each inside the speech.
    for (let i = 1; i < out.length; i++) expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].start);
    expect(out.every((x) => x.start >= 0 && x.end <= 1.3)).toBe(true);
  });

  it("lines numbers and symbols up as they are said", () => {
    const out = scriptTimes("Save 20% today.", [w("save", 1, 1.3), w("twenty", 1.35, 1.7), w("percent", 1.75, 2.2), w("today.", 2.3, 2.7)]);
    expect(out).toEqual([w("Save", 1, 1.3), w("20%", 1.35, 2.2), w("today.", 2.3, 2.7)]);
  });

  it("spreads the words over the span by their length when nothing was heard", () => {
    expect(scriptTimes("One two six", [], 2, 5).map((x) => [x.start, x.end])).toEqual([[2, 3], [3, 4], [4, 5]]);
    expect(scriptTimes("Go there", [], 0, 3).map((x) => [x.start, x.end])).toEqual([[0, 0.857], [0.857, 3]]);
  });

  /** A project with one voice line (0.5 s to 2.5 s) of a known script. */
  function voiced(trim = false): Project {
    const p = createProject();
    p.assets = [{ id: "v", kind: "audio", name: "line.wav", src: "line.wav", duration: 2, hasVideo: false, hasAudio: true, speech: { text: "Bring all of it, [pause 0.3] home.", voice: "af_heart", speed: 1 } }];
    const clip = { id: "c_v", type: "audio", assetId: "v", start: 15, duration: trim ? 30 : 60, in: 0, speed: 1, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 } as unknown as AudioClip;
    p.tracks = [...p.tracks, { ...createTrack("audio", "Voiceover"), clips: [clip] }];
    return p;
  }

  it("captions a whole voice line in its script's words, pause marks left out", () => {
    const heard = [w("Hello.", 0, 0.2), w("Bring", 0.9, 1.1), w("Olivet", 1.15, 1.5), w("Helmed.", 1.8, 2.2), w("there", 3, 3.3)];
    const words = withScripts(voiced(), heard);
    expect(words.map((x) => x.text)).toEqual(["Hello.", "Bring", "all", "of", "it,", "home.", "there"]);
    expect(wordsToCaptions(words).map((c) => c.text).join(" ")).toBe("Hello. Bring all of it, home. there");
    // A piece of the take says only part of it: Whisper's words stand.
    expect(withScripts(voiced(true), heard)).toEqual(heard);
  });

  it("gives a whole take's transcript its script's words, and leaves a part alone", () => {
    const heard = [w("Bring", 0, 0.3), w("Olivet", 0.35, 0.8), w("Helmed.", 1.1, 1.6)];
    expect(assetWords(voiced(), "v", 0, 2, heard).map((x) => x.text)).toEqual(["Bring", "all", "of", "it,", "home."]);
    expect(assetWords(voiced(), "v", 0.5, 2, heard)).toBe(heard);
  });
});
