// Captions as data: grouping recognized words into readable lines, and the
// SRT/VTT formats people bring in and take out. Pure, so line breaking is
// tested rather than eyeballed.

import type { Project, TextClip } from "./project/types";
import { framesToSeconds } from "./time";

export interface Word {
  text: string;
  /** Seconds. */
  start: number;
  end: number;
}

/** Normalize ASR output before it reaches transcripts or captions. An overlapping
 * repeat at a window boundary is one word; other overlaps keep word order.
 * Sequential repetitions ("very very") are retained. */
export function monotonicWords(words: Word[]): Word[] {
  const out: Word[] = [];
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  for (const w of [...words].filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && w.text.trim()).sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && w.start < last.end && key(w.text) && key(w.text) === key(last.text)) { last.end = Math.max(last.end, w.end); continue; }
    const start = Math.max(0, w.start, last?.end ?? 0);
    if (w.end > start) out.push({ ...w, start });
  }
  return out;
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
 * (it was edited) or there are none, and for a caption of one word: the
 * highlight says which word of a caption is being spoken, so a lone word
 * keeps the caption's color (ADR-115; it used to show the highlight color
 * the whole time it was up). */
export function spokenWord(text: string, times: number[] | undefined, r: number): number | undefined {
  if (!times || times.length < 2 || text.trim().split(/\s+/).length !== times.length) return undefined;
  let i = -1;
  while (i + 1 < times.length && times[i + 1] <= r) i++;
  return i;
}

export interface LineOptions {
  /** Short-form captions: at most this many words, keeping word timings. */
  maxWords?: number;
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
export const WEAK = new Set(["a", "an", "the", "of", "to", "and", "or", "but", "by", "in", "on", "at", "for", "with", "from", "as", "is", "my", "your", "our", "their", "this", "that", "i", "we", "you"]);

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
      if (cur.length >= (o.maxWords ?? Infinity) || w.start - prev.end >= o.pauseBreak || w.end - cur[0].start > o.maxDuration) flush();
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

/** The reading-time rule shared by auto captions and the project checker. */
export function captionReading(c: Caption): { cps: number; met: boolean } {
  const duration = c.end - c.start;
  const cps = c.text.replace(/\s+/g, " ").trim().length / Math.max(duration, 1e-3);
  return { cps, met: duration >= 5 / 6 && cps <= 20 };
}

/** Whole readable cues: choose phrase boundaries together, rather than
 * leaving a final word orphaned by a greedy line break. A cue may use two
 * lines. Reading time grows into silence, never over the next spoken word.
 * Very fast speech or a clipped word can still be infeasible; callers report
 * those cues instead of dropping recognized words. */
export function readableCaptions(input: Word[], o: LineOptions = DEFAULT_LINES, limit = Infinity): Caption[] {
  const ws = monotonicWords(input).filter(w => w.start < limit);
  const n = ws.length, cost = Array(n + 1).fill(Infinity), next = Array(n).fill(0), cues: Caption[] = [];
  cost[n] = 0;
  const wrap = (a: number, b: number) => {
    const lines = [""];
    for (const w of ws.slice(a, b)) {
      const t = w.text.trim(), last = lines.length - 1;
      if (lines[last] && lines[last].length + t.length + 1 > o.maxChars) lines.push(t);
      else lines[last] += (lines[last] ? " " : "") + t;
    }
    return lines.join("\n").replace(/\s+([,.!?;:])/g, "$1");
  };
  const cue = (i: number, j: number): Caption => {
    const text = wrap(i, j), start = ws[i].start;
    const need = Math.max(5 / 6, text.replace(/\s+/g, " ").trim().length / 19);
    return { start, end: Math.min(limit, ws[j]?.start ?? Infinity, Math.max(ws[j - 1].end, start + need)), text, words: ws.slice(i, j).filter(w => !/^[,.!?;:]/.test(w.text.trim())).map(w => w.start) };
  };
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j <= n && j <= i + 40; j++) {
      const c = cue(i, j), lines = c.text.split("\n");
      if (j > i + 1 && (lines.length > 2 || ws[j - 1].end - ws[i].start > Math.max(o.maxDuration, 5))) break;
      const duration = c.end - c.start;
      const cps = c.text.replace(/\s+/g, " ").trim().length / Math.max(0.001, duration);
      const penalty = 1 + (SENTENCE_END.test(ws[j - 1].text) ? 0 : /[,;:]$/.test(ws[j - 1].text) ? 0.3 : 1.2)
        + (WEAK.has(ws[j - 1].text.toLowerCase()) ? 3 : 0)
        + (j - i === 1 ? 4 : 0) + Math.max(0, 5 / 6 - duration) * 1000 + Math.max(0, cps - 20) * 100;
      if (penalty + cost[j] < cost[i]) { cost[i] = penalty + cost[j]; next[i] = j; }
      if (j < n && ws[j].start - ws[j - 1].end >= o.pauseBreak) break;
    }
  }
  for (let i = 0; i < n;) { const j = next[i] || i + 1; cues.push(cue(i, j)); i = j; }
  return cues;
}

// ---- the project's captions ------------------------------------------------------

/** The caption clips (add_captions' text clips), in time order. */
export function captionClips(p: Project): TextClip[] {
  return p.tracks.flatMap((t) => t.clips.filter((c): c is TextClip => c.type === "text" && !!c.caption)).sort((a, b) => a.start - b.start);
}

/** The project's captions in seconds, as SRT and VTT take them. */
export function currentCaptions(p: Project): Caption[] {
  return captionClips(p).map((c) => ({ start: framesToSeconds(c.start, p.fps), end: framesToSeconds(c.start + c.duration, p.fps), text: c.text }));
}

/** Captions as an export of [from, to) seconds shows them: timed from its
 * start, cut at its ends, those outside it left out. */
export function captionsInRange(caps: Caption[], from: number, to: number): Caption[] {
  return caps.filter((c) => c.end > from && c.start < to).map((c) => ({ start: Math.max(c.start, from) - from, end: Math.min(c.end, to) - from, text: c.text }));
}

/** The project with its captions switched off (disabled clips draw
 * nothing), for an export that leaves them out of the picture. */
export function withoutCaptions(p: Project): Project {
  return { ...p, tracks: p.tracks.map((t) => (t.clips.some((c) => c.type === "text" && c.caption) ? { ...t, clips: t.clips.map((c) => (c.type === "text" && c.caption ? { ...c, disabled: true } : c)) } : t)) };
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
