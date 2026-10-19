# ADR-086: A score fits an edit by whole bars and a nudged tempo

**Date:** 2026-10-19. **Status:** accepted.

## Context

An editor scoring a cut thinks in seconds ("an intro of four bars, a drop
at 8.0 s, an outro ending exactly at 56 s"); music thinks in bars. A
composer bridges the two by choosing the tempo so the hits land, and an
agent needs the answer as times it can cut to. The editor's own
`analyze_music` reads structure from a track, so a generated track should
read back as the structure it was written with.

## Decision

- **Sections are whole bars; asked-for times are anchors.** A section
  has bars, seconds, `at` (where it starts) or `end_at` (where it ends),
  in any mix. Between two anchors the free sections share the bars by
  their kind; the tempo is scanned within `max_nudge` (6% by default, 8%
  for a bare length) for the one that lands the anchors best, a round
  tempo when one fits as well. The file's end is met exactly: the last
  section stretches or shortens by part of a bar, so the end weighs least
  in the scan. The answer's `fit` says, per anchor, what was asked, what
  was got, the error, the tempo change, and whether every time landed
  within a sixteenth.
- **Default forms are phrase-aligned.** With only a length, each style's
  form (intro, build, drop, breakdown, drop, outro...) is fitted by trying
  every combination of usual lengths (phrases of four and eight bars,
  two for short intros and builds), keeping the main parts on one
  four-bar grid, never two drops back to back, and picking a total of bars
  that is a multiple of four when the tempo can move that far. A long piece
  goes round again (another breakdown, build and drop).
- **The cue sheet is the answer.** Every bar and beat, the sections, the
  drops (rises into a drop), `final_hit`, the breaths (a beat of silence
  before a drop and before the final hit), and `cut_points` ranked drop,
  section, phrase, bar; in timeline seconds once placed. `markers` writes
  them as analyze_music would (Bar, Beat, Phrase, section names, Drop).
- **Structure that analyze_music can read.** The arrangement keeps
  sections even inside (the hook does not change bar to bar, sparse parts
  hold their chords, builds start with a firm kick) and different at the
  joins, because the analyzer cuts where the two bars on either side of a
  bar line differ by 3 dB and checks phrase lines with looser thresholds.
  The drive checks that it finds the tempo, the drops and every section
  start within a bar, except one: a ring-out outro, whose final chord has
  no onsets for the beat tracker, reads as the end of the drop before it.
  Carrying the analyzer's beat grid through quiet endings found those
  outros but moved the launch film track's outro by a bar, so the analyzer
  was left as it is and the cue sheet is the authority on the ending.

## Consequences

- An agent can plan with `plan_music` (instant), then render the same
  plan with `generate_music` and the seed it was answered.
- Times that cannot all land within the nudge are reported, not hidden:
  `fit.ok` is false and the note says what to change.
- Short sections (two bars) can fall below what analyze_music separates;
  the generated cue sheet still names them exactly.
