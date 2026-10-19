// Listening back to a voiceover (review_voiceover): what Whisper heard
// against the script, word by word, and a verdict per line naming the tool
// that fixes each problem. Pure: the hearing and the measuring are the
// caller's (state/voiceReview.ts).

import { numberWords, parseLine } from "./voiceScript";

// ---- words --------------------------------------------------------------------------

/** Words to compare: lower case, no punctuation, numbers spelled out,
 * % and & said; hyphens and slashes part words. */
export function tokens(text: string): string[] {
  return text
    .replace(/%/g, " percent ")
    .replace(/&/g, " and ")
    .split(/[\s\-–—/]+/)
    .flatMap((w) => {
      const t = w.toLowerCase().replace(/[’]/g, "'").replace(/[^\p{L}\p{N}']/gu, "").replace(/^'+|'+$/g, "");
      if (/^\d{1,4}$/.test(t)) return numberWords(Number(t));
      return t ? [t] : [];
    });
}

export interface Difference {
  /** missing: said in the script, not heard; extra: heard, not in the
   * script; misheard: heard as something else. */
  kind: "missing" | "extra" | "misheard";
  /** A short word heard a letter off ("it" as "its", "an" as "and"): the
   * listener's slip as often as the voice's; reported, not failed. */
  minor?: boolean;
  script?: string;
  heard?: string;
  /** Index of the first heard word nearest it (for its time). */
  near: number;
  /** After a second hearing by a larger model: it heard the script's words
   * there (the first recognizer misheard; the voice is fine), or it heard
   * the same difference (the voice likely said it wrong). */
  likely?: "recognizer" | "voice";
}

/** One short word against another a letter apart, or a lone short word
 * missing or extra ("a", "the"): a slip, not a misread name. */
function isMinor(d: Difference): boolean {
  const a = d.script ?? "", b = d.heard ?? "";
  if (/\s/.test(a) || /\s/.test(b)) return false;
  if (!a || !b) return (a || b).length <= 3;
  if (Math.max(a.length, b.length) > 4 || Math.abs(a.length - b.length) > 1) return false;
  // One letter added, dropped or changed.
  let i = 0;
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1);
}

/**
 * The script against what was heard, word by word (an edit-distance
 * alignment). Words run together or apart compare equal ("open frame" and
 * "openframe", "m c p" and "mcp"); neighboring differences merge into one.
 */
export function diffWords(script: string[], heard: string[]): { matched: number; differences: Difference[] } {
  const S = script.length, H = heard.length;
  const cost = Array.from({ length: S + 1 }, () => new Float64Array(H + 1));
  const step = Array.from({ length: S + 1 }, () => Array<[number, number] | null>(H + 1).fill(null));
  for (let i = 0; i <= S; i++) {
    for (let j = 0; j <= H; j++) {
      if (!i && !j) continue;
      let best = Infinity, how: [number, number] | null = null;
      const take = (di: number, dj: number, c: number) => {
        if (i - di < 0 || j - dj < 0 || cost[i - di][j - dj] + c >= best) return;
        best = cost[i - di][j - dj] + c;
        how = [di, dj];
      };
      // Equal words, or up to three run together on either side.
      for (let di = 1; di <= 3; di++) {
        for (let dj = 1; dj <= 3; dj++) {
          if (i - di < 0 || j - dj < 0) continue;
          if (script.slice(i - di, i).join("") === heard.slice(j - dj, j).join("")) take(di, dj, 0);
        }
      }
      take(1, 1, 1);
      take(1, 0, 1);
      take(0, 1, 1);
      cost[i][j] = best;
      step[i][j] = how;
    }
  }
  const ops: { kind: "same" | Difference["kind"]; s: string[]; h: string[]; j: number }[] = [];
  for (let i = S, j = H; i > 0 || j > 0; ) {
    const [di, dj] = step[i][j]!;
    const s = script.slice(i - di, i), h = heard.slice(j - dj, j);
    const kind = di && dj ? (s.join("") === h.join("") ? "same" : "misheard") : di ? "missing" : "extra";
    ops.unshift({ kind, s, h, j: j - dj });
    i -= di;
    j -= dj;
  }
  let matched = 0;
  const differences: Difference[] = [];
  for (const o of ops) {
    if (o.kind === "same") {
      matched += o.s.length;
      continue;
    }
    const last = differences.at(-1);
    const prev = ops[ops.indexOf(o) - 1];
    if (last && prev && prev.kind !== "same") {
      // Next to the difference before: one difference, both sides joined.
      last.script = [last.script, o.s.join(" ")].filter(Boolean).join(" ") || undefined;
      last.heard = [last.heard, o.h.join(" ")].filter(Boolean).join(" ") || undefined;
      last.kind = last.script && last.heard ? "misheard" : last.script ? "missing" : "extra";
      continue;
    }
    differences.push({ kind: o.kind, ...(o.s.length ? { script: o.s.join(" ") } : {}), ...(o.h.length ? { heard: o.h.join(" ") } : {}), near: Math.min(o.j, Math.max(0, heard.length - 1)) });
  }
  for (const d of differences) if (isMinor(d)) d.minor = true;
  return { matched, differences };
}

/** The script against what was heard, against the words as written and as
 * respelled for the voice, whichever matches better. */
export function compareScript(text: string, heard: string, pronounce?: Record<string, string>) {
  const h = tokens(heard);
  const written = tokens(parseLine(text).written);
  const a = diffWords(written, h);
  if (!pronounce || !Object.keys(pronounce).length) return { words: written.length, ...a };
  const b = diffWords(tokens(parseLine(text, pronounce).spoken), h);
  return b.differences.length < a.differences.length ? { words: written.length, matched: written.length - b.differences.length, differences: b.differences } : { words: written.length, ...a };
}

/** The script words a difference covers, or what was heard for an extra word. */
const covered = (d: Difference) => new Set((d.script ?? d.heard ?? "").split(" ").filter(Boolean));

/**
 * The first hearing's differences judged against a second hearing of the
 * same line by a larger model: one the second did not hear is the first
 * recognizer's mistake, one it heard too (a difference over the same
 * words) is likely the voice's. Minor slips stay as they are.
 */
export function judgeHearings(first: Difference[], second: Difference[]): Difference[] {
  return first.map((d) => {
    if (d.minor) return d;
    const words = covered(d);
    const again = second.some((x) => !x.minor && (x.script === undefined) === (d.script === undefined) && [...covered(x)].some((w) => words.has(w)));
    return { ...d, likely: again ? "voice" : "recognizer" };
  });
}

// ---- verdicts -----------------------------------------------------------------------------

/** What review_voiceover holds a line to. Pace is judged in syllables,
 * since words per second runs high on short words ("so a whole film can be
 * made" is 4 words a second at an ordinary 4.4 syllables): read speech
 * moves at about 4-5.5 syllables a second inside a phrase. A line is read
 * in one breath, so its words a second run faster than a script's (which
 * counts the pauses between lines): 2.4-3.3 inside a line reads as 2.3-2.8
 * across a script. */
export const REVIEW = {
  fastSps: 5.6,
  slowSps: 3.2,
  /** A line meant to be slow (an end-card tagline, pace slow) or fast
   * (pace fast) is held to these instead. */
  slowIntentSps: 2,
  fastIntentSps: 7.5,
  /** Silence before the first word and after the last, seconds. */
  leadMax: 0.3,
  tailMax: 0.6,
  /** A pause inside a line longer than this that no mark asked for. */
  pauseMax: 1.2,
  /** Off the median of the lines reviewed, LU. */
  levelSpread: 1.5,
  truePeakMax: -1,
  /** Voice over music, LU: under this the words fight the bed; over the
   * max the music has all but gone under the voice. */
  overMusicMin: 8,
  overMusicMax: 25,
  /** What a fix aims the voice at over the music, LU (10-15 for a promo). */
  overMusicAim: 12,
  /** Melody, semitones: under this a read sounds flat. */
  flatSt: 3,
};

export interface LineMeasure {
  clipId: string;
  /** The clip's place, timeline seconds. */
  start: number;
  end: number;
  text?: string;
  voice?: string;
  speed?: number;
  pronounce?: Record<string, string>;
  /** The line's intended pace (add_voiceover's pace): a slow line is not
   * flagged as slow, nor a fast one as fast. */
  pace?: Pace;
  /** The clip's volume (linear). */
  volume: number;
  compressed: boolean;
  wps: number | null;
  /** Syllables a second over the speech. */
  sps: number | null;
  lead: number;
  tail: number;
  longestPause: number;
  /** Pause marks in the script, seconds each. */
  marks: number[];
  lufs: number | null;
  truePeak: number | null;
  rangeSt: number | null;
  overMusic: number | null;
  musicClip?: string;
  /** How far the music clip is turned down at the line's middle now
   * (its volume keys against their loudest), dB. */
  musicDuckDb?: number;
  differences: Difference[];
}

export type Pace = "slow" | "normal" | "fast";
export const PACES: Pace[] = ["slow", "normal", "fast"];

export interface Fix {
  problem: string;
  tool: string;
  args: Record<string, unknown>;
}

/** Words whose spelling a reader cannot sound out, as they sound: the
 * voice model's guess at them, and Whisper's, goes wrong more than most. */
const SOUNDS: Record<string, string> = {
  does: "duz", doesnt: "duzzent", says: "sez", said: "sed", done: "dun", gone: "gawn", one: "wun", once: "wunce", none: "nun", some: "sum",
  come: "kum", become: "bee-kum", love: "luv", above: "uh-buv", were: "wur", where: "wair", there: "thair", their: "thair", whose: "hooz",
  who: "hoo", two: "too", eight: "ayt", height: "hite", weight: "wayt", friend: "frend", busy: "bizzy", women: "wimmin", woman: "wumman",
  often: "offen", iron: "eye-urn", island: "eye-lund", colonel: "kernel", choir: "kwire", queue: "kyoo", recipe: "ress-ih-pee",
  genre: "zhahn-ruh", debut: "day-byoo", suite: "sweet", niche: "neesh", segue: "seg-way", cache: "kash", data: "day-tuh", route: "root",
  through: "throo", though: "thoh", enough: "ee-nuff", tough: "tuff", laugh: "laff", answer: "ann-ser", sword: "sord", walk: "wawk",
  talk: "tawk", could: "kood", would: "wood", should: "shood", build: "bild", guide: "gyde", juice: "joos", ocean: "oh-shun",
  people: "pee-pul", every: "ev-ree", business: "biz-ness", minute: "min-it", video: "vid-ee-oh", audio: "aw-dee-oh", editor: "ed-it-er",
  edit: "ed-it", agent: "ay-junt", agents: "ay-junts", app: "ap", gif: "jif", sql: "sequel", ai: "A I", ui: "U I",
};

/** How a word sounds by the usual English rules, or itself when none
 * applies: -tion "shun", -ture "cher", ph "f", silent kn and wr, igh
 * "eye", a silent final e lengthening its vowel (home "hohm"). */
function soundOut(w: string): string {
  let x = w.toLowerCase();
  x = x.replace(/tion$/, "shun").replace(/sion$/, "zhun").replace(/ture$/, "cher").replace(/ph/g, "f").replace(/^kn/, "n").replace(/^wr/, "r").replace(/igh/g, "eye").replace(/qu/g, "kw");
  x = x.replace(/c(?=[eiy])/g, "s");
  const e = /^(.*?)([aeiou])([^aeiouy])e$/.exec(x);
  const long: Record<string, string> = { a: "ay", e: "ee", i: "eye", o: "oh", u: "oo" };
  if (e && !/[aeiou]$/.test(e[1])) x = e[1] + long[e[2]] + e[3];
  return x;
}

/**
 * A respelling for a word the voice said wrong: capitals letter by letter,
 * CamelCase apart, then the word as it sounds (a table of words English
 * spells against their sound, "does" "duz", then the usual rules, "home"
 * "hohm"), then a long word in syllables ("Olivet" "ol-iv-et"). Null for
 * a short regular word, where a respelling would read the same.
 */
export function respell(word: string): string | null {
  if (/^[A-Z]{2,6}s?$/.test(word)) return word.replace(/s$/, "").split("").join(" ") + (word.endsWith("s") ? "s" : "");
  if (/^[A-Z]?[a-z]+(?:[A-Z][a-z]+)+$/.test(word)) return word.replace(/([a-z])([A-Z])/g, "$1 $2");
  const key = word.toLowerCase().replace(/[^a-z]/g, "");
  if (SOUNDS[key] && SOUNDS[key] !== key) return SOUNDS[key];
  const heard = soundOut(key);
  if (heard !== key) return heard;
  const parts = key.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy](?![aeiouy]))?/g);
  if (parts && parts.length > 1 && parts.join("") === key) return parts.join("-");
  return null;
}

