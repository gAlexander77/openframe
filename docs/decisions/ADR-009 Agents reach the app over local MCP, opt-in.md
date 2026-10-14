# ADR-009: Agents reach the app over local MCP, opt-in

- **Date**: 2026-10-14 · **Status**: accepted

## Context

ADR-008 made MCP a pure handler inside the webview. Agents outside the app
(Claude Code, Codex, any MCP client) need a transport, and the owner's
rules apply: everything stays on the user's machine, no server of ours. A
local server that can edit projects is also a door other local programs —
or a web page doing DNS rebinding — could knock on.

## Decision

- **Streamable HTTP on `127.0.0.1:47280/mcp`**, served by ~150 lines of
  std-only Rust (`src-tauri/src/mcp.rs`, no HTTP crate). Each POST becomes
  an `mcp-request` event; the webview's handler answers through
  `mcp_reply`; notifications get 202. No server-initiated stream (GET is
  405): every reply rides its POST.
- **`video-editor --mcp-stdio`**: the same exe, launched by a client as a
  process, pipes stdin/stdout lines to the running app's server. Clients
  that only speak stdio work unchanged.
- **Opt-in and locked**: off until "Allow AI agents" is turned on (the
  Copilot panel), remembered per machine. Every request needs the install's
  bearer token (in the app config dir, shown masked with copy buttons and a
  ready `claude mcp add` line); requests whose `Origin` is not localhost
  get 403, as the MCP spec asks of local servers.
- Fixed port so client configs survive restarts; a clear error if another
  copy already holds it.

## Consequences

Verified in the desktop app: an external client initialized, listed 33
tools, imported a file by path, placed it, added a title and received the
composited frame; no token gave 401, a foreign origin 403, and the stdio
bridge answered initialize and tools/list. The web build has no server;
its Copilot uses a local model directly.
