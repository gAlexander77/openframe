import { describe, expect, it } from "vitest";
import { clipForAsset, createProject } from "../project/defaults";
import { addClip, setReverse, setSpeedCurve, sourceTimeAt } from "../project/ops";
import type { Asset, Clip, Project, VideoClip } from "../project/types";
import { PRESETS } from "../speed";
import { planFrame } from "./plan";

const asset: Asset = { id: "a1", kind: "video", name: "a.mp4", src: "a.mp4", duration: 10, fps: 30, hasVideo: true, hasAudio: false };

function one(): Project {
  const p = { ...createProject({ fps: { num: 30, den: 1 } }), assets: [asset] };
  return addClip(p, p.tracks[0].id, { ...clipForAsset(asset, 0, p.fps), id: "v", duration: 60, in: 1 } as Clip);
}

const source = (p: Project, f: number) => {
  const item = planFrame(p, f)[0];
  if (item.kind !== "layer" || item.layer.source.kind !== "video") throw new Error("no video layer");
  return item.layer.source;
};

describe("planFrame with retimed clips", () => {
  it("flags reversed layers so the engine decodes backward, frame for frame", () => {
    const p = setReverse(one(), "v", true);
    const frames = Array.from({ length: 60 }, (_, f) => source(p, f));
    expect(frames.every((s) => s.reverse === true)).toBe(true);
    expect(frames.map((s) => Math.floor(s.time * 30))).toEqual(Array.from({ length: 60 }, (_, i) => 89 - i));
    expect(source(one(), 0).reverse).toBeUndefined();
  });

  it("asks a ramped clip for the curve's source time plus the quarter-frame guard", () => {
    const p = setSpeedCurve(one(), "v", PRESETS.flashIn.points, "flashIn");
    const c = p.tracks[0].clips[0] as VideoClip;
    for (const f of [0, 3, 10, c.duration - 1]) {
      expect(source(p, f).time).toBeCloseTo(sourceTimeAt(c, f, p.fps) + 0.25 / 30, 12);
    }
  });
});
