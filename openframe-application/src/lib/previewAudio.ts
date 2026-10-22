// Preview formats, in preference order. WAV needs no device encoder.
import { encodeWav } from "./wav";

export type PreviewAudioFormat = "mp3" | "m4a" | "wav";
export const PREVIEW_AUDIO_MIME: Record<PreviewAudioFormat, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav" };

/** An explicit WAV stays WAV; M4A falls back to WAV; MP3 tries both. */
export function previewAudioFormat(asked: PreviewAudioFormat, can: { mp3: boolean; m4a: boolean }): PreviewAudioFormat {
  if (asked === "mp3" && can.mp3) return "mp3";
  return asked !== "wav" && can.m4a ? "m4a" : "wav";
}

/** 48 kHz stereo to 24 kHz mono, with a low-pass before decimation.
 * The short windowed sinc keeps high frequencies from aliasing into speech. */
export function previewWav(L: Float32Array, R: Float32Array): Uint8Array<ArrayBuffer> {
  const taps = 32, cutoff = 0.225;
  const kernel = Array.from({ length: taps + 1 }, (_, i) => {
    const t = i - taps / 2;
    return (t ? Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t) : 2 * cutoff) * (0.5 + 0.5 * Math.cos(Math.PI * t / (taps / 2)));
  });
  const sum = kernel.reduce((a, b) => a + b, 0);
  const mono = new Float32Array(Math.ceil(L.length / 2));
  for (let i = 0; i < mono.length; i++) {
    let v = 0;
    for (let k = 0; k <= taps; k++) {
      const at = Math.min(L.length - 1, Math.max(0, 2 * i + k - taps / 2));
      v += (L[at] + R[at]) * 0.5 * kernel[k];
    }
    mono[i] = v / sum;
  }
  return encodeWav([mono], 24000);
}
