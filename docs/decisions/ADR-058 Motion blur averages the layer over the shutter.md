# ADR-058: Motion blur averages the layer over the shutter

**Date:** 2026-10-18. **Status:** accepted.

## Context

Fast keyframed moves, slides and whip transitions strobe without motion
blur: each frame is a sharp copy in a new place. After Effects' layer
motion blur renders the layer at several instants inside the shutter and
averages them; its defaults are a 180-degree shutter with a phase of -90
(open a quarter frame before the frame, closed a quarter after), 16 samples
per frame and an adaptive limit of 128 for fast moves. Premiere's Transform
effect has the same shutter angle setting. The app's "Motion blur" effect
was a fixed directional smear, not tied to any movement.

## Decision

- **A per-clip setting, `motionBlur: { shutter }`** (degrees, 1..720),
  and `set_motion_blur` for several clips at once. Per clip, as After
  Effects' layer switch, so a still background costs nothing.
- **The plan samples the placement, the compositor averages.** `layerAt`
  evaluates the picture's placement (keyframes, in/out/loop animations,
  wiggle, anchor, stabilization) at fractional clip frames; for a clip with
  motion blur it measures how far the picture's farthest corner travels
  along five instants over the shutter, and only when that is half a pixel
  or more lists `motion`: placements at stratified instants centered on the
  frame, about one per two pixels of travel, up to a cap. The source frame
  is the frame's own: one decode, many placements.
- **The cap is the quality knob**: 32 for export and the paused viewer
  (what `preview_frame` shows agents), 6 while playing
  (`MOTION_SAMPLES`), passed as `planFrame(p, f, { motionSamples })`.
- **Summed in half float.** The compositor draws the layer once per
  placement into an RGBA16F target with additive blending, each at
  1/n of its opacity, then copies the sum into the layer's target, where
  effects, mattes and blending go on as before. Averaging in an RGBA8
  target would round every sample: 32 rounded shares of a flat 200 drift
  by several levels. Without `EXT_color_buffer_float` the layer draws once.
- **Moving transitions blur too.** Slides, pushes, zooms and the spin
  average the transition pass over progress values spread by the shutter
  (`spread` = shutter / 360 / transition frames), in a separate program
  built on first use. Its texture lookups use `textureLod`: plain
  `texture()` inside a loop of uniform length made ANGLE's D3D compiler
  unroll the loop, and the whole transition program took a second to build.

## Consequences

The drive measures it: a bar crossing 80% of the canvas in half a second
has hard edges without blur, ~50-pixel ramps with it, the same total light
(0.06% apart), and is identical held still. Stabilization's correction is
the frame's own for every sample (it cancels shake; it does not move). The
shutter itself is not animated; cost grows with travel, not with the
number of clips that have blur on.
