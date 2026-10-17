// The voices offered for text to speech: a few of Kokoro-82M's, American
// and British English (the model's best-trained languages).

export interface Voice {
  id: string;
  label: string;
}

export const VOICES: Voice[] = [
  { id: "af_heart", label: "Heart (US, female)" },
  { id: "af_bella", label: "Bella (US, female)" },
  { id: "af_nicole", label: "Nicole (US, female, soft)" },
  { id: "am_michael", label: "Michael (US, male)" },
  { id: "am_fenrir", label: "Fenrir (US, male, deep)" },
  { id: "bf_emma", label: "Emma (UK, female)" },
  { id: "bm_george", label: "George (UK, male)" },
  { id: "bm_fable", label: "Fable (UK, male, warm)" },
];

export const DEFAULT_VOICE = VOICES[0].id;

/** What a title says aloud: its lines as one sentence each, no empty ones. */
export function speechText(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/[.!?…:;,]$/.test(l) ? l : `${l}.`))
    .join(" ");
}

/** A voice file's name: the first words it says. */
export const speechFileName = (text: string) => `Speech - ${text.slice(0, 32).replace(/[^\w ,.'-]+/g, "").trim() || "title"}.wav`;

/**
 * Where each line of a voiceover goes, in seconds: at its own `at` when
 * given, otherwise `gap` after the line before (the first at `start`); a
 * line never starts before the previous one ends, so voices never overlap.
 */
export function layoutLines(lines: { at?: number; seconds: number }[], start = 0, gap = 0.4): { start: number; end: number }[] {
  let next = start, end = 0;
  return lines.map((l) => {
    const s = Math.max(l.at ?? next, end);
    end = s + l.seconds;
    next = end + gap;
    return { start: +s.toFixed(3), end: +end.toFixed(3) };
  });
}
