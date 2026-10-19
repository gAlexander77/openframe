// The voices offered for text to speech: Kokoro-82M's American and
// British English voices that its author grades C or better (the model's
// best-trained languages; the lower grades sound synthetic), best first.
// grade is hexgrad's overall grade from the model card (A is the most
// natural); the pitch and pace are measured on this app's reads at the
// default speed (docs/research/Natural voiceover 2026-10-19.md).

export interface Voice {
  id: string;
  label: string;
  accent: "US" | "UK";
  gender: "female" | "male";
  /** The model author's overall grade: how natural and clean it sounds. */
  grade: string;
  /** How it sounds, measured and as its author tags it. */
  character: string;
  /** What to cast it for. */
  suited: string;
}

export const VOICES: Voice[] = [
  { id: "af_heart", label: "Heart (US, female)", accent: "US", gender: "female", grade: "A", character: "Warm and expressive, the model's most natural voice; mid-high (about 200 Hz), a lively melody (7 semitones), 3.1 words a second", suited: "Anything: ads, explainers, promos, narration. The default" },
  { id: "af_bella", label: "Bella (US, female)", accent: "US", gender: "female", grade: "A-", character: "Confident and bright, steadier than Heart (6 semitones); about 200 Hz, 2.9 words a second", suited: "Upbeat ads, launches, social; the second female voice beside Heart" },
  { id: "af_nicole", label: "Nicole (US, female, soft)", accent: "US", gender: "female", grade: "B-", character: "Soft and close, near a whisper (made for headphones); low (about 150 Hz), flat (3 semitones) and slow (2.0 words a second)", suited: "Calm, intimate reads: wellness, sleep, close-up product moments; too slow and flat for ads" },
  { id: "bf_emma", label: "Emma (UK, female)", accent: "UK", gender: "female", grade: "B-", character: "Clear, composed British English; about 180 Hz, 6 semitones, brisk (3.3 words a second)", suited: "Explainers, documentary, premium and corporate brands" },
  { id: "am_michael", label: "Michael (US, male)", accent: "US", gender: "male", grade: "C+", character: "Low, warm and measured, the most natural US man; about 120 Hz, lively (9 semitones), 2.8 words a second", suited: "Narration, explainers, trailers; the male voice to cast first" },
  { id: "am_fenrir", label: "Fenrir (US, male, deep)", accent: "US", gender: "male", grade: "C+", character: "Animated, the widest pitch swings of the US men (11 semitones); 3.1 words a second", suited: "Energetic promos, gaming, hype" },
  { id: "am_puck", label: "Puck (US, male)", accent: "US", gender: "male", grade: "C+", character: "Low and lively (about 120 Hz, 9 semitones), quick (3.3 words a second)", suited: "Upbeat ads, social, playful explainers" },
  { id: "af_aoede", label: "Aoede (US, female)", accent: "US", gender: "female", grade: "C+", character: "Smooth and even, the cleanest voicing measured; about 180 Hz, 8 semitones, 3.2 words a second", suited: "Explainers, tutorials, app walkthroughs" },
  { id: "af_kore", label: "Kore (US, female)", accent: "US", gender: "female", grade: "C+", character: "A lower female voice (about 160 Hz) with a wide melody (11 semitones), clean; 3.0 words a second", suited: "Storytelling, brand films, a contrast to Heart in a dialogue" },
  { id: "af_sarah", label: "Sarah (US, female)", accent: "US", gender: "female", grade: "C+", character: "High and lively (about 205 Hz, 10 semitones), 3.2 words a second", suited: "Friendly ads, social, lifestyle" },
  { id: "bm_george", label: "George (UK, male)", accent: "UK", gender: "male", grade: "C", character: "British, low and unhurried (about 150 Hz, 2.6 words a second), a steady melody (7 semitones)", suited: "Documentary, heritage brands, calm narration" },
  { id: "bm_fable", label: "Fable (UK, male, warm)", accent: "UK", gender: "male", grade: "C", character: "British, low (about 120 Hz) and animated (12 semitones), quick (3.3 words a second)", suited: "Storytelling, characters, trailers" },
  { id: "bf_isabella", label: "Isabella (UK, female)", accent: "UK", gender: "female", grade: "C", character: "British, high and clear (about 205 Hz), steady (6 semitones), 3.2 words a second", suited: "Explainers, lifestyle, luxury" },
];

/** The most natural voice, Heart (grade A). */
export const DEFAULT_VOICE = VOICES[0].id;

/** A voice id, or a blend of known voices ("af_heart:60,af_bella:40"):
 * checked, so a typo fails before anything is spoken. */
export function checkVoice(voice: string): string {
  const ids = new Set(VOICES.map((v) => v.id));
  const parts = voice.split(/[,+]/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error("Name a voice: list_catalog section voices has them");
  for (const part of parts) {
    const [id, w] = part.split(":").map((s) => s.trim());
    if (!ids.has(id)) throw new Error(`No voice ${id}: list_catalog section voices has them (${[...ids].join(", ")})`);
    if (w !== undefined && !(Number(w) > 0)) throw new Error(`Blend weights are positive numbers: ${part}`);
  }
  return parts.join(",");
}

/** What a title says aloud: its lines as one sentence each, no empty ones. */
export function speechText(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/[.!?…:;,\]>]$/.test(l) ? l : `${l}.`))
    .join(" ");
}

/** A voice file's name: the first words it says. */
export const speechFileName = (text: string) => `Speech - ${text.slice(0, 32).replace(/[^\w ,.'-]+/g, "").trim() || "title"}.wav`;

/**
 * A spoken line without the silence the voice model pads it with (about
 * half a second before the first word): `pre` seconds kept before the first
 * sound and `post` after the last, so a voiceover's reported times, its
 * captions and the cuts made to them land on the words.
 */
export function trimSpeech(audio: Float32Array, rate: number, pre = 0.04, post = 0.15): Float32Array {
  let peak = 0;
  for (const x of audio) peak = Math.max(peak, Math.abs(x));
  const floor = Math.max(peak * 0.02, 1e-4);
  let first = audio.findIndex((x) => Math.abs(x) > floor);
  if (first < 0) return audio;
  let last = audio.length - 1;
  while (last > first && Math.abs(audio[last]) <= floor) last--;
  first = Math.max(0, first - Math.round(pre * rate));
  last = Math.min(audio.length, last + 1 + Math.round(post * rate));
  return audio.subarray(first, last);
}
