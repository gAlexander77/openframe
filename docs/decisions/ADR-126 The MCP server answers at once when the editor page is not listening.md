# ADR-126: The MCP server answers at once when the editor page is not listening

**Date:** 2026-10-21. **Status:** accepted.

## Context

Vite re-bundled a dependency and reloaded the editor into a blank page.
JavaScript failed before React mounted, so no MCP listener returned.
The HTTP server still waited 300 seconds for each reply. Claude Code
gave up connecting after 30 seconds with only "connection timed out."

## Decision

- Track whether the page is listening separately from whether the server
  is running. Every `mcp_enable(true)` restores the flag, even when the
  server is already on; disabling clears it.
- When the main page starts loading, Tauri's page-load hook clears the
  flag and drains pending requests with a `PageGone` reply.
- While no page is listening, answer at once with a JSON-RPC error that
  explains the editor is starting, reloading, or stopped on an error,
  and suggests retrying or restarting OpenFrame.
- An interrupted request gets an error asking the agent to check the
  project with `describe_project` before retrying an edit. Errors keep
  the request id and use HTTP 200; notifications get an empty HTTP 202.
- Keep the 300-second timeout and HTTP 504 for a listening but slow page.
  Long exports legitimately take minutes.

## Consequences

- An agent learns in milliseconds why nothing works instead of timing out.
- An edit in flight during a reload is reported as possibly applied,
  so the agent can check before making the same edit twice.
- Rust still parses only the id. The webview continues to interpret MCP.
