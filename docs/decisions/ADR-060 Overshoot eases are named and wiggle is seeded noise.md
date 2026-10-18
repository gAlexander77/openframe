# ADR-060: Overshoot eases are named, and wiggle is seeded noise

**Date:** 2026-10-18. **Status:** accepted.

## Context

Pops, landings and "epic" title moves overshoot and settle; camera shake
and floating logos drift organically. After Effects users get both from
easing presets and expressions: `wiggle(freq, amp)` adds fractal noise to
a value (frequency in wiggles per second, amplitude in the value's units),
and spring, elastic and bounce eases come from expression libraries and
plugins; Robert Penner's easings (easings.net) are the common reference
curves. The app's eases were CSS beziers, which can overshoot once
(Overshoot, Anticipate) but cannot ring or bounce, and the only shake was a
fixed sine pattern (the Shake loop and effect).

## Decision

- **Three named eases**, `spring`, `elastic` and `bounce`, beside the
  existing names. Spring is a damped oscillator released at the start
  (decay 7, 2.25 swings: about 21% overshoot, settled within a percent by
  80% of the way); elastic and bounce are Penner's ease-out curves. They
  are names, not beziers, so the graph draws them by sampling and shows no
  handles. `ease()` reads an unknown name as linear, so a future name never
  fails a frame.
- **Wiggle is a clip's `wiggle: { x?, y?, rotation?, scale? }`**, each
  `{ frequency, amplitude, seed, strength? }`, added to the transform after
  keyframes and animations, so it rides on any move. The noise is 1D
  gradient (Perlin) noise with a second octave at 2.17 times the frequency
  and half the amplitude (AE's octaves and amp_mult), seeded by an integer
  hash and salted per value so x and y with one seed move apart. Raw, it
  rarely passed 0.75 of the amplitude; it is scaled by 1.3 and clamped, so
  the amplitude is a ceiling that is reached.
- **Strength is the keyframeable knob** (`wiggle.<value>.strength`,
  0..1, and `.amplitude` too): two `set_wiggle` calls with `at` ramp a
  shake in or out. `set_wiggle` takes pixels, degrees and percent and
  stores the transform's own units; its default seed comes from the clip
  id, so two clips shake differently.
- Deterministic and continuous in time, so preview, export and motion
  blur's sub-frame samples agree.

## Consequences

Frequency is not keyframeable: changing it mid-clip jumps the noise, as it
does in After Effects. A shaken picture uncovers the canvas edge; the
`set_wiggle` description points at `set_edge_mode` mirror (ADR-059) or a
slight scale-up.
