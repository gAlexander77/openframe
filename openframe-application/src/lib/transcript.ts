// Transcript editing (Premiere's Text-Based Editing): a clip's words in
// source seconds; deleting words cuts their time with cut_ranges. Pure.

import type { Range } from "./analysis/silence";
import { monotonicWords, type Word } from "./captions";
import { sourceTimeAt } from "./project/ops";
import { secondsToFrames } from "./time";
import { frameOfSource } from "./project/cut";
import type { AudioClip, Project, VideoClip } from "./project/types";
import { framesToSeconds } from "./time";

/** Only hear the played source window, with sentence context at either edge.
 * Timeline ranges are intersected before mapping through the clip's speed. */
export function speechWindow(p: Project, c: AudioClip | VideoClip, start = 0, end = Infinity, margin = 3): [number, number] {
  const first = Math.max(c.start, secondsToFrames(start, p.fps));
  const last = Math.min(c.start + c.duration, Number.isFinite(end) ? secondsToFrames(end, p.fps) : c.start + c.duration);
  const duration = p.assets.find(a => a.id === c.assetId)?.duration ?? Infinity;
  return [Math.max(0, sourceTimeAt(c, first, p.fps) - margin), Math.min(duration, sourceTimeAt(c, last, p.fps) + margin)];
}

/** Source words on a plain-speed clip's cut timeline, clipped to its edges
 * and the requested timeline window. Never carries a word across a cut. */
export function timelineWords(p: Project, c: AudioClip | VideoClip, words: Word[], start = 0, end = Infinity): Word[] {
  const from = Math.max(start, framesToSeconds(c.start, p.fps)), to = Math.min(end, framesToSeconds(c.start + c.duration, p.fps));
  // A word shorter than a frame (Whisper stamps some 20 ms long) keeps one
  // frame: rounded to no length, "year," fell out of its caption.
  const frame = framesToSeconds(1, p.fps);
  return words.map((w) => {
    const at = framesToSeconds(frameOfSource(c, w.start, p.fps), p.fps);
    return { text: w.text.trim(), start: Math.max(from, at), end: Math.min(to, Math.max(at + frame, framesToSeconds(frameOfSource(c, w.end, p.fps), p.fps))) };
  }).filter((w) => w.text && w.end > w.start);
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

/** A word's middle, for deciding which side of a cut says it. Whisper
 * stamps a word's end where the next one starts, so the last word before a
 * pause runs on through the silence: its length is capped at what its
 * letters take to say slowly. "another." before 2 s of quiet had its middle
 * past the cut that ended the clip, and fell out of the transcript. */
const middle = (w: Word) => w.start + Math.min(w.end - w.start, 0.3 + 0.07 * w.text.trim().length) / 2;

export interface Sentence {
  text: string;
  /** Source seconds its first word starts and its last word was said. */
  start: number;
  end: number;
  /** Seconds of breath before the next sentence; absent after the last. */
  pause_after?: number;
}

/**
 * Words as sentences, for choosing lines to keep (get_transcript): a
 * sentence ends at its punctuation, or at a pause of 0.7 s where the
 * recognizer wrote none. The end is where the last word was said (its
 * length capped as `middle` caps it), so a cut placed there keeps the word
 * and not the silence after it.
 */
export function sentencesOf(words: Word[]): Sentence[] {
  const out: Sentence[] = [];
  let cur: Word[] = [];
  const said = (w: Word) => w.start + Math.min(w.end - w.start, 0.3 + 0.07 * w.text.trim().length);
  const flush = () => {
    if (cur.length) out.push({ text: cur.map((w) => w.text.trim()).join(" ").replace(/\s+([,.!?;:])/g, "$1"), start: +cur[0].start.toFixed(2), end: +said(cur[cur.length - 1]).toFixed(2) });
    cur = [];
  };
  words.forEach((w, i) => {
    if (!w.text.trim()) return;
    cur.push(w);
    const next = words[i + 1];
    if (/[.!?…]["')\]]?$/.test(w.text.trim()) || (next && next.start - said(w) >= 0.7)) flush();
  });
  flush();
  out.forEach((s, i) => { if (out[i + 1]) s.pause_after = +Math.max(0, out[i + 1].start - s.end).toFixed(2); });
  return out;
}

/** The words a clip window [from, to) plays, by their middle. */
export const wordsIn = (words: Word[], from: number, to: number) => words.filter((w) => middle(w) >= from && middle(w) < to);
