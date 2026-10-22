// A voiceover's captions a few words at a time (add_voiceover and
// retake_voiceover caption_words, ADR-115), each word timed to when the
// voice says it. The second Claude film test built 46 such captions by
// hand from 12 get_transcript calls, and moved the first word of lines by
// hand because Whisper heard it up to 0.4 s late ("Station," at 0.46 s, the
// voice starting at 0.05 s). The speech model gives no word times (kokoro-js
// answers the waveform only), so Whisper's hearing times the script's
// words and the take's own sound corrects them: the voice's first sound
// starts the first word, and each pause the script's punctuation (or a
// pause mark) asks for ends the word before it and starts the word after
// it. Between those, Whisper's times are stretched onto the sound.
// Measured on Kokoro reads against the timestamped model's own durations:
// docs/decisions ADR-115. Pure.

import { WEAK, type Caption, type Word } from "./captions";
import { scriptTimes } from "./scriptWords";
import { matchPauses, parseLine } from "./voiceScript";

/** What the take sounds like (lib/analysis/speech.ts): its first and last
 * sound and its dips, in seconds from its start. */
export interface VoiceShape {
  first: number;
  last: number;
  dips: { start: number; end: number }[];
}

/** A word after which the voice pauses: punctuation ends it. */
const ENDS = /[,;:—–.!?…]["'”’)\]]*$/;
const letters = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
const r3 = (x: number) => +x.toFixed(3);
/** The least a word lasts, seconds. */
const MIN_WORD = 0.05;

/** The written words a script's pause marks come after (index of the word
 * after each mark), for a caption that shows the script's own words. */
export function markBreaks(script: string): number[] {
  const line = parseLine(script);
  return line.pauses.map((m) => line.spoken.slice(0, m.at).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length);
}

/**
 * The words of `text` (a take's caption) with the seconds each is spoken,
 * from the take's start: Whisper's `heard` words lined up with the text
 * (scriptTimes), then fitted to the take's sound. The first word starts at
 * the voice's first sound and the last ends at its last; a pause the text
 * asks for (its punctuation, or `marks`: words that follow a pause mark),
 * matched to a dip in the sound as the reader placed it (matchPauses),
 * ends the word before it at the dip and starts the word after it where
 * the voice comes back. Inside a phrase (between two such edges) a word
 * starts halfway between where Whisper heard it and where the phrase's
 * letters put it (each word's share of the phrase's time by its letters):
 * on Kokoro reads Whisper alone was off 0.12 s on average there (early),
 * the letters alone 0.11 s (late), the two together 0.06 s. With nothing
 * heard (Whisper could not run), the letters alone.
 */
export function voiceWordTimes(text: string, heard: Word[], v: VoiceShape, o: { marks?: number[] } = {}): Word[] {
  const w = scriptTimes(text, heard, v.first, v.last).map((x) => ({ ...x }));
  const n = w.length;
  if (!n) return w;
  const total = letters(text) || 1;
  // Breaks before word i: punctuation on the word before, or a pause mark.
  const before: number[] = [];
  for (let i = 1; i < n; i++) if (ENDS.test(w[i - 1].text) || o.marks?.includes(i)) before.push(i);
  const shares = before.map((i) => letters(w.slice(0, i).map((x) => x.text).join(" ")) / total);
  const match = matchPauses(v.dips, v.first, v.last, shares);
  // Edges: where each stretch of speech starts and ends on the sound.
  const starts = new Map<number, number>([[0, v.first]]);
  const ends = new Map<number, number>([[n - 1, v.last]]);
  before.forEach((i, k) => {
    const d = match[k] >= 0 ? v.dips[match[k]] : undefined;
    if (!d || d.end <= v.first || d.start >= v.last) return;
    starts.set(i, d.end);
    ends.set(i - 1, d.start);
  });
  const edges = [...starts.keys()].sort((a, b) => a - b);
  const anyHeard = heard.length > 0;
  edges.forEach((a, k) => {
    const b = (edges[k + 1] ?? n) - 1;
    const s0 = starts.get(a)!;
    const e0 = Math.max(s0, ends.get(b) ?? Math.min(v.last, w[b].end));
    const weight = w.slice(a, b + 1).map((x) => Math.max(1, letters(x.text)));
    const total = weight.reduce((x, y) => x + y, 0);
    let acc = 0;
    for (let i = a; i <= b; i++) {
      const byLetters = s0 + ((e0 - s0) * acc) / total;
      acc += weight[i - a];
      const byEar = Math.min(e0, Math.max(s0, w[i].start));
      w[i].start = i === a ? s0 : anyHeard ? (byLetters + byEar) / 2 : byLetters;
    }
    // Each word runs to the next; the phrase's last to the sound's edge.
    for (let i = a; i < b; i++) w[i].end = w[i + 1].start;
    w[b].end = e0;
  });
  // In order, each word at least MIN_WORD long and ending before the next.
  for (let i = 0; i < n; i++) {
    if (i > 0) w[i].start = Math.max(w[i].start, w[i - 1].start + MIN_WORD);
    w[i].end = Math.max(w[i].end, w[i].start + MIN_WORD);
  }
  for (let i = 0; i + 1 < n; i++) w[i].end = Math.min(w[i].end, w[i + 1].start);
  return w.map((x) => ({ text: x.text, start: r3(x.start), end: r3(Math.max(x.end, x.start)) }));
}

/** A chunk holds through a pause this short, until the next one shows. */
const HOLD = 0.7;
/** ...and past a longer one stays this long after its last word. */
const LINGER = 0.3;
/** A chunk up for less than this joins the one before it (check_project
 * names a chunk under 0.25 s as flashing by). */
const MIN_CHUNK = 0.3;

/**
 * A line's timed words as captions of at most `max` words (1-3), each with
 * its words' start times for the spoken-word highlight. A phrase (up to its
 * punctuation) splits into even chunks (four words make two and two, not
 * three and one), a little word ("a", "the", "to") never ends a chunk when
 * the next can take it, and a chunk stays up until the next one shows
 * across a pause up to 0.7 s (a comma, a sentence), else 0.3 s past its
 * last word; the last stays to `end` (the take's end). A chunk that would
 * flash by (under 0.3 s) joins its neighbor.
 */
export function chunkCaptions(words: Word[], max: number, end: number): Caption[] {
  if (!words.length) return [];
  const size = Math.max(1, Math.min(3, Math.round(max)));
  const groups: Word[][] = [];
  let phrase: Word[] = [];
  const flush = () => {
    if (!phrase.length) return;
    const k = Math.ceil(phrase.length / size);
    const base = Math.floor(phrase.length / k), extra = phrase.length % k;
    const parts: Word[][] = [];
    let at = 0;
    for (let i = 0; i < k; i++) {
      const len = base + (i < extra ? 1 : 0);
      parts.push(phrase.slice(at, at + len));
      at += len;
    }
    // A little word at a chunk's end goes on to start the next, unless the
    // word before it is little too ("on your": moving "your" left "on"
    // alone, and that one-word chunk then joined the one before it as
    // "and it runs on", four words of three: ADR-121).
    for (let i = 0; i + 1 < parts.length; i++) {
      while (parts[i].length > 1 && parts[i + 1].length < size && weak(parts[i].at(-1)!) && !weak(parts[i].at(-2)!)) parts[i + 1].unshift(parts[i].pop()!);
    }
    groups.push(...parts.filter((p) => p.length));
    phrase = [];
  };
  for (const w of words) {
    phrase.push(w);
    if (ENDS.test(w.text)) flush();
  }
  flush();
  // Chunks that would flash by join the one before (or after, the first).
  const timed = (g: Word[][]) =>
    g.map((ws, i) => {
      const next = g[i + 1]?.[0];
      const last = ws.at(-1)!;
      const stop = next ? (next.start - last.end <= HOLD ? next.start : Math.min(next.start, last.end + LINGER)) : Math.max(end, last.end);
      return { ws, start: ws[0].start, end: stop };
    });
  let chunks = timed(groups);
  const long = (c: { start: number; end: number }) => c.end - c.start >= MIN_CHUNK;
  for (let i = 0; i < chunks.length && chunks.length > 1; ) {
    if (long(chunks[i])) {
      i++;
      continue;
    }
    // It takes time from a neighbor, holding the word limit (ADR-121):
    // joined with it when the two hold `size` words or fewer, else their
    // words shared out again between the two, each at most `size`, where
    // every chunk then stays up long enough; a chunk ending on a little
    // word, then a shorter chunk, counts against an option.
    let best: { groups: Word[][]; at: number; score: number } | undefined;
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= groups.length) continue;
      const lo = Math.min(i, j);
      const pair = [...groups[lo], ...groups[lo + 1]];
      const options = pair.length <= size ? [[pair]] : [];
      for (let k = Math.max(1, pair.length - size); k <= Math.min(size, pair.length - 1); k++) if (k !== groups[lo].length) options.push([pair.slice(0, k), pair.slice(k)]);
      for (const o of options) {
        const g = [...groups.slice(0, lo), ...o, ...groups.slice(lo + 2)];
        const t = timed(g).slice(lo, lo + o.length);
        if (!t.every(long)) continue;
        const score = Math.min(...t.map((c) => c.end - c.start)) - (o.length > 1 && weak(o[0].at(-1)!) ? 1 : 0);
        if (!best || score > best.score) best = { groups: g, at: lo, score };
      }
    }
    if (best) {
      groups.splice(0, groups.length, ...best.groups);
      i = best.at;
    } else {
      // Nothing within the limit stays up long enough: it joins its
      // neighbor past the limit (the caller says so, overLimit).
      const into = i > 0 ? i - 1 : i + 1;
      const merged = into < i ? [...groups[into], ...groups[i]] : [...groups[i], ...groups[into]];
      groups.splice(Math.min(i, into), 2, merged);
      i = Math.max(0, Math.min(i, into));
    }
    chunks = timed(groups);
  }
  return chunks.map((c) => ({ start: r3(c.start), end: r3(c.end), text: c.ws.map((x) => x.text).join(" "), words: c.ws.map((x) => r3(x.start)) }));
}

/** A little word ("a", "the", "on"), which never ends a chunk when it can help it. */
const weak = (w: Word) => WEAK.has(w.text.toLowerCase().replace(/[^a-z']/g, ""));

/** The chunks holding more words than asked (`max`): what chunkCaptions
 * joined past the limit because its words were spoken too quickly to show
 * apart, for a note in the answer. */
export function overLimit(chunks: Caption[], max: number): Caption[] {
  return chunks.filter((c) => (c.words?.length ?? c.text.split(/\s+/).length) > max);
}
