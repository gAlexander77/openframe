# ADR-044: Trim previews read the applied edit

**Date:** 2026-10-16. **Status:** accepted.

## Decision

Drive the two-up view from the project after each gesture update, because
source bounds and neighboring clips can clamp pointer intent. Show the last
outgoing frame at `start + duration - 1`, never the exclusive end; show the
incoming frame at its start. Slip shows first/last frames, roll compares the
shared cut, and slide compares the surrounding clips. Other trims show the
selected clip's edges.

Render isolated clips with their own settings through the existing compositor
and private cursors. Omit transitions/other tracks and label this scope in the
view. Derive source times using the engine's speed/reverse/freeze mapping.
The panels do not change the program playhead or saved document.

Cancellation restores the original gesture snapshot and removes listeners;
loading a document clears the baseline. Decoder cleanup waits for pending
work so borrowed frames are not closed before their synchronous composite.

## Evidence and consequences

The desktop MCP drive decodes the numbered fixture's pixels for roll, slip,
slide and trim, then checks one-step Undo and Escape/pointer cancellation.
Both wide/narrow screenshots were inspected. Unit tests cover source clamps,
reverse/freeze and exact boundary selection. It is a clip-edge view rather
than a preview of the entire composite across the edit. See
[[Development pass 2026-10-16]] for evidence and pickup state.
