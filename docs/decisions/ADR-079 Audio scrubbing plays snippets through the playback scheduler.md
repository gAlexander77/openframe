# ADR-079: Audio scrubbing plays snippets through the playback scheduler

**Date:** 2026-10-18. **Status:** accepted.

## Context

Dragging the playhead was silent. CapCut and Premiere play short pieces
of sound as the playhead moves (Premiere's "Play audio while scrubbing",
on by default), which is how an editor finds a word or a beat by ear.
Playback's sound is scheduled by `scheduleAudio` (engine/audio.ts): for
a timeline span it opens each sounding clip's decoder, streams decoded
chunks into buffer sources on the sample grid and builds the clip's
chain (EQ, compressor, filters, gain envelope, echo and reverb, pan). It
works for any span on a realtime context, and stops cleanly.

## Decision

- **A snippet is a 90 ms span of the timeline scheduled by
  `scheduleAudio`**, the same call playback makes, so it carries every
  clip's volume, fades, keyframes, effects and pan, compound clips
  included; no second mixer to keep in step.
- **Snippets follow one another and never pile up** (`ScrubGate`,
  lib/scrub.ts): one sounds while the latest place the playhead reached
  waits; as it ends the next starts at that place, one lead (60 ms, for
  the first decode) before, so a moving hand hears no gaps. A move under
  20 ms sounds nothing new. Each snippet has its own gain that fades in
  and out over 8 ms, so a cut through a waveform does not click, and
  feeds the master bus, so the meters show it.
- **Only while paused, only from the ruler drag.** A snippet is never
  scheduled while the timeline plays, and starting playback stops any
  that sound. The hover preview axis stays silent.
- **A preference**, Preferences > Playback > Audio scrubbing, on by
  default as in Premiere, per viewer with the other preferences.

## Consequences

- A snippet's first chunk may arrive after its lead on a cold decoder
  (the first touch of a file), so the first snippet of a drag can be cut
  short; the rest are warm.
- About eleven snippets a second while dragging, each decoding 90 ms of
  every clip sounding there: small next to playback.
- Drive: `audio-scrub` (snippets counted and heard on the master bus,
  the switch, no snippet while playing, no dropped frames after a scrub).
