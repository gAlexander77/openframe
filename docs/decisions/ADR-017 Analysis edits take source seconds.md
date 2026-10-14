# ADR-017: Analysis edits take source seconds

- **Date**: 2026-10-13 · **Status**: accepted

## Context

Silence detection, scene detection and (soon) transcripts all describe a
media *file*: "the pause from 4.2 s to 5.1 s of talk.mp4". The commands
that act on them (`cut_ranges`, `split_at_times`) could take timeline
seconds like `split` and `trim_clip` do ([[ADR-006 Every edit is a named
command with a JSON Schema]]), but timeline positions move with every cut:
after removing the first silence, every later range is off by its length,
and a caller would have to re-map the list after each step or cut back to
front. A clip's speed and in-point add two more conversions to get wrong.

## Decision

- Commands scoped to **one media clip** whose times come from analysis
  take **source seconds**: seconds into the clip's media file, the unit the
  project already uses for a clip's `in` ([[ADR-004 Timeline time is
  integer frames]]). `cut_ranges {clip_id, ranges, ripple}` and
  `split_at_times {clip_id, times}`.
- Commands about the **timeline** keep timeline seconds (`split`,
  `add_marker`, `add_markers`).
- Ranges outside the clip's current source window are ignored, so one list
  stays valid however the clip is trimmed or cut, and the edit lands where
  the analysis meant even if the clip moved while it ran.
- `describeProject` reports each media clip's `out` beside its `in`, so an
  agent can see which source seconds a clip shows.
- A clip lined up with the target (same media, position and source window:
  audio detached from it) gets the same cuts, so picture and sound stay in
  sync. Locked tracks are never cut.

## Consequences

The op converts once (`frameOfSource`, rounding to the nearest frame) and
the pieces stay on the frame grid. Every command description says which
kind of seconds it takes, in capitals. A future "cut timeline range across
tracks" (Premiere's lift/extract) would be a separate, timeline-seconds
command.
