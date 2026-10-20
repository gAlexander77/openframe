// A voiceover's pace (ADR-096): the words a second a read is meant to have
// (by kind, or as asked), measured two ways (over the speech, first word to
// last, and over the clip), the speed that lands a line on it, and a
// verdict that tells a miss worth a retake from advice. The owner's rule
// for a natural narrator is 2.3-2.8 words a second; review_voiceover used
// to judge by syllables instead, and flagged lines read at exactly that as
// slow, while the help's narrator speed (0.9) read 3.7-4.2 words a second.

import { syllables, writtenWords } from "./voiceScript";

/** The kind of read: what sets a line's words a second when none is asked. */
export type ReadAs = "narration" | "ad" | "social";
export const READ_AS: ReadAs[] = ["narration", "ad", "social"];

/**
 * Words a second over a line's speech (its first word to its last, its own
 * pauses in): narration and documentary 2.3-2.8 (140-170 a minute, the
 * owner's rule and audiobook practice); ads 2.6-3.1 (a 30 s spot's 75-90
 * words); social video 2.8-3.4, brisk but not rushed.
 */
export const PACE_BANDS: Record<ReadAs, [number, number]> = { narration: [2.3, 2.8], ad: [2.6, 3.1], social: [2.8, 3.4] };

/** How far a line meant slow (an end card's tagline) or fast moves its band. */
const PACE_SHIFT = 0.5;

export type Pace = "slow" | "normal" | "fast";

/** The band a line is held to: a band asked for exactly as asked (it wins
 * over any pace, given or kept with the line: the film test asked a slow
 * line for 1.8-2.2 and got 1.3-1.7), else its kind's moved for its pace. */
export function targetBand(readAs: ReadAs = "narration", asked?: [number, number], pace: Pace = "normal"): [number, number] {
  if (asked) return [asked[0], asked[1]];
  const [lo, hi] = PACE_BANDS[readAs];
  const d = pace === "slow" ? -PACE_SHIFT : pace === "fast" ? PACE_SHIFT : 0;
  return [+Math.max(1, lo + d).toFixed(2), +Math.max(1.2, hi + d).toFixed(2)];
}

/** What a line's band comes from, as kept with its script: its kind and
 * a band asked for. Takes saved before the kind was kept stored the
 * kind's band as if asked (read_as ad as [2.6, 3.1]); such a band is read
 * as that kind again, so its pace still moves it. */
export function bandSource(info: { readAs?: ReadAs; wps?: [number, number] } | undefined): { readAs?: ReadAs; wps?: [number, number] } {
  if (!info) return {};
  if (info.readAs || !info.wps) return { ...(info.readAs ? { readAs: info.readAs } : {}), ...(info.wps ? { wps: info.wps } : {}) };
  const kind = READ_AS.find((k) => PACE_BANDS[k][0] === info.wps![0] && PACE_BANDS[k][1] === info.wps![1]);
  return kind ? { readAs: kind } : { wps: info.wps };
}

/** A words-a-second band from the tool's arguments, checked. */
export function readBand(x: unknown): [number, number] | undefined {
  if (x === undefined) return undefined;
  if (!Array.isArray(x) || x.length !== 2 || !x.every((v) => typeof v === "number" && v >= 1 && v <= 5) || !(x[0] < x[1])) throw new Error("words_per_second is [lowest, highest] words a second over the speech, between 1 and 5, such as [2.3, 2.8]");
  return [x[0], x[1]];
}

const r2 = (x: number) => +x.toFixed(2);

/** A line's words and syllables a second over its speech (first word to
 * last, its pause marks' seconds taken out: the caller's) and over its
 * clip, the two windows a pace is told in. */
export function paceOf(text: string, speechSeconds: number, clipSeconds: number) {
  const words = writtenWords(text);
  const syll = words.reduce((n, w) => n + syllables(w), 0);
  const rate = (s: number) => (s > 0.3 ? { words_per_second: r2(words.length / s), syllables_per_second: r2(syll / s), seconds: r2(s) } : null);
  return { words: words.length, syllables: syll, speech: rate(speechSeconds), clip: rate(clipSeconds) };
}

/** Syllables a second past which a read is rushed whatever its words
 * (read speech runs 4-5.5 inside a phrase), and under which short words
 * read on target sound drawn out. */
export const RUSHED_SPS = 5.8;
export const DRAWN_SPS = 2.5;

/** How far outside its band (a fraction of the band's edge) a line is
 * still advice, not a miss. */
export const PACE_SLACK = 0.1;

export interface PaceFinding {
  /** fix: worth a retake; advice: a note, the line passes. */
  level: "fix" | "advice";
  problem: string;
}

