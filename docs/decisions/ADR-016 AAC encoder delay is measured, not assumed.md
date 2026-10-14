# ADR-016: AAC encoder delay is measured, not assumed

- **Date**: 2026-10-13 · **Status**: accepted

## Context

An AAC encoder starts its stream with "priming": samples a decoder outputs
before the real sound. Unless the file says how many to skip (an MP4 edit
list), sound plays late by that much. WebCodecs does not report it, and
the research expected about 1024 samples from Chrome ([[Web media
engine]] §4.6). Measured on this machine against a PCM (WAV) export of the
same timeline, decoding with ffmpeg:

| Encoder | Delay | Without correction |
|---|---|---|
| Edge 155, Windows Media Foundation (native) | 0 samples | in sync |
| `@mediabunny/aac-encoder` (libavcodec WASM fallback) | 1024 samples | 21.3 ms late |

A fixed 1024 shift, as planned, would have put Edge's exports 21.3 ms
early; no shift leaves the fallback 21.3 ms late.

## Decision

`encoderDelay()` in `src/engine/export.ts` measures the delay once per
session: encode a half-second buffer with one click, decode it back with
WebCodecs, see how far the click moved (~0.1 s). The export then stamps
its first sample at `-delay/48000`; mediabunny shifts the track and
writes an edit list that skips exactly the priming. MP4, MOV and M4A get
this; Opus (WebM, MKV) carries its pre-skip in its own header and PCM has
none, so neither needs it.

## Consequences

Measured after the change (`scripts/drive/export.js`, three tone onsets
including one exactly on a 10 s mixing-window boundary): 0 samples off
the PCM reference for MP4/MOV/M4A (native encoder, delay 0, no edit
list), M4A through the WASM fallback (delay 1024, edit list), WebM and
MKV with Opus. The AAC track still ends up to one codec frame (21 ms)
after the picture, as silence padding: ffprobe reports 13.013 s for a
13.000 s timeline. Not verified: QuickTime/AVFoundation, which trims
2112 samples from AAC without an edit list; our native-encoder files
carry no edit list, so check them on a Mac before relying on them there.
