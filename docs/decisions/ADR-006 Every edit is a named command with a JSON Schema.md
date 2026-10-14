# ADR-006: Every edit is a named command with a JSON Schema

- **Date**: 2026-10-13 · **Status**: accepted

## Context

The owner wants AI agents to drive the editor — an in-app copilot now, an
MCP server and automated "script to finished video" pipelines later — and
asked that the product be built with that in mind from day one. Agents
need: a discoverable list of actions, machine-checkable argument shapes,
error messages they can act on, and a way to read the timeline back.
Retrofitting that onto UI handlers is how editors end up with automation
that can only press buttons.

## Decision

`src/lib/commands.ts` is the registry. Each command has a snake_case
`name`, a plain-English `description`, a JSON Schema `input`, and a pure
`run(project, args) -> project` built on the same `ops.ts` functions the UI
uses. `runCommand` validates arguments first and reports every problem with
its path. `describeProject` returns a compact, LLM-readable timeline.

- Command arguments use **seconds** (what people and models think in) and
  snap to frames; the stored document stays in frames ([[ADR-004 Timeline
  time is integer frames]]).
- The schema subset is deliberately small (object, string, number,
  integer, boolean, array, enum, min/max) so the same definitions serve as
  Anthropic/OpenAI tool definitions and MCP `inputSchema` unchanged.
- Commands that touch the outside world (import, render, generate media)
  will live one layer up, in the app's automation API, because they need
  the platform and the engine; the registry stays pure and testable.

## Consequences

An MCP server is a thin adapter: list `COMMANDS`, forward `tools/call` to
`runCommand`, apply the result through the store so it is undoable. Every
new editing feature should add its command in the same change — a feature
an agent cannot reach is a gap. See [[AI and automation]].
