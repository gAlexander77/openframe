# ADR-008: MCP is a handler over the command registry

- **Date**: 2026-10-14 · **Status**: accepted

## Context

The owner wants AI agents to drive the editor through MCP, and to future-
proof the product for agent-made videos. ADR-006 already made every edit a
named command with a JSON Schema. What was missing: the protocol itself,
and the session-level things an agent needs that are not document edits —
importing files, undo, moving the playhead, and above all *seeing* the
result.

## Decision

- `src/lib/mcp.ts` implements MCP (protocol 2025-06-18) as one pure
  function, `handleMcp(request, host)`: JSON-RPC in, JSON-RPC out. It knows
  no transport. `initialize` carries short instructions for the model;
  `tools/list` is every registry command plus app tools
  (`describe_project`, `list_catalog`, `import_media`, `undo`, `redo`,
  `seek`, `preview_frame`); `resources` expose the project JSON and summary.
- **Tool failures are results with `isError`**, carrying the registry's
  path-precise messages, so the model can read them and retry; only
  protocol mistakes are JSON-RPC errors.
- **`preview_frame` returns the composited frame as a PNG** — the same
  pixels export produces — so an agent can check its own work visually.
- The live host is `window.videoEditor.mcp` (`src/automation.ts`). Every
  agent edit is an ordinary undoable edit, visible in the UI as it happens.

## Consequences

A transport is a few lines: the desktop app's local Streamable HTTP server
and a stdio bridge forward messages to `window.videoEditor.mcp` (planned
with the desktop platform); the web build can be driven the same way by a
page-level bridge. New features reach agents by adding a command — or, for
side effects like render and generate, an app tool here.
