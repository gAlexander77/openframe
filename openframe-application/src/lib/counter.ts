// A title that counts (ADR-147): Final Cut's Counting generator, After
// Effects' Numbers, a countdown or a stopwatch. The clip's text holds {n}
// where the number goes ("{n}+ creators", "T-{n}"), so everything else a
// title has (style, runs, animations, keys) works on it unchanged. Pure:
// the render plan asks what the title reads at a frame.

import { ease } from "./keyframes";
import type { Counter, TextClip, TextRun } from "./project/types";
import type { Rational } from "./time";

export const COUNTER_TOKEN = "{n}";
export const COUNTER_FORMATS = ["number", "plain", "time"] as const;
export const COUNTER_MAX_DECIMALS = 6;

/** The value at clip frame `r`: `from` on the first frame, `to` on the
 * count's last frame, held from there. */
export function counterValue(c: Counter, r: number, fps: Rational): number {
  const last = Math.max(1, Math.round((c.seconds * fps.num) / fps.den) - 1);
  const x = Math.min(Math.max(r / last, 0), 1);
  // A timer runs at the clock's pace; a statistic arrives fast and settles.
  return c.from + (c.to - c.from) * ease(c.ease ?? (c.format === "time" ? "linear" : "easeOut"), x);
}

/** The value as it reads. A count never shows a number it has not reached:
 * rising, it rounds down (a stopwatch reads 0:00 for its first second);
 * falling, up (a countdown from 10 reads 10 for its first second). */
export function formatCount(v: number, c: Counter): string {
  const d = Math.min(Math.max(Math.round(c.decimals ?? 0), 0), COUNTER_MAX_DECIMALS);
  const k = 10 ** d;
  const shown = (c.to >= c.from ? Math.floor(v * k + 1e-6) : Math.ceil(v * k - 1e-6)) / k;
  if (c.format === "time") {
    const s = Math.abs(shown);
    const whole = Math.floor(s + 1e-9);
    const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60);
    const sec = `${String(whole % 60).padStart(2, "0")}${d ? (s - whole).toFixed(d).slice(1) : ""}`;
    return `${shown < 0 ? "-" : ""}${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${sec}`;
  }
  return c.format === "plain" ? shown.toFixed(d) : shown.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** `text` with every {n} replaced by `number`, and the styled runs moved
 * with it: a run over the token covers the whole number. */
function fill(text: string, number: string, runs?: TextRun[]): { text: string; runs?: TextRun[] } {
  const grow = number.length - COUNTER_TOKEN.length;
  const tokens: number[] = [];
  for (let at = text.indexOf(COUNTER_TOKEN); at >= 0; at = text.indexOf(COUNTER_TOKEN, at + COUNTER_TOKEN.length)) tokens.push(at);
  if (!tokens.length) return { text, runs };
  // A position in the template, in the filled text: inside a token, a
  // start goes to the number's first digit and an end past its last.
  const moved = (x: number, end: boolean) => tokens.reduce((to, t) => to + (x >= t + COUNTER_TOKEN.length ? grow : x > t ? (end ? grow + t + COUNTER_TOKEN.length - x : t - x) : 0), x);
  return { text: text.split(COUNTER_TOKEN).join(number), ...(runs ? { runs: runs.map((r) => ({ ...r, start: moved(r.start, false), end: moved(r.end, true) })) } : {}) };
}

/** The clip as it reads at clip frame `r`: itself when it does not count. */
export function countedClip(clip: TextClip, r: number, fps: Rational): TextClip {
  if (!clip.counter) return clip;
  const f = fill(clip.text, formatCount(counterValue(clip.counter, r, fps), clip.counter), clip.style.runs);
  return { ...clip, text: f.text, ...(f.runs ? { style: { ...clip.style, runs: f.runs } } : {}) };
}

/** The clip at its widest reading, for a box that holds every frame of the
 * count (alignment, the title-safe check): the longer of its two ends. */
export function widestCount(clip: TextClip, fps: Rational): TextClip {
  if (!clip.counter) return clip;
  const a = countedClip(clip, 0, fps), b = countedClip(clip, Infinity, fps);
  return b.text.length >= a.text.length ? b : a;
}
