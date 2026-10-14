// The preview player: turns store state into pictures and sound.
//
// - Paused: any change to the project, playhead, hover frame (preview
//   axis) or preview size renders that one frame. Requests coalesce, latest
//   wins, so a fast scrub never queues stale decodes.
// - Playing: the audio clock is master (ADR-002). Each animation frame
//   derives the timeline frame from audible time and renders it; video that
//   is late is dropped, never waited for.
// - Shuttle (J/K/L): forward rates play with sound at 1x and speed up as
//   silent frame playback at 2x/4x/8x; reverse is silent frame playback.

import type { VideoSample } from "mediabunny";
import { getAsset, projectDuration, sourceTimeAt } from "../lib/project/ops";
import type { Id, Project, VisualClip } from "../lib/project/types";
import { planFrame, type Layer, type PlanItem } from "../lib/render/plan";
import { frameAt, framesToSeconds } from "../lib/time";
import { provide } from "../state/actions";
import { store, type EditorState } from "../state/store";
import { audibleTime, audioContext, masterBus, scheduleAudio, type Schedule } from "./audio";
import { Compositor, type SourceImage } from "./compositor";
import { ReverseCursor, VideoCursor, type HeldFrame, type ReverseOptions } from "./cursor";
import { loadPlanLuts } from "./luts";
import { imageFor, mediaFor } from "./media";
import { rasterizeText } from "./text";

interface CursorEntry {
  cursor: Promise<VideoCursor | ReverseCursor | null>;
  used: number;
}

/** Resolved pixels for one plan, ready for a synchronous compositor pass. */
type Resolved = Map<Id, { sample?: VideoSample; frame?: HeldFrame; bitmap?: ImageBitmap; key?: string }>;

const layersOf = (plan: PlanItem[]): Layer[] =>
  plan.flatMap((i) => (i.kind === "layer" ? [i.layer] : i.kind === "transition" ? [i.from, i.to] : []));

/** Decode cursors keyed by clip, shared shape for preview and export.
 * Reversed clips get a ReverseCursor; `reverse` sets the size it holds
 * frames at (default: full size, exact frames for export). */
export class CursorPool {
  private map = new Map<string, CursorEntry>();

  constructor(private reverse: ReverseOptions = {}) {}

  get(p: Project, clipId: Id, assetId: Id): Promise<VideoCursor | null> {
    return this.open(p, clipId, assetId, false) as Promise<VideoCursor | null>;
  }

  getReverse(p: Project, clipId: Id, assetId: Id): Promise<ReverseCursor | null> {
    return this.open(p, clipId, assetId, true) as Promise<ReverseCursor | null>;
  }

  private open(p: Project, clipId: Id, assetId: Id, reverse: boolean) {
    const key = reverse ? `${clipId}#reverse` : clipId;
    let e = this.map.get(key);
    if (!e) {
      const asset = getAsset(p, assetId);
      const cursor = asset
        ? mediaFor(asset).then((m) => {
            if (!m.videoSink || !m.keySink) return null;
            if (!reverse) return new VideoCursor(m.videoSink, m.keySink, m.videoStart);
            return new ReverseCursor(m.videoSink, m.keySink, m.videoStart, { width: m.width, height: m.height }, this.reverse);
          })
        : Promise.resolve(null);
      e = { cursor: cursor.catch(() => null), used: 0 };
      this.map.set(key, e);
    }
    e.used = performance.now();
    return e.cursor;
  }

  /** Dispose cursors idle for longer than `ms`. */
  sweep(ms: number) {
    const now = performance.now();
    for (const [id, e] of this.map) {
      if (now - e.used > ms) {
        this.map.delete(id);
        void e.cursor.then((c) => c?.dispose());
      }
    }
  }

  clear() {
    for (const e of this.map.values()) void e.cursor.then((c) => c?.dispose());
    this.map.clear();
  }
}

/** Fetch every source a plan needs. Video samples are borrowed from their
 * cursors and stay valid until the next call on the same cursor. */
export async function resolveSources(p: Project, plan: PlanItem[], pool: CursorPool): Promise<Resolved> {
  const out: Resolved = new Map();
  await Promise.all([
    loadPlanLuts(plan),
    ...layersOf(plan).map(async (l) => {
      const src = l.source;
      if (src.kind === "video" && src.reverse) {
        const cursor = await pool.getReverse(p, l.clipId, src.assetId);
        const frame = cursor ? await cursor.frameAt(src.time) : null;
        if (frame) out.set(l.clipId, { frame });
      } else if (src.kind === "video") {
        const cursor = await pool.get(p, l.clipId, src.assetId);
        const sample = cursor ? await cursor.frameAt(src.time) : null;
        if (sample) out.set(l.clipId, { sample });
      } else if (src.kind === "image") {
        const asset = getAsset(p, src.assetId);
        if (asset) {
          const bitmap = await imageFor(asset).catch(() => null);
          if (bitmap) out.set(l.clipId, { bitmap, key: `img:${asset.src}` });
        }
      }
    }),
  ]);
  return out;
}

