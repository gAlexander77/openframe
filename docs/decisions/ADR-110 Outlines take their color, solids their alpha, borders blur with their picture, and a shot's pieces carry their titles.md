# ADR-110: Outlines take their color, solids their alpha, borders blur with their picture, and a shot's pieces carry their titles

**Date:** 2026-10-20. **Status:** accepted. Builds on
[[ADR-108 set_param sets what a clip has, borders stay outside see-through pictures, versions keep a frame's pixels]],
[[ADR-106 What sits on a shot or marks a song follows it through every edit]],
[[ADR-105 Answers hold what was asked, tracked titles center on their letters, pictures take a color]],
[[ADR-102 An edit moves only what its answer names, and the main track keeps the gaps it was given]] and
[[ADR-099 Feathers blur the shape, title runs share a baseline, pictures take a border]].

## Context

ADR-106 and ADR-108 left eight things open. Each was tried again through
the web build's MCP server (the launch film's footage and song) and in
unit tests, and each image was looked at:

1. **`add_shape` with `fill: false` and a `color` drew a white outline.**
   The outline's color defaulted to white unless the shape was a line;
   the color given went to the fill, which an outline-only shape does
   not draw.
2. **A solid ignored its color's alpha.** The compositor read a color
   clip's color with a hex-only parser that kept three channels:
   `#ff000080` over blue drew opaque red (255, 0, 0). Trying names found
   worse: `add_color_clip` takes any CSS color and stored `red`, `lime`
   or `rgba(0, 255, 0, 0.5)` as given, and each drew **black**. A canvas
   fill's color went the same way.
3. **A motion-blurred picture got a crisp border.** The border was cast
   once, around the picture already averaged over its shutter: a crisp
   band around the half-covered contour of the smear (in the borders
   drive, red led by 167 and three pixels were pure red). After Effects
   renders a layer's stroke with the layer, so the motion blur smears it.
4. **Versions kept effects' pixel sizes and a position wiggle at the
   master's numbers.** A blur's radius, a pixelate's blocks, a grain's
   and a halftone's size and the motion blur effect's length are pixels
   at a 1080-tall frame, drawn larger on a taller one (the effect pass
   scales them by the render's height / 1080). `export_versions` keeps
   type, strokes, borders, shadows and feathers against the short side
   (ADR-108), but not these: on 9:16 a picture-in-picture's blocks and a
   title's blur drew 1.78 times as large against the picture. A wiggle's
   x is stored as a fraction of the width and its y of the height, so a
   title's 12 px shake went 0.56 times as far across and 1.78 times as
   far up and down.
5. **`set_param` on a keyframed path without `at` wrote the hidden base
   value** and answered as if it had taken. `set_shape` and `set_tilt`
   did the same for their keyed numbers. `normalize_loudness` turned out
   not to rely on it: it refused a clip with volume keys ("normalize
   before ducking"), a ponytail until its keys could be scaled.
6. **A song's markers followed it one compound deep.** A song in a
   compound clip inside another compound clip lost every root marker
   (`throughNests` looked only at the compounds on the timeline).
7. **A title over the second half of a shot split by `freeze_frame`
   stayed put.** The freeze splits the shot: its first half keeps the
   id and changes length, its second half is a new clip pushed later.
   Linkage carried only clips on a shot that moved whole by id (ADR-102),
   so the title stayed over the freeze, off the pictures it was on. An
   insert into the middle of a shot did the same.
8. **Per-letter fades popped the border in at full strength, and a box
   under half opacity was not framed** (ADR-108).

Found on the way, by the compound-compressor drive: **`set_param eq.low`
was refused** ("eq.low is not on clip: it has no eq"). ADR-108's refusal
of a part a clip lacks took a sound's EQ for one, but its bands are each
flat when missing, and no other command sets an EQ: an agent could not EQ
a sound at all.

## Decision

### An outline-only shape's color is its outline's

`add_shape` with `fill: false`, a `color` and no `stroke_color` outlines
in that color (`stroke_color` still wins; a filled shape's outline is
still white by default). `set_shape` does the same for a color given to
a hollow shape, or one made hollow in the same call, and refuses
`fill: false` on a shape with no outline, as `add_shape` does ("an
outline-only shape needs stroke_width"): it drew nothing.

### A solid is any CSS color, alpha too

The compositor reads a solid's color (and a canvas fill's) with the
shared `parseColor`, alpha included: `#ff000080` over blue is 128, 0, 127
and `lime` is lime. `add_color_clip` refuses a color it cannot read, as
`add_shape` does, instead of storing one that drew black.

### A motion-blurred border blurs with its picture

A layer with a border and motion blur that moves is framed at each
shutter placement and the framed pictures averaged (`layerToTarget` in
the compositor): source, effects, track matte and border per sample,
summed into the half-float target, then the drop shadow, which is linear
in the picture and is cast once from the average. The track matte layer
is now drawn before the picture (it was drawn after the picture's
effects), so it is drawn once, not per sample. The same video frame is
uploaded once and reused across samples (`fresh` in `sourceTexture`).
Without a half-float target, the border is cast once as before.

The borders drive's rushing picture (57.6 px a frame, a 360 degree
shutter, a 20 px red border) now has no pure red pixel in its smear and
red leads by 88 there (the border covers each point for about 20 of the
57.6 px), from 167; its top border, which the move slides along itself,
stays red.

### Versions scale what rides on a picture with the picture

The catalog marks the effect parameters that are pixels at a 1080-tall
frame (`pixels`: blur amount, pixelate size, grain size, motion blur
amount, halftone size). After a version is laid out, each clip's
pixel-sized effect parameters and its x and y wiggle amplitudes, keys
too, are scaled by how many times larger its picture is drawn in pixels
(`grownBy`, `scalePixels` in `lib/versions.ts`): a title by its type
size, footage by how it fits the frame and its scale, a solid or shape by
the short side (as its stroke), and everything inside a compound that
refits as a picture by that picture's shrink. So a picture-in-picture's
blur keeps its pixels on 9:16 (20 becomes 11.25), as the picture does,
and a title's shake its 12 px both ways. Footage that fills the frame is
drawn 1.78 times larger to cover a 9:16 one, and its blur already grew
with it: its numbers stay, and the version still looks like a crop of the
master. This is "against the picture", not "against the short side", on
purpose: a border is a frame drawn around a picture and keeps the frame's
pixels (ADR-108); an effect acts on the picture's own pixels.

### A keyed value needs at, in set_param too

`set_param`, `set_shape` and `set_tilt` refuse a keyed value given without
`at`, naming it ("opacity is keyframed on clip c_1: give at (timeline
seconds) to key it there, or remove_keyframes path opacity first"), as
ADR-108's commands do; unkeyed values and clips still set without it.

`set_param` starts a sound's EQ again (`eq.low`, `eq.mid`, `eq.high`, dB,
listed in the params guide), as it starts a grade's HSL bands.

`normalize_loudness` now sets a ducked clip's level instead of refusing
it: `setLevel` (`lib/project/ops.ts`) sets the volume and scales its
volume keys so the loudest is the new level, the duck's shape kept. A
song keyed 1, 0.3, 1 normalized to -20 LUFS through MCP became 1.656,
0.497, 1.656. Re-ducking later reads the new level as its base, as
before.

### Markers follow a song however deep it is nested

`follow`'s `framesInside` walks compound clips inside compound clips (to
eight deep) and maps a song's second out through each one's timing. Two
compounds deep, moving the outer one 2 s moves every bar marker 60
frames; breaking both apart keeps them on the song's clip.

