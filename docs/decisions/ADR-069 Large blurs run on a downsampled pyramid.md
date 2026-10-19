# ADR-069: Large blurs run on a downsampled pyramid

**Date:** 2026-10-18. **Status:** accepted.

## Context

The launch film made through MCP ([[Launch film through MCP 2026-10-18]])
needed soft background glows, the staple of modern product films, and the
editor could not draw them: the Blur effect's maximum (amount 100, a
60-pixel radius, sigma 30 at 1080p) left a glow's shape readable, five
stacked passes still showed an ellipse's edge, and shapes had neither a
radial gradient nor a soft edge. The film imported glow sprites made in
Python.

The old blur is one separable 25-tap pass per axis at full size, its taps
spread over the radius, so they sit 5 pixels apart at amount 100 and the
kernel stops at two sigma. Widening it that way to a 300-pixel radius
would put taps 25 pixels apart (combing) and cost the same at any size.

## Decision

- **The Blur effect's amount goes to 500** (a 300-pixel radius, sigma
  150), keeping the old mapping: radius 0.6 pixels at 1080p per unit,
  twice the Gaussian's sigma. **Up to 100 the original shader runs
  unchanged**, so every saved project draws pixel for pixel as before
  (the render-fingerprint drive hashes five 1080p frames of a project
  made only of older features before and after; they match). Past 100 the
  pyramid draws it.
- **The pyramid** (`lib/blur.ts` plans it, `shaders.ts` DOWN, GAUSS, UP):
  halve the picture until the Gaussian is 3 to 6 texels wide there, blur
  with a separable 33-tap Gaussian over three sigma (taps under a texel
  apart), and read it back to full size with a cubic B-spline (four
  bilinear reads, GPU Gems 2, ch. 20). Each stage widens the blur, so the
  Gaussian takes only the variance the halvings, the read-back and
  between-texel taps leave: the result has the sigma asked for at every
  size, and a keyed blur grows smoothly across a change of level (under
  two 8-bit steps). Halved levels are half floats where the platform
  renders to them, and the read-back dithers by about one 8-bit step, so
  a wide, dim glow does not band.
- **Each halving is a [1, 3, 3, 1] / 8 filter**, four bilinear reads at
  0.75 of a source texel, not the usual 2x2 box. The CPU simulation
  (`simulate1d`) showed a box snapping a small bright point to the coarse
  grid, 32 pixels at a 150 blur, so a moving dot's glow would jump; this
  filter keeps every point's center exactly. The first version also put
  taps two texels apart and combed a hairline into stripes; the tests
  now check one peak.
- **Shapes get soft light without a blur pass**: `gradient.kind: radial`
  (from the center to the rim, an ellipse fitting the box, with a center
  and radius) and `feather` (pixels at 1080p; the edge's coverage is a
  Gaussian's CDF, sigma a quarter of the feather, from the signed
  distance the shape shader already has). Both are exact at any size and
  free per pixel; the quad grows by three sigma so the falloff is never
  cut. Absent, the shape shader runs its old expressions.

Measured in the real engine (soft-light drive, 1080p export path): a
white half-canvas blurred at 500 matches 1 - Phi(d / 150) within 2 levels,
no step over 2 levels, 10-90% in 384 pixels (77 at amount 100); a radial
gradient is linear to its rim within 1 level; a 200-pixel feather matches
Phi(d / 50) within 1 level.

## Consequences

- The cost past 100 is about one and a half full-size passes whatever the
  radius (the halvings, a small Gaussian, one read-back), less than the
  old blur's two at 100.
- Crossing amount 100 changes method: the old kernel stops at two sigma,
  the pyramid's does not, so a keyframed blur through 100 widens by a
  few percent there. Rarely visible; old projects that never pass 100
  are untouched.
- The canvas fill's blur and animations' blur stay on the old shader
  (their amounts never pass 100).
- Edges past the canvas repeat (CLAMP_TO_EDGE), as the old blur's did.
