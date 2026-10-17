// Filler words (CapCut's and Premiere's Remove filler words): which spoken
// words to cut, from Whisper's word timings. Whisper is trained toward clean
// text: the tiny model drops every "um", base keeps "um" but drops "uh",
// "hmm" comes back as "hum" and "er" as "or" (so "er" cannot be told apart
// and is left out). See docs/research/Filler words.md.

import type { Range } from "./analysis/silence";
import type { Word } from "./captions";

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
  const out: Range[] = [];
  const filler = words.map((w) => FILLERS.has(bare(w.text)));
  words.forEach((w, i) => {
    if (!filler[i]) return;
    // The nearest real words either side bound the cut.
    let a = i - 1, b = i + 1;
    while (a >= 0 && filler[a]) a--;
    while (b < words.length && filler[b]) b++;
    const start = Math.max(a >= 0 ? words[a].end + guard : -Infinity, w.start - reach, 0);
    const end = Math.min(b < words.length ? words[b].start - guard : Infinity, w.end + reach);
    if (end <= start) return;
    const last = out[out.length - 1];
    if (last && start <= last.end + 1e-6) last.end = Math.max(last.end, end);
    else out.push({ start: +start.toFixed(4), end: +end.toFixed(4) });
  });
  return out;
}
