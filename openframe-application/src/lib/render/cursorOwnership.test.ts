import { expect, it, vi } from "vitest";
import type { VideoSampleSink, EncodedPacketSink, VideoSample } from "mediabunny";
import { ReverseCursor, VideoCursor } from "../../engine/cursor";
const keys = { getKeyPacket: async () => ({ timestamp: 0 }) } as unknown as EncodedPacketSink;
it("lends the prepared head and closes it exactly once on advancing and disposal", async () => {
  const samples = [0, 1].map(timestamp => ({ timestamp, duration: 1, close: vi.fn() }));
  const sink = { async *samples() { for (const s of samples) yield s; } } as unknown as VideoSampleSink;
  const c = new VideoCursor(sink, keys, 0);
  expect(await c.frameAt(0)).toBe(samples[0]);
  expect(await c.frameAt(0.5)).toBe(samples[0]);
  expect(samples[0].close).not.toHaveBeenCalled();
  await c.frameAt(1);
  expect(samples[0].close).toHaveBeenCalledTimes(1);
  c.dispose(); c.dispose();
  await c.frameAt(2);
  expect(samples[1].close).toHaveBeenCalledTimes(1);
});
it("closes an arriving sample when disposal interrupts preroll", async () => {
  let deliver!: (s: VideoSample) => void;
  const pending = new Promise<VideoSample>(r => { deliver = r; });
  const arrived = { timestamp: 0, duration: 1, close: vi.fn() } as unknown as VideoSample;
  const ended = vi.fn();
  const sink = { async *samples() { try { yield await pending; } finally { ended(); } } } as unknown as VideoSampleSink;
  const c = new VideoCursor(sink, keys, 0);
  const preparing = c.frameAt(0);
  await new Promise(r => setTimeout(r, 0));
  c.dispose(); deliver(arrived);
  expect(await preparing).toBeNull();
  await c.frameAt(1);
  expect(arrived.close).toHaveBeenCalledTimes(1);
  expect(ended).toHaveBeenCalledTimes(1);
});

it("closes completed reverse prefetches when skipped or disposed and releases the input once", async () => {
  const bitmaps: { width: number; height: number; close: ReturnType<typeof vi.fn> }[] = [];
  const samples: { close: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("createImageBitmap", vi.fn(async () => { const bitmap = { width: 16, height: 16, close: vi.fn() }; bitmaps.push(bitmap); return bitmap; }));
  const sink = { async *samples(from: number) {
    for (let i = 0; i < 2; i++) {
      const sample = { timestamp: from + i / 30, duration: 1 / 30, displayWidth: 16, displayHeight: 16, rotation: 0, close: vi.fn(), toCanvasImageSource: () => ({ width: 16, height: 16 }) };
      samples.push(sample); yield sample;
    }
  } } as unknown as VideoSampleSink;
  const release = vi.fn();
  const cursor = new ReverseCursor(sink, keys, 0, { width: 16, height: 16 }, { budget: 4096 }, release);
  try {
    await cursor.frameAt(10);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(bitmaps.length).toBe(4);
    await cursor.frameAt(1); // The finished prefetch at ~10 s is discarded.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(bitmaps.length).toBe(8);
    cursor.dispose(); cursor.dispose();
    await cursor.frameAt(0);
    expect(bitmaps.every(b => b.close.mock.calls.length === 1)).toBe(true);
    expect(samples.every(s => s.close.mock.calls.length === 1)).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  } finally { cursor.dispose(); vi.unstubAllGlobals(); }
});
