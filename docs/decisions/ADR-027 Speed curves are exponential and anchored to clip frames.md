# ADR-027: Speed curves are exponential and anchored to clip frames

- **Date**: 2026-10-14 · **Status**: accepted

## Context

CapCut's Curve speed draws a clip's rate as a graph (0.1x–10x on a log axis)
with presets; Premiere's time remapping and Resolve's retime curve do the
same job ([[CapCut desktop]] §3.6, [[Professional NLE features]] §5.5). The
picture at a timeline frame must be exact (source = in + ∫ speed), and every
op that touches `in` or a clip's length — split, trims, roll, slip, slide,
freeze, extract audio, frame-rate change — must keep the frames that stay
on screen showing the same source. Reverse has the same requirement.

## Decision

- **`speedCurve: { preset?, points: [{ f, speed }] }`** on video and audio
  clips; `f` is a frame relative to the clip's start, **like keyframes**,
  fractional allowed. `speed` stays as the constant rate when no curve is set,
  so old files are unchanged.
- **Exponential between points** (a straight line on the log axis), so the
  graph shows exactly what plays. Area and inverse are closed forms
  (`expm1`/`log1p`, `src/lib/speed.ts`), and a piece cut out of a segment is
  again exponential, so splits and trims are exact, not resampled.
- Points **stay where they are when a clip is trimmed** (even outside it), so
  a left-edge move only shifts them and `in`, and an end trim touches
  nothing. Every op that already handled keyframes handles curves the same
  way; untrimming brings the ramp back, as in Premiere.
- **Applying a curve keeps the source range**: length = span / mean speed,
  as CapCut does, and later clips ripple. Commands and the graph editor speak
  in normalized `t` (0..1) and convert.
- **`reverse: true`** reads downward from `in`, which is *where playback
  begins* (the top of the range). Frame r shows the frame covering
  `in − off(r+1)`, the mirror of forward. Because `in` is the start in both
  directions, left-edge moves are `in += dir · off(d)` and end trims never
  change `in`. Toggling reverse swaps `in` to the other end of the range.
- Slip moves the source window by the clip's mean rate; `setFps` scales
  curve points without rounding, so a ramp keeps its shape in seconds.

## Consequences

The rejected alternative, points normalized to the clip (0..1), would make
every change of length re-window the curve — a dozen call sites, each a
chance to distort a ramp. Points at fractional frames are unusual for this
codebase but are curve shape, not frame events. Smooth slow motion (frame
blending, optical flow) is not part of this: slow frames repeat, as
Premiere's Frame Sampling does.
