// Filmstrips and waveforms for compound clips (ADR-037). A strip is the
// nested timeline itself, rendered by the viewer's plan, sources and
// compositor on a small offscreen canvas, a frame per step; a waveform is
// the inner clips' own peaks (engine/thumbs.ts), mixed the way the sound
// is: through soundingClips, so solo, mute, volume and fades show.
//
// Both are cached per Compound object. Editing inside a compound makes a
// new object, so its strip renders again the next time the compound clip
// is on screen; the old one is garbage with it.

import { soundGainAt, soundingClips } from "../lib/audio";
import { compoundView } from "../lib/project/compound";
import { getAsset, sourceOffset, timelineEnd } from "../lib/project/ops";
import type { Compound, Project } from "../lib/project/types";
import { planFrame } from "../lib/render/plan";
import { framesToSeconds } from "../lib/time";
import { Compositor } from "./compositor";
import { CursorPool, resolveSources, sourceImages } from "./player";
import { notifyThumbs, thumbs, type Filmstrip, type Peaks } from "./thumbs";

const THUMB_H = 96;
const PEAK_RATE = 100;

const strips = new WeakMap<Compound, Filmstrip>();
const peaks = new WeakMap<Compound, { version: number; peaks: Peaks }>();

/** The compound's filmstrip, frames arriving as they render. Inner
 * seconds index it, like a file's. */
export function compoundStrip(p: Project, k: Compound): Filmstrip {
  let s = strips.get(k);
  if (!s) {
    const seconds = framesToSeconds(timelineEnd(k.tracks), p.fps);
    // Fewer than a file's: every thumbnail is a full composite.
    const step = Math.max(0.5, seconds / 60);
    s = { step, frames: new Array(Math.max(1, Math.ceil(seconds / step))), aspect: p.width / p.height };
    strips.set(k, s);
    const strip = s;
    queue.push(() => render(p, k, strip));
    void pump();
  }
  return s;
}

const queue: (() => Promise<void>)[] = [];
let busy = false;
let comp: Compositor | null = null;
let warm: Promise<void> | null = null;

/** One strip at a time, a macrotask between frames, so a timeline full of
 * compound clips never starves playback. */
async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) await queue.shift()!().catch((e) => console.warn("compound strip failed:", e));
  } finally {
    busy = false;
  }
}

async function render(p: Project, k: Compound, strip: Filmstrip) {
  const view = compoundView(p, k.id);
  const h = THUMB_H;
  const w = Math.max(2, Math.round(h * strip.aspect));
  comp ??= new Compositor(new OffscreenCanvas(w, h));
  // Shaders compile off the main thread before the first frame needs them.
  await (warm ??= comp.warm().catch(() => undefined));
  comp.resize(w, h);
  const pool = new CursorPool({ maxSide: 320 }, "thumbnail");
  const fps = p.fps.num / p.fps.den;
  const end = timelineEnd(k.tracks);
  try {
    let last = performance.now();
    for (let i = 0; i < strip.frames.length; i++) {
      const plan = planFrame(view, Math.min(end - 1, Math.round(i * strip.step * fps)));
      const resolved = await resolveSources(view, plan, pool);
      comp.render(plan, sourceImages(resolved, w, h), p.background);
      strip.frames[i] = await createImageBitmap(comp.canvas);
      if (performance.now() - last > 250) {
        last = performance.now();
        notifyThumbs();
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    pool.clear();
    notifyThumbs();
  }
}

/** The compound's sound as peaks over its own seconds: every inner
 * sounding clip's peaks at the source time it plays, times its gain,
 * summed. Recomputed as the inner files' peaks arrive. */
export function compoundPeaks(p: Project, k: Compound): Peaks | undefined {
  const version = thumbs.version();
  const hit = peaks.get(k);
  if (hit && hit.version === version) return hit.peaks;
  const view = compoundView(p, k.id);
  const sounding = soundingClips(view, (id) => getAsset(view, id)?.hasAudio ?? false);
  if (!sounding.length) return undefined;
  const data = new Float32Array(Math.ceil(framesToSeconds(timelineEnd(k.tracks), p.fps) * PEAK_RATE) + 1);
  const fps = p.fps.num / p.fps.den;
  for (const s of sounding) {
    const asset = getAsset(view, s.clip.assetId);
    const src = asset && thumbs.peaks(asset);
    if (!src) continue;
    const t0 = framesToSeconds(s.clip.start, p.fps);
    const t1 = framesToSeconds(s.clip.start + s.clip.duration, p.fps);
    for (let b = Math.max(0, Math.floor(t0 * PEAK_RATE)); b < Math.min(data.length, Math.ceil(t1 * PEAK_RATE)); b++) {
      const t = b / PEAK_RATE;
      const at = s.clip.in + (s.clip.reverse ? -1 : 1) * sourceOffset(s.clip, (t - t0) * fps, p.fps);
      const v = (src.data[Math.floor(at * src.rate)] ?? 0) * soundGainAt(s, p.fps, t);
      data[b] = Math.min(1, data[b] + v);
    }
  }
  const out = { data, rate: PEAK_RATE };
  peaks.set(k, { version, peaks: out });
  return out;
}

/** Does anything inside make sound? */
export const compoundHasSound = (p: Project, k: Compound) => {
  const view = compoundView(p, k.id);
  return soundingClips(view, (id) => getAsset(view, id)?.hasAudio ?? false).length > 0;
};
