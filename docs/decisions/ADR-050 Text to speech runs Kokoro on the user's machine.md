# ADR-050: Text to speech runs Kokoro on the user's machine

**Date:** 2026-10-16. **Status:** accepted.

## Context

CapCut's Text tab turns a title into a voice-over with a choice of
voices. Its voices are a cloud service; ours must run on the user's
hardware with no account (ADR-003), like auto captions (ADR-007).

## Decision

- **Model: Kokoro-82M** (Apache-2.0 weights and voices), the ONNX export
  `onnx-community/Kokoro-82M-v1.0-ONNX`, through **kokoro-js** (Apache-2.0),
  the model authors' browser runtime. It sounds close to cloud voices at
  82 M parameters, which is small enough for a laptop CPU. Piper (MIT code,
  voices under mixed licenses) is lighter but flatter; larger open models
  (XTTS, F5) carry non-commercial or research-only weights.
- **Where it runs:** a module worker of its own (`src/engine/tts.worker.ts`),
  WebGPU at fp32 when the machine has an adapter, else WASM at q8 (about
  90 MB, a fifth of fp32). The weights download once from Hugging Face on
  first use, with progress, and the browser caches them; the CSP already
  allows those hosts for Whisper. The text never leaves the machine.
- **What it makes:** a 16-bit WAV ("Speech - first words.wav") imported like
  any file, then one undo step places it on an audio track at the title's
  start. Each line of the title is read as a sentence.
- **Voices:** eight American and British English voices, the model's best
  trained; the rest of its languages are left out until they are tested.
- **Dependency:** kokoro-js pins @huggingface/transformers 3 while the app
  uses 4 for Whisper, so npm keeps a second copy under kokoro-js. It loads
  only inside the speech worker, so it never reaches the main bundle.
  ponytail: drop the second copy when kokoro-js moves to transformers 4.

## Consequences

`text_to_speech` (MCP) and `window.videoEditor.tts` give agents the same.
The first use needs a network connection for the download; afterwards it
works offline. `scripts/drive/tts.js` makes a voice from a title with the
real model and checks the placed clip and that it holds speech.
