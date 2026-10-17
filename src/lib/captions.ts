// Captions as data: grouping recognized words into readable lines, and the
// SRT/VTT formats people bring in and take out. Pure, so line breaking is
// tested rather than eyeballed.

export interface Word {
  text: string;
  /** Seconds. */
  start: number;
  end: number;
}

export interface Caption {
  start: number;
  end: number;
  text: string;
  /** Seconds at which each word of `text` starts, when recognized. */
  words?: number[];
}

/** The word of a caption showing at clip-relative frame `r`: the last one
 * already started, or -1. Undefined when the times no longer fit the text
 * (it was edited) or there are none. */
export function spokenWord(text: string, times: number[] | undefined, r: number): number | undefined {
  if (!times?.length || text.trim().split(/\s+/).length !== times.length) return undefined;
  let i = -1;
  while (i + 1 < times.length && times[i + 1] <= r) i++;
  return i;
}

export interface LineOptions {
  /** Longest line in characters (Netflix's guideline is 42; short-form
   * video reads better around 32). */
  maxChars: number;
  /** Longest a caption stays up, seconds. */
  maxDuration: number;
  /** A silence this long (seconds) always starts a new caption. */
  pauseBreak: number;
  /** Shortest a caption stays up, extended into following silence. */
  minDuration: number;
}

export const DEFAULT_LINES: LineOptions = { maxChars: 32, maxDuration: 3.5, pauseBreak: 0.6, minDuration: 0.7 };

const SENTENCE_END = /[.!?…]["')\]]?$/;

/** Words a caption line should not end on. */
const WEAK = new Set(["a", "an", "the", "of", "to", "and", "or", "but", "by", "in", "on", "at", "for", "with", "from", "as", "is", "my", "your", "our", "their", "this", "that", "i", "we", "you"]);

/**
 * Group words into captions: break at sentence ends, at pauses, and before a
 * line would grow past maxChars or stay up past maxDuration. Then stretch
 * captions that flash by too fast into the gap that follows them.
 */
export function wordsToCaptions(words: Word[], o: LineOptions = DEFAULT_LINES): Caption[] {
  const out: Caption[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    const text = cur.map((w) => w.text.trim()).join(" ").replace(/\s+([,.!?;:…])/g, "$1").trim();
    // A word that is only punctuation joins the one before, as in the text.
    const words = cur.filter((w) => w.text.trim() && !/^[,.!?;:…]/.test(w.text.trim())).map((w) => w.start);
    if (text) out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text, ...(words.length ? { words } : {}) });
    cur = [];
  };
  const chars = (ws: Word[]) => ws.reduce((n, x) => n + x.text.trim().length + 1, 0);
  for (const w of words) {
    const t = w.text.trim();
    if (!t) continue;
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const len = chars(cur) + t.length;
      if (w.start - prev.end >= o.pauseBreak || w.end - cur[0].start > o.maxDuration) flush();
      else if (len > o.maxChars) {
        // Never strand a little word at the end of a line ("spoken by a /
        // computer"): carry it over to start the next one.
        const carry: Word[] = [];
        while (cur.length > 1 && WEAK.has(cur[cur.length - 1].text.trim().toLowerCase().replace(/[^a-z']/g, ""))) carry.unshift(cur.pop()!);
        flush();
        cur = carry;
      }
    }
    cur.push(w);
    // A sentence end always closes the line; a comma does once the line is
    // past 40% of its length, which is where readers expect a break.
    if (SENTENCE_END.test(t) || (/,$/.test(t) && chars(cur) >= o.maxChars * 0.4)) flush();
  }
  flush();
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (c.end - c.start < o.minDuration) {
      const limit = out[i + 1]?.start ?? Infinity;
      c.end = Math.min(c.start + o.minDuration, limit);
    }
  }
  return out;
}

// ---- SRT / VTT ------------------------------------------------------------------

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function stamp(seconds: number, sep: "," | "."): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export function toSrt(captions: Caption[]): string {
  return captions.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text}\n`).join("\n");
}

export function toVtt(captions: Caption[]): string {
  return `WEBVTT\n\n${captions.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text}\n`).join("\n")}`;
}

function parseStamp(s: string): number | null {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/.exec(s.trim());
  if (!m) return null;
  return (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
}

/** Read SRT or WebVTT (cue settings and styling are ignored). */
export function parseSubtitles(text: string): Caption[] {
  const out: Caption[] = [];
  const blocks = text.replace(/\r/g, "").replace(/^﻿/, "").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const start = parseStamp(a);
    const end = parseStamp(b.trim().split(/\s+/)[0]);
    const body = lines.slice(i + 1).join("\n").replace(/<[^>]+>/g, "").trim();
    if (start !== null && end !== null && end > start && body) out.push({ start, end, text: body });
  }
  return out;
}

/**
 * Where to cut long audio into recognition windows: near every `target`
 * seconds, at the quietest 10 ms within `slack` seconds before it, so no
 * word is sliced in half. `rms` holds one energy value per 10 ms.
 */
export function quietCuts(rms: Float32Array, total: number, target = 28, slack = 6): number[] {
  const cuts: number[] = [];
  let from = 0;
  while (total - from > target + 2) {
    const lo = Math.floor((from + target - slack) * 100);
    const hi = Math.floor((from + target) * 100);
    let best = hi;
    for (let i = lo; i <= hi && i < rms.length; i++) if (rms[i] < rms[best] || best >= rms.length) best = i;
    const cut = Math.max(from + 1, best / 100);
    cuts.push(cut);
    from = cut;
  }
  return cuts;
}

/** Energy per 10 ms window of mono PCM at `rate` Hz. */
export function rms10ms(pcm: Float32Array, rate: number): Float32Array {
  const n = Math.round(rate / 100);
  const out = new Float32Array(Math.ceil(pcm.length / n));
  for (let w = 0; w < out.length; w++) {
    let s = 0;
    const end = Math.min(pcm.length, (w + 1) * n);
    for (let i = w * n; i < end; i++) s += pcm[i] * pcm[i];
    out[w] = Math.sqrt(s / Math.max(1, end - w * n));
  }
  return out;
}

// ---- find and replace -------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** CapCut's caption Find and replace: every match of `find` in `text`
 * (any case unless `matchCase`; whole words only when `wholeWord`), and
 * how many there were. */
export function replaceText(text: string, find: string, replace: string, o: { matchCase?: boolean; wholeWord?: boolean } = {}): [string, number] {
  if (!find) return [text, 0];
  const body = escapeRe(find);
  const re = new RegExp(o.wholeWord ? `(?<![\\p{L}\\p{N}'])${body}(?![\\p{L}\\p{N}'])` : body, o.matchCase ? "gu" : "giu");
  let n = 0;
  const out = text.replace(re, () => (n++, replace));
  return [out, n];
}

/** Text as a style's case shows it (TextStyle.case): the typed text is
 * kept; title raises each word's first letter, as CSS capitalize does. */
export function casedText(text: string, c: "upper" | "lower" | "title" | undefined): string {
  if (c === "upper") return text.toUpperCase();
  if (c === "lower") return text.toLowerCase();
  if (c === "title") return text.replace(/(^|\s)(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
  return text;
}
