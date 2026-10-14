# ADR-024: Keyframes are selected by path and frame, and keys come first

- **Date**: 2026-10-14 · **Status**: accepted

## Context

Diamonds on the timeline and keys in the keyframe panel must be
selectable, and Delete, Copy and Paste must act on them (CapCut: select a
diamond, press Delete). Keyframes in the document have no ids; adding ids
would change the open format ([[Project format]]) for a UI need. The same
keys are also the clip's keys, so one key press could mean "delete the
keyframe" or "delete the clip".

## Decision

- A keyframe is addressed by **path and frame** (`KeyRef`), which the
  document already makes unique: a path never holds two keys on one frame
  (`lib/keyframeEdit.ts` replaces the key a move lands on).
- The selection lives in the store as `keySel: { clipId, keys }`, on one
  clip at a time, and is cleared whenever the clip selection changes. A
  drag rewrites the refs as the keys move. Refs an undo invalidated are
  ignored (`liveRefs`), never repaired.
- **Keys come first**: Delete, Copy, Paste and Escape act on selected
  keyframes when there are any, and on clips otherwise
  (`src/state/keyframes.ts`, asked first by `actions.ts`). Paste uses
  whichever clipboard was filled last, and lands keys relative to the
  playhead on the selected clip.

## Consequences

No format change. Clicking a clip's body drops the key selection, so the
next Delete removes the clip again, the same as in CapCut. Selection is not
undoable, like clip selection ([[ADR-005 One store, snapshot undo]]).
