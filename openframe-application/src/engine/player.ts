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

import { beforePlan } from "../lib/viewerCompare";
import { projectWork } from "../state/projectWork";
import type { VideoSample } from "mediabunny";
import { cropClips, NO_CROP } from "../lib/crop";
import { exportRange } from "../lib/export";
import { MOTION_SAMPLES } from "../lib/motionBlur";
import { getAsset, projectDuration } from "../lib/project/ops";
import type { Id, Project, VisualClip } from "../lib/project/types";
import { planFrame, planLayers, type Layer, type PlanItem } from "../lib/render/plan";
import { choose, DEFAULT_DECODE_RATE, entryTargets, heldBytes, leadFor, MAX_LEAD, nextDecodeRate, upcomingEntries, workFor, type Candidate, type Target } from "../lib/render/preroll";
import { frameAt, framesToSeconds } from "../lib/time";
import { provide } from "../state/actions";
import { store, type EditorState } from "../state/store";
import { audibleTime, audioContext, masterBus, scheduleAudio, type Schedule } from "./audio";
import { Compositor, type SourceImage } from "./compositor";
import { ReverseCursor, VideoCursor, type HeldFrame, type ReverseOptions } from "./cursor";
import { loadPlanLuts } from "./luts";
import { imageFor, mediaFor, mediaForSrc, type MediaFile } from "./media";
import { rasterizeText } from "./text";

interface CursorEntry {
  cursor: Promise<VideoCursor | ReverseCursor | null>;
  used: number;
}

/** Resolved pixels for one plan, ready for a synchronous compositor pass.
 * `matte` is the clip's background matte frame (Remove BG, ADR-033): a
 * borrowed sample, or a held frame for a reversed clip. */
export type Resolved = Map<Id, { sample?: VideoSample; frame?: HeldFrame; matte?: VideoSample | HeldFrame; bitmap?: ImageBitmap; key?: string; next?: { sample: VideoSample; w: number } }>;

/** Decode cursors keyed by clip, shared shape for preview and export.
 * Reversed clips get a ReverseCursor; `reverse` sets the size it holds
 * frames at (default: full size, exact frames for export). */
export class CursorPool {
  private map = new Map<string, CursorEntry>();

  constructor(private reverse: ReverseOptions = {}) {}

  /** `lane` 1 is a clip's second cursor, for frame blending's next frame:
   * one cursor holds one sample, so two frames need two. */
  get(p: Project, clipId: Id, assetId: Id, lane = 0): Promise<VideoCursor | null> {
    return this.forAsset(p, lane ? `${clipId}#${lane}` : clipId, assetId, false) as Promise<VideoCursor | null>;
  }

  getReverse(p: Project, clipId: Id, assetId: Id): Promise<ReverseCursor | null> {
    return this.forAsset(p, clipId, assetId, true) as Promise<ReverseCursor | null>;
  }

  /** The cursor over a clip's background matte, read backward for a
   * reversed clip; a matte made again (a new file) gets a new cursor. */
  matte(clipId: Id, src: string, reverse: boolean): Promise<VideoCursor | ReverseCursor | null> {
    return this.open(JSON.stringify([clipId, "matte", src, reverse]), () => mediaForSrc(src), reverse);
  }

  private forAsset(p: Project, clipId: Id, assetId: Id, reverse: boolean) {
    const asset = getAsset(p, assetId);
    // Relinking and undo can change a clip's source without changing its ID.
    return this.open(JSON.stringify([clipId, asset?.proxy ?? asset?.src, reverse]), () => (asset ? mediaFor(asset) : null), reverse);
  }

