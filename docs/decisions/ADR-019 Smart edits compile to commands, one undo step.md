# ADR-019: Smart edits compile to commands, one undo step

- **Date**: 2026-10-13 · **Status**: accepted

## Context

"Remove silences" on a podcast makes dozens of cuts; "Split scenes" makes
one split per shot. If each cut were its own edit, undo would take dozens
of presses and the history list would drown. If the tools edited the
project directly, agents and the future MCP server could not reproduce or
inspect what they did ([[ADR-006 Every edit is a named command with a JSON
Schema]]), and analysis results stored in the document would bloat every
save and every undo snapshot ([[ADR-005 One store, snapshot undo]]).

## Decision

- A smart edit is **analysis, then one registry command** applied through
  `edit()` in `src/state/ai.ts`: `cut_ranges` for silences,
  `split_at_times` or `add_markers` for scenes, `add_markers` for beats.
  One tool run is **one undo step** with a label that says what happened
  ("Remove 14 silences", "Split into 6 scenes", "Mark 43 beats").
- Analysis results are **not stored in the project**. They are returned
  (`window.videoEditor.analyze.*` gives them without editing, in source
  seconds) and the edit derived from them is what the document keeps.
- Every run gives feedback the same way: a progress toast and the card's
  progress while it runs, cancelable; a result toast after ("Removed 14
  silences, 22.4 s shorter"); an error toast naming the reason.

## Consequences

Undo, history, autosave and export never learn that silence removal
exists. Rerunning a tool re-decodes the clip; a hash-keyed analysis cache
beside the project ([[AI and automation]] §4.4) is the upgrade when that
gets slow. Agents can analyze, inspect the ranges, then call the same
commands themselves, or call the tool and undo it as one step.
