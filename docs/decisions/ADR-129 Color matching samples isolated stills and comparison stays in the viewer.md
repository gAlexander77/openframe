# ADR-129: Color matching samples isolated stills and comparison stays in the viewer

- **Date**: 2026-10-21 · **Status**: accepted

## Context

Matching needs the reference as rendered and the target before its look.
Sampling the viewer races decoding and fails hidden; repeatedly correcting
an already graded target compounds the correction. A comparison wipe must
never leak into export, saved projects, or undo history.

## Decision

- Share Auto adjust's still-export sampler. Render five isolated frames
  across each clip's middle 90%, downscaled to at most 160 pixels wide and 320 tall; retain
  geometry, crop, opacity and chroma key. Reference keeps its own look;
  target plans bypass Basic, grade, filter, effects and LUT.
- Fit smoothed RGB percentile curves with protected endpoints and cubic
  slopes about 0.4 to 2.5, plus optional mean-chroma saturation. Reduce points
  to editable handles. Keep the master curve and account for it in the fit.
  Matching replaces the target's other look settings and their keyframes;
  strength zero makes no edit. Commit all targets through one store edit
  only if the document and abortable project session are still current.
- Compare derives a plan, never a document. Present the live frame, then
  scissor a second presentation over the left/top. Off does no second work.
  Capture an owned ImageBitmap immediately after the live presentation,
  before comparison; close it on replacement, off, detach or session end.
  DOM supplies the divider; export only sees the original plan.
- MCP `match_color` runs the job; preview tools take typed `before` and
  `before_clip_ids` arguments to use the same plan bypass offscreen.

## Consequences

No new persisted fields or dependencies. Different subjects, clipped
sources and an extreme retained master curve can limit the match; report
sampled mean differences so agents can judge it. Comparison can reduce the
viewer frame rate, while the audio clock continues independently.
