# ADR-134: Track inserts and dynamics share one audio graph

**Date:** 2026-10-21. **Status:** accepted.

## Context
Track cleanup needs one detector across cuts; preview, export,
normalization and voice review must hear that same chain.
A gate can retain its hysteresis state indefinitely between thresholds;
a finite pre-roll cannot always reconstruct it at an export window.

## Decision

- Optional ordered `inserts` on audio tracks and sounding clips. Absent
  keeps the old graph. Tracks sum, then inserts, fader, pan and master.
  Nested tracks sum through their own inserts before their compound bus;
  each compound instance owns separate nodes. Clip inserts precede its
  fader/fades, after the legacy chain (including echo/reverb when present).
- One `insertChain` builds live and offline graphs. Native biquads (eight
  parametric bands), compressor, echo and reverb; one bundled worklet
  imports tested pure dynamics math directly, with stereo-linked detection.
- Gate: peak envelope, 3 dB hysteresis, hold, expansion and bounded range.
  De-esser: unity band-pass split (default 5?9 kHz), a fixed -36 dBFS
  detector threshold and 4:1 compression, capped by amount; subtract only
  the reduced band, preserving lows. A worklet avoids native compressor
  makeup/lookahead changing the recombined band's phase and level.
- Limiter: sliding peak maximum, instantaneous attack and exponential
  release, with 5 ms lookahead. Ceiling is sample-level, before later
  inserts/faders; it does not replace export's oversampled master limiter.
- Stateful inserts replay from timeline start for each offline window,
  preserving hysteresis and delay history. Copies get fresh insert ids;
  split processing compares settings rather than ids. Commands validate
  and clamp every field, and edits use the metadata undo path.

## Consequences
No dependency or schema migration. Limiter latency is 5 ms per instance;
the legacy compressor adds an uncompensated 6 ms. Long exports with stateful
inserts cost repeated decoding and growing offline buffers; worklet state
checkpoints are the documented upgrade. Desktop/worklet and browser drives
must be run on a machine that permits browser launch.

The 2026-10-22 drive review found that forcing a stereo worklet output
duplicated mono before its panner, raising centered mono by 3 dB even
outside the de-esser's band. Dynamics now follow their input's channel
count (capped at stereo) in both preview and offline rendering; the
band-replacement math was already correct. The drive's high-tone NaNs
came from fractional sample indices (`2.7 * 48000` is not an integer),
not a short WAV: energy windows now round to samples and reject missing
audio, and the drive records imported, placed and rendered tone lengths.
