# ADR-015: Export codecs follow what the device can encode

- **Date**: 2026-10-13 · **Status**: accepted

## Context

What WebCodecs can encode differs by OS, build and hardware: Edge on
Windows encodes H.264, VP9 and AV1 but HEVC only with the Store's HEVC
extension; Linux Chromium and Windows N have no AAC encoder; Safari has
no AV1 ([[Web media engine]] §1.7, pitfall 12). `isConfigSupported` also
answers per size and rate: 4K H.264 needs level 5.1. CapCut's dialog
offers H.264/HEVC in MP4/MOV ([[CapCut desktop]] §6.1).

## Decision

- Containers carry a preference-ordered codec list
  (`VIDEO_FORMATS` in `src/lib/export.ts`): MP4 H.264/HEVC/AV1, MOV
  H.264/HEVC, WebM VP9/AV1, MKV all four. Audio-only: M4A (AAC) and WAV.
- The engine asks mediabunny's `getFirstEncodableVideoCodec` with the
  real width, height, frame rate and bitrate, the chosen codec first. If
  it is unavailable the next one is used and the result says so ("HEVC
  isn't available here, so H.264 was used"); the dialog greys out what
  `getEncodableVideoCodecs` rules out before export starts.
- Sizes are even (4:2:0); presets name the short side.
- Bitrates come from `videoBitrate` (8 Mbps at 1080p30 H.264 for
  Recommended, scaled by pixels^0.9, rate^0.6 and codec efficiency) and
  are passed as an explicit `Quality({ bitrate })`, so the dialog's size
  estimate is the number the encoder gets.
- Sound: AAC in MP4/MOV/M4A, Opus in WebM and MKV. Matroska has no edit
  list to hide an AAC encoder's priming ([[Web media engine]] §4.6); Opus
  carries its pre-skip in its own header.
- Where `canEncodeAudio('aac')` is false, `@mediabunny/aac-encoder`
  (libavcodec in WASM, LGPL engine, MPL package) is loaded on demand; it
  costs nothing on devices that have a native encoder.
- MP4/MOV are written with `fastStart: 'reserve'`: the packet counts are
  known from the plan, so the index goes up front and the file plays
  while downloading.

## Consequences

The same project can export with a different codec on another machine;
the done view says when that happened. Masters (ProRes, DNxHR) and
loudness normalization are not here: masters go to Rust FFmpeg on desktop
(ADR-002), loudness needs a measuring pass first.
