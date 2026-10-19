# ADR-067: Versions lay keyframed motion out again around its rest

**Date:** 2026-10-18. **Status:** accepted.

## Context

[[ADR-063 Versions fit a group as one unit]] made `export_versions` adapt
ads built from `add_ad_element`. The launch film
([[Launch film through MCP 2026-10-18]]) was a designed film, and 9:16
broke it:

- **The windows.** Its UI windows are compound clips: footage at 0.8 of
  the frame, a hairline border, a shadow sprite. Each slides in with
  keyframed x (0.75 to 0.16, expo-out) and a slow scale. `versions.ts`
  skipped compound clips, so their keyed x stayed fractions of the old
  width. Their timelines were refit as frames: the footage kept its pixels
  and overflowed the 1080-wide canvas it is drawn on.
- **Keyed positions.** Positions were read at the first frame and every
  key moved by the same offset. A slide-in's first frame is off the edge,
  so it was placed as if it rested there.
- **The wordmark.** "OpenFrame" at size 170 is one word. A title shrinks
  to three quarters at most, then wraps, and one word cannot wrap.

## Decision

- **A set rests where it shows most of itself.** Of its first frame and
  its position and scale keys, the rest is the frame where most of the
  set's box is inside the frame; on a tie, the one held longest. A
  slide-in rests where it lands; a layer without keys rests where it
  starts. Overlay detection, placement and the box of every set are
  measured at the rest.
- **Keyed motion is laid out again around the rest.**
  - Each key's offset from the rest is scaled by how far the set has to
    travel to leave the frame on that side, new frame against old.
  - A window that starts 85% past the right edge on 16:9 starts 85% past
    it on 9:16, and moves the same way with the same ease and timing.
  - A small drift stays small.
  - Static positions are the case with no offset, so ADR-063's placement
    is unchanged.
- **A compound clip placed as a picture is refit as one picture.** A
  compound clip that is moved, scaled, turned or animated is a picture,
  not a nested scene.
  - **Its timeline is refit as one picture** (`asPicture`): the master's
    whole frame shrinks to fit inside the new one, centered, as a video's
    picture does. Positions, media scales, type, shape sizes and a solid's
    crop all scale by the same factor, so a 16:9 window stays a whole
    16:9 window.
  - **The clip refits as media the size of the master's frame**: fill,
    blur or fit when what it draws covers the frame, else its pixels
    against the short side.
  - **Its box is what its timeline draws**, scaled about the canvas
    center, so placement sees the window and not the canvas.
  - **A compound clip at rest** (scale 1, centered, no keys) is a nested
    scene. Its timeline is refit as a frame, and its own overlays are
    placed there as the root's are.
- **A lone picture the new frame would cut is fitted as a group is**: it
  shrinks into the safe area. A logo that still fits keeps its size, and
  a picture that reached past the master's safe area, and need not
  shrink, is placed against the frame.
- **A lone title that still does not fit** after the three-quarters
  shrink and the wrap (a word that cannot wrap) shrinks until its lines
  are no wider than the safe area.

## Consequences

- `src/lib/versions.film.test.ts` builds the film's shape:
  - a dark ground and a drifting glow sprite;
  - a window compound sliding in with an expo-out;
  - "Cut." beside it, and the wordmark.

  In 9:16, 1:1 and 4:5 it checks that:
  - the window rests inside the safe area and starts as far past the edge
    as it did;
  - its footage is a whole 16:9 picture, with the ease kept;
  - the wordmark fits, and the glow still covers the frame.

  `scripts/drive/mcp-launch-film.js` saves the check sheet.
- **Side-by-side layouts collide.** A title beside a window on 16:9
  overlaps it on 9:16, since each set is placed alone (the film's "Cut."
  over its window). Re-stacking a layout is a layout engine; until there
  is one, `save_project_copy` and lay that version out by hand.
- **The content box is a box.** A shadow sprite's transparent margin
  counts as content, so a window with a soft shadow is fitted a little
  smaller than its visible edge needs.
- **Nested compounds keep one level.** Compound clips inside a picture
  compound keep their scale. Only positions scale with the picture.
