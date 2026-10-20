# ADR-100: A compound clip's sound is a bus, and a bed keeps its balance in every take

**Date:** 2026-10-20. **Status:** accepted.

## Context

The sound added for the documentary test ([[ADR-098 Sound is mixed by role, beds are synthesized, an agent can listen]])
was checked through the MCP tools as a model sees them: every ambience
bed over eight seeds and lengths from 3 to 300 s, `check_project`'s sound
findings, `add_sound_effect`, `preview_audio` per stem and
`duck_under_speech` with `min_line_lu`. What was found:

- **A city bed went silent.** Each layer of a bed was levelled against
  the first by its RMS in the take's own first 20 s. City seed 3 had no
  car in them, so its cars' gain was 1e9; the whole was then held under
  its peak, and the street's hum sat at -158 LU for 23 s, then a car.
  Short city takes (seeds 2 and 3 at 12 s) had no car at all.
- **Wind lulled for seconds.** Gust targets drawn at random from 0.2 of
  full strength ran two or three lulls together: the bed 10 dB or more
  under its average for up to 7 s, its quietest second 17.5 dB down (24 s
  takes, ten seeds). Surf's same fault had been fixed alone.
- **A rocket missed its loudness.** Its crackle's rare shock peaks set
  the gain: the whole bed was turned down to hold them under -1 dBFS, and
  takes of 30 to 300 s came out 1.3 to 2.5 LU under their -21 LUFS.
- **A sound cut off mid-video was not found.** `check_project` judged
  only long audio clips that end with the video. Music trimmed to end at
  12 s of a 20 s video, and a voice line cut 2.5 s into its 6.4 s, both
  without fades, passed.
- **A compound clip could not be compressed, and its EQ was not heard.**
  `set_compressor` refused compound clips (the roadmap's "a compressor on
  compound clips"). The inspector showed a compound clip's Equalizer and
  `set_param eq.low` stored it, but the mixer applied the inner clips' EQ
  only: a -12 dB low shelf on a compound changed nothing measured.
- **Every compressor dropped out at each export window.** Export,
  `preview_audio`, `measure_loudness` and `duck_under_speech` render the
  mix in 10 s OfflineAudioContext windows. A DynamicsCompressorNode
  starts cold in each: its 6 ms lookahead is empty, so 288 samples of a
  compressed clip (add_voiceover's voices have one by default) were
  silence at every window, and its gain was out of step for a second.
- **The mix's stems left the picture out.** `preview_audio`'s mix answer
  listed dialog, music, effects and ambience; the video tracks' own
  sound (an interview's voice) is in the mix but was in no stem.

What passed: several sounds in one `add_sound_effect` call land on SFX
tracks only, overlapping ones on more SFX lanes, never on the voice or
the music, one undo removing all of them and their tracks; a project
with no SFX track gets one. Each `solo` returns the tracks of its role,
and the MP3 measures as the text says (ffmpeg's ebur128 within 0.5 LU);
the stems' and the picture's power over a stretch sums to the mix's
within 0.1 dB. `duck_under_speech min_line_lu 10` held four lines at
three levels (one 9 dB down) at 10.3 to 10.4 LU, measured on each line's
window. B-roll on an overlay track counts in the shots (7 across tracks
for three inserts over one interview) and in `cuts_off_beat`.

## Decision

### 1. A compound clip with an EQ or a compressor is a bus

Its clips' sound (each through its own chain and pan) is summed, then
the compound clip's EQ, its compressor, then its volume and fades: the
order a clip's own chain has, so a fade-out after the compressor is not
undone by it. `lib/audio.ts` says where each clip's sound goes
(`soundBuses`): the compound clips it plays through that are buses,
innermost first, each keyed by its path from the outer timeline (one
compound played twice is two buses), each applying the gains of the
compound clips from itself out to the next bus; the clip's own envelope
keeps only those under the first bus. `engine/audio.ts` builds each bus
once per schedule, before any wait, so preview, export and every
measurement hear the same thing. Without an EQ or compressor nothing
changes: the compound clip's gain stays in each clip's envelope.

`set_compressor` takes compound clips, the inspector's Compressor
section shows for them, `describe_project` names the preset. Measured on
a voice over a song nested in one compound: the strong preset brought
the seconds' loudness from 7.9 to 0.7 LU apart and the true peak down
3.9 dB; the EQ's -12 dB low shelf moved the low share from 0.52 to 0.45;
a 3 s fade-out still fell 14 LU.

### 2. A render starts a second early for a compressor

`mixPreroll` takes, for a clip with a compressor or one playing through
a compound clip with one, `COMPRESSOR_SETTLE` (1 s: a release is at most
1 s). The window then joins as if rendered in one go: no zero samples,
no level step (measured identical sample for sample over the first
second). It costs a tenth more render time, only where a compressor is.

### 3. A bed's layers are balanced by their level in the long run

Each layer is set against the first by its RMS over 60 s of a reference
take (its own seed, the same for every take of that bed), measured once
per bed and rate and kept. A take's balance no longer depends on what
its first seconds happen to hold. The bed is then brought to its
loudness and its rare peaks over -1 dBFS held by export's limiter
(`limiterGains`), run over three turns of the file and the middle one
kept, so its gain runs on from the last sample into the first. Cars
start within 1.5 s of the head as waves do. Wind keeps 0.3 of its
strongest gust in a lull (it was 0.2), and a gust target under 0.3 is
followed by one over it (`Drift`'s `lift`), so lulls never run together.

Measured after, 8 seeds at 3, 6, 12 and 30 s and 3 at 60 and 300 s:
every bed at its loudness within 0.1 LU; no silent stretch; city's
quietest 400 ms 7.4 LU under its average at worst, every 12 s take with
a car; wind 10 dB under its average for at most 2.7 s at a time (it was
7 s) and its quietest second 13.3 dB down, still moving 3.2 to 5.1 dB
(the std of its 400 ms loudness on 24 s takes); the loop's join within
each bed's 99th-percentile step in level and tilt, as before.

### 4. A sound cut off before the end is a warning

`tailTargets` also takes an audio clip that ends before the video, with
no fade, whose file sounds on past the cut and that nothing on its track
carries on from (the next clip of a song is an edit, not a cut-off). Its
last second is measured as the end's music is; one still sounding is
`sound_cut_off`, a warning (the picture goes on while it stops dead),
with set_fades or a trim to a pause as the fix. Unmeasured, only a clip
over 5 s is suspect, as before.

### 5. The picture is a stem in preview_audio's mix

`stems.picture` is what the video tracks play, where any sounds: their
footage's own sound, and a compound clip's mix (its inner tracks are in
no stem). Each stem's figure is its own integrated loudness where it
sounds (gated), so the stems do not add up to `integrated_lufs`; the
tool says so.

## Consequences

- A bed made after this differs from the same seed before it (its
  layers' balance, and city and wind in their events). Files already in
  a project keep playing as they were.
- The first bed of each kind in a session spends about a 60 s render of
  its layers on the reference; the worker keeps it.
- ponytail: a compound clip's Channels row (fill) is still ignored on
  compound clips; pan and volume act as before.
- ponytail: picture-in-picture inserts on an overlay still count as
  shots when they are the busiest track (ADR-097's designed film); a
  framed vertical clip counts only if it covers 60% of the frame.
- `scripts/drive/compound-compressor.js` holds sections 1, 2 and 5 in
  the running web build; `ambience.test.ts`, `designCheck.test.ts`,
  `audio.test.ts` and `compound.test.ts` hold the rest.
