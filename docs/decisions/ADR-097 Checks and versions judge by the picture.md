# ADR-097: Checks and versions judge by the picture

**Date:** 2026-10-19. **Status:** accepted.

## Context

An agent made a 72-second documentary through MCP alone (Codex's film
test, 2026-10-19) and listed what the tools got wrong. The parts this ADR
answers:

- **Contrast was never measured.** The `check_project` help said contrast
  is measured on the rendered frame, but every answer said "Contrast was
  not measured on the picture". [[ADR-068 check_project measures the picture and the sound it judges]]
  measured only titles without an outline, shadow or box, at their middle
  frame. Every one of the film's titles had a soft shadow (`blur` 16 on
  size 40 type), so none was measured, and the answer still read as if
  nothing was. The landscape check found nothing wrong with pale titles
  over a bright horizon.
- **`ok: true` beside a warning read as a pass.** The portrait check
  answered `ok: true` with a warning about the top app area.
- **Subtitles at 3.7% of the frame's height passed.** The film's
  subtitles ("A WAY HOME") were size 40 on 1080p, exactly the old floor
  (`minTextSize`, 40 on a 1080 short side), and did not read on a phone.
- **Two of the launch film's leftovers** (LIMITS #11). Music that fades
  out over its last second in its own audio was still called abrupt: the
  rule compared the last quarter second with the body, and a one-second
  linear fade's last quarter second is only 17 dB down. Shots were counted
  on the busiest track, which misses cuts that alternate between tracks
  (cutaways over an interview, A and B rolls).

## Decision

### Contrast is measured on every title, with its look

- **Every visible title is measured**, outlined, shadowed and boxed ones
  too (`contrastTargets`, the first 40 titles, then up to 12 captions
  spread over the video).
- **At a few moments of its life** (`titleMoments`): once its
  in-animation has played, its middle and before its out-animation, plus
  the quarters of a title on screen over six seconds. The frames are
  rendered as export draws them with every title off, 640 pixels wide,
  eight at a time.
- **With what the title draws around its letters** (`titleLook`,
  `letterContrast`): the box, the glow, the shadow and the outlines are
  mixed over each backdrop pixel, bottom up as the rasterizer draws them,
  by how much of the letters' edge each covers:
  - A box covers all of it.
  - An outline covers it fully from 4% of the type size (broadcast
    subtitles draw 2-3 px around 50-60 px type), in proportion below that.
  - A shadow or glow is a Gaussian-blurred copy of the strokes (canvas
    `shadowBlur` is twice its sigma), cast by the outermost part, its
    stems about a ninth of the type size (a seventh for bold), offset as
    styled; it covers what that blur leaves just past the edge.
  - The clip's opacity fades the letters and their surround alike.
- **The ratio is the 10th percentile over the backdrop pixels**: most of
  the letters have at least this contrast, and a few stray pixels do not
  decide it. The lowest moment is reported with its time and backdrop.
- **Each low title names fixes measured on the same pixels**: a dark box
  behind light type (a light box behind dark type) and a solid outline,
  with the ratio each reaches there.
- **The answer shows the evidence**: `contrast.lowest` lists every
  measured title's ratio and time, lowest first. `not_checked` says why
  contrast was not measured, when it was not (the picture could not be
  rendered, with the error; titles past the cap; titles inside compound
  clips), and the old guess (unguarded titles over footage are tips)
  applies only then.

Measured on a bright sky, Codex's subtitle look reads 1.26:1, its soft
shadow adding almost nothing; a box measures 6.7:1 and a 2 px outline
14:1. The rendered frames agree: the subtitle is nearly invisible.

### What `ok` means is said in words

`ok` is true when there are no errors (black on the main track, flashes
that can trigger seizures). A new `verdict` says it with the counts: "ok
means no errors; 2 warnings still to fix before delivering". The summary
counts tips too.

### Small text is judged by its share of the frame

- **The floor is a share of the frame's short side**: a phone shows every
  shape at its width (a tall frame held upright, a wide one turned or in a
  feed), about 6.5 cm. Letters at 4.5% of it are about 2.9 mm, a phone's
  body text; social video (a tall frame, or `kind: social_short`) is read
  in passing over the apps' buttons, so 5%.
- **In style sizes**: 49 on 16:9 and 1:1, 43 on 4:5, 31 on 9:16, 54 for a
  16:9 social short. As a share of the frame's height: 4.5% on 16:9,
  2.8% on 9:16. The old floor was 40, 40, 32 and 22.5.
- **The finding names it that way**: the title's share of the frame's
  height, the minimum as a share and a size, and the size to set. Small
  captions are named once, with how many.
- **Everything that makes type keeps to the same floor** (`minTextSize`):
  ad elements, the brand roles (`roleStyle`: body and label were 42 and 40
  on 16:9) and versions shrinking a group, so the tools never make text
  their own check flags.

### The music's end is judged by its last second

`tailLevels` keeps the last second in quarters and the last tenth of a
second. A clip ends by itself when its very end is under -50 dBFS or 18 dB
under the body, or when its last second falls away: each quarter no louder
than the one before, the last 8 dB under the first and the very end 12 dB
under the body (a fade in the audio that the clip ends a little early).
A one-second linear fade passes; music cut on a quieter bar does not.
The finding prints the quarters.

### Shots are counted where the viewer sees them

`seenShots` follows the frontmost picture that fills most of the frame (a
video, picture or compound clip covering 60% of it, nearly opaque) across
every visible track, and each change is a cut. When that finds more shots
than the busiest track, it is used (`shots_on: "the picture, across
tracks"`), and an epic edit's cuts on the beat are checked there. A
designed film whose cuts are floating windows over a background still
counts on its busiest track.

## Consequences

- `check_project` renders more: three to five frames a title instead of
  one frame per unguarded title. Codex's film is 6 titles, about 20
  renders at 640 pixels.
- The look model is a model: a shadow's cover is estimated from the
  type's weight and the blur, not read from pixels. Rendering each title
  over its backdrop and comparing letters with their surround would
  measure it exactly, at three renders per moment.
  ponytail: the model, until a title's real look and the measure disagree.
- Text inside compound clips is part of the compound's picture and is not
  measured; the answer says so.
- Ads, roles and versions make bigger small type than before (body text
  49 on 16:9, 31 on 9:16), and old projects with size 40 subtitles get a
  warning they did not get.
- `scripts/drive/check-measured.js` checks it in the web build.
