# ADR-020: The grade lives in adjust, in Lumetri's order

- **Date**: 2026-10-14 · **Status**: accepted

## Context

CapCut's Adjust tab has Basic, HSL, Curves and Color wheel sub-tabs and a
LUT slot ([[CapCut desktop]] §3.8); Premiere and Resolve have the same tools
with real math behind them ([[Professional NLE features]] §6). We needed a
place in the project file, an order of operations, and math concrete
enough that preview, export and a CPU reference agree.

## Decision

- **Schema:** the pro grade sits beside the Basic sliders in each clip's
  `adjust` as optional parts — `hsl`, `curves`, `wheels`, `lut`. Absent
  means unchanged, so every older file is still valid and an ungraded clip
  costs no bytes. Adjustment layers get all of it for free.
- **Numbers on the -100..100 scale, 0 = neutral**, like every other adjust
  value, so `paramAt`'s default of 0 for a missing path is already right
  and every number is keyframeable by path: `adjust.hsl.red.saturation`,
  `adjust.wheels.lift.y`, `adjust.lut.intensity` (0..1, like filter
  intensity). Curve points are not keyframed (Resolve keyframes whole node
  grades, not points).
- **Order** (Lumetri's panel order is its processing order): Basic sliders
  and filter look → LUT → curves → wheels → HSL → fade, vignette, grain.
  Values clamp to 0..1 entering the grade: it is a display-referred
  pipeline.
- **Math** (`src/lib/grade.ts`, `curves.ts`; the GLSL mirrors them):
  - Wheels: per channel `x + lift(1−x)`, `× (1 + gain)`, `^ 2^−gamma`,
    `+ offset`. A puck is a point on a vectorscope (Rec.709 Cb right, Cr
    up), converted to an r/g/b balance with zero luma; the ring is `y`.
  - HSL: eight bands at 0, 30, 60, 120, 180, 240, 280, 320°; each pixel is
    weighted between its two neighboring bands (eased), so the weights
    always sum to one and there are no seams; the effect fades out below
    15% chroma where hue is noise.
  - Curves: monotone cubic (Fritsch–Carlson, no overshoot), baked into a
    256×1 RGBA8 texture (R, G, B curves, luma in A). The luma curve maps
    R, G and B alike, like Lumetri's white curve.

## Consequences

One shader branch per part, skipped by uniform when unused, so ungraded
clips pay nothing. `ponytail:` the grade is one fixed node; Resolve-style
node graphs, hue-vs-hue curves and HSL qualifiers with masks would extend
`Grade` with new optional parts, not change these.
