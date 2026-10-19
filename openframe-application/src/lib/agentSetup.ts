// Ready-made lines for connecting coding agents to the desktop app's MCP
// server (ADR-009, ADR-065). Codex and Claude Code each get the form their
// own docs lead with: Codex launches the stdio bridge (the exe with
// --mcp-stdio, which reads the token itself, so no secret lands in its
// config), Claude Code speaks Streamable HTTP with the bearer token.
// Syntax as documented on 2026-10-18:
//   https://developers.openai.com/codex/mcp (codex mcp add, [mcp_servers])
//   https://code.claude.com/docs/en/mcp (claude mcp add, --scope user)

/** The server's name in every agent's config. */
export const SERVER_NAME = "openframe";

/** The stdio bridge's own flag (src-tauri/src/mcp.rs). */
export const STDIO_FLAG = "--mcp-stdio";

/** A path as one shell word. Windows paths cannot contain a double quote.
 * ponytail: a macOS or Linux path holding `"`, `$` or a backtick would need
 * single quotes; the config.toml snippet is the fallback there. */
const word = (path: string) => `"${path}"`;

/** `codex mcp add <name> -- <command>`: Codex's stdio form. */
export const codexAddLine = (exe: string) => `codex mcp add ${SERVER_NAME} -- ${word(exe)} ${STDIO_FLAG}`;

/** Claude Code over HTTP, for every project (user scope), the token in a
 * header. */
export const claudeAddLine = (url: string, token: string) =>
  `claude mcp add --transport http --scope user ${SERVER_NAME} ${url} --header "Authorization: Bearer ${token}"`;

/** A TOML basic string: backslashes, quotes and control characters
 * escaped, so a Windows path reads back exactly. */
export function tomlString(s: string): string {
  const esc: Record<string, string> = { "\\": "\\\\", '"': '\\"', "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r" };
  return `"${s.replace(/[\\"\u0000-\u001f\u007f]/g, (c) => esc[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;
}

/** The `~/.codex/config.toml` entry `codex mcp add` would write, plus a
 * tool timeout to match the bridge's: Codex gives a tool 60 s by default,
 * and an export answers within 240 s (mcp.ts). */
export const codexToml = (exe: string) =>
  `[mcp_servers.${SERVER_NAME}]\ncommand = ${tomlString(exe)}\nargs = [${tomlString(STDIO_FLAG)}]\ntool_timeout_sec = 300\n`;

/** Where each CLI's install guide lives, for "not found". */
export const INSTALL_PAGES = {
  codex: "https://developers.openai.com/codex/cli",
  claude: "https://code.claude.com/docs/en/setup",
} as const;

export type AgentCli = keyof typeof INSTALL_PAGES;

/** What "Add to Codex" or "Add to Claude Code" did (agent_cli.rs). */
export interface AgentCliResult {
  status: "added" | "exists" | "missing" | "failed";
  /** The CLI's own words, for added and failed. */
  detail: string;
}

/** The line the panel shows for a result. */
export function resultText(cli: AgentCli, r: AgentCliResult): string {
  const name = cli === "codex" ? "Codex" : "Claude Code";
  switch (r.status) {
    case "added":
      return `Added to ${name}. Start a new ${name} session to use it.`;
    case "exists":
      return `${name} already has a server named "${SERVER_NAME}"; nothing was changed.`;
    case "missing":
      return `The ${cli} command was not found on this computer.`;
    case "failed":
      return `${name} could not add it${r.detail ? `: ${r.detail}` : "."}`;
  }
}
