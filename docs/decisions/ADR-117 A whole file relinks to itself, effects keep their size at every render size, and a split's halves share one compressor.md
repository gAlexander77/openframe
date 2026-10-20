# ADR-117: A whole file relinks to itself, effects keep their size at every render size, and a split's halves share one compressor

**Date:** 2026-10-20. **Status:** accepted. Closes items left open by
[[ADR-112 An MP3 plays without its encoder delay, as ffmpeg plays it]] (relinking),
[[ADR-110 Outlines take their color, solids their alpha, borders blur with their picture, and a shot's pieces carry their titles]] (the RGB split's offset; glow, denoise and sketch in versions) and
[[ADR-107 A split plays on, a cut keeps its downbeat, and a duck follows its music]] (a compressor across a split).
Agrees with the sound-length rule of
[[ADR-113 A freeze fills the pause it was given, a run of lines follows its pictures, and a cut rolls in one call]].

## Context

Four engine and media items earlier rounds recorded as open. Each was
reproduced in unit tests and in the running web build (drives through
`window.videoEditor.mcp`, stills rendered as export draws them, the mix
rendered as export renders it), and every image was looked at.

1. **Relinking a clip to its own file was refused.** A sound's clip runs
   to the frame its last sample plays in (ADR-113), a picture's to the
   nearer frame (`clipForAsset`), so a clip of a whole file reads up to a
   frame past its end: `speech-test.wav` (6.435 s) is 194 frames, 6.467 s;
   a 30.024 s file (the MP3 fixture before ADR-112) 901, 30.033 s. Relink
   measured the clips to their end (`sourceRange`) and answered
   `relink_media` on the same file "The replacement must be at least 6.467
   seconds long to cover the clips that use it". Found on the way, from
   the same rounding: `slip_clip` on such a clip, either way, moved its
   in-point to -0.032 s (the room past its end was negative, and the slip
   took it as the move).
2. **The RGB split's offset was a number of render pixels.** Its shader
   divided by the render's width / 1920, so the split was 0.768 render
   pixels per unit of amount at any size: a white box split 30 measured
   0.0120 of the width in a 1080p still, 0.0269 at 480p and 0.0328 in the
   viewer (702 x 395), 2.7 times the export's. Looking at every effect's
   and transition's pixel numbers (`EFFECT_SHADERS`, the transition
   shader) found two more of the same: **VHS's scan lines** ran one every
   4.2 render pixels (a 480p still drew 115 lines to the 1080p export's
   258, the viewer 94, each that much thicker against the picture), and
   the **pixelate transition's** blocks reached 60 render pixels (32
   blocks across the frame at 1080p, 14 at 480p, 11 in the viewer). The
   rest are right:
   blur, pixelate, grain, motion blur, halftone, glow, denoise and sketch
   scale by `u_scale` (render height / 1080); zoom blur, glitch, the VHS
   jitter, shake, zoom pulse, zoom, fisheye, kaleidoscope, mirror,
   magnify, scanlines, letterbox and light leak are shares of the frame;
   invert, posterize, duotone and flash act on each pixel's color; and the
   one-pixel edge smoothing of letterbox, magnify and halftone is
   anti-aliasing, which belongs to render pixels.
3. **Glow, denoise and sketch had a fixed reach** (18, 4.5 and 1 px at
   1080p) in the shader, with no parameter `export_versions` could scale
   (ADR-110), so on a 9:16 version a picture-in-picture's glow reached
   1.78 times as far against the picture as on the master.
4. **A compressor on a split's second half started with no gain
   reduction.** Each half had its own EQ and compressor. Rendered against
   the unsplit clip: a song (`music-stereo.m4a`, strong preset) split at
   3 s came within 14.8 dB of the signal for 12 ms after the cut; a voice
   (`speech-test.wav`, voice preset, EQ low +6, high -6) within 20.7 dB
   for 14 ms (ADR-107 measured 24-40 dB with gentler settings).

## Decision

### A file covers a clip when the clip's last frame starts inside it

