# ADR-043: Reused settings preserve timing and ownership

**Date:** 2026-10-16. **Status:** accepted.

## Decision

[Adobe's effect copying workflow](https://helpx.adobe.com/premiere/desktop/add-video-effects/apply-video-effects/copy-and-paste-clip-effects.html)
informs including keyframes when reusing effects; the explicit attribute
groups and append/replace defaults below are this project's decisions.

Reusable effects store a detached stack and its source frame rate in a local
preset library. Presets validate known effect types, parameters, key paths and
easing before application. Local writes complete before updating the visible
list. Applying generates independent effect IDs and is undoable; managing
the preset library is separate from project history. The library is read
entry by entry: an entry a later version cannot read (an effect renamed or
removed) is reported and written back untouched, never dropped by the next
save.

Selective Paste Attributes takes a detached clip snapshot. Groups replace
their settings and matching keyframes; effects retain the established append
default with an explicit Replace choice. Keyframe times and fades convert via
seconds between frame rates. Audio fades clamp to half the new clip, the
inspector's limit, so the two ramps never overlap. Color
copies LUT file references under independent IDs when needed. Timeline timing,
source offsets, speed and unrelated settings never change.

Validate every target before any edit. Incompatible/locked targets cannot
receive a selected group. Apply with `store.edit` without magnetic settlement:
changing appearance or sound must not close intentional timeline gaps. The
same holds for adding, toggling, reordering and pasting effects.

## Consequences

Preset storage is device/profile-local and is not a project backup. LUT files
remain externally referenced. The clipboard is session-only, while presets
survive reloads. Evidence and limits are recorded in
[[Development pass 2026-10-16]].
