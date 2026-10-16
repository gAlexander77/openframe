# Navigation and composition

Research and implementation review, 2026-10-15. The owner asked for more
features from established video editors. These choices build on the current
shared editor; they do not overlap the parked nesting, background-removal,
or timeline-drag branches.

## Research

- [Premiere: safe zones](https://helpx.adobe.com/premiere/desktop/get-started/source-and-program-monitor-adjustments/view-safe-zones-in-the-monitors.html)
  exposes monitor guides to help place important picture and text inside
  the visible area. OpenFrame already has canvas transforms but lacked a
  composition overlay.
- [Kdenlive: timeline markers](https://docs.kdenlive.org/en/cutting_and_assembling/guides.html)
  provides a searchable marker list, navigation, position/comment editing,
  and chapter export. OpenFrame stores marker IDs, frames, labels and colors
  already, but previously exposed only ruler flags and add/delete actions.
- [Premiere: comparison view](https://helpx.adobe.com/in/premiere/desktop/correct-color/color-mode-fundamentals/about-comparison-view.html)
  uses reference frames for shot matching. This is a useful next step for
  OpenFrame's existing grading and scopes, but requires a deliberate second
  preview path and memory/performance checks.

## Delivery choices

1. **Viewer guides:** Off, Safe margins, Rule of thirds, or both, available
   in the Player header and View menu. The two fixed safe boxes enclose 90%
   and 80% of each canvas dimension (5%/10% inset per edge). These are
   composition aids, not a guarantee of compliance with every delivery
   specification or social platform's UI. A DOM overlay follows the fitted
   frame and ignores pointer input, below editing handles. It never enters
   engine pixels, scopes, stills, or movie exports. Like preview quality, the
   choice belongs to the editor session, not project history or saved JSON.
2. **Marker management, next:** searchable chronological list with seek,
   rename, precise time, color and deletion, using existing document fields
   and undoable commands. Searching should filter the list, not hide ruler
   flags unexpectedly. Leave clip markers, ranges and category schemas for
   a separate compatibility decision.

## Remaining candidates

- Marker chapter-text export after the basic marker management workflow.
- Reference-frame comparison for matching shot grades.
- Named reusable effect presets and selective Paste Attributes (see
  [[Effect workflow]]). Preset persistence and keyframe timing need design.
- Two-up trim monitoring (already in [[Roadmap]]), to make existing roll and
  slip tools easier to judge. Avoid the paused timeline branch's drag work.

## Verification

`scripts/drive/viewer-guides.js` checks mode switching, View-menu sync,
landscape/portrait geometry, resizing/full screen, click-through, unchanged
project/history, and identical engine pixels and exported PNGs with guides
on/off. Runs use isolated headless Playwright MCP; native desktop testing
remains for the owner's separate test computer. No dependencies or project
schema fields were added.
