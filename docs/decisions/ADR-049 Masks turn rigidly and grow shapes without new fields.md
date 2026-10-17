# ADR-049: Masks turn rigidly and grow shapes without new fields

**Date:** 2026-10-16. **Status:** accepted.

## Context

CapCut's masks are linear, mirror, circle, rectangle (with round
corners), heart and star, and its viewer draws each with handles to move,
size, turn and feather it. Ours had the first four, sliders only, and
measured everything in fractions of the layer: center, size, feather,
and rotation too. Rotating in fractions shears a shape on any layer that
is not square, so a rotated rectangle on a 16:9 picture became a
parallelogram, and handles drawn on the viewer could not follow it.

## Decision

- **The mask turns rigidly.** The shader measures the mask in layer
  heights (width scaled by the layer's aspect), rotates there, then
  returns to fractions along the mask's own axes. Width and height still
  mean fractions of the layer's width and height, and the older shapes'
  feather keeps its units, so every unrotated mask draws exactly as
  before.
- **New shapes are additive.** `shape` gains `heart` and `star`; round
  corners are an optional `radius` (0..1 of half the shorter side) on
  `rectangle`, absent meaning square, as CapCut's Round corners slider
  sits on its rectangle. No migration and no schema bump: old files load
  unchanged, and a reader that predates the shapes draws no mask for them.
- Heart and star fill the mask's box (Inigo Quilez's distance functions,
  mapped to it) and feather in half-sizes, like the circle. A rounded
  rectangle is a rounded box in layer heights with its feather in layer
  heights, so its corners stay round on screen.
- `src/lib/mask.ts` draws the same outlines for the viewer's handles and
  holds what each handle drag does; the shader and it change together.
- New hearts and stars start square on the picture, as CapCut's do; the
  older shapes keep their 0.6 by 0.6 start.

## Consequences

A mask saved with a rotation on a non-square picture now draws turned
rather than sheared. A feathered rectangle that gains round corners
measures its side feather in layer heights, so on a wide picture its left
and right edges sharpen slightly. `set_mask` gives agents every shape and
number; the mask numbers, `radius` included, take keyframes.
