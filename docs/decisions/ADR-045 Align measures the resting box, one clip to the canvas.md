# ADR-045: Align measures the resting box, one clip to the canvas

**Date:** 2026-10-16. **Status:** accepted.

## Context

CapCut's Video > Basic > Transform has an align row under Rotate: left,
center, right, top, middle, bottom, then two distribute buttons that stay
gray for one clip. The owner compared it with ours, which had none, and
our viewer snapped only a dragged box's center to the canvas center.

## Decision

- **One geometry.** `src/lib/align.ts` computes a clip's on-canvas box
  (fit, scale, crop, rotation) in project pixels. The viewer's handles, the
  align buttons, the commands and drag snapping all read it, so a button
  and a drag land on the same pixel. Rotation widens the box to its
  axis-aligned extent, as Figma and Premiere align rotated layers.
- **One clip aligns to the canvas, several to their combined bounds**
  (Premiere's Essential Graphics and Figma). Distribute keeps the outermost
  two and makes the gaps between neighbors equal; it needs three clips.
- **The resting transform, not the animated one.** An in or out
  animation's offsets are left out of the measurement, so aligning while
  the playhead sits in a slide-in still puts the settled picture on the
  edge. Positions are measured at the playhead (each clip's first frame for
  agents without `at`), and an animated position gets a keyframe there, as
  every other inspector value does.
- **Text is measured by the engine's rasterizer.** The pure module cannot
  draw, so `src/engine/text.ts` registers `rasterizeText` with
  `setTextMeasure` when it loads; unit tests use an estimate from the style.
- **Snapping** catches a moved box's edges and center on the canvas's and
  on every other visible picture's, within 6 screen pixels, and draws the
  guide at that line. Ctrl ignores snapping (unchanged); Shift keeps the
  drag on one axis, as in Premiere and Photoshop.
- Positions are rounded to a millionth of the canvas, so centered reads 0
  instead of float dust.

## Consequences

`align_clips` and `distribute_clips` join the command registry, so the
Copilot, MCP and `window.videoEditor` get the same moves. Alignment is a
metadata edit (`store.edit`), so it never moves clips in time.
`scripts/drive/align.js` checks every edge against the drawn box, a
rotated picture, a title, the selection bounds, both snaps and Ctrl.
