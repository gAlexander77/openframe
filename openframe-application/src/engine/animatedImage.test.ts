import { afterEach, expect, it, vi } from "vitest";
import { createProject, clipForAsset } from "../lib/project/defaults";
import type { Asset } from "../lib/project/types";
import { planFrame } from "../lib/render/plan";
import { borrowImage, probe } from "./media";
import { closeAnimation } from "./animatedImage";
import { CursorPool, resolveSources } from "./player";
import { memoryOwners } from "./memory";

vi.mock("../platform", () => ({ platform: { blobFor: async () => new Blob(["animated"]) } }));

afterEach(() => { memoryOwners.endSession(); vi.unstubAllGlobals(); });

it.each(["gif", "webp", "apng"])("lends timed %s frames and releases an evicted loop when its clip leaves the plan", async ext => {
  const closed: ReturnType<typeof vi.fn>[] = [];
  class Decoder {
    static isTypeSupported = async () => true;
    tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 2 } };
    async decode({ frameIndex }: { frameIndex: number }) {
      return { image: { displayWidth: 32, displayHeight: 32, duration: 500000, frameIndex, close: vi.fn() } };
    }
    close() {}
  }
  vi.stubGlobal("ImageDecoder", Decoder);
  vi.stubGlobal("createImageBitmap", async (frame: { frameIndex: number }) => {
    const close = vi.fn(); closed.push(close);
    return { width: 32, height: 32, frameIndex: frame.frameIndex, close };
  });
  const src = `animated.${ext}`, info = await probe(src, src);
  expect(info.animated).toBe(true);
  const asset: Asset = { ...info, id: "animation", src, name: src };
  const first = await borrowImage(asset, 0), later = await borrowImage(asset, 0.6), loop = await borrowImage(asset, 1);
  expect(first.value).not.toBe(later.value);
  expect(first.value).toBe(loop.value);
  first.release(); later.release(); loop.release();
  const p = createProject(); p.assets = [asset]; p.tracks[0].clips = [clipForAsset(asset, 0, p.fps)];
  const pool = new CursorPool();
  try {
    await resolveSources(p, planFrame(p, 0), pool);
    closeAnimation(src);
    expect(memoryOwners.snapshot().animated_image_borrows.bytes).toBe(32 * 32 * 4 * 2);
    expect(closed.every(close => close.mock.calls.length === 0)).toBe(true);
    await resolveSources(p, [], pool);
    expect(closed.every(close => close.mock.calls.length === 1)).toBe(true);
    expect(memoryOwners.snapshot().animated_image_borrows.bytes).toBe(0);
  } finally { pool.clear(); }
});
