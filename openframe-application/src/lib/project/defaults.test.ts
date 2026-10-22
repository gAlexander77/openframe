import { describe, expect, it } from "vitest";
import { createProject, DEFAULT_ADJUST, normalizeProject, ProjectError } from "./defaults";

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

  it("keeps a clip's background matte, drops a broken one, and loads older files unchanged", () => {
    const load = (cutout: unknown) => {
      const p = normalizeProject({
        assets: [{ id: "a1", src: "talk.mp4", duration: 10 }],
        tracks: [{ kind: "video", clips: [{ type: "video", assetId: "a1", start: 0, duration: 30, ...(cutout === undefined ? {} : { cutout }) }] }],
      });
      return p.tracks[0].clips[0] as { cutout?: unknown };
    };
    expect(load(undefined)).not.toHaveProperty("cutout");
    expect(load({ src: "matte-talk.mp4", from: 0, to: 1, model: "m" }).cutout).toEqual({ enabled: true, src: "matte-talk.mp4", from: 0, to: 1, model: "m" });
    expect(load({ enabled: false, src: "matte-talk.mp4", from: 2, to: 4 }).cutout).toEqual({ enabled: false, src: "matte-talk.mp4", from: 2, to: 4, model: "" });
    for (const broken of [true, { from: 0, to: 1 }, { src: "", from: 0, to: 1 }, { src: "m.mp4", from: 1, to: 1 }, { src: "m.mp4", from: "0", to: 1 }]) {
      expect(load(broken)).not.toHaveProperty("cutout");
    }
    const color = normalizeProject({ tracks: [{ kind: "video", clips: [{ type: "color", start: 0, duration: 5, cutout: { src: "m.mp4", from: 0, to: 1 } }] }] });
    expect(color.tracks[0].clips[0]).not.toHaveProperty("cutout");
  });

  it("gives an empty document a main track", () => {
    const p = normalizeProject({});
    expect(p.tracks).toHaveLength(1);
    expect(p.tracks[0].main).toBe(true);
  });
});

describe("a chosen canvas (UX-02)", () => {
  it("is marked when a size is given up front, kept on load, absent otherwise", () => {
    expect(createProject({ width: 1080, height: 1920 }).canvasFixed).toBe(true);
    expect(createProject().canvasFixed).toBeUndefined();
    expect(normalizeProject({ ...createProject({ width: 1080, height: 1920 }) }).canvasFixed).toBe(true);
    expect(normalizeProject({ width: 1080, height: 1920 }).canvasFixed).toBeUndefined();
  });
});


it("validates optional held duck pauses without dropping unrelated clip data", () => {
  const load = (held: unknown) => normalizeProject({ assets: [{ id: "music", src: "music.wav", kind: "audio", duration: 10, hasAudio: true }], tracks: [{ kind: "audio", clips: [{ type: "audio", assetId: "music", duration: 300, duck: { keys: 12, held, minGap: 1.1 }, custom: "kept" }] }] }).tracks.flatMap((t) => t.clips).find((c) => c.type === "audio")!;
  const c = load([[1, 1.5], [3, 2], [0, Infinity], ["1", 2], [-1, 2], null]);
  expect(c).toMatchObject({ duck: { keys: 12, minGap: 1.1, held: [[1, 1.5]] }, custom: "kept" });
  expect(load("broken")).toMatchObject({ duck: { keys: 12 } });
  expect((load("broken") as { duck?: { held?: unknown } }).duck?.held).toBeUndefined();
});
