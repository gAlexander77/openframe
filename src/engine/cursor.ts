// A decode cursor per clip: one live `samples()` iterator (it *is* the
// decoder) that rolls forward for playback and small seeks, and restarts
// only when a seek leaves the current GOP or goes backward. This is the
// mediabunny author's scrubbing recipe (docs/research/Web media engine.md
// §1.5); calling getSample() per scrub event would build a new decoder each
// time and decode up to a whole GOP.
//
// Ownership: the cursor owns exactly one VideoSample, its head. Callers
// borrow it until their next call on the same cursor and never close it
// (Conventions rule 9: every frame has exactly one owner).

import type { EncodedPacketSink, VideoSample, VideoSampleSink } from "mediabunny";

export class VideoCursor {
  private it: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private head: VideoSample | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(
    private sink: VideoSampleSink,
    private keys: EncodedPacketSink,
    /** Container start time; source time 0 is this timestamp. */
    private offset: number,
  ) {}

  /** The frame showing at source time `t` (seconds). Calls are serialized;
   * the returned sample is borrowed. */
  frameAt(t: number): Promise<VideoSample | null> {
    const run = this.queue.then(() => this.seek(t + this.offset));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async seek(t: number): Promise<VideoSample | null> {
    if (this.disposed) return null;
    const h = this.head;
    // Fast path: the head already covers t.
    if (h && t >= h.timestamp && t < h.timestamp + h.duration) return h;
    let rollForward = false;
    if (this.it && h && t >= h.timestamp) {
      // Within reach if the key frame for t is at or before the head: the
      // decoder has to pass through it anyway.
      const key = await this.keys.getKeyPacket(t, { verifyKeyPackets: true });
      rollForward = !key || key.timestamp <= h.timestamp;
    }
    if (!rollForward) await this.restart(t);
    try {
      for (;;) {
        const cur = this.head;
        if (cur && cur.timestamp + cur.duration > t) return cur;
        const r = await this.it!.next();
        if (r.done) return this.head; // past the end: hold the last frame
        this.head?.close();
        this.head = r.value;
      }
    } catch {
      // A reclaimed decoder (idle/background, QuotaExceededError) or a
      // disposed input: start over once at the same time.
      if (this.disposed) return null;
      await this.restart(t);
      const r = await this.it!.next();
      if (r.done) return this.head;
      this.head?.close();
      this.head = r.value;
      return this.head;
    }
  }

  private async restart(t: number) {
    const old = this.it;
    this.it = null;
    await old?.return().catch(() => undefined);
    this.head?.close();
    this.head = null;
    this.it = this.sink.samples(Math.max(0, t));
  }

  dispose() {
    this.disposed = true;
    const it = this.it;
    this.it = null;
    this.queue = this.queue.then(async () => {
      await it?.return().catch(() => undefined);
      this.head?.close();
      this.head = null;
    });
  }
}

// ---- reverse ------------------------------------------------------------------

/** A decoded picture held as an ImageBitmap, borrowed until the cursor's
 * next call. Width and height are display size, like SourceImage's. */
export interface HeldFrame {
  image: ImageBitmap;
  width: number;
  height: number;
  /** Quarter turns the compositor still has to apply. */
  rotation: 0 | 1 | 2 | 3;
}

interface Held extends HeldFrame {
  ts: number;
  end: number;
}

interface Ahead {
  from: number;
  to: number;
  abort: boolean;
  done: Promise<Held[] | null>;
}

export interface ReverseOptions {
  /** Longest side of held frames in pixels; absent keeps full size (export:
   * exact frames). Preview passes roughly the screen's size. */
  maxSide?: number;
  /** Bytes one window of held frames may use. */
  budget?: number;
}

const DEFAULT_BUDGET = 192 * 2 ** 20;

/**
 * A cursor for reversed clips (ADR-028). The decoder only runs forward, and
 * a backward step would restart it at the previous key frame every frame,
 * so this decodes a window of frames forward once (from the key frame, or a
 * budget's worth back, up to the frame asked for), keeps them as
 * ImageBitmaps and hands them out backward. The window below is decoded in
 * the background while the current one plays.
 *
 * Ownership: each VideoSample is closed as soon as its bitmap exists; the
 * cursor owns the bitmaps and closes them when their window is dropped (at
 * most two windows plus one being prefetched).
 */
export class ReverseCursor {
  private windows: Held[][] = [];
  private ahead: Ahead | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private last = Infinity;
  private frameDur = 1 / 30;
  private perWindow: number;
  private scale: number;

  constructor(
    private sink: VideoSampleSink,
    private keys: EncodedPacketSink,
    /** Container start time; source time 0 is this timestamp. */
    private offset: number,
    /** Source display size, for the memory budget. */
    size: { width: number; height: number },
    opts: ReverseOptions = {},
  ) {
    const side = Math.max(size.width, size.height, 1);
    this.scale = opts.maxSide ? Math.min(1, opts.maxSide / side) : 1;
    const bytes = Math.max(1, size.width * size.height * this.scale * this.scale * 4);
    // ponytail: a fixed byte budget per window; 4K at full size gets the
    // minimum window and re-decodes more. Upgrade path: an all-intra proxy
    // (every frame a key frame) makes every window start at its own frame.
    this.perWindow = Math.max(4, Math.min(150, Math.floor((opts.budget ?? DEFAULT_BUDGET) / bytes)));
  }

