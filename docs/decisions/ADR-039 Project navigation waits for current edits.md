# ADR-039: Project navigation waits for current edits

**Date:** 2026-10-15. **Status:** accepted.

## Context

A headless reproduction delayed a real project write, added a text clip
while Back to home was waiting, then released the write. The saved document
lost that last clip: the 800 ms autosave timer had not run before navigation.
A second reproduction allowed Create project while an earlier card load was
pending; the delayed load could replace that new document.

## Decision

- After each successful write, compare the store revision with the saved
  revision. If it changed, save again before reporting success or leaving.
  Keep editing available during I/O. A stable successful save clears the
  pending debounce timer. Failed writes retain the existing retry behavior.
- One shared navigation guard covers New, Open, Back to home, presets,
  project cards and shortcuts. The first request owns the transition;
  overlapping requests return without queuing a later surprise navigation.
  Release the guard after success or failure.
- A loaded document enters only after the current document has saved. New
  saves the old project before replacing it; the new project's first save
  runs normally in the background so the editor is immediately usable.
- Home exposes a loading status and disables creation/deletion during a
  transition. Card keyboard activation handles Enter and Space only from
  the card itself; a nested Delete button cannot bubble into Open. Focus
  also reveals the delete control.

## Verification and limits

Seven `project-races` checks cover mid-save edits in real OPFS contents,
overlapping actions, loading failure/retry availability, nested Delete and
Space activation. All 15 existing `project-lifecycle` checks also pass,
including storage failures that must keep the editor open. The Home loading
screenshot was inspected. TypeScript and all 374 unit tests pass.

These are shared frontend checks through isolated headless Playwright MCP.
No native computer control, storage format change or new dependency. Native
disk failures still need desktop verification. This guard does not govern
long-running media import, analysis or export jobs; their project ownership
needs a separate audit before claiming all asynchronous edits are isolated.
