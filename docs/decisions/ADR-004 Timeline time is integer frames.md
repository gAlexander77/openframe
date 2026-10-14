# ADR-004: Timeline time is integer frames

- **Date**: 2026-10-13 · **Status**: accepted

## Context

Web editors commonly store clip positions as float seconds. Every ripple,
split and trim then adds and subtracts floats, and after a few hundred edits
a cut sits at 4.999999999 s: one frame of the wrong clip flashes at the edit,
snapping misses by an epsilon, and `0.1 + 0.2` decides which frame is drawn.
NTSC rates (29.97 = 30000/1001) make it worse, since no frame boundary is a
round number of seconds or microseconds. Premiere solves this with a
254,016,000,000-ticks-per-second integer clock; VEGAS and Resolve snap
everything to frames.

## Decision

- Clip `start` and `duration`, markers, keyframe positions and the playhead
  are **integer frames at the project frame rate**.
- Frame rates are **rationals** (`{num, den}`), so 29.97 is exact.
- A clip's source offset (`in`) is **seconds into the source file**, because
  the source has its own frame rate (or none — audio) and that number is only
  ever handed to the decoder.
- Conversion lives in one file, `src/lib/time.ts`. `frameAt` (floor with a
  1e-6 epsilon) answers "which frame is showing at time t".
- Timecode follows SMPTE, with drop-frame at 29.97 and 59.94.

## Consequences

Edits can never drift off the frame grid. Audio clip edges are also
frame-quantized, as with VEGAS's "quantize to frames" (its default). Sub-frame
audio edits wait until someone needs them. Changing a project's frame rate
rescales and rounds every position once: an explicit, rare operation.
