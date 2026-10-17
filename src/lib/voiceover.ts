// Where a voiceover take lands on the timeline. The microphone's samples
// carry audio-clock times; playback maps the clock to timeline seconds
// (t0 at ctxAt). The speaker heard each moment outputLatency after it was
// scheduled, so the take moves earlier by that much. Browsers do not report
// input latency; ponytail: it stays in (a few ms on a typical device).

import type { Rational } from "./time";

export interface TakeClock {
  /** Audio-clock time of the first recorded sample. */
  first: number;
  /** Timeline seconds playing at audio-clock time `ctxAt`. */
  t0: number;
  ctxAt: number;
  outputLatency: number;
  /** Timeline seconds before which nothing is kept: the playhead where the
   * take began, so the pre-roll before playback (the clock's lead time)
   * does not shift the voice onto earlier frames. */
  from: number;
}

/** The take's first whole frame, and how many leading samples to drop so
 * the kept audio starts exactly on it. */
export function placeTake(c: TakeClock, fps: Rational, sampleRate: number): { start: number; skip: number } {
  const at = c.t0 + (c.first - c.ctxAt) - c.outputLatency;
  const start = Math.max(0, Math.ceil((Math.max(at, c.from) * fps.num) / fps.den - 1e-9));
  const skip = Math.max(0, Math.round(((start * fps.den) / fps.num - at) * sampleRate));
  return { start, skip };
}