/** Turn resolved sources into what the compositor uploads. Must run inside
 * the synchronous render: a sample's canvas image may close next microtask. */
export function sourceImages(resolved: Resolved, width: number, height: number) {
  return (l: Layer): SourceImage | null => {
    if (l.source.kind === "text") return rasterizeText(l.source.clip, width, height);
    const r = resolved.get(l.clipId);
    if (!r) return null;
    if (r.bitmap) return { image: r.bitmap, width: r.bitmap.width, height: r.bitmap.height, rotation: 0, key: r.key };
    if (r.frame) return { image: r.frame.image, width: r.frame.width, height: r.frame.height, rotation: r.frame.rotation };
    const s = r.sample!;
    const image = s.toCanvasImageSource();
    // A raw VideoFrame is in coded orientation: rotate it in the quad. A
    // canvas from mediabunny already has rotation applied.
    const raw = typeof VideoFrame !== "undefined" && image instanceof VideoFrame;
    const turns = raw ? (((s.rotation / 90) % 4) as 0 | 1 | 2 | 3) : 0;
    return { image, width: s.displayWidth, height: s.displayHeight, rotation: turns };
  };
}

export class Player {
  private compositor: Compositor | null = null;
  // Reversed clips hold their decoded windows at about screen size.
  private pool = new CursorPool({ maxSide: 1280 });
  private wanted: number | null = null;
  private rendering = false;
  private unsub: () => void;
  private last: Partial<EditorState> = {};
  /** Display size of the canvas in device pixels. */
  private displayW = 0;
  private displayH = 0;

  // playback
  private schedule: Schedule | null = null;
  private rate = 0;
  private t0 = 0;
  private ctxAt = 0;
  private wallAt = 0;
  private raf = 0;
  /** Last frame actually drawn, for the dropped-frame counter. */
  drawn = { frame: -1, dropped: 0 };

  constructor() {
    this.unsub = store.subscribe(() => this.onStore());
    provide({
      playPause: () => (this.rate ? this.pause() : this.play(1)),
      shuttleForward: () => this.play(this.rate <= 0 ? 1 : Math.min(this.rate * 2, 8)),
      shuttleBack: () => this.play(this.rate >= 0 ? -1 : Math.max(this.rate * 2, -8)),
      shuttleStop: () => this.pause(),
    });
  }

  /** Attach the preview canvas (or detach with null). */
  attach(canvas: HTMLCanvasElement | null) {
    this.compositor?.dispose();
    this.compositor = canvas ? new Compositor(canvas) : null;
    this.pool.clear();
    if (canvas) this.request();
  }

  /** The canvas's on-screen size changed (device pixels). */
  setDisplaySize(w: number, h: number) {
    this.displayW = w;
    this.displayH = h;
    this.request();
  }

  get playing() {
    return this.rate !== 0;
  }

  /** Resolves when no frame is pending or drawing. */
  async idle(): Promise<void> {
    while (this.rendering || this.wanted !== null) await new Promise((r) => setTimeout(r, 16));
  }

  /** What the viewer shows, as { width, height, data } (RGBA, top row
   * first); with `maxWidth`, scaled down on the GPU first (scopes). */
  pixels(maxWidth?: number) {
    const c = this.compositor;
    if (!c) return null;
    if (maxWidth) return c.readPixelsScaled(maxWidth);
    return { width: c.canvas.width, height: c.canvas.height, data: c.readPixels() };
  }

  private frameListeners = new Set<() => void>();
  /** Called after every frame the viewer draws, paused or playing. */
  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  private renderSize(p: Project, scale: number) {
    // Never render more pixels than the screen shows or the project has.
    const maxW = Math.min(p.width * scale, this.displayW || p.width);
    const maxH = Math.min(p.height * scale, this.displayH || p.height);
    const k = Math.min(maxW / p.width, maxH / p.height);
    return { w: Math.max(2, Math.round(p.width * k)), h: Math.max(2, Math.round(p.height * k)) };
  }

  private onStore() {
    const s = store.get();
    const prev = this.last;
    this.last = s;
    if (this.rate !== 0) {
      // An edit during playback restarts it from the current frame so sound
      // matches what is now on the timeline.
      if (prev.project && prev.project !== s.project) this.play(this.rate);
      return;
    }
    if (prev.project !== s.project || prev.playhead !== s.playhead || prev.hoverFrame !== s.hoverFrame || prev.previewScale !== s.previewScale) {
      this.request();
    }
  }

  /** Render the frame the UI is showing (hover frame wins while hovering). */
  request(frame?: number) {
    const s = store.get();
    this.wanted = frame ?? s.hoverFrame ?? s.playhead;
    if (!this.rendering) void this.drain();
  }

