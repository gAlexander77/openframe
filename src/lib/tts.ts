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
