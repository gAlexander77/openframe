# ADR-034: Timelines leave as OpenTimelineIO

- **Date**: 2026-10-14 · **Status**: accepted

## Context

Pro editors expect to move a cut between tools: rough cut here, color in
Resolve, finishing in Premiere. The common formats are CMX3600 EDL (one
video track, no titles), FCP7 XML (Premiere and Resolve import it, but it
is a large, loosely specified dialect), FCPXML (Final Cut and Resolve) and
OpenTimelineIO (the Academy Software Foundation's open format; Resolve
imports it natively, Premiere through its plugin, and the OTIO library
converts to the others).

## Decision

Export OTIO JSON first (`src/lib/interchange/otio.ts`, File > Export
timeline (OTIO)). It is the only one of the four with a public schema and
a reference library, so correctness can be proven rather than guessed, and
the library's adapters reach the rest.

- Schemas old enough for current importers: `Clip.1` (one media
  reference), `Marker.2` (`Marker.1` named its range `range`, which
  newer readers turn into a null `marked_range`).
- Times in the project's frame rate; source ranges in media seconds times
  that rate; transitions centered on the cut, as ours are.
- A video clip's sound is repeated on a companion audio track, as NLEs
  link picture and sound; titles, color clips and adjustment layers are
  clips with a `GeneratorReference` holding their content.
- Each clip's full definition rides in `metadata.video_editor`, so a
  later importer can round-trip what OTIO cannot express.

## Consequences

Checked with OpenTimelineIO 0.18.1: a timeline with a dissolve, a 2x
clip, a title, music after a gap and a marker loads, reports the right
times and effects, and round-trips equal. Effects, keyframes, text
styling and masks travel only as metadata other tools ignore. Import,
FCP7 XML and EDL are left for when someone needs them; the OTIO library
can already convert the export to those.
