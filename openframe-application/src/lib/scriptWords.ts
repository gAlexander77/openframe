// Captions of a voice whose words are known (ADR-092): a line read by
// add_voiceover or text to speech keeps its script with its take
// (Asset.speech), so its captions show the script's words, timed by what
// Whisper heard, instead of what Whisper thought it heard. On the launch
// footage Whisper turned "All of it, home" into "Olivet Helmed". Pure.

import type { Word } from "./captions";
import { clipEnd, getAsset } from "./project/ops";
import type { Clip, Project } from "./project/types";
import { framesToSeconds } from "./time";
import { tokens } from "./voiceReview";
import { parseLine } from "./voiceScript";

/** For each token of `a`, the token of `b` it lines up with (the same word
 * or the one heard in its place), or -1 for one not heard: an edit
 * distance alignment, substitutions allowed. */
function align(a: string[], b: string[]): number[] {
  const n = a.length, m = b.length;
  const cost = Array.from({ length: n + 1 }, (_, i) => Float64Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) cost[i][j] = Math.min(cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), cost[i - 1][j] + 1, cost[i][j - 1] + 1);
  const out = new Array<number>(n).fill(-1);
  for (let i = n, j = m; i > 0 && j >= 0; ) {
    if (j > 0 && cost[i][j] === cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) out[--i] = --j;
    else if (cost[i][j] === cost[i - 1][j] + 1) i--;
    else j--;
  }
  return out;
}

/**
 * The words of `script` (as written: its caption, punctuation kept) timed
 * by `heard`, Whisper's words over the same speech: each script word takes
 * the time of the heard words it lines up with (numbers and symbols
 * compare as said, "20%" as "twenty percent"); a run of words not heard
 * shares the time between its neighbors by length. With nothing heard the
 * words share [from, to).
 */
export function scriptTimes(script: string, heard: Word[], from = heard[0]?.start ?? 0, to = heard.at(-1)?.end ?? from): Word[] {
  const written = script.split(/\s+/).filter(Boolean);
  if (!written.length) return [];
  // Tokens, each with the written (or heard) word it came from.
  const st: { t: string; w: number }[] = written.flatMap((w, i) => tokens(w).map((t) => ({ t, w: i })));
  const ht: { t: string; w: number }[] = heard.flatMap((w, i) => tokens(w.text).map((t) => ({ t, w: i })));
  const pairs = align(st.map((x) => x.t), ht.map((x) => x.t));
  const times: ({ start: number; end: number } | null)[] = written.map(() => null);
  pairs.forEach((j, i) => {
    if (j < 0) return;
    const h = heard[ht[j].w], k = st[i].w;
    times[k] = times[k] ? { start: Math.min(times[k]!.start, h.start), end: Math.max(times[k]!.end, h.end) } : { start: h.start, end: h.end };
  });
  // Runs of untimed words share the gap around them by their length.
  for (let i = 0; i < written.length; i++) {
    if (times[i]) continue;
    let j = i;
    while (j < written.length && !times[j]) j++;
    const a = i > 0 ? times[i - 1]!.end : from, b = j < written.length ? times[j]!.start : to;
    const len = written.slice(i, j).map((w) => Math.max(1, w.length));
    const total = len.reduce((x, y) => x + y, 0);
    let at = a;
    for (let k = i; k < j; k++) {
      const d = (Math.max(0, b - a) * len[k - i]) / total;
      times[k] = { start: at, end: at + d };
      at += d;
    }
    i = j - 1;
  }
  // Keep them in order (a word heard early cannot start before the one before it).
  for (let i = 1; i < written.length; i++) if (times[i]!.start < times[i - 1]!.start) times[i] = { start: times[i - 1]!.start, end: Math.max(times[i - 1]!.start, times[i]!.end) };
  return written.map((text, i) => ({ text, start: +times[i]!.start.toFixed(3), end: +times[i]!.end.toFixed(3) }));
}

/** What a voice clip's captions say: its caption when it has one, else
 * its script as written (no pause marks). */
export const scriptCaption = (speech: { text: string; caption?: string }) => speech.caption ?? parseLine(speech.text).written;

/** A clip that plays the whole of a take with a known script: the script
 * is what it says. A piece of one (trimmed or cut) says only part of it,
 * so Whisper's words stand there. */
function scripted(p: Project, c: Clip): string | undefined {
  if (c.type !== "audio" && c.type !== "video") return undefined;
  const a = getAsset(p, c.assetId);
  if (!a?.speech || c.muted || c.reverse || c.speedCurve) return undefined;
  const plays = framesToSeconds(c.duration, p.fps) * (c.speed || 1);
  return c.in <= 0.05 && Math.abs(plays - a.duration) <= 0.1 ? scriptCaption(a.speech) : undefined;
}

/**
 * Words Whisper heard on the timeline (timeline seconds), with each voice
 * line of a known script (a whole add_voiceover or text-to-speech take on
 * a track that sounds) said in its script's words, timed by what was
 * heard over it.
 */
export function withScripts(p: Project, heard: Word[]): Word[] {
  let out = heard;
  for (const t of p.tracks) {
    if (t.muted) continue;
    for (const c of t.clips) {
      const script = scripted(p, c);
      if (!script) continue;
      const from = framesToSeconds(c.start, p.fps), to = framesToSeconds(clipEnd(c), p.fps);
      const mid = (w: Word) => (w.start + w.end) / 2;
      const inside = out.filter((w) => mid(w) >= from && mid(w) < to);
      out = [...out.filter((w) => !inside.includes(w)), ...scriptTimes(script, inside, from, to)].sort((a, b) => a.start - b.start);
    }
  }
  return out;
}

/** An asset's words heard over [from, to) of its source, in its script's
 * words when it has a known script and the whole take was heard. */
export function assetWords(p: Project, assetId: string, from: number, to: number, heard: Word[]): Word[] {
  const a = getAsset(p, assetId);
  return a?.speech && from <= 0.05 && to >= a.duration - 0.1 ? scriptTimes(scriptCaption(a.speech), heard, from, to) : heard;
}
