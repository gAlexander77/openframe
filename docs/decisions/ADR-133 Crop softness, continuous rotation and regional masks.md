# ADR-133: Crop softness, continuous rotation and regional masks

**Date:** 2026-10-21. **Status:** accepted.

## Context

Rigid masks and hard crops cannot isolate a curved subject or blend a
regional grade. Adjustment clips have no source image, and wrapping an
angle at a dial's seam would discard intentional complete turns.

## Decision

- Optional `crop.feather` is inward smoothstep softness in pixels at a
  1080-tall render, before flips and the picture transform (ADR-048).
  Absent and zero keep the old hard edge. Versions scale its pixel measure.
- The dial accumulates shortest pointer-angle deltas, retaining complete
  turns. Snapping affects the displayed result, not the accumulated angle.
  Its gesture and numeric entry share the inspector's undo and keyframing.
- Adjustment clips gain optional `mask`; resolve its numeric keys and mix
  the accumulator before/after all grade and effect passes by its alpha.
  Their mask frame is the canvas. Pictures keep their own layer frame.
- `path` anchors are local layer fractions. Mask width/height multiply
  anchors and handle offsets before rigid rotation/translation (ADR-049).
  `closed` defaults true; false is an unfilled draft. Canvas2D Path2D fills
  with nonzero winding; a Gaussian approximation feathers its alpha.
  Translation/rotation reuse the raster; point, size or feather edits rebuild it.
- Paths have at most 256 anchors. An eight-entry GPU cache caps rasters at
  1024 pixels on their long side and releases replaced, unused and disposed
  textures. Individual anchors stay static; numeric mask keys animate the frame.

## Consequences

Old optional-field-free projects keep their rendering. Preview and still/video
export share these passes. Open paths show an editable outline until closed;
large paths can soften at the raster ceiling. Point morphing and tiled or
larger path rasters remain future work, marked `ponytail:` at their ceilings.