### A piece cut off a shot carries what sat on it

Linkage counts a piece cut off a shot as a shot of its own (`pieceMoves`
in `lib/project/ops.ts`): a new main-track clip that reads a stretch of
an old shot that is still there and shorter, from the same file at the
same speed and direction, played before the edit where that stretch
played in the old shot; when it now plays elsewhere, what sat mostly on
that stretch moves with it, as with a shot that moved whole. A freeze
frame's second half carries its title past the freeze (3.5 s became 5 s
through MCP, under a 1.5 s freeze), and so does an insert into a shot. A
plain split moves nothing. A head trim, a slip and a speed change are as
ADR-102 says: those change the shot itself, not where a piece of it
went. A new clip two old shots could have given, or pieces that claim
more of a shot than it lost (a replay of the shot's own tail inserted
into it) move nothing: which is which is unclear.

### Left open: per-letter fades and a faint box

Not fixed, and not small. The border's inside is what is at least half
covered, and its strength is full (ADR-108's 60% picture keeps a full
red border). A fading letter and a see-through box are the same pixels to
the border pass: a letter at 0.4 and a box at `rgba(0,0,0,0.4)` both read
0.4, and one should be framed faintly, the other fully. Ramping the
strength with a pixel's neighborhood would also thin a soft PNG's border,
which ADR-108 keeps at its half-covered contour. A border that fades with
each letter needs the letter's own opacity: the text renderer would hand
the compositor a second raster with the letters at rest (as a matte),
the border would be seeded from it and scaled by the faded raster
against it at each seed. A box under half opacity framed as a box needs
the same: the title's box drawn at rest into that raster.

