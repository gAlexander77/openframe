// Transcript editing (Premiere's Text-Based Editing): a clip's words in
// source seconds; deleting words cuts their time with cut_ranges. Pure.

import type { Range } from "./analysis/silence";
import { monotonicWords, type Word } from "./captions";
import { frameOfSource } from "./project/cut";
import type { AudioClip, Project, VideoClip } from "./project/types";
import { framesToSeconds } from "./time";

/** Source words on a plain-speed clip's cut timeline, clipped to its edges
 * and the requested timeline window. Never carries a word across a cut. */
export function timelineWords(p: Project, c: AudioClip | VideoClip, words: Word[], start = 0, end = Infinity): Word[] {
  const from = Math.max(start, framesToSeconds(c.start, p.fps)), to = Math.min(end, framesToSeconds(c.start + c.duration, p.fps));
  return words.map((w) => ({ text: w.text.trim(), start: Math.max(from, framesToSeconds(frameOfSource(c, w.start, p.fps), p.fps)), end: Math.min(to, framesToSeconds(frameOfSource(c, w.end, p.fps), p.fps)) })).filter((w) => w.text && w.end > w.start);
}

/** The ranges to cut for the words `cut` picks (runs merged). Each run's
 * cut reaches from the previous kept word's end to the next kept word's
 * start, at most `reach` seconds past its own stamps, with `guard` left
 * beside each kept word, whose stamped edges are approximate (see
 * docs/research/Filler words.md: cutting right to them nipped "well"
 * into "while"). */
export function wordRanges(words: Word[], cut: (w: Word, i: number) => boolean, reach = 0.35, guard = 0.04): Range[] {
  const out: Range[] = [];
  const gone = words.map(cut);
  words.forEach((w, i) => {
    if (!gone[i]) return;
    let a = i - 1, b = i + 1;
    while (a >= 0 && gone[a]) a--;
    while (b < words.length && gone[b]) b++;
    const start = Math.max(a >= 0 ? words[a].end + guard : -Infinity, w.start - reach, 0);
    const end = Math.min(b < words.length ? words[b].start - guard : Infinity, w.end + reach);
    if (end <= start) return;
    const last = out[out.length - 1];
    if (last && start <= last.end + 1e-6) last.end = Math.max(last.end, +end.toFixed(4));
    else out.push({ start: +start.toFixed(4), end: +end.toFixed(4) });
  });
  return out;
}

/** Words heard for an asset, with the source spans already transcribed, so
 * a clip cut into pieces reuses what its whole was heard as. */
export interface Heard {
  words: Word[];
  spans: Range[];
}

/** The part of [from, to) not yet transcribed, or null when all of it is. */
export function missing(h: Heard | undefined, from: number, to: number): Range | null {
  const s = h?.spans.find((r) => r.start <= from + 1e-3 && r.end >= to - 1e-3);
  return s ? null : { start: from, end: to };
}

/** Add newly heard words for [from, to): words already inside the span are
 * replaced, so a re-run never doubles them. */
export function merge(h: Heard | undefined, from: number, to: number, words: Word[]): Heard {
  const kept = (h?.words ?? []).filter((w) => w.end <= from || w.start >= to);
  // Spans that touch the new one join it.
  const touching = (h?.spans ?? []).filter((r) => r.end >= from && r.start <= to);
  const joined = { start: Math.min(from, ...touching.map((r) => r.start)), end: Math.max(to, ...touching.map((r) => r.end)) };
  const spans = [...(h?.spans ?? []).filter((r) => !touching.includes(r)), joined].sort((a, b) => a.start - b.start);
  return { words: monotonicWords([...kept, ...words]), spans };
}

/** The words a clip window [from, to) plays, by their middle. */
export const wordsIn = (words: Word[], from: number, to: number) => words.filter((w) => (w.start + w.end) / 2 >= from && (w.start + w.end) / 2 < to);
