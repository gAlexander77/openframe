# ADR-005: One store, snapshot undo

- **Date**: 2026-10-13 · **Status**: accepted

## Context

TermHQ keeps state in `App.tsx` until that hurts. An editor hurts on day
one: the timeline, inspector, player and media panel all read and write the
same document, and the playhead changes 60 times a second during playback.
Undo has to cover every edit, and a drag must be one undo step, not one per
pointer move.

## Decision

- One module-level store (`src/state/store.ts`) holding the project plus
  editor state. Components read slices with `useEditor(selector)`, built on
  React's `useSyncExternalStore`, so only components whose slice changed
  re-render. No state library: a few dozen lines replace it.
- **Undo is snapshots of the immutable project**, not inverse commands. Edit
  operations are pure (`src/lib/project/ops.ts`) and share untouched
  branches, so a snapshot costs a few pointers. 200 steps are kept.
- **Gestures** (`beginGesture` / `previewGesture` / `endGesture`) recompute
  every pointer move from the drag's starting project, then record one undo
  entry labeled with what the drag did.

## Consequences

Selectors must return stable values (a primitive or an existing object),
never a fresh object or array, or React re-renders in a loop. Anything not
in the project (selection, zoom, playhead) is not undoable, which matches
Premiere and CapCut. Undo labels feed the history list and toasts.
