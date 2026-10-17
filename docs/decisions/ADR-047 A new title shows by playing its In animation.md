# ADR-047: A new title shows by playing its In animation

- **Date**: 2026-10-16 · **Status**: accepted

## Context

Text › Title › + adds the title at the playhead, so the playhead sits on
the first frame of its "rise" In animation, where the text has not risen
yet: the viewer shows an empty bounding box and the user cannot see what
they added ([[UX audit 2026-10-14]] UX-15). Every In animation starts that
way (a sticker's pop starts at zero size). The options:

1. Play the In animation once and stop where it has settled.
2. Draw the clip settled while it is selected and the player is paused.
3. Seek straight to the settled frame.
4. Add presets without an In animation.

## Decision

Option 1. After a text preset, template or sticker is added from the
library, if the playhead sits inside the new clips' In animations,
`revealAdded` (`src/state/apply.ts`) plays from the earliest start to where
the last In has settled (`revealSpan` in `src/lib/overlays.ts`) and parks
the playhead there. The run is silent: `player.preview(from, to)` plays on
the wall clock without scheduling sound, because half a second of the music
bed on every add would be noise. With reduced motion it is option 3. It
leaves playback and a playhead the clip already shows at alone, and
commands (`add_text`, MCP) never reveal: agents do not watch the viewer.

Option 2 was rejected because the viewer would stop showing the real frame
at the playhead: scrubbing a selected title through its animation, the way
you check it, would show it settled. Option 4 throws away the preset's
look.

## Consequences

The user sees the title arrive and then sees it in place; the playhead
ends the In's length (0.5 s for presets) after the clip's start, so the
next add at the playhead stacks on a new track above it rather than at the
same frame. Any transport command takes over from the run, as from
playback. `ponytail:` the run starts at the clip's start even when a drop
put the playhead a few frames into the animation.
