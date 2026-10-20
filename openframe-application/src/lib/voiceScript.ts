// A voiceover script line, directed (add_voiceover, retake_voiceover):
// pause marks written in the text, a pronunciation map that respells words
// for the voice while captions keep them as written, the pause a line's
// ending calls for, and where the voice model's own pauses fall so a mark
// can lengthen one instead of cutting the sentence in two (ADR-083).

/** A pause the script asks for, in seconds. */
export const PAUSE_DEFAULT = 0.5;
export const BEAT_DEFAULT = 1;
const PAUSE_MIN = 0.05, PAUSE_MAX = 5;

/** `[pause]`, `[pause 0.4]`, `[pause 400ms]`, `[beat]`, or SSML's
 * `<break time="400ms"/>`. */
const MARK = /\[\s*(pause|beat)(?:\s+(\d+(?:\.\d+)?)\s*(ms|s)?)?\s*\]|<break\s+time\s*=\s*["']?\s*(\d+(?:\.\d+)?)\s*(ms|s)?\s*["']?\s*\/?>/gi;

const clampPause = (s: number) => Math.min(PAUSE_MAX, Math.max(PAUSE_MIN, s));

export interface ParsedLine {
  /** The words as written, marks taken out: what the caption shows. */
  written: string;
  /** What the voice reads: marks out, words respelled, a comma where a
   * mark fell between words with no punctuation (so the voice phrases a
   * break there instead of running on). */
  spoken: string;
  /** Pauses inside the line: `at` is the character index in `spoken`
   * the pause follows, `share` the share of the line's letters before it
   * (where in the read it should fall). */
  pauses: { at: number; share: number; seconds: number }[];
  /** A mark before the first word or after the last: silence before or
   * after the line, added to the gap. */
  before: number;
  after: number;
}

const letters = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
const ENDS_PHRASE = /[,.;:!?…—–-]["'”’)\]]*$/;

/** A pronunciation map from untrusted JSON: every value a string. */
export function checkPronounce(map: unknown): Record<string, string> | undefined {
  if (map === undefined) return undefined;
  if (typeof map !== "object" || map === null || Array.isArray(map)) throw new Error('pronounce is a map of words to how to say them: {"MCP": "M C P"}');
  for (const [k, v] of Object.entries(map)) if (typeof v !== "string" || !v.trim()) throw new Error(`pronounce.${k} must be the text the voice reads instead`);
  return map as Record<string, string>;
}

/** Respell words for the voice: whole words only, case as written, the
 * longest key first ("Open Frame" for "OpenFrame", "M C P" for "MCP"). */
export function applyPronounce(text: string, map: Record<string, string> | undefined): string {
  const keys = Object.keys(map ?? {}).filter((k) => k.trim()).sort((a, b) => b.length - a.length);
  if (!keys.length) return text;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}])`, "gu");
  return text.replace(re, (m) => map![m] ?? m);
}

/** `*word*`, markdown's emphasis, as a script may carry it. */
const STAR = /\*([^*\n]+)\*/g;

/** Stars out: the voice cannot be directed to stress a word (ADR-096:
 * raising its stress, the voice model's one handle, measured no
 * emphasis), and neither the voice nor the caption should say them. */
const unstar = (s: string) => s.replace(STAR, "$1").replace(/\*/g, "");

/** Does the script mark a word for emphasis? (Answered with a note.) */
export const asksEmphasis = (text: string) => /\*[^*\n]+\*/.test(text);

/** What a voiceover answers when a line asks for emphasis. */
export const EMPHASIS_NOTE =
  "*word* emphasis is not voiced, and the stars were dropped: the voice model (Kokoro) takes only phonemes, punctuation and one speed per line, and raising a word's stress, its own emphasis mark, measured no emphasis (ten short words: pitch and level moved either way, length +0.01 s). For a word to stand out, put it last in its phrase, where English puts the main stress and the voice lengthens it, or [pause 0.2] before it.";

/** Split a line at its pause marks into what is written, what is spoken
 * and where the pauses go. */
export function parseLine(text: string, pronounce?: Record<string, string>): ParsedLine {
  const parts: string[] = [];
  const marks: number[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    parts.push(text.slice(last, m.index));
    const n = m[2] ?? m[4];
    const unit = m[3] ?? m[5];
    const given = n === undefined ? (m[1]?.toLowerCase() === "beat" ? BEAT_DEFAULT : PAUSE_DEFAULT) : Number(n) / (unit?.toLowerCase() === "ms" ? 1000 : 1);
    marks.push(clampPause(given));
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  // Punctuation written after a mark belongs before it: "Wait [pause]. Now".
  for (let i = 1; i < parts.length; i++) {
    const lead = parts[i].match(/^\s*([,.;:!?…]+)/);
    if (lead) {
      parts[i - 1] = parts[i - 1].trimEnd() + lead[1];
      parts[i] = parts[i].slice(lead[0].length);
    }
  }
  const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
  const written = tidy(unstar(parts.join(" ")));
  let before = 0, after = 0;
  // Marks with no words before them (or after them) are line-edge silence.
  while (marks.length && !letters(parts[0])) {
    before += marks.shift()!;
    parts.splice(0, 2, `${parts[0]} ${parts[1]}`);
  }
  while (marks.length && !letters(parts.at(-1)!)) {
    after += marks.pop()!;
    parts.splice(-2, 2, `${parts.at(-2)} ${parts.at(-1)}`);
  }
  let spoken = "";
  const ats: number[] = [];
  parts.forEach((raw, i) => {
    let s = tidy(unstar(applyPronounce(raw, pronounce)));
    if (i < marks.length && s && !ENDS_PHRASE.test(s)) s += ",";
    spoken = spoken && s ? `${spoken} ${s}` : spoken || s;
    if (i < marks.length) ats.push(spoken.length);
  });
  const total = letters(spoken);
  const pauses = ats.map((at, i) => ({ at, share: total ? letters(spoken.slice(0, at)) / total : 0, seconds: marks[i] }));
  return { written, spoken, pauses, before, after };
}

/** The script's words, for counting and comparing: marks out. */
export const writtenWords = (text: string) => parseLine(text).written.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

/**
 * The silence a line's ending calls for before the next line (the gap
 * between the clips; each take also keeps a short breath of its own either
 * side, about 0.25 s together): a sentence 0.4 s, a trailing ellipsis
 * 0.6 s, a comma, colon or dash 0.1 s (the thought runs on), a paragraph's
 * end 0.8 s.
 */
export function pauseAfter(text: string, paragraph = false): number {
  if (paragraph) return 0.8;
  const t = parseLine(text).written.replace(/["'”’)\]]+$/, "");
  if (/(…|\.\.\.)$/.test(t)) return 0.6;
  if (/[,;:—–-]$/.test(t)) return 0.1;
  return 0.4;
}

/**
 * Where each line goes, in seconds: at its own `at` when given, otherwise
 * its `gap` (default `gap`) after the line before (the first at `start`);
 * a line never starts before the previous one ends, so voices never
 * overlap. `before` delays a line that is not pinned.
 */
export function layoutLines(lines: { at?: number; seconds: number; gap?: number; before?: number }[], start = 0, gap = 0.4): { start: number; end: number }[] {
  let next = start, end = 0;
  return lines.map((l) => {
    const s = Math.max(l.at ?? next + (l.before ?? 0), end);
    end = s + l.seconds;
    next = end + (l.gap ?? gap);
    return { start: +s.toFixed(3), end: +end.toFixed(3) };
  });
}

/**
 * A note for each line given an `at` that starts later, pushed there by
 * the line before running past it. The answer gave the real starts, but
 * nothing said "line 4 asked for 12.6, landed 14.36", and a film test's
 * script overran by 3 s unnoticed (ADR-113).
 */
export function lateLineNotes(asked: (number | undefined)[], times: { start: number; end: number }[]): string[] {
  const out: string[] = [];
  asked.forEach((at, i) => {
    const late = at === undefined || i === 0 ? 0 : times[i].start - at;
    if (late < 0.0005) return;
    out.push(`Line ${i + 1} starts at ${times[i].start} s, ${+late.toFixed(3)} s after its at (${at} s): line ${i} runs until then. Shorten line ${i} (retake_voiceover with fewer words or a faster words_per_second) or give line ${i + 1} a later at.`);
  });
  return out;
}

/**
 * The places a voice pauses on its own: after each comma, colon,
 * semicolon, dash and sentence end inside `spoken` (not its last), with
 * the share of letters before each and whether it ends a sentence.
 */
export function breaksOf(spoken: string): { at: number; share: number; sentence: boolean }[] {
  const total = letters(spoken);
  const out: { at: number; share: number; sentence: boolean }[] = [];
  for (const m of spoken.matchAll(/([,;:—–]|[.!?…]+)["'”’)\]]*(?=\s+\S)/g)) {
    const at = m.index! + m[0].length;
    out.push({ at, share: total ? letters(spoken.slice(0, at)) / total : 0, sentence: /[.!?…]/.test(m[1]) });
  }
  return out;
}

/**
 * Which of a take's dips (analysis/speech.ts dips) each break is (`-1`:
 * none). Dips are placed by their share of the voiced time (pauses of
 * 0.1 s or more taken out), breaks by their share of the letters; an
 * in-order alignment scores each pair by the dip's length (up to 0.4 s)
 * less the distance between the two shares, and keeps the best total, so
 * a long pause near the right place beats a consonant's short closure
 * right on it. A pair further apart than `tolerance`, or scoring nothing,
 * is never made: the voice ran through that break.
 */
export function matchPauses(pauses: { start: number; end: number }[], first: number, last: number, shares: number[], tolerance = 0.2): number[] {
  const long = pauses.filter((p) => p.end - p.start >= 0.1);
  const voiced = last - first - long.reduce((n, p) => n + (p.end - p.start), 0);
  if (!(voiced > 0)) return shares.map(() => -1);
  const at = pauses.map((p) => (p.start - first - long.filter((q) => q.end <= p.start).reduce((n, q) => n + (q.end - q.start), 0)) / voiced);
  // best[i][j]: the best score aligning the first i breaks with the first j dips.
  const B = shares.length, P = pauses.length;
  const best = Array.from({ length: B + 1 }, () => new Float64Array(P + 1));
  const from = Array.from({ length: B + 1 }, () => new Int8Array(P + 1));
  for (let i = 1; i <= B; i++) {
    for (let j = 0; j <= P; j++) {
      // The break unmatched, or the dip skipped, or the two matched.
      let score = best[i - 1][j], how = 0;
      if (j > 0 && best[i][j - 1] > score) {
        score = best[i][j - 1];
        how = 1;
      }
      if (j > 0) {
        const d = Math.abs(shares[i - 1] - at[j - 1]);
        const gain = Math.min(0.4, pauses[j - 1].end - pauses[j - 1].start) - d;
        if (d <= tolerance && gain > 0 && best[i - 1][j - 1] + gain > score) {
          score = best[i - 1][j - 1] + gain;
          how = 2;
        }
      }
      best[i][j] = score;
      from[i][j] = how;
    }
  }
  const out = shares.map(() => -1);
  for (let i = B, j = P; i > 0; ) {
    const how = from[i][j];
    if (how === 2) out[--i] = --j;
    else if (how === 1) j--;
    else i--;
  }
  return out;
}

/**
 * Split text the voice cannot take in one breath (the model reads about
 * 500 phonemes; past that it drops the rest) at sentence ends, so no
 * sentence is ever cut: pieces of at most `max` characters unless one
 * sentence is longer, which then goes alone.
 */
export function chunkSentences(text: string, max = 320): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const out: string[] = [];
  for (const s of sentences) {
    if (out.length && out.at(-1)!.length + 1 + s.length <= max) out[out.length - 1] += ` ${s}`;
    else out.push(s);
  }
  return out;
}

// ---- words, counted --------------------------------------------------------------

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 0..9999 as words ("24" as twenty four), so a script's numerals and a
 * transcript's words (or the other way round) compare equal. */
export function numberWords(n: number): string[] {
  if (n < 20) return [ONES[n]];
  if (n < 100) return [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])];
  if (n < 1000) return [ONES[Math.floor(n / 100)], "hundred", ...(n % 100 ? numberWords(n % 100) : [])];
  return [...numberWords(Math.floor(n / 1000)), "thousand", ...(n % 1000 ? numberWords(n % 1000) : [])];
}

/**
 * Syllables in an English word, by its vowel groups: a silent final e is
 * dropped (not after an l: "little"), and -es and -ed when they are not a
 * syllable of their own ("makes", "asked"; "voices" and "wanted" keep
 * theirs). A pace measure that does not count "a" and "computer" alike.
 */
export function syllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  const digits = word.replace(/\D/g, "");
  if (!w) return digits && digits.length <= 4 ? numberWords(Number(digits)).reduce((n, t) => n + syllables(t), 0) : 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouycsxzgh]es|[^laeiouytd]ed|[^laeiouy]e)$/, (m) => m[0]).replace(/^y/, "");
  return Math.max(1, w.match(/[aeiouy]+/g)?.length ?? 0);
}
