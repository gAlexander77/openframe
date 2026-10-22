import { levelsDb, percentile } from "./silence";

export interface AudioRoleGuess {
  role?: "dialog" | "music";
  reason: string;
  seconds: number;
  pauses: number;
  modulation: number;
  periodicity: number;
}

/** Bounded energy-envelope VAD: syllable-rate variation and irregular
 * pauses suggest speech; sustained energy or a repeating pulse music.
 * ponytail: an acoustic heuristic cannot separate singing, rap or speech
 * over a music bed reliably; leave ambiguous clips unset. A trained audio
 * classifier can replace this without changing the import contract. */
export function classifyAudioRole(pcm: Float32Array, rate: number): AudioRoleGuess {
  const seconds = Math.min(60, pcm.length / rate);
  const db = levelsDb(pcm.subarray(0, Math.ceil(seconds * rate)), rate, 0.02);
  const peak = percentile(db, 95), threshold = Math.max(-60, peak - 22);
  const energy = Array.from(db, d => Math.pow(10, (d - peak) / 20));
  const pauses = Array.from(db).filter(d => d < threshold).length / Math.max(1, db.length);
  const mean = energy.reduce((a, b) => a + b, 0) / Math.max(1, energy.length);
  const variance = energy.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, energy.length);
  const modulation = Math.sqrt(variance) / Math.max(mean, 1e-6);
  let periodicity = 0;
  // 0.24..1.2 seconds spans beats and syllable groups. Only positive,
  // centered correlation counts: a steady sine is sustained, not speech.
  for (let lag = 12; lag <= 60 && lag < energy.length / 3; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = lag; i < energy.length; i++) {
      const a = energy[i] - mean, b = energy[i - lag] - mean;
      xy += a * b; xx += a * a; yy += b * b;
    }
    periodicity = Math.max(periodicity, xy / Math.max(1e-12, Math.sqrt(xx * yy)));
  }
  let rises = 0;
  for (let i = 2; i + 2 < energy.length; i++) if (energy[i] > mean * 0.7 && energy[i] > energy[i - 1] && energy[i] >= energy[i + 1] && energy[i] - Math.min(energy[i - 2], energy[i + 2]) > mean * 0.15) rises++;
  const syllables = rises / Math.max(seconds, 1);
  const valid = seconds >= 3 && peak > -55 && pauses < 0.8;
  const role = !valid ? undefined : periodicity > 0.82 && pauses < 0.35 ? "music" : pauses >= 0.07 && modulation > 0.45 && syllables >= 1 && syllables <= 10 && periodicity < 0.75 ? "dialog" : pauses < 0.03 && modulation < 0.3 ? "music" : undefined;
  const reason = role === "dialog" ? "Speech-like syllable energy and irregular pauses" : role === "music" ? "Sustained or regularly pulsing musical energy" : "Uncertain audio content; role left unset";
  return { ...(role ? { role } : {}), reason, seconds, pauses, modulation, periodicity };
}
