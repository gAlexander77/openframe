# ADR-038: Copied effects preserve animation and get new identities

**Date:** 2026-10-15. **Status:** accepted.

## Context

Editors reuse a treatment across shots. Premiere and Kdenlive expose effect
copy/paste workflows; sources are in [[Effect workflow]]. OpenFrame already
stores an ordered effect list and animation paths `effects.<id>.<parameter>`.
Copying the list without remapping those paths would make animation point
at the wrong effect. Reusing mutable references would tie later edits across
clips. A short destination still needs later keys to interpolate correctly.

## Decision

- Copy a detached snapshot of effects, their effect-only keyframes and the
  source project's rational frame rate. The clipboard is session state;
  project serialization is unchanged. Normal clip/keyframe copy is separate.
- Paste appends to each target's current stack, preserving transforms,
  filters, grading, source/timeline timing and their keys. Every added effect
  gets a fresh ID and its keyframe paths are remapped. Enabled flags and order
  are copied. Missing parameters are filled from catalog defaults.
- Preserve clip-relative animation time in seconds across frame rates, then
  round to destination frames. If rounding merges keys onto one frame, the
  later source key wins. Retain keys outside a shorter destination's visible
  range: they define interpolation within it, as with existing trimmed clips.
- UI paste targets unlocked visual clips and adjustment layers, naming the
  receiving count for mixed selections. The `copy_effects` command requires
  every explicit target to be valid; it validates all targets before editing.
  One paste is one undo step even for multiple targets.

## Consequences and verification

This is effect-stack reuse, not a general Paste Attributes dialog: color,
audio, speed and transforms are not copied. Named persistent presets shipped
later; see [[ADR-043 Reused settings preserve timing and ownership]]. No dependencies or saved-data migration are introduced.

Five unit tests cover snapshot independence, fresh IDs, existing settings,
keyframe path remapping, cross-frame-rate conversion, rounded-frame collisions
and locked targets. The eight-check `effect-copy` drive passes through headless
Playwright MCP: single/multiple paste, animation on a shorter clip, mixed audio
selection, text effects, grouped undo/redo and the ordinary clip clipboard.
Native OS interaction was not part of these shared-UI checks.
