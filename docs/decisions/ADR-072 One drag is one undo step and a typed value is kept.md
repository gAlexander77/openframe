# ADR-072: One drag is one undo step, and a typed value is kept

**Date:** 2026-10-18. **Status:** accepted.

## Context

Recording the launch film's footage ([[Launch film through MCP 2026-10-18]])
found one drag of the Animation tab's Duration slider, 1.2 to 2.0 s,
making eight "In animation" undo steps; the color wheels and the effect
and reverb sliders made one. The slider called its edit on every `input`
event. The same was true of the Animation Stagger and Transition Duration
sliders, and of every color swatch: the platform color picker sends an
`input` per pointer move while its square is dragged, and each became an
edit through its caller (twenty swatches, each with its own edit path).

The gesture sliders had a quieter fault: each `keydown` reopened the
gesture, so holding an arrow key left only the last repeat to undo and
the rest could not be undone at all.

A whole-app audit then found typed values lost or misread:
- A number typed in the inspector and left by clicking another clip was
  dropped. The timeline's press keeps the focus, so the field never
  blurred; selecting the clip unmounted the field, and React fires no
  blur on unmount. Details > Name had no Enter either.
- `Number("")` is 0 and stripping every non-digit read "1,5" as 15: a
  cleared Scale field set 1%, its minimum.
- Preferences lost a typed length when Escape closed the dialog.

## Decision

- **A range input is a gesture** (`rangeGesture` in
  `components/inspector/controls.tsx`), as the wheels always were: the
  press opens it, the release closes it wherever the pointer is let go
  (a window listener, not the input's), and every value in between
  previews from the gesture's start (`store.previewGesture`). Held keys:
  only the first `keydown` opens it. The release's own `change` event
  comes after `pointerup`, and where the shown value is rounded (speed,
  a transition's frames, decibels) it re-sends the value, so the close
  waits a task for it.
- **A change with no press is one edit.** `previewGesture(fn, label)`
  with no gesture open applies `fn` as an ordinary edit named `label`: a
  script setting the value, or assistive technology, still edits.
- **A run folds whole edits into one step** (`store.beginRun` and
  `endRun`), for controls whose callers edit through their own paths: the
  color swatch opens a run on its first `input` and closes it on `change`
  or blur. Undo, redo and loading a project end a run. Gestures stay for
  drags that recompute from their start (nothing accumulates); a run is
  for controls whose every step is a complete, absolute edit.
- **A typed value is kept when focus leaves, however it leaves**
  (`useCommitOnLeave`): Enter, blur, and the field unmounting with a
  draft (another clip selected, another tab, the dialog closed) all
  commit; Escape alone reverts. Details > Name commits on Enter.
- **Nothing typed, nothing changed** (`lib/numberInput.ts` `parseTyped`):
  an empty or non-numeric field keeps its value; a decimal comma reads
  as a point ("1,5" is 1.5, and "1,500.5" is thousands); a unit after
  the number ("50 %", "2s", "1.5x") is ignored.

## Consequences

- `scripts/drive/undo-steps.js` drags every range slider the inspector
  shows for a video, a title and a sound (72, every tab and Adjust part,
  every animation slot, an effect, a transition) plus track volume and
  pan, and requires one step each; also the film's Duration case, a held
  key, a scripted value, and the color picker's live inputs.
- `scripts/drive/typed-values.js` covers the click-away, junk, comma,
  name and Preferences cases.
- A run left open (a swatch that never blurs) folds later edits into its
  step until it closes; edits are never lost, only grouped.
