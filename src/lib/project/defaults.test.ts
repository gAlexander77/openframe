import { describe, expect, it } from "vitest";
import { DEFAULT_ADJUST, normalizeProject, ProjectError } from "./defaults";

describe("normalizeProject", () => {
  it("completes the minimal JSON an agent would write", () => {
    const p = normalizeProject({
      fps: 25,
      assets: [{ id: "a1", src: "C:/media/intro.mp4", duration: 10 }],
      tracks: [
        {
          kind: "video",
          clips: [
            { type: "text", text: "Hello", start: 0, duration: 50 },
            { type: "video", assetId: "a1", start: 50, duration: 100 },
          ],
        },
      ],
    });
    expect(p.fps).toEqual({ num: 25, den: 1 });
    expect(p.tracks[0].main).toBe(true);
    const [text, video] = p.tracks[0].clips;
    expect(text.type === "text" && text.style.size).toBe(96);
    expect(video.type === "video" && video.transform.scale).toBe(1);
    expect(video.type === "video" && video.volume).toBe(1);
    expect(p.assets[0].name).toBe("intro.mp4");
  });

  it("sorts clips but refuses overlaps, wrong tracks and dangling assets", () => {
    const track = (clips: unknown[], kind = "video") => ({ tracks: [{ kind, clips }] });
    expect(() =>
      normalizeProject(
        track([
          { type: "color", start: 0, duration: 10 },
          { type: "color", start: 5, duration: 10 },
        ]),
      ),
    ).toThrow(/overlaps/);
    expect(() =>
      normalizeProject(track([{ type: "text", start: 0, duration: 1 }], "audio")),
    ).toThrow(ProjectError);
    expect(() =>
      normalizeProject(track([{ type: "video", assetId: "nope", start: 0, duration: 1 }])),
    ).toThrow(/not in assets/);
  });

  it("keeps files without a grade unchanged, and checks LUT references", () => {
    const old = normalizeProject({ tracks: [{ kind: "video", clips: [{ type: "color", start: 0, duration: 5, adjust: { exposure: 10 } }] }] });
    const c = old.tracks[0].clips[0];
    expect(c.type === "color" && Object.keys(c.adjust).sort()).toEqual(Object.keys(DEFAULT_ADJUST).sort());
    expect(c.type === "color" && c.adjust.exposure).toBe(10);
    expect(old.luts).toBeUndefined();

    const graded = normalizeProject({
      luts: [{ id: "l1", src: "C:/luts/Film Look.cube", kind: "3d", size: 33 }],
      tracks: [{ kind: "video", clips: [{ type: "adjustment", start: 0, duration: 5, adjust: { lut: { id: "l1", intensity: 2 }, wheels: { gain: { y: 10 } } } }] }],
    });
    expect(graded.luts?.[0].name).toBe("Film Look.cube");
    const adj = graded.tracks[0].clips[0];
    expect(adj.type === "adjustment" && adj.adjust.lut).toEqual({ id: "l1", intensity: 1 });
    expect(adj.type === "adjustment" && adj.adjust.wheels?.gain).toEqual({ r: 0, g: 0, b: 0, y: 10 });
    expect(adj.type === "adjustment" && adj.adjust.exposure).toBe(0);
    expect(() =>
      normalizeProject({ tracks: [{ kind: "video", clips: [{ type: "color", start: 0, duration: 5, adjust: { lut: { id: "gone" } } }] }] }),
    ).toThrow(/lut gone is not in luts/);
  });

  it("gives an empty document a main track", () => {
    const p = normalizeProject({});
    expect(p.tracks).toHaveLength(1);
    expect(p.tracks[0].main).toBe(true);
  });
});
