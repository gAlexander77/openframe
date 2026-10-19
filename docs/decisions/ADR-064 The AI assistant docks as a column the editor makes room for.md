# ADR-064: The AI assistant docks as a column the editor makes room for

**Date:** 2026-10-18. **Status:** accepted.

## Context

The AI assistant was a drawer fixed over the right of the window
(`position: fixed`, 380 px). It covered the inspector, the timeline's zoom
controls, the player header's scopes toggle and the viewer's loudness
meter, and sat 6 px below the inspector it covered, so the inspector's
rounded corner showed above it like a second tab. Its prompt box ended
6 px from the window's bottom edge.

A chat needs height more than width: the message list is what grows.
Premiere docks a side panel (Essential Graphics, Lumetri) as a full-height
column and code editors do the same with their chat; CapCut's side panels
are top-row only, which here would leave a 1100 x 680 window about 200 px
of conversation.

Measured on 2026-10-18 (the dock drive checks each), the editor's parts
stop working below: the player 456 px (its transport's controls, 434 px,
once the timecodes hide), the inspector 248 px (its width at the 1100 px
minimum window, which the style sweep proves), the library 240 px (its
splitter's floor), and the timeline toolbar 844 px of tools, or 728 once
the zoom slider goes.

## Decision

- **A full-height column at the editor's right**, in the workspace grid:
  the top row, its splitter and the timeline in the first column, a
  splitter and the panel spanning all three rows. It lines up with the
  inspector's top and the timeline's bottom and uses the panels' surface,
  radius and gap.
- **The editor lays out as if the window were narrower** by the column:
  the side panels keep their shares of the editor's width, not the
  window's (`src/lib/dock.ts`), so opening the panel scales the editor
  down instead of crushing the player.
- **Widths**: 22% of the window, 300 px at least and 560 at most, and never
  so wide that the editor has under 760 px (the compact toolbar plus
  padding). Dragging its splitter resizes it; double-click resets. The
  width is saved per viewer with the assistant's other settings.
- **The library steps aside when four columns do not fit** with the
  player at 456 px and the inspector at 248: the window is then too narrow
  for it (1100 px), as Scopes already take its slot. Closing the panel or
  a wider window brings it back. The player keeps its place, so its canvas
  is never remounted.
- **The timeline toolbar queries its own width**: below 844 px of content
  the zoom slider hides and Fit and the zoom buttons stay.
- **The title-bar toggle carries `aria-pressed`** and the app's on style
  (`--accent-soft`), so it reads as open wherever focus is.

## Consequences

At 1600 x 950 the panel is 352 px beside a 579 px player and a 360 px
library; at 1280 x 720 300 px beside a 456 px player and a 246 px library;
at 1100 x 680 300 px beside a 528 px player, the library aside. Nothing is
covered: `scripts/drive/assistant.js` checks the column against every
panel, the scopes toggle, the meter and the zoom controls at the three
sizes, and the style sweep audits both of the panel's views there.

A new tool in the timeline toolbar or the player's transport changes the
measured widths: remeasure them (the comments in `dock.ts`,
`timeline.css` and `player.css` say where).

## Addendum, 2026-10-19: floating below 1066 px, the player's floor

Below 1066 px (the editor's 760 plus the gap and the column's 300; only a
browser tab, as the desktop window stops at 1100) the column used to keep
its minimum while the editor squeezed: at 900 x 600 the player was 330 px
and its play button sat under the zoom menu, and the timeline's tools
were crowded below the toolbar's 748 px. There the column now **floats over the editor's right side**
(`canDock` in `dock.ts`), as a drawer with a shadow: the editor keeps the
layout it has without the panel, and closing the panel uncovers it. No
splitter there; the column is 300 px.

The same width floor now holds for the splitters: a side panel dragged
toward its cap (library 640 px, inspector 560) stops where the player
would drop under 456 px (`sideMax`). At 1100 px a library at its cap had
left the player 320 px. `scripts/drive/sizes-shell.js` checks the player's
width with every splitter at its limits at seven window sizes, and the
floating column at 1024 and 900.
