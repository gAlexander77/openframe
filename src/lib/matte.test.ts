import { describe, expect, it } from "vitest";
import { clipForAsset } from "./project/defaults";
import type { Asset, VideoClip } from "./project/types";
import { clipWindow, covers, matteSize, stabilize } from "./matte";

/** Run the stabilizer over a sequence the way the matte maker does. */
function run(frames: Uint8Array[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  let last: Uint8Array | null = null;
  frames.forEach((cur, i) => {
    last = stabilize(frames[i - 1] ?? null, cur, frames[i + 1] ?? null, last);
    out.push(last);
  });
  return out;
}

const px = (...v: number[]) => Uint8Array.from(v);

describe("matteSize", () => {
  it("keeps the aspect with the long side capped, in even pixels", () => {
    expect(matteSize(1920, 1080)).toEqual({ width: 1024, height: 576 });
    expect(matteSize(1080, 1920)).toEqual({ width: 576, height: 1024 });
    expect(matteSize(960, 540)).toEqual({ width: 960, height: 540 });
    expect(matteSize(3840, 1601)).toEqual({ width: 1024, height: 426 });
    expect(matteSize(641, 361)).toEqual({ width: 642, height: 362 });
  });
});

describe("stabilize", () => {
  it("removes a one-frame pop without touching its neighbors", () => {
    // A pixel on the person drops out for a single frame (a model miss).
    const seq = [255, 255, 0, 255, 255].map((v) => px(v));
    expect(run(seq).map((f) => f[0])).toEqual([255, 255, 255, 255, 255]);
  });

  it("lets a moving edge through with no lag or ghost", () => {
    // A hard edge crossing a row of 8 pixels, one pixel a frame.
    const seq = Array.from({ length: 10 }, (_, t) => Uint8Array.from({ length: 8 }, (_, x) => (x < t ? 255 : 0)));
    run(seq).forEach((f, t) => expect([...f]).toEqual([...seq[t]]));
  });

  it("damps shimmer around a steady value", () => {
    // Soft-edge noise around 128. The median alone keeps most of it.
    const seq = Array.from({ length: 40 }, (_, t) => px(128 + (t % 2 ? 8 : -8) + (t % 3) * 3));
    const swing = (fs: Uint8Array[]) => Math.max(...fs.slice(5).map((f) => f[0])) - Math.min(...fs.slice(5).map((f) => f[0]));
    const out = run(seq);
    expect(swing(out)).toBeLessThan(swing(seq) / 2);
    const mean = out.slice(5).reduce((a, f) => a + f[0], 0) / (out.length - 5);
    expect(Math.abs(mean - 129)).toBeLessThan(4);
  });

  it("settles on a small real change within a few frames", () => {
    const seq = Array.from({ length: 12 }, (_, t) => px(t < 2 ? 100 : 112));
    const out = run(seq).map((f) => f[0]);
    expect(out[11]).toBeGreaterThanOrEqual(111);
    expect(out[11]).toBeLessThanOrEqual(112);
  });

  it("passes the first frame through as its median with the next", () => {
    expect([...stabilize(null, px(10, 200), px(30, 190), null)]).toEqual([10, 200]);
  });
});

describe("clipWindow and covers", () => {
  const asset: Asset = { id: "a", kind: "video", name: "v.mp4", src: "v.mp4", duration: 20, fps: 30, hasVideo: true, hasAudio: false };
  const fps = { num: 30, den: 1 };

  it("is the source seconds the clip shows, speed included", () => {
    const clip: VideoClip = { ...(clipForAsset(asset, 30, fps) as VideoClip), in: 2, duration: 60, speed: 2 };
    expect(clipWindow(clip, fps)).toEqual([2, 6]);
  });

  it("is one frame for a freeze", () => {
    const clip: VideoClip = { ...(clipForAsset(asset, 0, fps) as VideoClip), in: 3, duration: 90, freeze: true };
    const [from, to] = clipWindow(clip, fps);
    expect(from).toBe(3);
    expect(to).toBeCloseTo(3 + 1 / 30, 9);
  });

  it("covers a window inside the matte, give or take a frame", () => {
    expect(covers({ from: 1.99, to: 6 }, 2, 6)).toBe(true);
    expect(covers({ from: 2, to: 5.5 }, 2, 6)).toBe(false);
    expect(covers({ from: 2.1, to: 6 }, 2, 6)).toBe(false);
  });
});