/** What a line's pace calls for against its band: nothing, advice, or a fix. */
export function judgePace(wps: number | null, sps: number | null, band: [number, number]): PaceFinding[] {
  if (wps === null || sps === null) return [];
  const [lo, hi] = band;
  const out: PaceFinding[] = [];
  const aim = `aim ${lo}-${hi} words a second`;
  if (wps < lo) out.push({ level: wps < lo * (1 - PACE_SLACK) ? "fix" : "advice", problem: `slow: ${wps} words a second over the speech (${aim})` });
  else if (wps > hi) out.push({ level: wps > hi * (1 + PACE_SLACK) ? "fix" : "advice", problem: `fast: ${wps} words a second over the speech (${aim})` });
  if (sps > RUSHED_SPS && wps <= hi) out.push({ level: "fix", problem: `rushed: ${sps} syllables a second (read speech runs 4-5.5), though its words a second are on target: long words; read it slower or split it` });
  if (sps < DRAWN_SPS && wps >= lo) out.push({ level: "advice", problem: `short words read slowly (${sps} syllables a second): on-target words a second draw them out; a fuller sentence, or pace slow for a closing line, reads more naturally` });
  return out;
}

/** The slowest and fastest speeds the voice is given to land a line on its
 * band: past them its vowels drag or clip. Codex's documentary landed
 * eleven narration lines at 0.61-0.90 (Heart, natural finish). */
export const AUTO_SPEED: [number, number] = [0.6, 1.3];

/**
 * The speed to read a line at next, from a read at `speed` whose speech
 * lasted `span` seconds, `fixed` of them pauses the finish set to a length
 * (they do not change with speed), to say `words` at `target` words a
 * second. The voice model divides its sounds' lengths by the speed, so the
 * rest of the span scales as 1 / speed.
 */
export function nextSpeed(speed: number, span: number, fixed: number, words: number, target: number, bounds: [number, number] = AUTO_SPEED): number {
  const voiced = Math.max(0.1, span - fixed);
  const want = words / target - fixed;
  const s = want > 0.1 ? (speed * voiced) / want : bounds[1];
  return r2(Math.min(bounds[1], Math.max(bounds[0], s)));
}

/** A first speed for a line before it is read: Heart says about 4.6
 * syllables a second at speed 1 (research note: Natural voiceover), and
 * the finish's pauses take `fixed` seconds. */
export function firstSpeed(syll: number, words: number, fixed: number, target: number, bounds: [number, number] = AUTO_SPEED): number {
  const want = words / target - fixed;
  return r2(Math.min(bounds[1], Math.max(bounds[0], want > 0.1 ? syll / 4.6 / want : bounds[1])));
}

/** Is a measured pace inside its band? */
export const onPace = (wps: number, band: [number, number]) => wps >= band[0] && wps <= band[1];

/** The fastest a line meant slow is read when its band is its pace's (no
 * band asked): the voice's own pace. The film test's slow tagline was read
 * at 1.3 to fit a band its pause mark had filled. */
export const SLOW_MAX_SPEED = 1;

/** The speeds a line's speed is chosen within: the voice's natural range,
 * and for a line meant slow no faster than the voice's own pace, unless a
 * band was asked for (a band asked wins over the pace). */
export function speedBounds(pace: Pace | undefined, asked: boolean): [number, number] {
  return pace === "slow" && !asked ? [AUTO_SPEED[0], SLOW_MAX_SPEED] : AUTO_SPEED;
}

/** One read of a line as it measures: its speech's seconds from its first
 * word to its last, the pauses in it set to a length (`fixed`: they do not
 * change with speed) and, of those, the pause marks' (`directed`). */
export interface ReadSpan {
  span: number;
  fixed: number;
  directed: number;
}

/** Words a second over a read's speech, its pause marks out: a mark is a
 * beat the script asks for, silence that is not the reader's pace, so a
 * line given one is not read faster to make up for it (ADR-104). The
 * reader's own pauses at commas and sentence ends stay in. */
export const readWps = (words: number, r: ReadSpan) => words / Math.max(0.3, r.span - r.directed);

/**
 * Read a line until it lands on its band (ADR-096): first at a speed from
 * its syllables (`natural`: the seconds of pauses the finish will set,
 * pause marks not counted), then again at the speed its measure calls for,
 * up to `maxReads`; the read nearest the band is kept. `read` reads the
 * line at a speed and says how it measured. Pure, so the choice is tested
 * with a model of the voice.
 */
export async function landSpeed<T extends ReadSpan>(
  read: (speed: number) => Promise<T>,
  o: { words: number; syllables: number; natural: number; band: [number, number]; bounds: [number, number]; maxReads?: number },
): Promise<{ read: T; speed: number; reads: number; wps: number }> {
  const aim = (o.band[0] + o.band[1]) / 2;
  const wps = (r: ReadSpan) => readWps(o.words, r);
  const miss = (r: ReadSpan) => Math.max(0, o.band[0] - wps(r), wps(r) - o.band[1]);
  let speed = firstSpeed(o.syllables, o.words, o.natural, aim, o.bounds);
  let best = { read: await read(speed), speed };
  let reads = 1;
  while (reads < (o.maxReads ?? 3) && !onPace(wps(best.read), o.band)) {
    const r = best.read;
    speed = nextSpeed(best.speed, r.span - r.directed, r.fixed - r.directed, o.words, aim, o.bounds);
    if (speed === best.speed) break;
    const again = await read(speed);
    reads++;
    if (miss(again) < miss(best.read)) best = { read: again, speed };
  }
  return { ...best, reads, wps: r2(wps(best.read)) };
}
