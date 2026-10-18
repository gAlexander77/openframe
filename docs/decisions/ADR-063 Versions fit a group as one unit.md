# ADR-063: Versions fit a group as one unit

**Date:** 2026-10-18. **Status:** accepted.

## Context

`export_versions` (`lib/versions.ts`) makes an ad's other shapes from the
master. A blind test built a 9:16 ad through MCP (an `add_ad_element` end
card with a logo, headline, button and url, an offer badge with a tag, a
kinetic headline) and asked for 16:9, 1:1 and 4:5. In all three the end
card's url ran into its button and the button into its headline.

Each layer was refit alone. Text kept its pixel size against the frame's
short side (a title is as big on a phone), but positions stayed fractions
of the frame, so from 1920 tall to 1080 tall the stack's spacing shrank to
0.56 of what it was while its type did not: the type grew 1.78 times
against its own layout. Moving the group into the safe area afterwards
(the old `clampOverlays`) kept the parts together but could not undo
that.

The same test found the elements themselves off their descriptions on
9:16: the "always centered" end card sat 4% left of center (centered in
TikTok's safe area, whose right side is 19% for the buttons against 11% on
the left), spilled past the area at both ends, and a wide offer badge,
"top right", reached the middle of the frame.

## Decision

- **The overlays of the master are taken in sets**: the clips of a group
  (an ad element's parts, a user's grouped lower third) as one, every
  other overlay alone. Full-frame footage and backgrounds are not
  overlays.
- **A group moves and scales as one unit.** Each part's size grows with
  the short side (as before) and so does its offset from the group's box,
  so the layout is the master's, larger or smaller. A title in a group
  wraps at a width that grows with its type, so its lines break where they
  did. When the whole would not fit the new safe area (90% title safe; on
  9:16 also clear of the bottom 35%, the right 19%, the top 14% and the
  left 11%), it shrinks to fit, every part alike. It never grows to fill.
- **A set keeps its anchor**: where it sat in the free room of the
  master's safe area, from 0 (against the start edge) to 1 (against the
  end), is where it sits in the new one, so a badge against the top right
  stays against the top right, and a centered card centered. A set that
  was not inside the master's safe area (a picture centered on a 9:16
  frame reaches into the captions' band) is measured against the whole
  frame instead.
- **A set centered on the frame stays on the center line**: on 9:16 its
  room is the safe area made even about the center (19% each side), as
  `lib/ads.ts` lays a centered element out in the first place.
- **A lone overlay keeps its own refit** (a title shrinks to three
  quarters at most, then wraps to the new width) and only moves.
- **Shapes refit in pixels against the short side**, as boxes cut from a
  solid already did: their width and height are fractions of the frame,
  so they stretched with it.
- `lib/ads.ts` builds by the same rules: a centered element in the even
  room, a badge on its half of the frame, an element too big for its room
  built again smaller (type, logo, boxes and gaps alike), no text under
  the readable floor (`minTextSize`: 40 px at a 1080 short side, so 22.5
  on a 1920-tall 9:16 canvas), and type over footage with a shadow and an
  outline.

## Consequences

The drive `scripts/drive/ad-versions.js` builds that ad through MCP and
measures every version: no two text boxes of the end card or the badge
intersect (turned boxes, separating axes), all inside the safe area,
none under the floor. A group shrunk to fit is not held at the text floor:
keeping one part's size would break the layout the group is kept for; a
9:16 element at the floor stays at it in 16:9, 1:1 and 4:5 since the
floor scales with the short side too. Positions are read at the first
frame; a part's keyframed motion moves with its group but keeps its size
in frame fractions.
