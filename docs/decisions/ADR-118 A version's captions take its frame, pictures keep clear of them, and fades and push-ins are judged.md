# ADR-118: A version's captions take its frame, pictures keep clear of them, and fades and push-ins are judged

**Date:** 2026-10-21. **Status:** accepted. Builds on
[[ADR-097 Checks and versions judge by the picture]],
[[ADR-103 Checks see inside compounds, and versions refit cards, scrims and titles as the check judges them]],
[[ADR-108 set_param sets what a clip has, borders stay outside see-through pictures, versions keep a frame's pixels]]
and [[ADR-116 New titles land on top, masks say where they end, wider versions keep the master's framing]].

## Context

Two Claude Code test films and the agents that fixed them left four
version and check items open. Each was reproduced on the web build's MCP
server with a rebuilt 9:16 short like Claude film test 2 (a launch shot
pushed in with frame_region, the station darkened under a round porthole
picture-in-picture with a ring and a shadow, the tester's word captions:
Arial Black 60, upper case, a countdown at 120, at y 0.08) and its 16:9
and 1:1 versions, looking at every check sheet and frame:

1. **Captions kept their phone size in a wider version.** Every size in a
   version keeps its pixels against the frame's short side (ADR-097,
   ADR-103, ADR-108). On 9:16 the captions were about a tenth of the
   phone's width (60 is 107 px of 1080); on 16:9 that is a tenth of the
   frame's height, two lines a fifth of the picture, and they read large
   for a website (the film's self-review). Worse, a caption was placed as
   an overlay of its own: each kept its share of the safe area, so on
   16:9 and 1:1 the countdown sat in the middle of the frame and the
   other captions near the bottom, at different heights.
2. **Wide versions left overlays across their burned captions.**
   ADR-116 named the porthole under the 16:9 captions, with the override
   that clears it, and left it there.
3. **A title's fade was never measured.** Contrast is measured once a
   title's in-animation has played and before its out (ADR-097); the
   film's "LA_T NOTE" lost its S over the rocket's white nose during a
   0.2 s fade.
4. **A subject the master's own push-in cuts was not named in a
   version.** The subject check looked for the subject only inside what
   the master showed, so the 16:9 launch, its nose cut by the 9:16 push,
   drew no outline.

## Decision

### Captions take the version's frame (1)

- **Where.** A version that is not tall (16:9, 1:1) of a tall master
  places the captions itself, as tall versions of wide masters do
  (ADR-091): a tall master's captions sit under the middle only to clear
  the apps' buttons, so they move to where captions sit on the new frame,
  centered at y 0.36 (add_captions' place), all at one height, wrapping
  at the captions' width (0.84) and kept inside the title-safe area
  (`captionPlace`, `placeOpenCaption`). A landscape version of a square
  master keeps their place and takes the size below.
- **How large.** One factor for all of them (`captionScale`), so a
  caption made larger on purpose (a countdown) stays as much larger: their
  pixels against the short side, as a title's, and on a landscape frame
  brought down until the typical caption (the median) is no larger than
  the largest caption look there (`captionMax`: 72, Word pop and Bold
  yellow, 6.7% of the height; broadcast subtitles are 4.6-5.6%). On a
  square, seen at a phone's width in a feed as the short is, they keep
  their size. Never under the frame's readable size (`minTextSize`), and a
  word too wide for the safe width (the countdown's LIFTOFF. on a square)
  shrinks to it, measured as check_project measures it.
- **Titles keep the short side.** The design rules size headlines alike
  against the short side on both shapes (9:16 size 50-90, 16:9 90-160,
  8-15% of the short side), and a title is placed in the version's safe
  area as before. Captions differ: a short's pop captions are a phone
  idiom, a landscape cut's captions are subtitles.
- **Overlays keep above the captions the version placed**, as tall
  versions keep them (the room above the highest caption showing).

On the rebuilt short the 16:9 captions are 72 (the countdown 144) at the
bottom, the 1:1 ones 107 at the bottom; check_project finds nothing in
the layout of either (the master's own countdown runs past its safe
column, and the 1:1 version now fits it).

What the editors do: Premiere's Auto Reframe resizes caption text with
the frame, and its users report captions changing size and line count
between shapes; Adobe's advice is a caption stream per shape, set by
characters a line ([Adobe community, 2022](https://community.adobe.com/t5/premiere-pro-discussions/captions-workflow-between-aspect-rations/m-p/12796192)).
Pinned graphics move with the frame's edges ([Larry Jordan](https://larryjordan.com/?p=121758)).
CapCut documents no caption behavior for a ratio change. So the version
restyles its captions for the shape, keeping their look.

### A picture-in-picture keeps clear of the captions (2)

A version moves a picture-in-picture (a video, a picture that is not a
sticker, or a floating window: a compound clip playing footage and no
titles), alone (not part of a group or a layout's cut cell), that crosses
a burned caption's letters in its shape where the master kept it clear,
by the override the collision names (up, smaller when it would leave the
frame), up to three times for a later, taller caption (`clearCaptions`).
The master's own crossing is its design and stays; a touch under a
quarter of the letters' height is not a crossing (the film's porthole
grazed its caption's outline by 7 px). The version's overrides are the
last word: a clip they place is only named. Designed layouts (a group, a
card, a shape, a split screen's cell) keep their places and are named.
`caption_overlaps` lists a moved one with `done` (where it went, and how
to place it otherwise), the check sheet labels it "moved clear of the
captions". The 16:9 porthole now sits above "HOW'S THE" whole.

### A fade is judged for evenness (3)

check_project renders the middle of each fade a title has (an in or out
animation of the whole title from or to no opacity: fade, pop, zoom,
rise; at most 16 such frames a check, the earliest titles first,
`fadeMoments`) and asks whether it fades as one (`unevenFade`). Every
title passes through 1:1 as it fades, so a fade is not held to 4.5:1. What
reads as a fault is a part gone while the rest is still seen: stepping the
opacity down, while the median backdrop pixel is still seen (1.6:1), a
tenth of it gone (under 1.35:1). The thresholds are the film's: at a
quarter of its opacity the S over the white nose measured 1.3:1 and
vanished, the rest over the sky 1.6:1 and showed.

How far apart the two parts are is set by the look and the backdrop, not
by the fade (each loses about the same share of its contrast as it
fades): yellow on a 55% box measures 3.95:1 over the nose and 7.5:1 over
the sky at rest, 1.32:1 and 1.63:1 at a quarter. A solid box or outline
fades as one (3.3:1 against 4.4:1 at half). Measuring the fade's own
frame still matters: the backdrop under a fade can differ from the rest
moments (a subject moving under it, the next shot under a fade-out across
a cut). The finding (`title_fades_unevenly`, a tip) names the opacity,
both ratios and the backdrop, and the box or outline that fades as one on
the same pixels; a title already under 3:1 at rest is named for that
alone. On a label over the launch's flame the check names it at 30% of
its opacity (1.32:1 against 1.62:1), and the frames show its letters over
the flame gone first; with an opaque box nothing is named and it fades
whole.

### A push-in's cut subject is named (4)

In a version whose frame shows more of a shot than the master did on one
axis (16:9 or 1:1 of a 9:16 push-in), a keyed push that crops the subject
on the other axis is named (`pushCut`): the subject is found in the whole
picture, must be the master's (half of it in what the master showed), and
is grown along a thin part running on from it (`withSpine`: rows above
and below while the strongest salience across the subject's box is a
tenth of the peak and twice the row's median; the launch's strongest blob
is its flame, its nose a faint streak above). It is named when the frame
leaves out 2% of the picture or more of it that way, and a twentieth of
it, where the shot at its widest would leave out at most half that. The
note says the master's push crops it and that pushes relax or hold shows
it; the sheet labels it "push cuts subject". The rocket is named at 89%
on 16:9 and 88% on 1:1.

## Consequences

- A tall short's 16:9 and 1:1 versions put their captions at the bottom,
  and on 16:9 at subtitle size; an agent wanting the old look moves them
  with the version's overrides or set_caption_look in a saved version.
- Overlays in those versions sit above the captions; a lone
  picture-in-picture may move up or shrink a little in a version, and the
  answer says so.
- check_project renders up to 16 more frames for fading titles.
- ponytail: the thresholds of an uneven fade are the film's one
  measurement; a shot's spine grows only along the axis the master's crop
  decides, and only from a keyed push; a picture-in-picture is told from a
  layout's cell by its crop.
- Tests, each failing on the old code: `versions.captions.test.ts`
  (captions on 16:9 and 1:1, the porthole moved, a group and the master's
  own crossing left), `reframe.test.ts` (the push-cut nose, gone when
  held), `contrast.test.ts` (uneven and even fades),
  `designCheck.test.ts` (fade moments and the finding). The drives
  export-versions, versions-subject, versions-stack, ad-versions, ad-spot,
  edited-structure, check-measured, check-panel, check-text-box,
  title-wrap, caption-looks, one-word-captions, karaoke and mcp-io-surface
  pass on the web build.