`relinkAsset` measures each clip that uses the file to where its last
frame starts in the source (`lastRead`: a reversed clip's first frame,
which reads the highest; at its speed or ramp), and takes a replacement
that runs past that. It is the rule the clips are made by: `clipForAsset`
gives a sound the frame its last sample plays in and a picture the nearer
frame, so every clip made from a file starts its last frame inside it, and
relinking a file to itself always works. A file that ends before a clip's
last frame starts is refused ("must be longer than 30.000 seconds to cover
the clips"). The whole-file check against the original's length
(`relinkProblem`, source handles) is unchanged.

Rejected: making a clip no longer than its file. It would cut a sound's
tail again (ADR-113: the 0.25 s shutter was 0.233 s). Rejected: a flat
tolerance of a frame: a clip at 2x reads two frames of source a frame,
and a reversed clip reads from its in-point down; the last frame's start
is right for each.

`slipBySource` gives no room past a file's end that is negative: a
whole-file sound slips 0 s and says "the source ends there".

### Pixel sizes are pixels at 1080p, in every pass

- **RGB split**: 0.768 px at 1080p per unit of amount (`u_scale`), the
  same across and up: the white box measures 0.0120 of the width at
  1080p, 0.0117 at 480p and 0.0121 in the viewer. A 1920 x 1080 export
  of a horizontal split (angle 0 or 180, the beat hits' angle) is
  unchanged to the bit. Two looks change on purpose: a split's upward
  part on 16:9 grows to the across part's pixels (at 90 degrees, 0.432 to
  0.768 px per unit: the shader offset by the same share of the width and
  of the height, so the angle was not the angle drawn), and a vertical
  project's export draws it 1.78 times larger, as every pixel size on a
  1920-tall frame (what its small viewer showed before was larger still).
  The catalog marks the amount `pixels`, so versions scale it.
- **VHS**: a line every 4.2 px at 1080p (258 to the frame's height).
  Under 4 render pixels a line the lines are averaged over each pixel
  (a sinc of the pixel's share of the period, normalized to 1 at 1080p),
  as the export scaled down by area shows them: against the 1080p still
  scaled down, the 480p still's rows moved from 7.9 levels off to 1.2 and
  the viewer's from 7.5 to 1.1. At 1080p the formula is the old one, bit
  for bit; a 4K export draws 258 lines, not 516.
- **Pixelate transition**: blocks up to 60 px at 1080p: 32 across at
  1080p, 480p and in the viewer.

### Glow, denoise and sketch take their reach

`glow.radius` (18 px at 1080p, 2-48), `denoise.radius` (4.5, 1-12) and
`sketch.width` (the edge filter's step, 1, 0.5-6) are parameters marked
`pixels`, so `export_versions` scales them with the picture as it does a
blur (a picture-in-picture's 18 px glow is 10.125 on 9:16) and a person
can set them. The shaders keep their taps (7 x 7 a third of the radius
apart; the same 3 x 3 Sobel), so they cost what they did. A stored effect
saved without the parameter loads with its default (`normalizeProject`
fills each effect's missing parameters from the catalog), and the renderer
draws any parameter an effect lacks at its default (`resolveEffects`):
before, a missing uniform kept whatever the last draw of that effect gave
it, and an ad's logo glow is made with only its amount and threshold. At
1080p a glow, a denoise and a sketch draw bit-identical to before (frame
hashes), and the glow's reach measured 0.0167 of the height at 1080p,
0.0180 at 480p and 0.0189 in the viewer, 0.0333 at radius 36.

### A split's halves run through one EQ and compressor

`sharedChains` (lib/audio.ts) finds the runs: a clip that goes on with
the one before it (`continues`, ADR-107) with the same EQ and compressor
belongs to that clip's run. The mixer builds one EQ and compressor per run
and fans its output out to each half's own filters and gain; each half's
sources feed it. A half's gain closes at its end when another half
follows (the shared chain carries that half's sound from there, its 6 ms
lookahead tail included, at the level the click guard already moves to),
and every clip's gain is created at 0: a `GainNode` passes at 1 until its
first automation event, which, with a shared chain, let the second half
pass the first half's sound until 10 ms before its start (the drive saw it
doubled). Measured: the song's and the voice's splits now render identical
to the unsplit clip (error -150 dBFS, over 130 dB under the signal); halves with
different compressors stay two, and the second still starts fresh, as two
clips do. Played in the viewer across the cut, the master meter holds
-11.3 to -14.2 dBFS with no step. The halves' filters (sound design) stay
their own and are fed the run's sound throughout, so their state is
right at the cut too; a half's filters run while the other half plays.

## Consequences

- Every clip made from a file relinks to it; `relink_media` and the media
  manager accept a file at least as long as each clip's last frame's
  start. Whole-file sounds slip no further than their file.
- Effects look the same in the viewer, a still and the export at any
  size. 16:9 projects export as before but for an angled RGB split's
  upward part; vertical projects' RGB splits export larger.
- Glow, Reduce image noise and Sketch show a Radius or Line width slider;
  versions keep their look against the picture. Old projects gain the
  parameter at its old value on load.
- A split of a compressed or EQed sound is continuous in every render.
- Tests, each failing on the code before: `relink.test.ts` (a whole-file
  sound, a voice and a video relinked to themselves, reversed and at 2x,
  a file ending before the last frame refused; the slip),
  `effectStack.test.ts` (old glow, denoise and sketch loaded and drawn at
  their reach), `versions.effects.test.ts` (the four scaled on 9:16, kept
  on 1:1), `audio.chains.test.ts` (runs of two and three, an EQ alone,
  none for differing settings, a skip or nothing to share, inside a
  compound clip). Drives: `relink-whole-file` (relink_media and
  slip_clip), `effect-scale` (RGB split, VHS, pixelate transition and
  glow measured at 1080p, 480p and in the viewer) and `compressor-split`
  (the renders against the unsplit clip) fail on the code before and
  pass. `render-fingerprint` hashes the same before and after.

## Not done

- `roomRight` still lets a picture grow only to the frames it fills, so a
  whole video clip made a frame past its file (the nearer frame) cannot be
  trimmed and extended back to that frame; ADR-113 keeps it so.
- A split compound clip's halves are two buses, so a compound clip's
  compressor still starts fresh at a split of the compound clip
  (`continues` is for video and audio clips).
- Film grain's cells cannot be smaller than one render pixel, so a small
  viewer draws grain coarser than the export.
- An animation's blur (blurIn) rides on the blur effect, so it scales with
  the render, but versions do not scale it (it is not a stored number),
  as ADR-110 says.
- At its largest radius (48 px) a glow's taps are 16 px apart and a small
  highlight glows as a grid of copies; a pyramid like the big blur's
  (ADR-069) would be the upgrade if glows that wide are wanted.
