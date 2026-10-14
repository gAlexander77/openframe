import { describe, expect, it } from "vitest";
import { normalizeProject, ProjectError } from "./defaults";

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

  it("gives an empty document a main track", () => {
    const p = normalizeProject({});
    expect(p.tracks).toHaveLength(1);
    expect(p.tracks[0].main).toBe(true);
  });
});
