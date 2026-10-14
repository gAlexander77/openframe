# ADR-018: Local analysis is our own signal processing in the webview

- **Date**: 2026-10-13 · **Status**: accepted

## Context

The first AI tools (remove silences, split scenes, beat markers) must run
on the user's machine with no key and no download ([[ADR-003 Desktop
first, one build, a platform seam]]), on the desktop and in the web build.
The usual libraries are either another runtime (PySceneDetect is Python),
or licensed in ways we cannot ship (aubio GPL, Essentia AGPL, madmom's
models non-commercial), or models (Silero VAD, Beat This!, TransNetV2)
that need an ONNX runtime we do not have yet. The classic algorithms
behind them are each a page of arithmetic.

## Decision

- The algorithms are **our own TypeScript** in `src/lib/analysis/`, pure
  and tested on synthetic signals: RMS against the noise floor for
  silence, a port of PySceneDetect's Content and Adaptive detectors
  (BSD-3, notice kept in [[AI tools]]), spectral flux plus Ellis's DP
  tracker for beats. No new dependency.
- Decoding lives in `src/engine/analyze.ts`: WebCodecs through mediabunny,
  on **separate Inputs** so analysis never moves a playback decoder, to
  **analysis resolution** (mono PCM at 16 or 22.05 kHz, frames 128 px
  wide), keeping only what the algorithm needs (scores, not frames).
  Progress callbacks and an AbortSignal on every job.
- It runs on the main thread for now (mediabunny yields between packets;
  the per-frame work is tiny), with a `ponytail:` note naming a worker as
  the upgrade.

## Consequences

The same code runs on desktop and web with no install step, and the tests
pin behavior to known answers. Quality is that of the classic methods:
energy cannot tell music under a pause from speech, and gradual
transitions are not cuts. Models (Silero VAD, TransNetV2, Beat This!)
slot in behind the same functions when an ONNX runtime lands; the range
logic, commands and UI stay. Measuring the fixtures found that AAC in MP4
starts with 1024 samples of encoder priming that mediabunny exposes as a
negative first timestamp: the analysis decoder maps timestamp 0, not the
first timestamp, to source time 0 (the playback engine still does the
latter; see [[AI tools]]).