  private open(key: string, media: () => Promise<MediaFile> | null, reverse: boolean) {
    let e = this.map.get(key);
    if (!e) {
      const m = media();
      const cursor = m
        ? m.then((f) => {
            if (!f.videoSink || !f.keySink) return null;
            if (!reverse) return new VideoCursor(f.videoSink, f.keySink, f.videoStart);
            return new ReverseCursor(f.videoSink, f.keySink, f.videoStart, { width: f.width, height: f.height }, this.reverse);
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
    // Compound clips' nested layers too: their sources draw first (ADR-037).
    ...planLayers(plan).map(async (l) => {
      const src = l.source;
      if (src.kind === "video") {
        const m = l.matte;
        const reverse = !!src.reverse;
        const n = src.next;
        const [picture, matte, next] = await Promise.all([
          reverse
            ? pool.getReverse(p, l.clipId, src.assetId).then((c) => c?.frameAt(src.time) ?? null)
            : pool.get(p, l.clipId, src.assetId).then((c) => c?.frameAt(src.time) ?? null),
          m ? pool.matte(l.clipId, m.src, reverse).then((c): Promise<VideoSample | HeldFrame | null> | null => c?.frameAt(m.time) ?? null) : null,
          n ? pool.get(p, l.clipId, src.assetId, 1).then((c) => c?.frameAt(n.time) ?? null) : null,
        ]);
        if (picture)
          out.set(l.clipId, {
            ...(reverse ? { frame: picture as HeldFrame } : { sample: picture as VideoSample }),
            matte: matte ?? undefined,
            ...(next && n ? { next: { sample: next, w: n.w } } : {}),
          });
      } else if (src.kind === "image") {
        const asset = getAsset(p, src.assetId);
        if (asset) {
          const bitmap = await imageFor(asset, src.time).catch(() => null);
          if (bitmap) out.set(l.clipId, { bitmap, key: `img:${asset.src}:${asset.animated ? src.time : 0}` });
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
    if (l.source.kind === "text") return rasterizeText(l.source.clip, width, height, l.source.word, l.source.kinetic);
    const r = resolved.get(l.clipId);
    if (!r) return null;
    if (r.bitmap) return { image: r.bitmap, width: r.bitmap.width, height: r.bitmap.height, rotation: 0, key: r.key };
    const matte = r.matte && ("image" in r.matte ? r.matte.image : r.matte.toCanvasImageSource());
    if (r.frame) return { image: r.frame.image, width: r.frame.width, height: r.frame.height, rotation: r.frame.rotation, matte };
    const s = r.sample!;
    const image = s.toCanvasImageSource();
    // A raw VideoFrame is in coded orientation: rotate it in the quad. A
    // canvas from mediabunny already has rotation applied.
    const raw = typeof VideoFrame !== "undefined" && image instanceof VideoFrame;
    const turns = raw ? (((s.rotation / 90) % 4) as 0 | 1 | 2 | 3) : 0;
    const next = r.next ? { image: r.next.sample.toCanvasImageSource(), w: r.next.w } : undefined;
    return { image, width: s.displayWidth, height: s.displayHeight, rotation: turns, matte, ...(next ? { next } : {}) };
  };
}

interface Prep {
  clipId: Id;
  at: number;
  targets: Target[];
  /** Pixels to decode before the first frame: undefined until looked up,
   * null while looking. */
  work?: number | null;
  /** The longest catch-up in frames. */
  frames?: number;
  state: "waiting" | "running" | "ready";
}

export interface PrepRecord {
  clipId: Id;
  /** The first frame the clip was needed on. */
  at: number;
  gapFrames: number | null;
  leadMs: number | null;
  startedAheadMs: number;
  decodeMs: number;
}

export class Player {
  private compositor: Compositor | null = null;
  private reference: ImageBitmap | null = null;
  private capture = 0;
  private captureNext: { take: (canvas: HTMLCanvasElement | OffscreenCanvas) => void; cancel: () => void } | null = null;
  private referenceAbort: (() => void) | null = null;

  private clearReference() {
    this.capture++;
    this.captureNext?.cancel();
    this.captureNext = null;
    this.referenceAbort?.();
    this.referenceAbort = null;
    this.reference?.close();
    this.reference = null;
    this.compositor?.clearCompare();
  }

  async showReference() {
    if (this.reference) store.set({ compare: { ...store.get().compare, mode: "reference" } });
    else await this.captureReference();
  }

  async captureReference() {
    if (!this.compositor) throw new Error("The viewer is not available");
    const session = projectWork.signal();
    session.throwIfAborted();
    this.captureNext?.cancel();
    const token = ++this.capture;
    // Snapshot immediately after the live presentation, before the wipe is
    // drawn. This is the viewer's actual raster, including its crop mode
    // and playback quality; it never captures the comparison itself.
    await new Promise<void>((resolve, reject) => {
      const abort = () => { if (token === this.capture) this.clearReference(); resolve(); };
      session.addEventListener("abort", abort, { once: true });
      const done = () => { session.removeEventListener("abort", abort); resolve(); };
      this.captureNext = {
        cancel: done,
        take: canvas => {
          void createImageBitmap(canvas).then(bitmap => {
            if (token !== this.capture || session.aborted) { bitmap.close(); done(); return; }
            this.clearReference();
            this.reference = bitmap;
            const clear = () => this.clearReference();
            session.addEventListener("abort", clear, { once: true });
            this.referenceAbort = () => session.removeEventListener("abort", clear);
            store.set({ compare: { ...store.get().compare, mode: "reference" } });
            this.request();
            done();
          }, e => { session.removeEventListener("abort", abort); reject(e); });
        },
      };
      this.request();
    });
  }
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
  /** Where Loop starts over, while looping. */
  private loopFrom: number | null = null;
  /** A bounded, silent run (preview): stop on this frame. */
  private until: number | null = null;
  private silent = false;
  /** Last frame actually drawn, for the dropped-frame counter. */
  drawn = { frame: -1, dropped: 0 };
  // Preparing decoders ahead of cuts (preroll, ADR-074).
  private preps = new Map<string, Prep>();
  private prepFor: Project | null = null;
  private prepTargets = new Map<string, Target[]>();
  /** Measured decode speed, pixels a second. */
  decodeRate = DEFAULT_DECODE_RATE;
  /** The cuts prepared lately: how far ahead each started and how long its
   * catch-up took (playback drives read it). */
  prepared: PrepRecord[] = [];

  constructor() {
    this.unsub = store.subscribe(() => this.onStore());
    provide({
      playPause: () => (this.rate ? this.pause() : this.play(1)),
      shuttleForward: () => this.play(this.rate <= 0 ? 1 : Math.min(this.rate * 2, 8)),
      shuttleBack: () => this.play(this.rate >= 0 ? -1 : Math.max(this.rate * 2, -8)),
      shuttleStop: () => this.pause(),
      // Premiere's Play In to Out: the range once, or round with Loop on.
      playInToOut: () => {
        const { project, inPoint, outPoint } = store.get();
        const r = exportRange(project, "inout", inPoint, outPoint);
        if (r.to <= r.from) return;
        store.seek(r.from);
        void this.play(1, { until: r.to });
      },
    });
  }

  /** Attach the preview canvas (or detach with null). */
  attach(canvas: HTMLCanvasElement | null) {
    this.compositor?.dispose();
    this.compositor = canvas ? new Compositor(canvas) : null;
    this.pool.clear();
    if (!canvas) { this.clearReference(); return; }
    this.request();
    // Compile every pass's program in the background: a transition's first
    // use otherwise compiled inside a playback frame (about 0.4 s on
    // ANGLE/D3D11), long enough to skip a short transition at its cut.
    const comp = this.compositor!;
    void comp.warm().catch((e) => console.warn("viewer shaders:", e));
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

  private frameListeners = new Set<(frame: number) => void>();
  /** Called after every frame the viewer draws, paused or playing, with
   * the timeline frame drawn. */
  onFrame(fn: (frame: number) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  /** The raster target, also used by the canvas text editor's layout. */
  renderSize(p: Project, scale: number) {
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
    if (s.compare.mode === "off" && (this.reference || prev.compare?.mode !== "off")) this.clearReference();
    if (prev.compare !== s.compare || (s.compare.mode === "beforeAfter" && prev.selection !== s.selection)) this.request();
    if (this.rate !== 0) {
      // An edit during playback restarts it from the current frame so sound
      // matches what is now on the timeline.
      if (prev.project && prev.project !== s.project) this.play(this.rate, { until: this.until ?? undefined, silent: this.silent });
      return;
    }
    if (prev.project !== s.project || prev.playhead !== s.playhead || prev.hoverFrame !== s.hoverFrame || prev.previewScale !== s.previewScale || prev.cropEdit?.id !== s.cropEdit?.id) {
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
    // The crop mode shows its clip whole, the crop drawn over it (ADR-048).
    const p = s.cropEdit ? cropClips(s.project, [s.cropEdit.id], NO_CROP) : s.project;
    // At the end of the timeline (one past the last frame) hold the last
    // frame, as CapCut does: playback stops there and adding a clip parks
    // the playhead there, and a black viewer reads as a failed import.
    const end = projectDuration(p);
    // Motion blur at full quality paused (what preview_frame and export
    // show), with a few samples while playing (ADR-058).
    const plan = planFrame(p, end > 0 ? Math.min(f, end - 1) : f, { motionSamples: this.rate !== 0 ? MOTION_SAMPLES.playing : MOTION_SAMPLES.full });
    const resolved = await resolveSources(p, plan, this.pool);
    if (comp !== this.compositor) return;
    // Above 1080p, play back at half resolution and show full on pause, as
    // Resolve and Premiere do: the biggest single playback lever.
    const scale = this.rate !== 0 && p.height > 1080 ? Math.min(s.previewScale, 0.5) : s.previewScale;
    const { w, h } = this.renderSize(p, scale);
    comp.resize(w, h);
    try {
      const sources = sourceImages(resolved, w, h);
      comp.render(plan, sources, p.background);
      const capture = this.captureNext;
      this.captureNext = null;
      capture?.take(comp.canvas);
      if (s.compare.mode !== "off") comp.compare(s.compare.mode === "beforeAfter" ? beforePlan(plan, s.selection) : null,
        s.compare.mode === "reference" ? this.reference : null, sources, p.background, s.compare.split, s.compare.orientation === "horizontal");
    } catch (e) {
      console.error("render failed", e);
    }
    for (const fn of this.frameListeners) fn(f);
    if (this.drawn.frame >= 0 && this.rate > 0 && f > this.drawn.frame + 1) this.drawn.dropped += f - this.drawn.frame - 1;
    this.drawn.frame = f;
    this.pool.sweep(4000);
    if (this.rate > 0) this.preroll(p, f);
  }

  /** Prepare the decoders of clips that enter the picture soon, so the
   * first frame after a cut is waiting rather than late (ADR-074). Each
   * starts as far ahead as its catch-up from the key frame takes at the
   * measured decode speed (at least 0.75 s, at most 5 s), soonest first,
   * within a memory budget. A clip brought in by a transition is prepared
   * for the transition's first frame, which shows it before its cut.
   * ponytail: cuts inside a compound clip that is already playing are not
   * prepared; plan ahead through it if playback shows them late. */
  private preroll(p: Project, f: number) {
    const fps = p.fps.num / p.fps.den;
    if (p !== this.prepFor) {
      this.prepFor = p;
      this.prepTargets.clear();
    }
    const seen = new Set<string>();
    const cands: (Candidate & { prep: Prep })[] = [];
    for (const e of upcomingEntries(p, f, Math.round(MAX_LEAD * fps))) {
      const ek = `${e.clip.id}@${e.at}`;
      let targets = this.prepTargets.get(ek);
      if (!targets) this.prepTargets.set(ek, (targets = entryTargets(p, e)));
      if (!targets.length) continue;
      const key = JSON.stringify([e.at, targets.map((t) => [t.clipId, t.assetId, t.kind, t.lane, t.src, t.reverse, t.time])]);
      seen.add(key);
      let prep = this.preps.get(key);
      if (!prep) this.preps.set(key, (prep = { clipId: e.clip.id, at: e.at, targets, state: "waiting" }));
      if (prep.work === undefined) this.measureWork(p, prep);
      cands.push({ at: e.at, lead: prep.work == null ? null : leadFor(prep.work, this.decodeRate), bytes: heldBytes(targets), active: prep.state !== "waiting", prep });
    }
    for (const k of this.preps.keys()) if (!seen.has(k)) this.preps.delete(k);
    // One catch-up at a time, soonest cut first: the clip playing now
    // shares the machine with one extra decoder, not several, and the
    // nearest deadline gets the whole of it.
    let busy = [...this.preps.values()].some((x) => x.state === "running");
    for (const c of choose(cands, f, fps)) {
      for (const t of c.prep.targets) void this.cursorFor(p, t); // not idle: no sweep
      if (busy || c.prep.state !== "waiting") continue;
      busy = true;
      this.prepare(p, c.prep, (c.at - f) / fps, c.lead);
    }
  }

  private cursorFor(p: Project, t: Target): Promise<VideoCursor | ReverseCursor | null> {
    if (t.kind === "matte") return this.pool.matte(t.clipId, t.src!, t.reverse);
    return t.reverse ? this.pool.getReverse(p, t.clipId, t.assetId) : this.pool.get(p, t.clipId, t.assetId, t.lane);
  }

  /** Look up how far each target's first frame is from its key frame. */
  private measureWork(p: Project, prep: Prep) {
    prep.work = null;
    void Promise.all(prep.targets.map(async (t) => {
      const c = t.reverse ? null : await this.cursorFor(p, t);
      return c instanceof VideoCursor ? c.keyGap(t.time) : 0;
    })).then(
      (gaps) => {
        prep.work = workFor(prep.targets, gaps);
        prep.frames = Math.round(Math.max(0, ...gaps.map((g, i) => g * prep.targets[i].fps)));
      },
      () => (prep.work = 0),
    );
  }

  /** Decode each target of an entry up to its first frame, together. */
  private prepare(p: Project, prep: Prep, ahead: number, lead: number | null) {
    const cursors = prep.targets.map((t) => this.cursorFor(p, t));
    prep.state = "running";
    const t0 = performance.now();
    void Promise.all(cursors.map((c, i) => c.then((cur): Promise<unknown> | undefined => cur?.frameAt(prep.targets[i].time)))).then(
      () => {
        prep.state = "ready";
        const ms = performance.now() - t0;
        if (prep.work) this.decodeRate = nextDecodeRate(this.decodeRate, prep.work, ms, prep.frames ?? 0);
        this.prepared.push({ clipId: prep.clipId, at: prep.at, gapFrames: prep.frames ?? null, leadMs: lead === null ? null : Math.round(lead * 1000), startedAheadMs: Math.round(ahead * 1000), decodeMs: Math.round(ms) });
        if (this.prepared.length > 50) this.prepared.shift();
      },
      () => (prep.state = "ready"),
    );
  }

  // ---- transport ---------------------------------------------------------------

  /** Play from the playhead at `rate`. `until` stops on that frame, and
   * `silent` leaves the sound off: preview() uses both. */
  async play(rate: number, opts: { until?: number; silent?: boolean; once?: boolean; returnTo?: number } = {}) {
    this.stopClock();
    this.until = opts.until ?? null;
    this.silent = !!opts.silent;
    const s = store.get();
    const p = s.project;
    const end = projectDuration(p);
    if (end === 0) return;
    let start = s.playhead;
    // Loop: forward, audible playback goes round the in/out range when it
    // holds the playhead, else the whole timeline (a voiceover take and the
    // silent title preview play once).
    this.loopFrom = null;
    if (s.loop && rate > 0 && !this.silent && !opts.once) {
      const r = exportRange(p, "inout", s.inPoint, s.outPoint);
      const ranged = (s.inPoint !== null || s.outPoint !== null) && r.to > r.from && start >= r.from && start < r.to;
      this.loopFrom = ranged ? r.from : 0;
      this.until = ranged ? r.to : (this.until ?? end);
    }
    if (rate > 0 && start >= end - 1) start = this.loopFrom ?? 0;
    if (start !== s.playhead) store.set({ playhead: start });
    this.rate = rate;
    this.t0 = framesToSeconds(start, p.fps);
    this.wallAt = performance.now();
    store.set({ playing: true, hoverFrame: null });
    if (rate === 1 && !this.silent) {
      const ctx = audioContext();
      await ctx.resume();
      if (this.rate !== rate) return; // paused while resuming
      this.ctxAt = ctx.currentTime + 0.12; // lead time for the first chunks
      this.schedule = scheduleAudio(ctx, masterBus().input, p, this.t0, framesToSeconds(end, p.fps), this.ctxAt);
    }
    this.drawn = { frame: -1, dropped: 0 };
    // Cursors move while paused (scrubbing): prepare every cut again.
    this.preps.clear();
    const tick = () => {
      if (this.rate === 0) return;
      const proj = store.get().project;
      let t: number;
      if (this.schedule) t = this.t0 + Math.max(0, audibleTime(audioContext()) - this.ctxAt);
      else t = this.t0 + ((performance.now() - this.wallAt) / 1000) * this.rate;
      const f = frameAt(t, proj.fps);
      const last = projectDuration(proj);
      if (this.loopFrom !== null && f >= Math.min(this.until ?? last, last)) {
        const from = this.loopFrom, until = this.until ?? undefined;
        store.set({ playhead: from });
        void this.play(rate, { until });
        return;
      }
      if (this.until !== null && f >= this.until) {
        const stop = opts.returnTo ?? this.until;
        this.pause();
        store.seek(stop);
        return;
      }
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

  /** While playing with sound: timeline seconds `t0` sound at audio-clock
   * time `ctxAt` (a voiceover take is placed with it). */
  clock(): { t0: number; ctxAt: number } | null {
    return this.schedule ? { t0: this.t0, ctxAt: this.ctxAt } : null;
  }

  private stopClock() {
    cancelAnimationFrame(this.raf);
    this.schedule?.stop();
    this.schedule = null;
  }

  /** Play [from, to) once without sound then return to the original playhead. `to` is where
   * a new title's In animation has settled (UX-15). Any transport command
   * takes over, as it does from playback. */
  preview(from: number, to: number) {
    const returnTo = store.get().playhead;
    store.seek(from);
    void this.play(1, { until: to, silent: true, returnTo });
  }

  pause() {
    if (this.rate === 0) return;
    this.stopClock();
    this.rate = 0;
    this.until = null;
    this.silent = false;
    store.set({ playing: false });
    this.request();
  }

  dispose() {
    this.pause();
    this.unsub();
    this.clearReference();
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