const round = (x: number, d = 2) => +x.toFixed(d);

/** What is wrong with a line and the call that fixes each, given the
 * median loudness of the lines reviewed. */
export function verdict(m: LineMeasure, medianLufs: number | null): Fix[] {
  const R = REVIEW;
  const fixes: Fix[] = [];
  const written = m.text ? parseLine(m.text).written.split(/\s+/) : [];
  for (const d of m.differences) {
    // A slip, or a word a larger model heard right: nothing to retake.
    if (d.minor || d.likely === "recognizer") continue;
    const sure = d.likely === "voice" ? " (a larger model heard it the same: likely the voice)" : "";
    const plain = (w: string) => w.replace(/[^\p{L}\p{N}']/gu, "");
    const bare = (w: string) => w.toLowerCase().replace(/'/g, "");
    // The script's words it covers, as written.
    const words = (d.script ?? "").split(" ").map((t) => written.map(plain).find((w) => bare(w) === bare(t))).filter((w): w is string => !!w);
    const tried = words.find((w) => m.pronounce?.[w]);
    // The longest word with a respelling, the likeliest to be misread.
    const spell = words.map((w) => [w, respell(w)] as const).filter((x): x is readonly [string, string] => !!x[1]).sort((a, b) => b[0].length - a[0].length)[0];
    const slower = { clip_id: m.clipId, speed: round((m.speed ?? 1) * 0.9) };
    if (d.kind === "misheard" && tried)
      // Respelled already and still wrong: say it another way.
      fixes.push({ problem: `"${d.script}" was heard as "${d.heard}"${sure}, though respelled "${m.pronounce![tried]}": reword the line without "${tried}", or read it slower`, tool: "retake_voiceover", args: slower });
    else if (d.kind === "misheard" && spell) fixes.push({ problem: `"${d.script}" was heard as "${d.heard}"${sure}`, tool: "retake_voiceover", args: { clip_id: m.clipId, pronounce: { ...m.pronounce, [spell[0]]: spell[1] } } });
    else if (d.kind === "misheard") fixes.push({ problem: `"${d.script}" was heard as "${d.heard}"${sure}; no respelling reads differently: read it slower, or reword the line around it`, tool: "retake_voiceover", args: slower });
    else if (d.kind === "missing") fixes.push({ problem: `"${d.script}" was not heard${sure}`, tool: "retake_voiceover", args: { clip_id: m.clipId, speed: round((m.speed ?? 1) * 0.95) } });
    else fixes.push({ problem: `"${d.heard}" was heard but is not in the script${sure}`, tool: "retake_voiceover", args: { clip_id: m.clipId, speed: round((m.speed ?? 1) * 0.95) } });
  }
  // A speed change of more than 15% at once drags or rushes the voice;
  // review again after the retake.
  const fast = m.pace === "fast" ? R.fastIntentSps : R.fastSps, slow = m.pace === "slow" ? R.slowIntentSps : R.slowSps;
  if (m.sps !== null && m.sps > fast) fixes.push({ problem: `fast: ${m.sps} syllables a second (read speech runs 4-5.5)`, tool: "retake_voiceover", args: { clip_id: m.clipId, speed: round(Math.max(0.5, (m.speed ?? 1) * Math.max(0.85, 4.8 / m.sps))) } });
  if (m.sps !== null && m.sps < slow) fixes.push({ problem: `slow: ${m.sps} syllables a second (read speech runs 4-5.5)`, tool: "retake_voiceover", args: { clip_id: m.clipId, speed: round(Math.min(2, (m.speed ?? 1) * Math.min(1.15, 4.5 / m.sps))) } });
  if (m.lead > R.leadMax) fixes.push({ problem: `${m.lead} s of silence before the first word`, tool: "trim_clip", args: { clip_id: m.clipId, edge: "start", to: round(m.start + m.lead - 0.06) } });
  if (m.tail > R.tailMax) fixes.push({ problem: `${m.tail} s of silence after the last word`, tool: "trim_clip", args: { clip_id: m.clipId, edge: "end", to: round(m.end - m.tail + 0.2) } });
  if (m.longestPause > R.pauseMax && !m.marks.some((s) => Math.abs(s - m.longestPause) < 0.25)) fixes.push({ problem: `a ${m.longestPause} s pause inside the line that no mark asked for`, tool: "retake_voiceover", args: { clip_id: m.clipId } });
  if (m.lufs !== null && medianLufs !== null && Math.abs(m.lufs - medianLufs) > R.levelSpread) {
    const db = medianLufs - m.lufs;
    fixes.push({ problem: `${db > 0 ? "quieter" : "louder"} than the other lines by ${round(Math.abs(db), 1)} LU`, tool: "set_param", args: { clip_ids: [m.clipId], path: "volume", value: round(Math.min(4, m.volume * Math.pow(10, db / 20)), 3) } });
  }
  if (m.truePeak !== null && m.truePeak > R.truePeakMax)
    fixes.push(m.compressed ? { problem: `peaks at ${m.truePeak} dBTP`, tool: "set_param", args: { clip_ids: [m.clipId], path: "volume", value: round(m.volume * Math.pow(10, (R.truePeakMax - 0.5 - m.truePeak) / 20), 3) } } : { problem: `peaks at ${m.truePeak} dBTP`, tool: "set_compressor", args: { clip_ids: [m.clipId], preset: "voice" } });
  // A depth measured here, line by line: voice_above_music_lu aims over
  // the whole span from the first word to the last, gaps between lines
  // included, so it ducks a voiceover with long gaps far too deep.
  const depth = (m.musicDuckDb ?? 0) + R.overMusicAim - (m.overMusic ?? 0);
  if (m.overMusic !== null && m.overMusic < R.overMusicMin && m.musicClip) fixes.push({ problem: `only ${m.overMusic} LU over the music`, tool: "duck_under_speech", args: { clip_id: m.musicClip, depth: round(Math.min(40, Math.max(1, depth)), 1) } });
  if (m.overMusic !== null && m.overMusic > R.overMusicMax && m.musicClip && (m.musicDuckDb ?? 0) > 0) fixes.push({ problem: `the music is ${m.overMusic} LU under the voice: ducked to nearly nothing`, tool: "duck_under_speech", args: { clip_id: m.musicClip, depth: round(Math.min(40, Math.max(1, depth)), 1) } });
  if (m.rangeSt !== null && m.rangeSt < R.flatSt) fixes.push({ problem: `a flat read (its pitch moves ${m.rangeSt} semitones)`, tool: "retake_voiceover", args: { clip_id: m.clipId, voice: "af_heart" } });
  return fixes;
}
