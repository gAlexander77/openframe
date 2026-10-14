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
