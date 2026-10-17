# ADR-052: Agents read what changed and export without a dialog

**Date:** 2026-10-17. **Status:** accepted.

## Context

Claude made a 36-second promo end to end over MCP (History, 2026-10-17).
The surface held, and showed four costs an agent should not pay:

- **Every edit answered with the whole timeline.** `describe_project`
  after each of about 40 edits: some 8 KB each, a third of a million
  characters for one short video, nearly all of it unchanged.
- **One edit per call.** Nine titles needed nine `set_animation` calls,
  five cuts five `set_transition` calls, each a separate undo step.
- **No way to export.** The export dialog asks where to save, and an
  agent has no one to answer it; the agent had to ask the user to export.
- **Silent settings.** `set_animation`, positions and text styles left no
  trace in `describe_project`, so an agent could not check them.

## Decision

- **Edits answer with what changed** (`describeChanges` in
  `src/lib/mcp.ts`): `describe_project` before and after, diffed by id
  into `added_clips`, `changed_clips` (as they are now, with their
  track), `removed_clips`, the same for tracks and assets, and any other
  part that differs, always with `duration`. `undo` and `redo` answer the
  same way. A diff of descriptions, not of documents, so whatever
  `describe_project` shows is exactly what a change reports: one place
  decides what an agent can see. `describe_project` gained animations,
  position and scale (when not the defaults) and a title's size, color
  and box, so those edits show.
- **`batch`** is a registry command: steps run in order on one document,
  so the whole batch is one undo step and one validation; a failing step
  names its number and nothing changes. The in-app AI assistant can use it
  too. `add_sticker` stays out (it draws its picture outside the
  registry).
- **`export_video`** writes into `<Videos>/<app name>/`, chosen by Rust
  (`export_begin_auto`), with no dialog. The page names only the file,
  never the folder, and an existing file is never replaced (" (2)"...),
  so an agent cannot write over anything or anywhere else; the dialog
  export keeps its rule that only the user picks a destination. The call
  waits up to 240 s (the desktop bridge gives a call 300 s) and otherwise
  answers `running`, followed by `export_status`. A toast shows the user
  an agent is exporting.

## Consequences

An edit's answer is usually under 300 bytes. Agents that relied on a
full description after an edit call `describe_project` (the in-app AI
assistant runs commands directly and is unaffected). Exports by agents
land in one predictable folder the user can find. The diff costs two
descriptions per edit, negligible next to the edit itself.
