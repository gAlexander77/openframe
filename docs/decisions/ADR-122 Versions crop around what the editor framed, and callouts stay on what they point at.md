# ADR-122: Versions crop around what the editor framed, and callouts stay on what they point at

**Date:** 2026-10-21. **Status:** accepted. Builds on
[[ADR-097 Checks and versions judge by the picture]] (the subject crop),
[[ADR-103 Checks see inside compounds, and versions refit cards, scrims and titles as the check judges them]],
[[ADR-108 set_param sets what a clip has, borders stay outside see-through pictures, versions keep a frame's pixels]],
[[ADR-116 New titles land on top, masks say where they end, wider versions keep the master's framing]],
[[ADR-118 A version's captions take its frame, pictures keep clear of them, and fades and push-ins are judged]] and
[[ADR-120 Callouts and overlays pinned to footage, and frame_region moves]] (anchors).

## Context

Claude film test 3 (a 70 s product explainer from 2560x1440 screen
recordings, `frame_region` push-ins onto the part of the interface that
mattered, rings and spotlights as callouts) asked `export_versions` for a
1:1 version and got one where every callout was broken (its report's item
4 and top fix 3):

1. **The crops followed detected subjects, not the regions the editor
   pushed into.** On the Letter rise shot the crop framed the city
   picture the saliency map found inside the push's region and cut out
   the card the push was for; the Split button fell outside the crop.
2. **Spotlight masks were not adapted.** A spotlight is a full-frame dim
   with an inverted mask; the dim spans the frame, so it kept its share
   of the new frame, and its mask kept the 16:9 frame's fractions: the
   hole sat elsewhere, at another size, while the ring moved.
3. **A frame-wide ring was shrunk with `transform.scale 0.57`** to fit the
   square frame while its `shape.width` keys stayed in frame fractions:
   the Undo state it glides to was drawn at 0.57 of the Undo button, its
   stroke thinned, and widths keyed by hand in the saved version came
   out 0.57 of what was asked until the scale was reset to 1.
4. **Callouts were moved by the title layout rules** (a ring is an
   overlay, kept at its share of the safe area) into empty interface,
   and the check sheet named only the two rings that touched captions.

Reproduced on the web build's MCP server with the tester's cut, color and
titles sections rebuilt from its calls (03-cut, 04-color and 05-titles,
the same regions, rings, spotlights and glides, shifted to start at 0,
plus a frame-wide ring around 03-cut's timeline gliding onto Undo, as its
09-ai-agent ring did) and the 1:1, 9:16 and 4:5 check sheets at every
callout's moment: on the old code the Split ring sat on empty timeline
with the button out of the crop, the Lift ring between the two wheels, the
Letter rise card was cropped out for the city picture, the 9:16 rings lay
in empty interface, and the only notes were caption overlaps and
"subject too wide" for the interface itself.

## Decision

### A version crops around what the editor chose (1)

For a full-frame shot a version crops (lib/reframe.ts `reframeShot`), what
decides the crop, where no `focus` does:

- **What the callouts over it point at** (`shotTargets`,
  lib/versionCallouts.ts): the union of their targets, read in the
  shot's own picture at every frame they show (source fractions, as
  frame_region and anchors take them). The frame is centered on them,
  inside what the master showed, at every frame where one starts, stops
  or glides, and at every frame the master's push moves (keys every half
  second, linear between, would leave a bare band mid-push against an
  eased zoom); between callouts it holds on the last, before the first it
  is already there, and it pans to the next over the 0.4 s before it
  draws on. Thinned to a pixel. The tester's Split ring and its glide to
  the trimmed edge come out as the pan it keyed by hand in the saved
  1:1 version.
- **Else the region the master frames** (`framesRegion`): at rest or at
  one of its position or scale keys the shot is zoomed 1.1 times past
  the scale that covers the frame, or moved off its middle by 2% of the
  picture. Its framing is kept, centered on that region (as `reframe:
  "center"` crops): frame_region's region is the editor's choice, and a
  screen recording's most salient part (a thumbnail, a picture in a
  panel) is rarely what the push was for. A slower drift is motion, not
  a region.
- **Else the subject**, as ADR-097: shots the master shows whole.

Where a callout or a region decides, the detector's subject is not
reported as cut (it would outline the interface as "subject too wide" and
invite a focus that breaks the callout); a subject the master's own push
cuts in a wider version is still named (ADR-118).

### Callouts stay on what they point at (2, 4)

`calloutsOf` finds them in the master, on the project's timeline:

- every clip pinned with an anchor (ADR-120: add_callout's ring and dim,
  a label pinned to a button) points into its anchor's clip;
- a ring (an outlined shape short of the frame's edges) or a spotlight
  (a layer over the whole frame with a closed mask) made by hand points
  into the video or picture under its middle for at least half of its
  time, or at a title showing with it whose letters it holds (most of
  them inside, and a fifth of the ring or more: the film's own caption
  ringed on "just like these");
- parts of a group with a title (an ad element) are that group's layout,
  a filled box with a title's middle on it is the title's panel, and a
  shape that reaches the frame's edges on an axis is part of the frame
  (ADR-103): none is a callout.

A version leaves callouts out of its overlay layout and writes them
again from the version's picture (`followCallouts`): at every frame of
the callout, what it points at in the master's picture is placed through
the same picture in the version (its position, and its size by how much
larger the version draws the picture), thinned to a quarter pixel: a
ring's position and `shape.width`/`shape.height`, a spotlight's mask x,
y, width and height in its own layer's fractions, keys where they move.
A ring around a title is placed around the title as the version sets
it, its margins scaled with the letters. Anchored clips are written by
ADR-120's `reanchor` on the reframed version, exactly. A ring keeps its
own scale and its stroke's pixels against the short side (ADR-108).

What is under the captions in a version: a callout crossing a burned
caption is still listed in `caption_overlaps`, but its note asks for the
captions to move ("it points at what is under it"), not for an override
that would move the ring off its button.

### A shape's size and the scale a version gives it agree (3)

Where a version still fits a shape by layout (a lone outline too wide for
the frame, a group's box, an override's `scale`), it scales the shape's
own box, its keys, its stroke and its feather by the same factor
(`shrink` through `scaleShape`), never a transform scale under size keys
that do not know about it. A solid's keyed mask is scaled with its static
size (the keys kept the master's fractions before).

### The check names a callout off the frame or off what it pointed at (4)

`calloutReports` measures every callout every sixth of a second it
shows: as the version draws it against where its target is there. Off
its target: its middle a quarter of its size (and 3 px) or more from it
(a ring moved by an override, a filled box the layout moved off the
button under it). Off the frame: a twentieth of its box or more outside.
One report a callout, at its worst moment, with what keeps it: a focus on
the shot centered on the target, fit "blur" or "fit" when the target is
wider than the frame (the timeline ring on 1:1 is 39% outside, 66% on
9:16), or the override that puts it back. `export_versions` answers them
in `callouts` (the check, each exported version and each saved project);
the sheet outlines one where it runs off the frame at that moment, with
an arrow on the edge it passes, or wherever it shows when off its target.

The sheet's time stamps move to a strip under each frame, as ADR-121 did
for the other contact sheets, and a caption overlap of a layer that moves
is outlined near its moment only (the gliding Split ring was outlined at
the trimmed edge while it was still on Split).

## Consequences

- On the rebuilt sections the 1:1, 9:16 and 4:5 versions keep the Split
  button, the trimmed edge (the crop pans with the glide), the Lift and
  Gamma wheels, the Letter rise card, Undo and an add_callout ring on the
  waterfall's edge in frame, each ring and hole on its target; the only
  callouts named are the frame-wide timeline ring and its dim.
- A shot pushed in or zoomed past 1.1x is cropped around its region in
  every version: a natural shot with a centered push and an off-center
  subject is now centered too, where ADR-097 followed the subject. Its
  push is the editor's framing; `focus` frames the subject instead.
- Saved versions carry more keys on callouts that glide while the crop
  pans (about one a frame for a 0.4 s glide), as anchors do.
- ponytail: callouts on the project's timeline over a video or picture
  (not inside compound clips, not over a floating window's footage);
  a turned callout or picture is placed by its center and size, its angle
  kept; the footage's anchor point, animations and wiggle are not
  followed; a filled box is only checked, not moved, since a panel or a
  mark may belong to the frame's layout; a ring around a title follows
  the title's place at its middle frame.
- Tests, each failing on the code before (11 of 13; the other two guard
  what stays): `src/lib/versionCallouts.test.ts` (the Letter rise region
  centered over a subject beside it; a shot shown whole still framed on
  its subject; the tester's Split ring and spotlight through the push and
  glide on 1:1, 9:16 and 4:5, the target in frame and ring and hole within
  a pixel of it at seven moments; what is found and what it points into;
  an add_callout ring on its button through reanchor; the frame-wide
  ring's Undo state at the button's size with scale 1, and named off the
  frame; a lone shape fitted by its own size, keys and stroke; a solid's
  keyed mask; a ring moved by an override named off its target; a
  highlight box named, a ring around a caption kept on it; a ring under
  captions asking them to move) and `src/lib/reframe.test.ts` (a centered
  push now frames its region, a 1.05 drift still the subject).
- Drives on the web build: export-versions, versions-subject,
  versions-stack, ad-versions, ad-spot, edited-structure, shapes,
  auto-reframe, callouts, canvas-tools, borders, export-shape and
  mcp-io-surface pass.
