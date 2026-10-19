# ADR-093: An AI agent's changes are announced at the top, under the Bot

**Date:** 2026-10-19. **Status:** accepted.

## Context

An agent connected over MCP (Codex, Claude Code) or the docked assistant
edits the open project live. While the third launch film was edited that
way, the timeline changed with nothing saying who changed it: the app's
toasts were the same pills at the bottom whether the user or an agent
acted, and most agent edits raised none. The owner asked for the AI robot
icon on the notifications of AI actions, so the user knows it is their AI
agent making the changes.

## Decision

- **Every tool call is the agent's.** The desktop bridge and the docked
  assistant both send MCP `tools/call` through `window.videoEditor.mcp`;
  that one door runs the call as the agent's (`asAgent` in
  `src/state/toast.ts`). Scripts calling `exec` directly and the user's own
  edits are not.
- **A call that changes the project says so.** One notice names the edit
  (its undo label, `commandLabel`); a run of edits retitles the same notice
  rather than stacking, and it leaves three seconds after the last.
  Read-only calls (describe, previews, checks) raise nothing.
- **Agent toasts stand apart.** The notice and any toast raised during the
  call (an export's progress, an error) show at the top center, under the
  title bar, marked "AI agent" with the Bot icon ([[Icons]]: the assistant's
  icon) and an accent ring. The user's own toasts stay at the bottom.

## Consequences

- The user sees the agent act, edit by edit, where the eye already is (the
  player), and the bottom toasts stay theirs.
- **Ceiling:** a toast of the user's own raised while an agent's long call
  is running (an export) is marked as the agent's too: the mark follows a
  counter of calls in flight, not each call's own async context.
  `AsyncContext`, once browsers ship it, would tell them apart.
- Checked by `scripts/drive/agent-notice.js` at 1100, 1600 and 2560 wide.
