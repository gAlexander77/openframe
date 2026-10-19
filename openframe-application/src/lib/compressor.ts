// A clip's compressor: presets, validation and naming. Its own module
// with no imports but types, so the project loader can use it without a
// cycle through ops.

import type { Compressor } from "./project/types";

export type CompressorPreset = "voice" | "gentle" | "strong";

/** Enhance voice evens out speech, the way CapCut's toggle and Premiere's
 * Dialogue > Dynamics do: synthetic voices peak some 20 dB over their
 * loudness, which held the OpenFrame promo's export loudness 2 dB short. */
export const COMPRESSOR_PRESETS: Record<CompressorPreset, Compressor> = {
  voice: { threshold: -26, ratio: 4, knee: 6, attack: 0.003, release: 0.15, makeup: 0 },
  gentle: { threshold: -20, ratio: 2, knee: 10, attack: 0.01, release: 0.25, makeup: 0 },
  strong: { threshold: -32, ratio: 8, knee: 3, attack: 0.002, release: 0.1, makeup: 0 },
};

const COMPRESSOR_RANGES: Record<keyof Compressor, [number, number]> = {
  threshold: [-60, 0],
  ratio: [1, 20],
  knee: [0, 40],
  attack: [0, 1],
  release: [0, 1],
  makeup: [0, 24],
};

/** A compressor from untrusted JSON or a partial edit: every field in
 * range, missing ones from the Voice preset; nothing usable gives none. */
export function cleanCompressor(raw: unknown): Compressor | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const out = { ...COMPRESSOR_PRESETS.voice };
  for (const [k, [lo, hi]] of Object.entries(COMPRESSOR_RANGES) as [keyof Compressor, [number, number]][]) {
    if (typeof r[k] === "number" && Number.isFinite(r[k])) out[k] = Math.max(lo, Math.min(hi, r[k] as number));
  }
  return out;
}

/** Which preset a compressor is, or "custom" once any value differs. */
export function compressorPreset(c: Compressor): CompressorPreset | "custom" {
  const hit = (Object.keys(COMPRESSOR_PRESETS) as CompressorPreset[]).find((k) =>
    (Object.keys(COMPRESSOR_RANGES) as (keyof Compressor)[]).every((f) => Math.abs(COMPRESSOR_PRESETS[k][f] - c[f]) < 1e-9),
  );
  return hit ?? "custom";
}
