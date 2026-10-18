# ADR-054: Tracking writes position keyframes

**Date:** 2026-10-17. **Status:** accepted.

## Context

CapCut pins a title or sticker to a moving subject (Text/Sticker >
Tracking); Resolve, VEGAS and Final Cut do the same with a point tracker.
The feature survey listed it as a P1 gap. Two shapes were possible:

- **A live link**: store the tracked path on the layer and let the render
  plan move it every frame. The pin would follow later edits to the video
  (moving or scaling it), but the layer's position would no longer be
  what the inspector and the keyframe panel show, and every place that
  reads a position (align, snapping, the transform box, `describe_project`)
  would need to know about it.
- **Keyframes**: turn the path into the layer's own `transform.x/y` keys
  once, as Premiere's Auto Reframe and the survey's note suggest.

## Decision

- **Keyframes.** `src/lib/follow.ts` carries the subject's path (source
  fractions, from `src/lib/analysis/track.ts`) onto the canvas through the
  followed clip's resolved layer at each frame (its keyframes, flips,
  rotation, anchor and stabilization included) and writes the layer's
  position as its value at the start plus the subject's movement since.
  Keys before the starting frame stay; later position keys are replaced.
  One undo step, "Track motion".
- **Few keys.** The canvas path is smoothed (a 1-4-6-4-1 binomial that
  leaves the ends alone) and thinned (Ramer-Douglas-Peucker within one
  canvas pixel): the tracker's sub-pixel jitter kept a key on every frame
  before smoothing (90 on the drive's 3 s clip; 5 after).
- **The tracker is template matching**: normalized cross-correlation of the
  box's pixels within a search window around its last place, on 320 px
  wide gray frames, the template sampled to at most 40 x 40 points and
  adapting 10 % a frame only while the match is sure (above 0.8). Below
  0.5 the subject counts as lost and the box holds still.
- **Forward from the playhead**, as CapCut tracks, to the end of the
  shorter of the two clips. The box is placed on the viewer (it starts
  around the layer's own center, a sixth of the canvas high) or given by
  an agent in fractions of the video's picture (`track_motion`).

## Consequences

- The pinned layer stays an ordinary layer: its keys can be nudged in the
  keyframe panel and it renders, exports and describes with no new path.
- Moving or rescaling the followed video afterwards does not move the pin;
  track again (one click) after such an edit.
- Position only: the layer keeps its scale and angle. A similarity fit
  (scale and rotation from several tracked points) is the upgrade for
  subjects that approach the camera or turn; reversed and frozen clips
  cannot be followed yet.
