# ADR-030: The canvas text editor is a transparent textarea over the engine's text

- **Date**: 2026-10-14 · **Status**: accepted

## Context

CapCut edits a title where it sits: double-click the text in the player
and a caret appears in it; what you type shows in the frame at once. Our
text is rasterized by Canvas2D (`src/engine/text.ts`) and composited by
WebGL, so the viewer has no DOM text to put a caret in. Two ways to get
one: draw the text in the DOM while editing and hide the engine's, or keep
the engine's and lay an invisible editor over it.

## Decision

- **The engine keeps drawing the text; the editor is a `<textarea>` with
  transparent glyphs** over it, showing only the caret (accent color) and a
  translucent accent selection. The frame you edit is the frame you export:
  stroke, shadow, background, filters, effects and blend all stay visible,
  which a DOM stand-in could not reproduce, and nothing in the engine knows
  editing exists.
- The textarea types in the **same font family, weight, size, letter
  spacing, line pitch, alignment and rotation**, all derived from the
  rasterizer's own layout (`TextLayout`, returned with the raster) by the pure
  `editBox()` in `src/lib/textBox.ts`. It is as wide as the wrap width,
  anchored like the lines, so it wraps where the rasterizer does; its sides
  are trimmed to half an em past the box so it does not swallow the clicks
  beside a short title that should end editing.
- The canvas centers each line on the em box (`textBaseline = "middle"`);
  CSS centers ascent plus descent. The rasterizer measures the difference
  from the font (`fontBoundingBoxAscent` at both baselines) and the editor
  drops by it.
- A textarea rather than `contenteditable`: plain text in and out, native
  selection and undo while typing, no markup to sanitize on paste.

## Consequences

The drive (`scripts/drive/inline-text.js`) paints the editor's glyphs red
over a hidden canvas and compares them, line by line, with the engine's:
within a pixel on every edge for a 140 px title, a caption, and a title
turned 15 degrees; without the baseline correction they sit three to four
pixels low. At smaller type single edges scatter about a pixel and a half
(CSS snaps baselines to whole pixels, the compositor resamples the
raster), which the eye does not see. Mirrored (flipped) and cropped text
get a box that ignores the flip and the crop. The caret is the browser's
one-pixel bar; CSS cannot thicken it yet.
