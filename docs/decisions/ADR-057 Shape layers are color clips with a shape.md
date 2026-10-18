# ADR-057: Shape layers are color clips with a shape

**Date:** 2026-10-18. **Status:** accepted.

## Context

Lower thirds, callouts, CTA buttons, progress bars and end cards are built
from shapes: After Effects' shape layers (Rectangle with Roundness,
Ellipse, Fill, Gradient Fill, Stroke, Trim Paths), CapCut's shape
stickers. The app drew boxes only as color clips cropped to a rectangle
(the title templates do), with no round corners, outline, gradient or
draw-on, and no ellipse or line.

Two shapes for the data were open: a new clip type, or a mode of the
existing color clip.

## Decision

- **A shape is a color clip with an optional `shape`**:
  `{ kind: rectangle | ellipse | line, width, height, radius?, fill?,
  gradient?: { from, to, angle }, stroke?: { color, width }, draw? }`. The
  clip's `color` is the fill. A new type would have to be taught to every
  place that switches on clip types (timeline, inspector tabs, templates,
  Align, crop, describe, OTIO export, the loader's type list), and older
  builds would refuse to open the file; as a mode, all of that already
  works for a solid, and an older build opens the file and draws a solid.
- Sizes are fractions of the canvas, like positions; stroke widths are
  pixels at a 1080-pixel-tall canvas, like text. A line runs across its
  width and turns with `transform.rotation`; it is drawn with its stroke
  (8 px by default). `radius` 0..1 is a share of half the shorter side, as
  the rectangle mask's is, so 1 is a pill at any size.
- **Every number keyframes by path** (`shape.width`, `shape.height`,
  `shape.radius`, `shape.stroke.width`, `shape.draw`,
  `shape.gradient.angle`) through the existing keyframe machinery; the plan
  resolves them into a `shape` layer source.
- **Drawn as signed distances in the layer shader**, not rasterized: the
  quad is the shape's box plus its stroke and two screen pixels, so
  transform, crop, mask, color, effects, blend and motion blur act on a
  shape exactly as on a picture, at any resolution, with edges
  anti-aliased by the screen-space derivative of the shape's pixel
  coordinates (rotation and scale included). A rounded box uses the exact
  distance; an ellipse the first-order one (exact on circles); fills and
  strokes composite stroke over fill.
- **Trim paths (`draw`) cut the outline by arc length** from the top center
  clockwise (a line from its left end). A rounded rectangle is measured
  exactly (four edges and four arcs, `lib/shapes.ts rectOutlineAt`, which
  the shader copies and the tests pin); an ellipse by angle, since its arc
  length has no closed form. Fills are not trimmed.
- The shape code lives in a second build of the layer shader
  (`LAYER_SHAPE_FS`, `#define SHAPE`): in the one every layer uses it added
  about half again to the compile on ANGLE/D3D11.

## Consequences

`add_shape` places a shape above whatever shows at that time (as stickers
and templates land), so a box goes in before the text that sits on it;
`set_shape` edits one. Polygons, stars and free paths are not shapes yet
(the mask's star and heart are there for cutting). An ellipse drawn on
with `draw` moves a little faster along its ends.
