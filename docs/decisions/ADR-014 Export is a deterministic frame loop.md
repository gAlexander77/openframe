# ADR-014: Export is a deterministic frame loop

- **Date**: 2026-10-13 · **Status**: accepted

## Context

Preview is driven by the audio clock and drops late frames on purpose
([[ADR-002 The media engine lives in the webview]]). An export must do the
opposite: every frame, exactly once, however slow the machine. Web editors
that export through `requestAnimationFrame`, timers, `captureStream()` or
MediaRecorder drop or duplicate frames when rendering is slower or faster
than real time, and stall when the window is hidden ([[Web media engine]]
§3.7, pitfall 23). A whole-timeline `OfflineAudioContext` allocates the
entire mix up front (2.8 GB for two hours of stereo) and reports no
progress (§4.3).

## Decision

`src/engine/export.ts` runs one loop per output frame `n`:
`planFrame` → `resolveSources` (awaited: a frame is never skipped) →
`Compositor.render` → `await CanvasSource.add(n/fps, 1/fps)` (encoder
and writer backpressure). The plan, sources and compositor are the
preview's own, so export matches preview by construction; only the canvas
differs: a private `OffscreenCanvas` at the export size with its own GL
context and its own `CursorPool`, so preview and export never fight over
a decoder. The context is lost explicitly at the end, because Chrome
keeps ~16 and drops the oldest, which would be the preview's.

- **Sound**: the preview's `scheduleAudio` renders 10 s windows into fresh
  `OfflineAudioContext`s (sample-exact boundaries from `audioWindows`),
  the next window prefetched, fed to the encoder in 1 s slices kept 1 s
  ahead of the picture so the muxer interleaves.
- **Frame rates**: output frame `n` shows the timeline frame on screen at
  `n/outFps` (drop or repeat, no blending). At the project rate it is one
  for one.
- **Failure**: a clip whose pixels cannot be produced fails the export
  with its name and timecode instead of exporting black. A watchdog fails
  the export if the encoder emits nothing for 15 s while we wait on it, or
  a frame's sources take 60 s (pitfall 13). Cancel and failure abort the
  target, so a partial file is never committed.
- **Hidden window**: nothing waits on rAF or timers; mediabunny's own
  timers run in a worker. Chromium does not reclaim decoders while an
  encoder in the same global is active ([[Web media engine]] §2.3).
  Measured (Edge 155, raw CDP, 1800 frames at 1080p): visible 5.7 s,
  background tab 5.8 s, minimized 7.5 s: slower, never stalled.

## Consequences

Export speed is bound by decode and encode, not by the clock (about 300
frames/s at 1080p on the development machine). It runs on the main
thread with the rest of the engine; `ponytail:` move it into the engine
worker with the compositor when that lands. Proved by
`scripts/drive/export.js`: every exported frame encodes the source frame
the timeline says, at 1x, 2x, 24 fps and in an In/Out range.
