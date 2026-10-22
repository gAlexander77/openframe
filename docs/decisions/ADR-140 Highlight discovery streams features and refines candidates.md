# ADR-140: Highlight discovery streams features and refines candidates

- **Date**: 2026-10-21, **Status**: accepted

## Context

Stream VODs run for hours. Whole-file PCM and whole-file Whisper cost too
much memory and time; loud gameplay alone is weak editorial evidence.
People and agents need the same ranked, reviewable source-time windows.

## Decision

- Decode once through one input into reusable 10-second 16 kHz mono buffers.
  Keep 100 ms K-weighted powers and voice/vocal features, then 500 ms scores;
  retain at most three source readings per document session, never PCM.
- Compare 3-second short-term and 400 ms momentary BS.1770 loudness with
  a surrounding three-minute median. Voice activity uses energy and zero
  crossings. Band energy (300 Hz–3 kHz), 4–8 Hz modulation and spectral flux
  suggest vocal excitement; music/game effects can match this heuristic.
- Default weights: audio .5, speech .1, chat .25, scenes .05, given times .8;
  normalize by present signal weights and clamp to 0–1. Keywords add .3
  after transcription. Expose all weights. Chat uses three-second message
  rates against the same median, plus repetition/emotes and clip mentions.
- Suppress peaks within max(20 s, minimum length), grow around the build-up,
  add 4/3 s context and prefer pauses while holding 15–60 s length bounds.
  Sample scenes at 96 px once a second; auto skips video over two hours.
- Transcribe up to twice the requested candidates plus 5 s context using
  the shared per-asset transcript queue/cache; rerank by keywords and derive
  quotes/titles without a model. Keep results in source seconds.
- Share a cancellable session job and results between UI and find_highlights.
  The named add_highlight_markers command adds following ranges as one
  metadata undo step; ranges follow their start (ADR-132).

## Consequences

Memory grows with compact features, not decoded media. Chat text is capped
at 32 MiB; larger replays need splitting. Scene sampling still decodes codec
dependencies and may be slow. Scores require editorial review; no dependency,
Rust, keyboard or document-schema change is needed.
