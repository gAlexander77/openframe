# ADR-065: One-click agent setup runs the agent's own CLI

**Date:** 2026-10-18. **Status:** accepted.

## Context

Connecting a coding agent to the desktop app's MCP server (ADR-009) meant
copying a line from the AI assistant panel into a terminal. The panel had
a ready-made `claude mcp add` line but nothing for the OpenAI Codex CLI,
whose users would otherwise hand-write `~/.codex/config.toml`.

The current syntax, read on 2026-10-18:

- **Codex CLI**: `codex mcp add <name> [--env K=V] -- <command> [args]` for
  a stdio server, `codex mcp add <name> --url <url>
  [--bearer-token-env-var VAR]` for Streamable HTTP; entries live in
  `~/.codex/config.toml` as `[mcp_servers.<name>]` with `command`, `args`,
  `env`, `env_vars`, `cwd` (stdio) or `url`, `bearer_token_env_var`,
  `http_headers`, `env_http_headers` (HTTP), plus `startup_timeout_sec`
  (10), `tool_timeout_sec` (60) and `enabled`. `codex mcp list`, `get`,
  `remove` and `login` manage them. Sources:
  <https://developers.openai.com/codex/mcp> (now served from
  learn.chatgpt.com/docs/extend/mcp) and the CLI's own source,
  <https://github.com/openai/codex/blob/main/codex-rs/cli/src/mcp_cmd.rs>.
- **`codex mcp add` replaces an existing entry of the same name silently**
  (`servers.insert`, then "Added global MCP server"), while `codex mcp get
  <name>` exits 1 with "No MCP server named '<name>' found." when there is
  none.
- **Claude Code**: `claude mcp add [--scope local|project|user]
  [--transport stdio|http] <name> -- <command> [args]`, or `<name> <url>
  --header "..."` for HTTP; the default scope is local (one project), and
  adding a name that exists at the same scope fails with "MCP server
  <name> already exists in <scope> config".
  <https://code.claude.com/docs/en/mcp>

## Decision

- **Each client gets the form its docs lead with.** Codex: the stdio
  bridge, `codex mcp add openframe -- "<exe>" --mcp-stdio`, so no token
  lands in its config (the bridge reads the token itself), with the
  equivalent `config.toml` entry as the fallback and `tool_timeout_sec =
  300` to match the bridge (an export answers within 240 s). Claude Code:
  Streamable HTTP with the bearer token, now `--scope user`, since the
  editor is not one project's tool.
- **On the desktop, "Add to Codex" and "Add to Claude Code" run that
  CLI's own `mcp add`** for the stdio bridge (`src-tauri/src/agent_cli.rs`),
  so each config is written by its owner in its own format. We never write
  an agent's config file ourselves.
- **Never over an existing entry**: Codex is asked first (`codex mcp get
  openframe`): present is reported as already added; an answer that is
  neither present nor "No MCP server named" (an older Codex without `get`,
  a broken config) stops with the CLI's words rather than risk `add`
  replacing something. Claude Code refuses a duplicate itself, which is
  reported the same way.
- **Only a CLI found on PATH** (`.exe`, `.cmd` and `.bat` on Windows, so an
  npm shim counts); otherwise the panel says so and offers the CLI's install
  guide, opened in the default browser by Rust from a fixed list.
- **The webview names a CLI, never a command**: Rust builds the arguments
  from its own exe path, so a compromised page cannot register an
  arbitrary command in an agent's config. No console window, no input, a
  60 s limit.
- The web build has no MCP server, so it shows neither the lines nor the
  buttons, only how to connect through the desktop app.

## Consequences

Checked against the real CLIs (codex-cli 0.163.0 through its npm shim,
Claude Code 2.1.303) with every config location moved into `scratch/`
(`cargo test real_clis -- --ignored`): the first add reports added, the
second already added, and the entries are the CLIs' own (Codex wrote
`command = '<exe>'`, `args = ["--mcp-stdio"]`; Claude Code a `stdio`
server under `mcpServers`). The user's own configs were not touched. The
panel's results, the rows and the buttons' visibility are checked with
the desktop's IPC mocked (`scripts/drive/assistant.js`).

Not checked on this machine: the install guide opening (it would open a
browser window on the owner's desktop), macOS and Linux. A macOS app
opened from Finder gets launchd's short PATH, so a Homebrew or npm CLI can
read as missing there; the copy rows still work. The one-click Codex entry
keeps Codex's 60 s tool timeout (its `mcp add` has no flag for it); the
`config.toml` snippet sets 300.
