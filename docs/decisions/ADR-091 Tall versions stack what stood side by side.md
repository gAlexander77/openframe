# ADR-091: Tall versions stack what stood side by side

**Date:** 2026-10-19. **Status:** accepted.

## Context

[[ADR-063 Versions fit a group as one unit]] and
[[ADR-067 Versions lay keyframed motion out again around its rest]] place
each overlay set on its own. The third launch film
([[Launch film 3 through MCP 2026-10-19]]) was designed side by side: a
floating window in one half of the 16:9 frame, its headline in the other,
the sides alternating, and a split screen. On 9:16 every set kept its
place in the safe area, so the headlines landed on their windows and the
split screen's halves crowded each other. The vertical cut took a project
copy and about 25 hand steps. `export_versions` had no captions option
either, so a burned-in vertical meant showing the hidden caption track by
hand, and captions kept the master's size.

## Decision

- **Side by side is found where each set rests** (`sideBySide`): a
  picture (footage, a picture or a floating window at least a quarter of
  the frame each way) mostly (60%) in one horizontal half, and a title or
  another picture mostly in the other half, on screen together for half
  the shorter one's time, level with each other (their heights overlap by
  30%). Sets beside the same set join one composition. A title whose
  center lies on a picture (a split screen's label) rides on it instead.
- **On a tall version of a wide master (9:16, 4:5) a composition is
  stacked** in the safe column (the safe area, and on any tall frame clear
  of the apps' buttons, as `check_project` judges a 4:5 frame too):
  pictures first, left to right becoming top to bottom, then titles in
  reading order. Each is fitted to the column's width (a picture grows or
  shrinks to it; a title wraps to it and never grows), centered on it, the
  stack centered in the column's height.
- **When the stack is too tall**, a layout's cell (an `apply_layout` cover
  crop) is cut again wider first, down to a 2.4:1 strip, keeping the middle
  of what it showed at the master's zoom; then the pictures shrink, to half
  at most; then the titles, never under the readable size (`minTextSize`).
- **What rides on a stacked set follows it** (`followersOf`): an overlay
  showing with it whose center lies on it (a label, a logo), or a shape it
  lies on (a glow behind a window, up to six times its size). It keeps its
  place in the set's box and is scaled as the set was; a label never
  shrinks under the readable size and stays inside its picture.
- **On a narrower frame that is not tall (16:9 to 1:1)** a composition and
  its followers move and scale as one group (ADR-063), so a headline is
  not pushed onto its window. A group's type never shrinks under the
  readable size there either.
- **Keyed motion and groups keep ADR-063 and ADR-067**: the stacking only
  chooses where each set goes and how big; the slide-in from off the edge
  is laid out again around the new place as before.
- **Captions are a version's choice**: `captions` is `burn` (the caption
  track shown, even when the master hides it; a caption turned off stays
  off), `none` or `as_project`. A tall version burns them by default, as
  people watch phones with the sound off; the rest keep the project's.
  On a tall version captions sit where `add_captions` puts them on a tall
  canvas (y 0.05, wrapped to the apps' column), their type kept against
  the short side. The stacks and every other overlay showing with a burned
  caption keep above it.
- **Titles wrap to where they land**: a stacked title across the safe
  column, a centered one within even margins (`titleWrap`, 0.62 of a 9:16
  frame), the rest within the safe width.

## Consequences

- `src/lib/versions.stack.test.ts` builds the film's shape: windows on
  alternating sides with headlines, a glow behind one, a split screen with
  a label on each half, an end card and a hidden caption track. On 9:16
  and 4:5 every window is above its headline and nothing overlaps; the
  split's halves are stacked and wider than tall with their labels on
  them; the captions are burned below the stacks; `check_project` finds
  nothing in the layout on 9:16, 4:5 or 1:1.
- `scripts/drive/versions-stack.js` makes the same film through MCP and
  measures every version with the engine's own text layout.
- **4:5 is tight.** `check_project` treats any tall frame like 9:16 and
  captions sit at the middle of a tall frame, so a 4:5 stack gets the top
  half of the apps' column and shrinks.
- **Only halves are read.** Three pictures in a row (a triptych), a
  picture beside two stacked titles in the same half, and layouts on a
  tall master made wide are placed set by set as before.
- **A box is a box.** Overlap is judged on boxes, not letters; a title
  beside a picture with room to spare still stacks.
