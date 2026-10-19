// Animated GIF export (CapCut's Export GIF, Premiere's Animated GIF through
// Media Encoder): the same frames the video export draws, each quantized to
// its own 256-color palette by gifenc (MIT) and written with frame delays
// that add up to the real duration. GIFs have no sound. The whole file is
// built in memory, which is why the plan caps size and length
// (gifLimits in src/lib/export.ts).

import { applyPalette, GIFEncoder, quantize } from "gifenc";
import type { StreamTargetChunk } from "mediabunny";
import { gifDelays, timelineFrameFor, type ExportPlan } from "../lib/export";
import type { Project } from "../lib/project/types";
import { planFrame } from "../lib/render/plan";
import { Compositor } from "./compositor";
import type { ExportProgress, ExportResult } from "./export";
import { CursorPool, resolveSources, sourceImages } from "./player";

export async function exportGif(
  p: Project,
  plan: ExportPlan,
  target: { writable: WritableStream<StreamTargetChunk> },
  onProgress: (x: ExportProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<ExportResult> {
  const started = performance.now();
  const v = plan.video!;
  const writer = target.writable.getWriter();
  const comp = new Compositor(new OffscreenCanvas(v.width, v.height));
  const read = new OffscreenCanvas(v.width, v.height).getContext("2d", { willReadFrequently: true })!;
  const pool = new CursorPool();
  try {
    onProgress({ phase: "preparing", done: 0, total: plan.frames, fraction: 0, fps: 0, eta: null });
    await document.fonts.ready;
    comp.resize(v.width, v.height);
    const gif = GIFEncoder();
    const delays = gifDelays(plan.frames, v.fps);
    for (let n = 0; n < plan.frames; n++) {
      signal?.throwIfAborted();
      const f = timelineFrameFor(n, plan.range.from, p.fps, v.fps);
      const items = planFrame(p, f);
      const resolved = await resolveSources(p, items, pool);
      comp.render(items, sourceImages(resolved, v.width, v.height), p.background);
      read.drawImage(comp.canvas, 0, 0);
      const { data } = read.getImageData(0, 0, v.width, v.height);
      const palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), v.width, v.height, { palette, delay: delays[n] });
      if (n % 30 === 29) pool.sweep(2000);
      const elapsed = (performance.now() - started) / 1000;
      const rate = (n + 1) / Math.max(elapsed, 1e-3);
      onProgress({ phase: "rendering", done: n + 1, total: plan.frames, fraction: (n + 1) / plan.frames, fps: rate, eta: (plan.frames - n - 1) / rate });
      // Let the progress view paint between frames.
      if (n % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
    onProgress({ phase: "finalizing", done: plan.frames, total: plan.frames, fraction: 1, fps: 0, eta: 0 });
    gif.finish();
    const bytes = gif.bytes();
    signal?.throwIfAborted();
    await writer.write({ type: "write", data: bytes, position: 0 });
    await writer.close();
    return { frames: plan.frames, seconds: plan.seconds, bytes: bytes.byteLength, elapsed: (performance.now() - started) / 1000, videoCodec: "gif", audioCodec: null, audioDelay: 0 };
  } catch (e) {
    // A canceled or failed GIF never commits a file.
    await writer.abort(e).catch(() => undefined);
    throw e;
  } finally {
    pool.clear();
    const gl = comp.gl;
    comp.dispose();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
