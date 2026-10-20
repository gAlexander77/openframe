# ADR-099: Feathers blur the shape, title runs share a baseline, pictures take a border

**Date:** 2026-10-20. **Status:** accepted.

## Context

The last rounds added soft shapes (ADR-069), multi-color titles
(ADR-087), keyed title styles (ADR-071), custom Bezier eases and
`transform_group` (ADR-088), and none of them had been rendered and looked
at through MCP, as a model uses them. A round of checks did that in the
web build: build each feature with the MCP tools, render it with
`preview_frame`, `preview_frames` and `preview_motion`, measure the
pixels, and compare a frame with the same frame of an export. The
results:

- **Glows and soft shapes: a bug.** Radial gradients were smooth (one or
  two levels of 255 between neighboring pixels, no banding), and the blur
  effect up to 500 was not cut off. But the feather was a Gaussian of the
  signed distance to the outline (ADR-069's `edgeCover`). That is a blur
  only along a straight edge. With a feather as wide as the shape it
  creased along the shape's middle: a rectangle showed its diagonals, a
  line its ends as arrowheads, and an ellipse 960 x 162 feathered 300
  pinched to a bow tie at its center (the ellipse's distance there was
  480 one way and 81 the other), went dark in notches past its ends, and
  was cut off by straight vertical edges where its quad ended (the
  ellipse's first-order distance is short far from it, so the glow ran
  past the three sigma the quad allowed).
- **Multi-color titles: two bugs.** Literal matches, `all`, UTF-16 offsets
  (an emoji with its variation selector, a surrogate pair), explicit line
  breaks and wrapped lines all landed on the right characters. But a
  run's gradient ran across the whole title block, so "OpenFrame" styled
  cyan to violet began a third of the way in (it started 42, 174, 255,
  not 0, 229, 255), and a scaled run was centered on the line's middle,
  so "SALE" at 1.6 sat 16 px below the baseline of "Big" and "today".
- **Style keyframes: two bugs.** `style.color`, `style.size` and
  `style.letterSpacing` animated in `preview_motion`; `style.weight`,
  `style.stroke.width`, `style.shadow.blur`, `style.lineHeight` and
  `style.background.padding` were refused with the list of what
  animates. But `add_keyframe` took `color` on any path and keyed its
  0xRRGGBB as the number (`style.size` with `#ff0000` became a
  16,711,680-pixel title), and `set_param` on `style.color` stored the
  number in the style itself, after which `check_project` failed with
  "css.trim is not a function". `set_param` also wrote numbers into any
  field (a font name, a boolean).
- **Custom Bezier eases: pass.** Two squares keyed with
  `[0.2, 0.9, 0.3, 1]` and the overshooting `[0.3, -0.5, 0.7, 1.5]`
  were at the CSS cubic-bezier's position in every one of 21 frames
  (within the measuring's constant pixel).
- **`transform_group`: a bug.** The pivot was the center of the members'
  combined bounds and a 90-degree turn moved each member rigidly. But a
  move with `at` keyed every transform path of every member, including
  animated paths the move left as they were: an x move put a key on a
  member's eased scale, splitting its curve, so its scale at other times
  changed.
- **Preview against export: pass.** The web build refuses `export_video`
  to agents, so the clip was rendered with `videoEditor.render` (the same
  export loop) and its frame decoded with ffmpeg: the ink boxes of a
  weight-200, a weight-900 outlined, a boxed left-aligned and a styled
  title matched `preview_frame` within a pixel.

The same round added the border on pictures the layouts lacked: a clip
could cast a drop shadow (ADR-070) but not frame its picture.

## Decision

### A feather is the shape blurred

`feather` keeps its meaning along a straight edge (the edge fades over
that many pixels at 1080p, centered on it, a Gaussian's falloff with sigma
a quarter of it) and is now that blur everywhere: the coverage is the
crisp shape convolved with the Gaussian, computed in the shape shader.
The shape is cut in horizontal slices; each slice is a span whose blur
across is exact (a difference of two erf). A rectangle is one such span
along y too, so it is exact. A rounded rectangle's straight middle is
exact, and each rounded end is summed over 12 slices taken by angle
(`t = h + r sin a`), so the end's vertical tangent costs no accuracy. An
ellipse is all end. A ring (an outline) is the shape grown by half its
width less the shape shrunk by it. The trim of a feathered outline is
blurred along it the same way, so its two ends are as soft as its sides.
`lib/shapes.ts` (`blurredCover`, `trimCover`) is the shader line for line;
its tests compare it with a brute-force 2D convolution (within two levels
of 255), check that a long ellipse's middle row is smooth, and that
nothing is left where the quad ends.

A feather wider than the shape now dims the shape's middle, as a blur
does: a 20-pixel line feathered 200 is a faint haze, not a line at half
strength. The add_shape description says so.

### A run's gradient spans its letters; a line shares one baseline

A run with its own gradient takes the box around its own pieces (across
the lines it wraps onto) for the gradient's ends (`runBoxes`); a title's
gradient still spans the block. Each piece is still drawn centered on its
line, then moved down by how much nearer the middle its font puts the
baseline than the line's tallest piece does (`baselineShifts`), so every
piece sits on the tallest one's baseline and the line's content stays
inside its height. Lines keep one pitch, the tallest run's.

### Keys and parameters take only what they hold

`add_keyframe` refuses `color` on a path that is not a color.
`set_param` writes a title's color as CSS (`#rrggbb`) unless the color is
keyed, where it keys the number, refuses a color path on a clip that is
not a title, and refuses any path that holds something other than a
number, naming what it holds.

### A group move keys only what it changes

`transform_group` skips an animated path whose value the move leaves as
it is. Static paths still take a key when `at` is given, as documented.

### Pictures take a border

`border: { color, width, opacity }` on any visual clip, `set_border`
(clip_ids, color, width 0..200 pixels at 1080p, opacity, off, at), the
keys `border.width` and `border.opacity`, and a Border section beside the
Shadow section of the Video tab.

- **Around the finished picture, outside it.** The border is drawn after
  the mask, crop, effects and track matte, and before the drop shadow,
  which the picture and its border cast together. A rounded mask gets a
  rounded border and a compound window one border around the whole.
  Outside, so the picture is never covered (After Effects' Stroke layer
  style, Outside).
- **Its width does not scale with the clip**, as a CSS border does not:
  an inset at a quarter size keeps its 20-pixel frame.
- **The edge is found by a jump flood.** A seed pass marks the pixels the
  picture covers by at least half (half of the clip's opacity, so a faded
  picture keeps its border); steps of 2^k down to 1, and one more of 1,
  carry the nearest such pixel outward as far as the border reaches
  (`floodSteps`), on two scratch targets with the coordinates in two bytes
  each. The final pass covers what lies within the width of the edge,
  placing the edge inside the nearest pixel by how much of it is covered
  past half, so a curve's border is anti-aliased; it draws only where the
  picture would not cover at full opacity, so a faded picture does not
  show its frame through itself. Rejected: a dilation (cost grows with the
  width squared), a blurred alpha cut at a threshold (thins the border at
  corners by a quarter), and the picture's quad and mask solved
  analytically (wrong for compound clips, titles and mattes).

### describe_project shows masks

A clip's mask is listed as `set_mask` takes it; until now a model could
not see the masks it had set.

## Consequences

- Feathered shapes cost more: up to three sums of 24 slices a pixel for
  a filled, outlined rounded shape, against one erf before. Unfeathered
  shapes draw exactly as before.
- Projects with wide feathers on small or thin shapes look dimmer than
  they did. Glows feathered by half their size or less look the same.
- A border costs a seed pass, log2 of its width plus two flood passes and
  a final pass, at the canvas's size, and two canvas-sized RGBA8 targets
  made on first use.
- A border near the canvas edge ends there: the flood knows only what is
  on the canvas, as the shadow does.
- ponytail: the run's gradient spans the box around all of its pieces,
  not the run laid end to end across its lines (CSS's
  `box-decoration-break: slice`); lines keep one pitch.
- `scripts/drive/borders.js` checks the border in the still, the viewer's
  own pixels and an exported MP4; `scripts/drive/soft-light.js` checks a
  long feathered ellipse against `blurredCover`'s values.
