// Audio scrubbing (CapCut, Premiere): while the playhead is dragged, a short
// snippet of the mix sounds at each place it reaches. One snippet plays at a
// time and the latest place waits for it, so a fast drag never piles up
// decodes or overlapping sound; the engine side is engine/scrub.ts (ADR-079).

/** Seconds of sound per snippet: long enough to hear a word's shape, short
 * enough to follow the hand (Premiere's scrub plays about this much). */
export const SNIPPET_SECONDS = 0.09;
/** Fade in and out, so a snippet cut out of a waveform does not click. */
export const SNIPPET_FADE = 0.008;
/** A move smaller than this (seconds) sounds nothing new. */
export const MIN_MOVE = 0.02;

/** Which place to sound next. request() answers whether to start a snippet
 * now; while one plays the place is kept, and done() hands back the latest
 * kept place (or null) when it ends. */
export class ScrubGate {
  private busy = false;
  private pending: number | null = null;
  private last: number | null = null;

  /** The playhead reached `t` (seconds). True: sound a snippet there now. */
  request(t: number): boolean {
    if (this.busy) {
      this.pending = t;
      return false;
    }
    return this.take(t);
  }

  /** The snippet ended: the place to sound next, if the playhead moved on. */
  done(): number | null {
    this.busy = false;
    const t = this.pending;
    this.pending = null;
    return t !== null && this.take(t) ? t : null;
  }

  /** The drag ended (or playback began): nothing waits any more. */
  reset() {
    this.busy = false;
    this.pending = null;
    this.last = null;
  }

  private take(t: number): boolean {
    if (this.last !== null && Math.abs(t - this.last) < MIN_MOVE) return false;
    this.busy = true;
    this.last = t;
    return true;
  }
}
