# ADR-127: Timeline conveniences share search and edit paths, monitor mute belongs to preview

**Date:** 2026-10-21. **Status:** accepted.

## Context

Long edits need a clip list, repeated cuts need a preferred transition,
and preview sound needs a switch independent of exported track settings.
Compounds have their own timeline coordinates; sound has several preview
entry points besides the timeline player.

## Decision

- Derive clip names, searchable text and sorted rows in `timelineIndex`.
  The UI memoizes rows by the current project view. `find_clips` walks
  reachable compound instances too, names the containing clip, and uses
  local timeline seconds for nested hits, like `describe_project`.
- Keep video transition type/duration and audio duration in viewer
  preferences. Supply the pure bulk command's defaults at preference load
  and change, like still lengths. Reuse `setTransition` and `setCrossfade`
  with the existing join limits; report skipped cuts and edit once.
- Keys use selected outgoing clips, or the nearest eligible main cut.
  Audio crossfades require audio clips; without an eligible cut the action
  asks for selection. Track mute/solo use `update_track` via `store.edit`.
- Put monitor mute in session state and a final realtime output gain,
  before peak/LUFS taps. Route playback, scrubbing, source previews and
  library auditions through it. Voiceover's temporary speaker suppression
  remains separate. Offline mixes never see the switch.

## Consequences

No project schema changes or migration. One Undo reverses bulk edits.
A search hit inside a compound is addressed in that compound's timeline,
not retimed onto each parent's clock. Exports keep their own sound graph.

## Drive review, 2026-10-21

The lead's headless Edge pass exposed two drive errors. Default transitions
created color clips without `track_id`; `landingTrack` puts those on an
overlay, leaving main empty. The drive now places four touching clips on
main explicitly and guards against empty-array assertions. Raw `project()`
clips are ordered by start in frames; `describe()` preserves that order but
reports seconds and names the outgoing transition `transition`.

Monitor mute read `gain.value` immediately after the key, racing the
`setValueAtTime` change on the audio rendering thread. Shift+S has one
binding; the stage focuses itself and only intercepts arrow-key nudges.
The drive now polls gain, session state and button state for up to two
seconds after each single toggle, records those readings, and checks that
clicking the stage preserves mute and focuses it. Product code is unchanged
by these fixes. Browser reruns belong to the lead; this review used code
and the reported results, without launching a browser.

Validation: `npx tsc --noEmit` passed; `npx vitest run --configLoader native
--pool threads --maxWorkers 2` passed all 1,652 tests in 183 files. The added
command-built regression covers raw/description clip order and choosing
the main cut despite a closer overlay cut. Both drive functions parse.
