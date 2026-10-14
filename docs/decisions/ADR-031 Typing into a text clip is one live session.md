# ADR-031: Typing into a text clip is one live session

- **Date**: 2026-10-14 · **Status**: accepted

## Context

CapCut redraws the frame as you type a title, on the canvas or in the
inspector, and the two stay in sync. Our inspector's Text box committed on
blur, so the viewer showed the old words until you left the box, and the
canvas editor ([[ADR-030 The canvas text editor is a transparent textarea
over the engine's text]]) needs the same live path. An undo step per
keystroke would bury the history; one per session matches how drags work
([[ADR-005 One store, snapshot undo]]).

## Decision

- `src/state/textEdit.ts` owns one **typing session** at a time:
  `beginTyping(clip, editor)`, `typeText(text)`, `endTyping()`. It rides the
  store's gesture (`beginGesture` / `previewGesture` / `endGesture`), so
  every keystroke reaches the project and the viewer, and the session is one
  undo step, "Edit text". Typing back to the starting words records nothing.
- Both editors are controlled by the clip's text, so each shows the other's
  typing live.
- A session ends on Escape, on blur, or on a **pointer press outside its
  editor, caught in the capture phase**. Focus leaves an editor only after
  the press's own handlers have run; a timeline drag or a slider that opens
  its gesture there would otherwise find ours still open, and the two would
  close each other.
- The store's `textEdit` names the clip being edited on the canvas; the
  session clears it when it ends.

## Consequences

Shortcuts stay off while typing through the existing rule: the keymap
ignores keys aimed at a text field, except Escape. Edits from elsewhere
during a session (an agent's command) would be folded into its undo step;
nothing does that while a person is typing.
