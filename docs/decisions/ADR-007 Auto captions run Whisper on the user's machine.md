# ADR-007: Auto captions run Whisper on the user's machine

- **Date**: 2026-10-13 · **Status**: accepted

## Context

Auto captions are CapCut's most-used AI feature and its sorest point:
cloud-only, about five free runs a month, moved behind Pro in 2025
([[CapCut desktop]] §4.5, §9). The owner's rule is that everything runs on
the user's hardware ([[ADR-003 Desktop first, one build, a platform seam]]).

## Decision

- Whisper through **transformers.js** (`@huggingface/transformers` 4.3) in a
  dedicated worker (`src/engine/asr.worker.ts`), on WebGPU when available
  and WASM otherwise. One implementation serves both builds; WebView2 has
  WebGPU. Only the model weights download, once, from Hugging Face, and
  the browser caches them; audio never leaves the machine.
- The `onnx-community/whisper-*_timestamped` exports, because word
  timestamps need their cross-attention outputs. English-only models are
  offered first (Fast 41 MB, Balanced 77 MB, Accurate 249 MB).
- The audio is the **timeline mix** at 16 kHz mono, rendered by the same
  scheduler export uses, so captions follow what the viewer hears, J/L cuts
  and all. Long audio is cut at the quietest point before every ~28 s so no
  word is split and progress is real; silent windows are skipped because
  Whisper invents "Thank you." on silence.
- Words become lines by readable rules (`src/lib/captions.ts`): break at
  sentence ends, at pauses, after commas past 40% of the line, never end a
  line on a little word, hold a flash-by caption to 0.7 s.
- Results land through the `add_captions` command, the same path an agent
  with its own transcript uses.

## Consequences

Captions are unlimited and offline after the first download. Measured: a
6.4 s clip captioned in 14 s on first run including the 77 MB download,
words exact. `ponytail:` the desktop build could move to native whisper.cpp
(faster, frees the webview) when long-form transcription times matter; the
worker message shape is the seam.
