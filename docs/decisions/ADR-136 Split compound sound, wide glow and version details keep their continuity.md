# ADR-136: Split compound sound, wide glow and version details keep their continuity

**Date:** 2026-10-21. **Status:** accepted.

## Context

ADRs 117, 122 and 125 left compound compressors, wide glow sampling,
nested callouts, captions crossing rings, tall end cards and no-grid
silent-join hints open. These paths already have commands and renderers.

## Decision

- Extend the existing continuous compound collector to EQ and compressors.
  Identical adjoining source spans use one bus before scheduling, in preview
  and offline mixdown; distinct settings, fades and splices keep their buses.
- Above glow radius 18, threshold at full resolution, then use ADR-069's
  pyramid Gaussian and spline reconstruction. Match the classic taps'
  variance (sigma two thirds of radius); smaller radii keep their shader.
- Discover, frame and follow callouts separately in every compound scene's
  timeline. Compounds treated as pictures keep their existing whole layout.
- On tall versions, move colliding burned captions above rings when there
  is room inside titleZone, report it in done, and respect explicit overrides.
  A ring holding a caption remains on it. Reserve outline room before fitting
  a grouped card, so settling text cannot push its logo outside the safe area.
- Start a 9:16 end card's headline at 24% of its safe column's width;
  the button follows its role ratio. Keep the logo-first fit and readable floor.
- Without a grid or Bar markers, scan both source files within half a second
  of a silent join. Suggest a legal timeline frame only with 20 ms of silence
  below -60 dBFS RMS on either side in both files; otherwise suggest no target.

## Consequences

No schema or command changes. Existing split, set_compressor, add_effect,
add_ad_element, export_versions, preview_audio and roll_edit paths benefit.
Wide glows intentionally change; the default and small glows remain unchanged.
Regression tests fail on the old paths; browser drives are written for the
lead to run because the lane sandbox cannot launch a browser. Variable-line
canvas editing and per-letter compositor border fades remain open.
