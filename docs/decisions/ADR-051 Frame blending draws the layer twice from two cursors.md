# ADR-051: Frame blending draws the layer twice from two cursors

**Date:** 2026-10-16. **Status:** accepted.

## Context

Slow motion repeats source frames: at half speed each one shows twice,
which reads as stutter. Every editor we imitate offers frame blending
(Premiere's Time Interpolation > Frame Blending, Resolve's Retime
Process, VEGAS's resample, Final Cut's Frame Blending), mixing the two
neighboring source frames by where the timeline frame falls between them;
optical flow is the costlier step after it.

The engine was built around one frame per clip: a decode cursor owns
exactly one sample (its head) and lends it until the next call
(Conventions rule 9), and the plan's quarter-frame lookahead deliberately
lands inside the intended frame (the framecode drive's lesson).

## Decision

- **The plan says what to mix.** With `frameBlend` on a forward,
  non-frozen video clip, `layerAt` finds the source position in source
  frames; past a whole frame by `w` (0.01 to 0.99) the layer's source gets
  `next: { time, w }` for frame i + 1, and the primary lookup moves a
  quarter into frame i itself, since past three quarters the usual
  lookahead would already reach i + 1. On a whole frame nothing changes.
- **A second cursor lane.** `CursorPool.get(..., lane)` keys a clip's
  second cursor `clipId#1`. Each cursor still owns one sample, so the
  ownership rule holds without a cursor that keeps two; a slowed clip
  decodes about as many frames as a normal one, now split over two
  decoders.
- **A second draw, not a second texture.** After the layer's normal draw
  into its own target, the compositor draws the same quad and pass again
  with the next frame and `CONSTANT_ALPHA` blending at `w`: the result is
  exactly (1 - w) * A + w * B, alpha included, through every grade, key
  and mask uniform already set. The layer shader is unchanged.
- Reversed clips are left out (their frames come from the reverse
  cursor's held windows); freeze frames have nothing to blend.

## Consequences

The drive renders half speed through the export path: an in-between frame
equals the average of its two neighbors to within 0.05 of a level, and
1080p blended playback drew 82 frames in 3 s with none dropped. The
matte of a removed background is the primary frame's for both draws, a
one-frame lag on the second that is not visible at blending's shares.
Optical flow would replace the second draw with a warped one; the plan's
`next` is where it would hook in.
