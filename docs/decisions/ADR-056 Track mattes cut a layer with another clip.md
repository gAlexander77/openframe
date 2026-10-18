# ADR-056: Track mattes cut a layer with another clip

**Date:** 2026-10-18. **Status:** accepted.

## Context

Video inside text, logo reveals and wipe reveals are After Effects' track
mattes: a layer shows only where the layer above it is opaque (Alpha
Matte) or bright (Luma Matte), or the reverse (Inverted), and the matte
layer's own video is switched off. Since AE 2023 any layer can be picked
as the matte, not just the one directly above. Premiere's Track Matte Key
and Resolve's Alpha/Luma Matte do the same with a track as the source, and
leave the matte visible unless it is hidden by hand. The app had masks
(shapes on one layer) and Remove BG (a per-frame matte from a model), but
no way for one clip's picture to cut another's.

## Decision

- **A matte is a visual clip's optional `trackMatte: { clipId?, mode }`**,
  `mode` one of `alpha`, `alphaInverted`, `luma`, `lumaInverted`. With
  `clipId` it names a visual clip of the same timeline (any track); without
  it, whatever is on the video track directly above at each frame. The
  default (`set_track_matte` with no matte named) is the track above,
  because it keeps working after the matte is split or replaced; a named
  matte is for a matte elsewhere in the stack.
- **The matte is not drawn**, as in After Effects: a named matte at every
  frame (its video is off), the clip above a track-above matte only while
  the clip it cuts is showing. The plan (`planTracks`) computes that set
  first (`lib/trackMatte.ts mattesAt`) and skips those clips, transitions
  included.
- **The plan attaches the matte's layer** (`layerAt`, so its keyframes,
  animations, effects, mask, opacity and motion blur all apply) to the layer
  it cuts; `null` where the matte clip has no picture at that frame, which
  is an empty matte: nothing of an alpha matte shows, all of an inverted
  one. `walkPlan` yields the matte's layer so its source decodes and its
  LUT loads like any other.
- **The compositor renders the matte to its own target and multiplies**:
  each nesting level gets three more canvas-sized targets on first use (the
  matte's draw and its two effect temps), so a matte never competes with the
  layer or a transition's sides for the existing six. One full-screen pass
  (`MATTE_FS`) keeps the layer times the matte's alpha or its luminance
  (Rec. 709 weights on premultiplied color, so transparent parts read as
  black, as After Effects does), inverted for the inverted modes.
- Preview and export share the plan and the compositor, so they match;
  the drive compares the viewer with export's still to the level.

## Consequences

A named matte that is split leaves its second half an ordinary, visible
clip; the track-above default avoids that, and the loader drops a named
matte whose clip is gone (`dropDanglingMattes`). A matte layer cannot have
a matte of its own (the plan never attaches one to it), and a matted
clip's Canvas fill is drawn uncut. A matte costs one more layer draw and a
full-screen pass per frame it shows.
