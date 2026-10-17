// Filler words (CapCut's and Premiere's Remove filler words): which spoken
// words to cut, from Whisper's word timings. Whisper is trained toward clean
// text: the tiny model drops every "um", base keeps "um" but drops "uh",
// "hmm" comes back as "hum" and "er" as "or" (so "er" cannot be told apart
// and is left out). See docs/research/Filler words.md.

import type { Range } from "./analysis/silence";
import type { Word } from "./captions";
import { wordRanges } from "./transcript";

export const FILLERS = new Set(["um", "umm", "uhm", "uh", "uhh", "erm", "hmm", "hm", "hum", "mm", "mmm", "ah", "ahh", "eh"]);

const bare = (t: string) => t.toLowerCase().replace(/[^a-z]/g, "");

/** The ranges to cut, one per filler (touching ones merged). A filler's
 * timestamp can be a 20 ms sliver of the sound, so each cut runs from the
 * previous word's end to the next word's start, at most `reach` seconds
 * past the filler's own edges: the hesitation goes with it, a long pause
 * stays. `guard` is left beside each neighbor, whose stamped edges are
 * approximate (cutting right to them nipped "well" into "while").
 * Times are whatever `words` uses (source seconds here). */
export function fillerRanges(words: Word[], reach = 0.35, guard = 0.04): Range[] {
  return wordRanges(words, (w) => FILLERS.has(bare(w.text)), reach, guard);
}
