# ADR-128: Sound shaping uses the shared mixer and retimer

**Date:** 2026-10-21. **Status:** accepted.

## Context

Fade shapes, independent pitch and voice characters must agree in preview,
export and loudness measurement. Export starts a fresh context in each
pre-rolled window; a split must not restart grain, filter or delay state.

## Decision

- Five pure rising envelopes in `lib/audio.ts`; falling fades read them
  backward. Optional curve names keep legacy linear fades and equal-power
  crossfades. The scheduler and timeline draw the same functions.
- Pitch resamples each WSOLA grain by `2^(semitones/12)` while its placement
  follows the original source map: one retiming pass, unchanged duration.
  It is static (-12..12); unsupported pitch/processor keys are refused.
- Identical split sound runs, including shifted keys and speed curves,
  enter one retimer and effects graph. Pitched seeks rebuild grain history
  from the clip start before discarding the unheard samples.
- Presets are data expanded into editable settings; `voice` is descriptive.
  None clears the owned settings and keys, preserving timing and faders.
  Tanh saturation uses voiced-reference RMS compensation; a ring carrier
  starts at the timeline's phase, including in a pre-rolled export window.
- `normalize_loudness` measures the processed clip through the export mixer
  at unit clip gain, retaining a duck's shape and excluding mix faders.

## Consequences

No new dependency or stored-data migration. Every number/name is cleaned
at load. One chip is one undo step and a three-second isolated audition.
Pitch, saturation and ring parameters do not animate. A fixed saturation
compensation cannot match every input; normalization measures the result.
Long pitched seeks/windows replay earlier grains; cached retimer state
checkpoints are the upgrade. Browser/desktop sound drives still require
execution where the sandbox permits launching a browser.
