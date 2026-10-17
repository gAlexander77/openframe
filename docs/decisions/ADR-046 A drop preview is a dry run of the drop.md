# ADR-046: A drop preview is a dry run of the drop

- **Date**: 2026-10-16 · **Status**: accepted

## Context

Dragging from the library draws a preview on the timeline. It sat under the
pointer while the magnet put a photo at the nearest cut
([[UX audit 2026-10-14]] UX-13), and dropping above the tracks drew a
new-track line while the photo went to 00:00 of the main track (UX-12).
The first fix shared one landing rule (`visualDrop`) between the preview and
the drop for video and images, but every other kind still had its own copy
of the rules in the preview, and each copy had drifted:

- on a busy overlay row the drop opened a new track above it while the
  preview drew on the row (the collision rule lives in `placeClip`);
- audio previewed on the hovered row but landed on the first audio track
  with room;
- an effect or filter dropped on empty timeline attached to the selected
  clips instead of becoming a layer there;
- a transition dropped away from a cut went on the cut nearest the
  playhead.

## Decision

The preview is computed by running the drop's own placement on the current
project, without committing it. `planDrop` in `src/components/Timeline.tsx`
returns, for each kind of library item, both what the drop runs and that
dry run: `placeAsset` (`src/lib/drop.ts`, also the body of
`addToTimeline`, settled as `edit()` settles), `placeTextPreset`,
`addTemplate` and `placeOnTop`, the same pure functions the actions call.
`landing()` reads the result against the project before it: the row, or the
index a new track goes in at; the frame and length; and how far each
existing clip moves. The timeline draws exactly that: a box sized to the
item, an insertion bar at a magnet cut, later clips sliding aside together
with the ones linkage carries, and a new track as a chip in the ruler band
(top), a band in the gap (between rows) or a row (bottom). Effects, filters
and word art outline the clip they attach to; a transition marks its cut.

A drop acts only where it lands: with `at` given, `applyEffect`,
`applyFilter` and `applyTransition` never fall back to the selection or the
playhead (a click still does).

Rejected: committing the edit to the store during the drag
(`previewGesture`) and cancelling on leave. It is truthful too, but the
viewer would render the item, autosave and playback restarts would see a
project the user has not made, and a sticker's clip cannot exist until its
image is rendered.

## Consequences

Preview and drop cannot disagree for any kind whose placement is a pure
function; `scripts/drive/timeline-ux.js` compares every drop with the
preview drawn just before the release. Each pointer move runs one placement
and settle on the project; the timeline re-renders only when the landing
changes. `ponytail:` a sticker previews with a stand-in clip of the
sticker's span, since `addStickerClip` places only by span today; a
template previews its first layer. OS file drags still show only the
outline: the files' kinds and lengths are unknown until they are probed.