## Consequences

- Hollow shapes take the color a model gives them; solids and canvas
  fills draw any CSS color, see-through ones too, and an unreadable color
  is refused instead of drawing black.
- A framed picture with motion blur costs its effects and border per
  shutter sample (up to 32 on export, 6 playing) while it moves; a
  still or unframed picture costs what it did.
- Versions of titles, shapes and pictures-in-picture keep their blur,
  blocks, grain and shake against their picture; full-frame footage is
  unchanged.
- A model that set a keyed value without `at` is told to give it, instead
  of a value nothing reads; `normalize_loudness` works on ducked music.
- Titles on a frozen or inserted-into shot's second half stay on their
  pictures.
- Left open, besides the border's per-letter fades and faint boxes:
  - A glow's reach (18 px at 1080p), denoise's and sketch's are fixed in
    the shader, not parameters, so a version draws them as before
    (larger against a title on 9:16; right against full-frame footage).
    So is an animation's blur (blurIn). The three are parameters versions
    scale since [[ADR-117 A whole file relinks to itself, effects keep their size at every render size, and a split's halves share one compressor]]; blurIn is not.
  - An adjustment clip's effects act on everything under it and are not
    scaled: on a fill version that is mostly footage drawn larger, which
    they match.
  - Glitch, VHS and camera shake effects move by fractions of the frame,
    and rgbSplit's offset is constant in render pixels by its formula
    (it divides by the render's width / 1920), so it reads larger in a
    smaller preview than in export; neither is touched here. The split
    is pixels at 1080p (scaled by versions) since ADR-117, which also
    found VHS's scan lines and the pixelate transition's blocks sized in
    render pixels and fixed them.
- Tests, each failing on the code before: `commands.graphics.test.ts`
  (an outline-only shape's color in `add_shape` and `set_shape`;
  `add_color_clip`'s colors; `set_param`, `set_shape` and `set_tilt`
  refusing a keyed value without `at`; `set_param` starting an EQ),
  `versions.test.ts` (effects and a wiggle on 9:16 and 1:1),
  `ops.test.ts` (a freeze's, an insert's and a split's pieces, a replay
  that moves nothing; `setLevel`),
  `commands.test.ts` (an agent's freeze with a caption on the second
  half), `musicGrid.test.ts` (two compounds deep and out). The drives
  `shapes` (a hollow box's yellow outline, from white; red at half over
  blue 128, 0, 127 and lime 0, 255, 0, from 255, 0, 0 and black) and
  `borders` (the motion-blurred border) fail on the old code and pass.
- Every drive but four ran headless on the web build (182 of 186): all
  pass (voiceover on a second run: its fake microphone's take came out a
  frame long once) but music-structure, which needs a song file this
  checkout's scratch does not have. Not run: the three that need the
  desktop app (desktop-session-jobs, media-relink, window-header) and
  longgop-cut, whose media is kept elsewhere (ADR-106).
