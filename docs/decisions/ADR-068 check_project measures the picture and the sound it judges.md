# ADR-068: check_project measures the picture and the sound it judges

**Date:** 2026-10-18. **Status:** accepted.

## Context

`check_project` (`lib/designCheck.ts`, [[ADR-055 The MCP guide is generated from the tools]])
judged from the document alone. On the launch film
([[Launch film through MCP 2026-10-18]]) three of its guesses were wrong:

- **Contrast.** It gave 22 contrast tips for white type on a near-black
  ground. The ground held soft glow sprites, which are image clips, so
  every title counted as "over footage" with no outline.
- **The music's end.** "Music ends abruptly" fired on a track that fades
  out in its own audio. The rule only knew about `set_fades`.
- **Shots.** The summary said 1 shot of 56 s. The main track held the
  background, and the cuts were on an overlay track.

## Decision

- **The app measures, the check judges.** Before `checkProject` runs,
  `automation.ts` measures what needs rendering or decoding and passes the
  numbers in (`Measured`). `lib/contrast.ts` turns pixels and samples into
  those numbers, so they are tested.
- **Contrast against the rendered picture.** For each title without an
  outline, shadow or box (`contrastTargets`, at most 40, earliest first):
  - The frame at the title's middle is rendered as export draws it, with
    every title off, 640 pixels wide.
  - The WCAG 2.x contrast of the title's color with the pixels behind its
    letters is measured. A gradient is judged by its worse end. A
    translucent color, with the clip's opacity, is mixed with the backdrop
    first.
  - The backdrop is the 90th-percentile pixel toward the type's own
    lightness, so a bright half decides it and a few sparks do not.
  - Under 3:1 is a warning; under 4.5:1 a tip. Each finding states the
    ratio, the backdrop color and the time. A measured title is never also
    a guessed one; an unmeasured one keeps the old rule.
- **The music's end, measured.** A long audio clip that ends with the
  video and has no fade of its own (`set_fades`, or volume keys bringing
  the end 18 dB down) has the last four seconds of its source decoded.
  - It ends by itself when its last quarter second is under -50 dBFS, or
    18 dB or more under the three seconds before.
  - Otherwise the finding names both levels.
- **Shots on the busiest picture track.** The shots are counted on the
  visual track with the most video, picture and compound clips (the main
  track on a tie): `shots` and `shots_on` in the summary. An epic edit's
  cuts on the beat are checked on that track too.

## Consequences

- `check_project` takes a moment longer: one render of the frame behind
  each measured title, and a decode of each long music clip's last four
  seconds. A measurement that fails falls back to the guess and never
  fails the check.
- Titles with an outline, shadow or box are not measured. They carry their
  own contrast, and most captions are among them.
- A title's contrast is measured at one frame, its middle. A title over a
  moving shot that turns bright later is not seen; `preview_frames`
  still is. Text inside a compound clip is part of the compound's
  picture, so it is not measured.
- `scripts/drive/mcp-launch-film.js` measures white type on the film's
  dark ground with a dim picture in it as passing. White on a pink
  fractal photo measures 2.16:1. Of a 30 s song cut at 12 s and a tone
  that fades out in its own audio, only the song is named.
