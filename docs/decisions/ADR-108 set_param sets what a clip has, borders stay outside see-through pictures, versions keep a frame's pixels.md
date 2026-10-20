# ADR-108: set_param sets what a clip has, borders stay outside see-through pictures, versions keep a frame's pixels

**Date:** 2026-10-20. **Status:** accepted. Builds on
[[ADR-099 Feathers blur the shape, title runs share a baseline, pictures take a border]],
[[ADR-105 Answers hold what was asked, tracked titles center on their letters, pictures take a color]]
and [[ADR-066 Keyframes are refused where nothing moves and shown in answers]].

## Context

A round tried to break what ADR-099 and ADR-105 added, through the web
build's MCP server as a model uses it: borders on every kind of picture
(transitions, in and out animations, crop and rounded masks, a soft PNG,
titles and shapes, widths 0 to 200, a picture at 0.05, motion blur, a
mirrored edge, keyed opacity and width, a chroma key, a drop shadow, a
compound, a 9:16 version), colorize (solids at three grays, a glow sprite
keyed, an adjustment clip over two tracks, a filter, a compound, a title,
undo, a color with alpha), tracking (three alignments, wrapped and
multi-line titles, negative spacing, a scaled range with its own
gradient, karaoke captions, word-by-word animations, the on-canvas
editor), every animatable path through `set_param`, and describe_project's
filters (an empty stretch, `end` before `start`, unknown ids among good
ones, a clip and a track inside a compound, nested compounds, filters
combined). Each frame was looked at and measured. What broke:

