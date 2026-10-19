# ADR-084: Voiceover is read at full precision and finished like a recording

**Date:** 2026-10-19. **Status:** accepted.

## Context

The owner's bar for the voice: very natural, ahead of extra features. The
app read with Kokoro-82M's 8-bit weights on a computer without WebGPU and
handed the model's output to the timeline nearly as it came: a third of a
second of digital silence trimmed off each end, every line at whatever
level the model made it, 0.4 s between every pair of lines, and the
model's own pauses, which are often a 60-100 ms dip at a sentence's end.
[[Natural voiceover 2026-10-19]] measured what it does against the traits
of a natural read.

## Decision

- **Full precision by default** (`quality: best`): fp32 on WebGPU, else
  fp32 on the CPU, else the 8-bit weights only when fp32 cannot load (and
  once more on the CPU if a GPU loads the model but fails to run it).
  Measured, fp32 on the CPU reads as fast as q8 (8.0 s against 9.0 s for
  a 3.5 s line), so the only cost is the download (325 MB against 92 MB,
  once). `quality: draft` keeps q8 for a quick pass. The inspector's Text
  to speech offers the same choice.
- **The natural finish** (`finish: natural`, the default;
  `lib/voiceTake.ts`), after the read:
  - pauses at commas (and colons, dashes) lengthened to at least 0.28 s
    and sentence ends inside a line to at least 0.55 s, by the same pause
    resizing the pause marks use (ADR-083), never shortened;
  - a line the voice rushed (over 5.5 syllables a second; the model
    rushes short lines) read once more slower, by at most a fifth, when no
    speed was given;
  - a 12 dB/octave low cut at 80 Hz and +2 dB around 3.5 kHz;
  - every line brought to -23 LUFS, its peak held under -1 dBFS;
  - pink room tone at -72 dBFS RMS under the whole take, so no pause is
    digital silence (ACX asks a floor under -60 dBFS);
  - raised-cosine fades (12 ms in, 30 ms out) at the edges and at every
    join, a 60 ms lead-in and 200 ms tail kept around the words;
  - on the clip: the Enhance voice compressor and a touch of room (a small
    room reverb, 0.35 s, 6% wet), both ordinary clip settings an agent or
    the user can change.

  `clean` keeps the one loudness and the fades, nothing added; `raw` is
  the model's read trimmed and faded. `enhance: false` drops the
  compressor in any finish.
- **A narrator's pace by default**: speed 0.95 (about 2.8 words a second
  over a script with the finish's pauses) and Heart, the voice its author
  grades A, as the default voice.
- **Voices are cast from a catalog**: `list_catalog` section `voices`
  describes the thirteen English voices graded C or better (accent,
  gender, grade, character with measured pitch, range and pace, what each
  suits), best first. Lower grades sound synthetic and are not offered.
- **Blends** (`"af_heart:60,af_bella:40"`) mix voices' style vectors in
  the speech worker, as Kokoro's own pipeline does; offered, not default,
  since nothing measured says a blend is more natural.

## Consequences

- Six lines that the old read left with digital silence in four, a
  sentence pause of 0.13 s and a line at 6.3 syllables a second now land
  inside every target the research sets ([[Natural voiceover 2026-10-19]]).
- A first voiceover on a computer without WebGPU downloads 325 MB instead
  of 92 MB, and every line takes several seconds on the CPU: a long script
  there can pass the desktop bridge's 300 s for one call (a ponytail noted
  in `state/tts.ts`).
- The finish is measured, not heard: its EQ, room and reverb are small,
  documented and each can be turned off.
- The gaps between lines stay the timeline's own silence; a continuous
  room-tone bed would close them.
