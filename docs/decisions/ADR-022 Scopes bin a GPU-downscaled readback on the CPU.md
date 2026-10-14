# ADR-022: Scopes bin a GPU-downscaled readback on the CPU

- **Date**: 2026-10-14 · **Status**: accepted

## Context

Grading without scopes is guessing: the eye adapts, monitors differ. We
wanted Premiere's and Resolve's four (waveform, RGB parade, vectorscope,
histogram) without costing playback frames ([[Professional NLE features]]
§6.5). The research suggests GPU scatter (point sprites into a float
target) or compute atomics; WebGL2 has no compute, and scatter needs a
float-blendable target, an extension.

## Decision

- **Read the viewer, not the source**: scopes show the output of the whole
  pipeline, grade included, which is what a colorist judges.
- **Downscale on the GPU, bin on the CPU.** `Compositor.readPixelsScaled`
  blits the presented frame into a 320-pixel-wide renderbuffer with linear
  filtering and reads that back (0.45 ms, against 1.15 ms for even a
  745-pixel viewer at full size). `src/lib/scopes.ts` bins all four
  scopes in one pass over the 57,600 pixels (1.35 ms), pure and tested.
- **Cadence**: the player notifies after every drawn frame; the panel
  updates on the next animation frame when paused and at most 8 times a
  second while playing. Nothing runs while the panel is closed.
- **Display**: log-scaled brightness against a reference count, so stray
  pixels show and flat areas saturate; Rec.709 luma and Cb/Cr, 75% boxes
  and 100% dots for the six bar colors, the skin-tone line at 123°.
- **Placement**: the panel takes the media library's slot, as Premiere's
  Color workspace puts Lumetri Scopes where the Source monitor was, so
  the viewer keeps its size; toggled from the Player header or View menu.

## Consequences

Measured on graded 1080p30 in Edge: 0 dropped frames over 174 with all
four scopes on (1 with them off), 7.8 updates per second. `ponytail:` the
readback is synchronous; if a slower GPU shows stalls, switch to a pixel
buffer object with a fence (async readback) — the panel already tolerates
a frame of latency.
