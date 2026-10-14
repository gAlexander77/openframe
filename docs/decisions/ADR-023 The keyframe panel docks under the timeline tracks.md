# ADR-023: The keyframe panel docks under the timeline tracks

- **Date**: 2026-10-14 · **Status**: accepted

## Context

CapCut's Alt+K "Show keyframe animation" opens per-property lanes with
curve editing ([[CapCut desktop]] §2.10). Pros put that editor in one of
three places: a separate panel with its own mini timeline (Premiere's
Effect Controls), a graph window (After Effects), or under the clip in the
main timeline (Resolve's keyframe and curve tracks). Our layout is CapCut's
four panels, and the inspector is 360 px wide: too narrow for a time axis.
A floating window would need its own zoom and scroll, kept in sync with the
timeline's by hand.

## Decision

The panel is a resizable sub-area at the bottom of the timeline panel
(`src/components/KeyframePanel.tsx`), toggled by the keymap's
`toggleKeyframePanel`, the toolbar and the clip's right-click menu. It
**shares the timeline's time axis**: the same zoom, the same horizontal
scroll, the same 112 px header column, so a key in the panel sits exactly
under its diamond on the clip, and Ctrl+wheel over it zooms the timeline.
It shows the selected clip only: one lane per animated path, then a value
graph of the focused lane in display units (Scale in %, Position in px
with Y up, Volume in dB, from `lib/paramInfo.ts`). The graph is SVG: a
few dozen keys, hit-tested by element, styled by CSS.

## Consequences

No second time axis to synchronize, and playhead, snapping and seeking
behave as on the tracks. The panel takes height from the tracks while
open; its height persists per machine. Only the focused lane is graphed;
overlaid multi-curve views (AE's) and a speed graph wait for a need. The
value axis freezes during a drag so the graph never rescales under the
pointer. A bezier handle that coincides with its key (Ease in's arriving
handle) sits under the key and cannot be grabbed in the graph.