- **`set_param` stored half of a part the clip lacked.** On a clip with
  no colorize, `adjust.colorize.amount 0.5` stored `{amount: 0.5}`, and
  every frame with the clip failed to render ("Cannot read properties of
  undefined (reading 'trim')": the color was missing). `mask.width` stored
  a one-number mask, and from then on `describe_project` failed, and so did
  `undo` and `set_mask none`, whose answers are built from it: the project
  was stuck for a model ("reading 'toFixed'", the mask summary ADR-099
  added). `border.width` and `shadow.blur` stored a part that drew nothing
  in the session and a white border after a reload (the loader fills the
  missing color). The keyframe table already knew what each part needs;
  `set_param` without `at` never asked it.
- **A keyed value without `at` went under its keys.** `set_border width 30`,
  `set_shadow`, `set_colorize amount` and `set_mask` on a keyed value with
  no `at` wrote the value under the keys, where nothing shows it, and the
  answer showed the new number as if it had taken. `set_mask none` kept
  the mask's keys, which then animated the next mask.
- **A border filled see-through pictures with its color.** The border pass
  drew the border under every pixel the picture did not cover fully, its
  inside included. A title's box at `rgba(0,0,80,0.5)` over green turned
  lavender (127, 127, 167 instead of 16, 80, 72) under a white border, a
  blue picture at 60% over gray read 102, 0, 153 instead of 51, 51, 204,
  letters fading in one by one filled pink, and a soft PNG and a feathered
  shape tinted inside.
- **Versions drew borders, drop shadows and feathers 1.78 times larger on
  9:16.** These are pixels at a 1080-tall frame, like a title's size and a
  shape's stroke, which `export_versions` keeps against the frame's short
  side. These three were left as they were, so a 12 px frame drew 21 px
  around a picture that kept its size, and a 120 px feather drew 213 px
  soft (dimmer too, now that a feather is a blur).
- **describe_project left out nested compounds and compound tracks.** A
  compound shown that plays another compound listed only the outer one
  and not the inner one's media. A track inside a compound, named in
  `track_ids`, came back in `not_found`.
- **A colorize color's alpha was dropped.** `#ffb34780` colored white full
  amber (255, 179, 71).
- **A tracked range's gradient ended a spacing past its last letter.**
  "SALE" tracked 30 ended at 124, 55, 221 against `to` 138, 43, 226: the
  run's box was its advance, which counts the spacing after the last
  letter, the error ADR-105 fixed for whole lines.

What held: borders through slide transitions, in and out animations, crop
with a rounded mask (a rounded frame), a soft PNG (at its half-covered
contour), titles and shapes, widths 0 (none) and 200, a picture at 0.05,
keyed width and opacity, a chroma key (the cut-out's edge), a drop shadow
cast by both, a compound; colorize on solids (white 255, 179, 71, gray
128, 90, 36, black 0, 0, 0), a keyed glow, an adjustment clip over two
tracks, a filter after it, a compound, undo and `off`; tracked titles
centered, left and right, wrapped onto five lines, at -20, karaoke
highlights on their words and word pops on theirs; the on-canvas editor's
letters on the drawn ones within a pixel at spacing 40 (center, left,
right, three wrapped lines) and -8; every animatable number still sets
through `set_param`; describe_project with unknown ids among good ones, a
stretch through a clip, a clip inside a compound, combined filters; the
glow's new default threshold leaves the presets that set their own (beat
hits 50, the logo reveal 45) as they were; feathered shapes turned and
trimmed.

## Decision

### set_param sets what a clip has

`set_param` refuses a path through a part the clip lacks, with what adds
it: "border.width is not on clip c_1: it has no border: set_border first"
(`missingPart` in `lib/commands.ts`, the reason from the keyframe table's
`partNeeds`). A grade's HSL bands and wheels are the exception the tool's
description names: the grade reads a missing value as 0, so `set_param`
still starts them. The table gains the two needs it lacked: a LUT's
intensity needs a LUT, and a wiggle's keys need that target's wiggle, so
`add_keyframe` refuses those dead keys too. Every animatable path still
sets on a clip that has its part (a test runs them all).

### A keyed value needs at

`set_border`, `set_shadow`, `set_colorize` and `set_mask` refuse a keyed
value given without `at`, naming it ("border.width is keyframed on clip
c_1: give at..."); unkeyed values in the same call still change.
`set_mask none` removes the mask's keys with it, as `set_border off` and
`set_shadow off` do. `set_param` keeps setting a keyed path's base value
without `at`, as before: `normalize_loudness` sets `volume` that way on
ducked music, and whether that should key or refuse is the sound lane's
call.

### Borders stay outside see-through pictures

Inside the picture (a pixel covered at least half), the border is drawn
only where the edge's anti-aliasing leaves room: by how much more its most
covered neighbor is covered than it is, and only on the edge (a neighbor
outside). An opaque picture's soft edge pixel still meets the border
without a seam (0.7 covered, its inner neighbor 1: 0.3 of border under
it, as before); a see-through picture's inside and its edge row stay its
own. `scripts/drive/borders.js` checks a blue picture at 60%: 51, 51, 204
inside and on its first pixel, red around it.

### Versions keep a frame's pixels

`export_versions` scales a picture's border width, its drop shadow's blur
and offsets and a shape's feather like the stroke beside them, keys too
(`scaleFrame`, `scaleShape` in `lib/versions.ts`), so on 9:16 a 12 px frame
stays 12 px against the short side. Inside a compound that refits as a
picture they scale with its inner frame, as its titles and shapes do.

### describe_project, nested and at a moment

- Compounds a listed clip plays are listed whole, and what they play in
  turn, with their media.
- A track inside a compound named in `track_ids` lists that compound with
  that track, as a clip named in `clip_ids` does.
- An empty `clip_ids` or `track_ids` is no filter: a model that fills in
  every optional argument sends `[]` meaning all, and an empty list read
  literally answered a track asked for as empty.
- `start` equal to `end` is a moment: the clips playing at it and a marker
  on it. `end` before `start` is still refused ("end must not be before
  start").

### A colorize color's alpha scales its amount

As a border's or a shadow's color alpha scales its opacity:
`#ffb34780` at amount 1 mixes amber in at 0.5 (white renders 255, 217,
163), and `transparent` colors nothing.

### A tracked range's gradient ends on its letters

`runBoxes` takes the letter spacing off each piece's advance, so a run's
gradient spans its first letter to its last however it is tracked: the
last ink of "SALE" reads 131, 45, 220 against `to` 138, 43, 226 (its
anti-aliased edge), from 124, 55, 221.

## Consequences

- A model that set a border, shadow, mask or colorize number before adding
  the part is told which command adds it, instead of getting a part that
  draws nothing, crashes a render or wedges `describe_project`.
- Keys on a LUT's intensity without a LUT and on a wiggle target the clip
  does not wiggle are refused, as other dead keys are (ADR-066).
- A border on a picture with see-through pixels (a box at 50%, a fading
  letter, a soft PNG) now frames it without tinting it. Opaque pictures
  draw exactly as before. The border pass reads up to nine more texels for
  the pixels inside a see-through picture's reach.
- Left open:
  - A picture fading by its own pixels (a title's letters fading in one
    by one) gets its border once a letter is half covered, at full
    strength. A border that fades with each letter needs the letter's own
    opacity, which the layer does not have.
  - A box less than half covered (`rgba(0,0,0,0.4)`) is not part of the
    picture: the border hugs the letters and shows through the box near
    them, as ADR-099's half-covered rule says.
  - A motion-blurred picture's border is drawn around the blurred picture,
    crisp; After Effects blurs a layer's stroke with it. That needs a
    border per shutter sample.
  - Effects' pixel-sized parameters (a blur's amount) are still drawn at
    the version's height, larger on 9:16; so is a position wiggle's
    amplitude.
  - `add_shape` with `fill: false` and a `color` but no `stroke_color`
    draws a white outline, as its description says; a solid color clip
    drops its color's alpha.
- Verified by unit tests (`commands.graphics`, `describeFilter`,
  `versions`, `colorize`, `textRuns`), each failing on the old code, and the
  drives `borders` (a see-through picture) and `inline-text` (the editor
  over tracked titles, four ways).