  private async drain() {
    this.rendering = true;
    try {
      while (this.wanted !== null && this.compositor) {
        const f = this.wanted;
        this.wanted = null;
        await this.renderFrame(f);
      }
    } finally {
      this.rendering = false;
    }
  }

  private async renderFrame(f: number) {
    const comp = this.compositor;
    if (!comp) return;
    const s = store.get();
    const p = s.project;
    // At the end of the timeline (one past the last frame) hold the last
    // frame, as CapCut does: playback stops there and adding a clip parks
    // the playhead there, and a black viewer reads as a failed import.
    const end = projectDuration(p);
    const plan = planFrame(p, end > 0 ? Math.min(f, end - 1) : f);
    const resolved = await resolveSources(p, plan, this.pool);
    if (comp !== this.compositor) return;
    // Above 1080p, play back at half resolution and show full on pause, as
    // Resolve and Premiere do: the biggest single playback lever.
    const scale = this.rate !== 0 && p.height > 1080 ? Math.min(s.previewScale, 0.5) : s.previewScale;
    const { w, h } = this.renderSize(p, scale);
    comp.resize(w, h);
    try {
      comp.render(plan, sourceImages(resolved, w, h), p.background);
    } catch (e) {
      console.error("render failed", e);
    }
    for (const fn of this.frameListeners) fn();
    if (this.drawn.frame >= 0 && this.rate > 0 && f > this.drawn.frame + 1) this.drawn.dropped += f - this.drawn.frame - 1;
    this.drawn.frame = f;
    this.pool.sweep(4000);
    if (this.rate > 0) this.preroll(p, f);
  }

  /** Warm up decoders for clips that start within the next 0.75 s, so the
   * first frame after a cut is not late. */
  private preroll(p: Project, f: number) {
    const ahead = f + Math.round(0.75 * (p.fps.num / p.fps.den));
    for (const t of p.tracks) {
      if (t.kind !== "video" || t.hidden) continue;
      for (const c of t.clips) {
        if (c.type !== "video" || c.start <= f || c.start > ahead) continue;
        const t = sourceTimeAt(c, c.start, p.fps);
        if (c.reverse && !c.freeze) void this.pool.getReverse(p, c.id, c.assetId).then((cur) => cur?.frameAt(t));
        else void this.pool.get(p, c.id, c.assetId).then((cur) => cur?.frameAt(t));
      }
    }
  }

  // ---- transport ---------------------------------------------------------------

  async play(rate: number) {
    this.stopClock();
    const s = store.get();
    const p = s.project;
    const end = projectDuration(p);
    if (end === 0) return;
    let start = s.playhead;
    if (rate > 0 && start >= end - 1) start = 0;
    if (start !== s.playhead) store.set({ playhead: start });
    this.rate = rate;
    this.t0 = framesToSeconds(start, p.fps);
    this.wallAt = performance.now();
    store.set({ playing: true, hoverFrame: null });
    if (rate === 1) {
      const ctx = audioContext();
      await ctx.resume();
      if (this.rate !== rate) return; // paused while resuming
      this.ctxAt = ctx.currentTime + 0.12; // lead time for the first chunks
      this.schedule = scheduleAudio(ctx, masterBus().input, p, this.t0, framesToSeconds(end, p.fps), this.ctxAt);
    }
    this.drawn = { frame: -1, dropped: 0 };
    const tick = () => {
      if (this.rate === 0) return;
      const proj = store.get().project;
      let t: number;
      if (this.schedule) t = this.t0 + Math.max(0, audibleTime(audioContext()) - this.ctxAt);
      else t = this.t0 + ((performance.now() - this.wallAt) / 1000) * this.rate;
      const f = frameAt(t, proj.fps);
      const last = projectDuration(proj);
      if (f >= last || f < 0) {
        this.pause();
        store.seek(f < 0 ? 0 : last);
        return;
      }
      if (f !== store.get().playhead) store.set({ playhead: f });
      this.request(f);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopClock() {
    cancelAnimationFrame(this.raf);
    this.schedule?.stop();
    this.schedule = null;
  }

  pause() {
    if (this.rate === 0) return;
    this.stopClock();
    this.rate = 0;
    store.set({ playing: false });
    this.request();
  }

  dispose() {
    this.pause();
    this.unsub();
    this.pool.clear();
    this.compositor?.dispose();
  }
}

/** Visible clip under the playhead with the highest track, for click-to-
 * select in the viewer. */
export function topClipAt(p: Project, f: number): VisualClip | null {
  for (const t of p.tracks) {
    if (t.kind !== "video" || t.hidden) continue;
    const c = t.clips.find((x) => x.start <= f && f < x.start + x.duration);
    if (c && c.type !== "adjustment" && c.type !== "audio") return c;
  }
  return null;
}

export const player = new Player();
