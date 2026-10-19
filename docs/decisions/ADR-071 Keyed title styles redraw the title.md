# ADR-071: Keyed title styles redraw the title

**Date:** 2026-10-18. **Status:** accepted.

## Context

The launch film found two limits in titles. They had one weight (bold
or not), so a heavy display line could not pair with a light one. And
`add_keyframe` accepted `style.letterSpacing` and answered that it was
keyed, but the renderer read the stored style only: a tracking expand,
a staple of title sequences, did nothing. Size and color could not
animate either.

## Decision

- **`style.weight`**, 100..900, in the rasterizer's font string. Absent,
  `bold` decides (700 or 400), so every saved title draws as before; a
  weight wins over `bold`. Commands keep the two in agreement: a weight
  sets `bold` to match (for readers that only know bold), `bold` alone
  clears the weight. The Text tab's Weight list shows only the weights
  the font has: the family is drawn at each of 100..900 on a small canvas
  with the rasterizer's fallbacks, and equal drawings are one face (the
  browser draws a missing weight with its nearest face, by CSS font
  matching); each face is named by the weight it usually has in its run
  (`lib/textLook.ts` distinctWeights).
- **`style.size`, `style.letterSpacing` and `style.color` keyframe.** The
  plan resolves them per frame (`lib/textAnim.ts` textStyleAt) into the
  text source's clip; the rasterizer's cache key is the style, so a held
  value hits the cache and a changing one draws again. A keyed title's
  raster is uploaded unkeyed, into a scratch texture, as kinetic frames
  are, so an animation does not fill the texture cache with a frame each.
  An unkeyed title's style is the stored object itself: it rasterizes
  once, as before.
- **Colors key as numbers**: a keyframe holds a number, so a keyed color
  holds 0xRRGGBB and eases channel by channel (not the packed number,
  which would cross other hues). Alpha does not key: opacity fades a
  title. `animate_text_style` takes CSS colors and writes the numbers;
  the keyframe panel shows them as #rrggbb.
- **A keyed title grows from its aligned side**: a left-aligned title
  keeps its left edge as it tracks out or grows, a right-aligned one its
  right, as After Effects anchors text; centered type grows both ways.
  The plan measures the title at rest and at the frame with the
  rasterizer's own measure and moves the picture by half the difference,
  turned and mirrored with it. The first scene showed why: a
  left-aligned subline under a left-aligned title drifted left of it as
  its tracking opened.

## Consequences

- A title whose `style.letterSpacing` was keyed before this (the launch
  film's) now animates as its author asked; nothing else changes for old
  projects.
- A keyed title is drawn by Canvas2D each frame its values change: about
  a millisecond for a title, as kinetic typography already costs.
- `set_param` on `style.color` writes a number into the style; the
  renderer and the loader read it as 0xRRGGBB (the loader stores it back
  as #rrggbb), but the MCP layer should take a CSS color there (the
  keyable paths are listed in `TEXT_STYLE_PARAMS` and `COLOR_PATHS`).
