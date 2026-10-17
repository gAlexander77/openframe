# ADR-048: Crop is cut from the source and edited on a copy

**Date:** 2026-10-16. **Status:** accepted.

## Context

`crop` holds fractions of the source trimmed from each edge, and cropping
keeps the uncropped picture where it was (Premiere's Crop effect). The
compositor and `layerBox` placed the visible part as if the picture were
never flipped and then mirrored it inside its own box. A mirrored picture
cropped on one side therefore slid its content: the part it kept was no
longer where the uncropped, mirrored picture showed it. A crop mode that
draws the whole picture dimmed around the crop cannot line up with that.

## Decision

- **The crop is cut from the source first; flips, scale, rotation and
  position act on what is left.** This is Premiere's Crop then Horizontal
  Flip order. A flip mirrors the crop's offset with the picture, so the
  part kept sits exactly where the uncropped, mirrored picture showed it.
  `compositor.ts` and `align.ts` `layerBox` apply the same sign.
- The stored fractions stay in source terms (left is the source's left,
  whatever the flip). Tools that work on the canvas convert at their edge.
- **The crop mode edits a copy, not the project.** CapCut's Crop is a
  dialog: the whole picture with the crop drawn over it, ratios, Reset,
  Cancel and Confirm. Ours runs on the viewer as a session in the store
  (`cropEdit`: clip, crop, ratio). While it is open the player draws that
  clip uncropped, and the overlay dims what lies outside the crop. Done
  writes the crop as one undo step ("Crop"); Cancel or Escape drop it and
  leave no history. A gesture over the project (`beginGesture`) was the
  other choice; it would have shown the uncropped picture only by
  editing the project, and any other drag during the session would have
  replaced its base.
- The session ends with Done when the viewer can no longer show it: a new
  selection, playback, the playhead leaving the clip, a hidden track.
  Leaving keeps the work, as typing on the canvas does (ADR-031).
- **Ratios are measured on the source**, in its pixels, and picking one
  crops the largest centered area of that shape, as CapCut does. A picture
  stretched with Scale Y shows the shape stretched. A corner keeps the
  shape by following the pointer along the diagonal from the opposite
  corner; an edge grows the other axis about its middle.

## Consequences

A saved project that both flips and crops one side unevenly now draws the
kept part on the mirrored side, where the uncropped picture had it. No
field changed, and every other project draws as before. The crop mode's
pixels (`window.videoEditor.pixels()`) show the whole picture until Done,
which the canvas-tools drive checks. `set_crop` gives agents the same
edges and ratios.
