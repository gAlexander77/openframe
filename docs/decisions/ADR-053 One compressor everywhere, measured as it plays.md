# ADR-053: One compressor everywhere, measured as it plays

**Date:** 2026-10-17. **Status:** accepted.

## Context

The OpenFrame promo's voices came from Kokoro and peaked some 20 dB over
their loudness. Export loudness raises the mix to its target and holds the
peaks with a limiter capped at 6 dB, so the promo stopped at -15.8 LUFS of
-14. Every editor we imitate evens speech out before that point: CapCut's
Enhance voice, Premiere's Dialogue > Dynamics, Resolve's and VEGAS's
compressors. The feature survey listed "Compressor" and "Enhance voice" as
missing.

A compressor changes how loud a clip plays, and `normalize_loudness` read
the source file, so a compressed clip would have been normalized to the
wrong level.

## Decision

- **The platform's `DynamicsCompressorNode`**, then a makeup gain, built in
  one place (`compressorNodes` in `src/engine/audio.ts`) and placed after
  the clip's EQ and before its volume (EQ, dynamics, fader, as a channel
  strip runs). Preview and export already share the clip chain, so both
  get it with no second implementation to drift.
- **Measured as it plays.** `measureLoudness` runs the decoded audio
  through the same nodes in an `OfflineAudioContext`, ten seconds at a
  time, so normalize sets the level the clip will actually have.
- **Presets first** (Enhance voice, Gentle, Strong), threshold, ratio and
  makeup as sliders; the stored value is the six numbers, and the preset
  name is derived (`compressorPreset`), so a moved slider reads Custom.
- **No extra makeup in the presets.** Web Audio's compressor already raises
  its output by about 0.6 of its full-scale reduction; the first presets
  added 4 to 12 dB on top and pushed peaks past full scale.
- `add_voiceover` puts Enhance voice on the voices it makes unless told not
  to.

## Consequences

The promo exports at -14.1 LUFS (ffmpeg) with 1.1 dB of limiting. Each
measurement block starts the compressor afresh, moving a reading by
hundredths of a dB. The node's fixed 6 ms lookahead delays a compressed
clip's sound by a fifth of a frame. Compound clips get no compressor yet;
their sound mixes through linear time maps (ADR-037).