  /** The frame showing at source time `t` (seconds). Calls are serialized;
   * the returned frame is borrowed until the next call. */
  frameAt(t: number): Promise<HeldFrame | null> {
    const run = this.queue.then(() => this.seek(t + this.offset));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private lookup(t: number): Held | null {
    for (const fs of this.windows) {
      if (!fs.length || t < fs[0].ts || t >= fs[fs.length - 1].end) continue;
      for (let i = fs.length - 1; i >= 0; i--) if (fs[i].ts <= t) return fs[i];
    }
    return null;
  }

  private async seek(t: number): Promise<HeldFrame | null> {
    if (this.disposed) return null;
    const backward = t <= this.last;
    this.last = t;
    let hit = this.lookup(t);
    if (!hit && this.ahead) {
      const a = this.ahead;
      this.ahead = null;
      if (t >= a.from && t < a.to) {
        const w = await a.done;
        if (w) this.keep(w);
        hit = this.lookup(t);
      } else a.abort = true;
    }
    if (!hit) {
      const span = this.perWindow * this.frameDur;
      let from = t - span + this.frameDur;
      let to = t + 1e-4;
      if (backward) {
        // Start at the key frame when it is inside the budget: the decoder
        // has to begin there anyway, so nothing is decoded twice.
        const key = await this.keys.getKeyPacket(t, { verifyKeyPackets: true }).catch(() => null);
        if (key && key.timestamp > from) from = key.timestamp;
      } else {
        // Scrubbing the other way (source forward): look ahead instead.
        from = t;
        to = t + span;
      }
      const w = await this.decode(Math.max(0, from), to, { abort: false });
      if (this.disposed) return null;
      if (w?.length) {
        this.keep(w);
        hit = this.lookup(t) ?? (t < w[0].ts ? w[0] : w[w.length - 1]);
      }
    }
    if (backward) this.prefetch();
    return hit;
  }

  /** Decode the window just below the lowest one, in the background. */
  private prefetch() {
    if (this.ahead || this.disposed) return;
    let low: Held | null = null;
    for (const fs of this.windows) if (fs[0] && (!low || fs[0].ts < low.ts)) low = fs[0];
    if (!low || low.ts <= this.offset + 1e-6) return;
    const to = low.ts;
    const ahead: Ahead = { from: Math.max(0, to - this.perWindow * this.frameDur), to, abort: false, done: Promise.resolve(null) };
    ahead.done = this.keys
      .getKeyPacket(to - this.frameDur / 2, { verifyKeyPackets: true })
      .catch(() => null)
      .then((key) => {
        if (key && key.timestamp > ahead.from) ahead.from = key.timestamp;
        return this.decode(ahead.from, to - 1e-6, ahead);
      });
    this.ahead = ahead;
  }

  private keep(w: Held[]) {
    this.windows.push(w);
    while (this.windows.length > 2) for (const f of this.windows.shift()!) f.image.close();
  }

  private async decode(from: number, to: number, flag: { abort: boolean }): Promise<Held[] | null> {
    const frames: Held[] = [];
    const drop = () => frames.forEach((f) => f.image.close());
    try {
      for await (const s of this.sink.samples(from, to)) {
        if (flag.abort || this.disposed) {
          s.close();
          break;
        }
        try {
          frames.push(await this.hold(s));
        } finally {
          s.close();
        }
      }
    } catch {
      // A reclaimed decoder or a disposed input: nothing usable this time.
      drop();
      return null;
    }
    if (flag.abort || this.disposed) {
      drop();
      return null;
    }
    for (let i = 0; i < frames.length - 1; i++) frames[i].end = frames[i + 1].ts;
    if (frames.length > 1) this.frameDur = (frames[frames.length - 1].ts - frames[0].ts) / (frames.length - 1);
    return frames;
  }

  private async hold(s: VideoSample): Promise<Held> {
    const src = s.toCanvasImageSource();
    // A raw VideoFrame is in coded orientation (rotate in the quad); a
    // canvas from mediabunny already has rotation applied.
    const raw = typeof VideoFrame !== "undefined" && src instanceof VideoFrame;
    const w = raw ? (src as VideoFrame).displayWidth : (src as OffscreenCanvas).width;
    const h = raw ? (src as VideoFrame).displayHeight : (src as OffscreenCanvas).height;
    const image =
      this.scale < 1
        ? await createImageBitmap(src, { resizeWidth: Math.max(1, Math.round(w * this.scale)), resizeHeight: Math.max(1, Math.round(h * this.scale)), resizeQuality: "medium" })
        : await createImageBitmap(src);
    return {
      image,
      width: s.displayWidth,
      height: s.displayHeight,
      rotation: raw ? (((s.rotation / 90) % 4) as 0 | 1 | 2 | 3) : 0,
      ts: s.timestamp,
      end: s.timestamp + s.duration,
    };
  }

  dispose() {
    this.disposed = true;
    if (this.ahead) this.ahead.abort = true;
    this.ahead = null;
    this.queue = this.queue.then(() => {
      for (const fs of this.windows) for (const f of fs) f.image.close();
      this.windows = [];
    });
  }
}
