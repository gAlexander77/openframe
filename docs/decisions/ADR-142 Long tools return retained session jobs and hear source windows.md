# ADR-142: Long tools return retained session jobs and hear source windows

- **Date**: 2026-10-21, **Status**: accepted

## Context

The MCP bridge's 300-second limit is useful for a listening but slow page.
Long VOD analysis and Whisper can exceed it. Retrying then finds busy work
with no result, progress or cancellation handle. Short clips also heard
whole source files for captions and transcripts.

## Decision

- Wrap long app tools in one session registry. Answer the complete tool
  result or, after at most 45 seconds, a running job ID. Allow `wait: 0`.
  Repeated calls of a running tool reuse its job. Retain finished answers
  for 30 minutes; job_status lists or fetches them, cancel_job aborts them.
- Own jobs by projectWork's document-session signal, not only project ID.
  Entry points capture operation signals synchronously before awaiting;
  later helpers receive that captured signal. Stable session observers
  keep the document signal. Late canceled results are discarded.
- Route existing toast progress by toast ID into job progress and stage.
  The toast offers Cancel; quiet_seconds reports time without callbacks.
  Keep export_status alongside the same retained export answers.
- Share the ASR queue and per-asset window cache. Clip tools intersect the
  timeline range, map it to source seconds and add three-second margins.
  Recheck coverage in the queue; retain base.en and report hearing cost.
- Sample scenes every four seconds past 20 minutes, every second below.
  Cap scene sampling at 75 seconds and report incomplete source coverage.

## Consequences

No transport timeout increase, dependency or persisted schema change.
Results disappear on app restart. Cancellation is cooperative at engine
checkpoints; completed batch files and saved projects remain. Sparse or
incomplete scenes reduce visual evidence, so audio/chat and human review
still matter. The 45-minute hardware target needs a real drive measurement.

## Measured on the 45-minute VOD, 2026-10-22

In the desktop app (RTX 5070 laptop), `find_highlights` with scenes and
Whisper answered `running` at 45 s and finished in 185 s (about ten minutes
before this ADR). Two runs then showed the 75 s scene budget sampling 417
and 238 frames: sampled in order from the start, it reached 27:48 and then
only 15:52. Moments inside the sampled part get a small scene bonus
(0.016 here) that later ones never get, which is how the parachute call
(27:14) fell out of the top six on the slower run. Sampling now runs coarse
to fine, each pass ascending through mediabunny's `canvasesAtTimestamps`:
every 32 s across the whole file first, then the midpoints down to 4 s; a
cut-short reading spans the file evenly, and `even_interval_seconds` says
how fine it got.
