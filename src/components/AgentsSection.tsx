import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Eye, EyeOff, Loader2, Plug } from "../icons";
import { claudeAddLine, codexAddLine, codexToml, resultText, type AgentCli, type AgentCliResult } from "../lib/agentSetup";
import { platform, type AgentEndpoint } from "../platform";
import { Toggle } from "./inspector/controls";

const KEY = "agents-enabled";
const remembered = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

let endpoint: AgentEndpoint | null = null;

/** Turn the MCP server back on at startup if the user left it on. */
export async function restoreAgents() {
  if (platform.agents && remembered()) endpoint = await platform.agents.enable(true).catch(() => null);
}

/** A value to copy: wrapped whole (a command cut off by an ellipsis cannot
 * be checked by eye), hidden until asked when it holds the token. */
function CopyRow({ label, value, secret, block }: { label: string; value: string; secret?: boolean; block?: boolean }) {
  const [done, setDone] = useState(false);
  const [show, setShow] = useState(!secret);
  const copy = () =>
    navigator.clipboard.writeText(value).then(
      () => {
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      },
      () => setShow(true), // no clipboard here: show it to copy by hand
    );
  return (
    <div className="agent-row">
      <span className="agent-label">{label}</span>
      <code className={`agent-value${block ? " block" : ""}`}>{show ? value : "•".repeat(24)}</code>
      <span className="agent-row-tools">
        {secret && (
          <button className="icon-btn small" aria-label={show ? `Hide ${label}` : `Show ${label}`} data-tip={show ? "Hide" : "Show"} onClick={() => setShow((v) => !v)}>
            {show ? <EyeOff /> : <Eye />}
          </button>
        )}
        <button className="icon-btn small" aria-label={`Copy ${label}`} data-tip={done ? "Copied" : "Copy"} onClick={() => void copy()}>
          {done ? <Check /> : <Copy />}
        </button>
      </span>
    </div>
  );
}

const CLI_NAMES: Record<AgentCli, string> = { codex: "Codex", claude: "Claude Code" };

/** One agent CLI: a one-click add on the desktop (the CLI's own `mcp add`,
 * ADR-065), and the lines to paste. */
function Client({ cli, children }: { cli: AgentCli; children: React.ReactNode }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AgentCliResult | null>(null);
  const agents = platform.agents;
  const add = async () => {
    setRunning(true);
    setResult(null);
    try {
      setResult(await agents!.addTo!(cli));
    } catch (e) {
      setResult({ status: "failed", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  };
  return (
    <section className="agent-client" aria-label={CLI_NAMES[cli]}>
      <header>
        <strong>{CLI_NAMES[cli]}</strong>
        {agents?.addTo && (
          <button className="btn agent-add" disabled={running} onClick={() => void add()}>
            {running ? <Loader2 size={13} className="spin" /> : <Plug size={13} />} Add to {CLI_NAMES[cli]}
          </button>
        )}
      </header>
      {result && (
        <p className={`agent-result ${result.status}`} role="status">
          {resultText(cli, result)}{" "}
          {result.status === "missing" && agents?.openInstallPage && (
            <button className="link-btn" onClick={() => void agents.openInstallPage!(cli).catch(() => undefined)}>
              Install {CLI_NAMES[cli]} <ExternalLink size={11} />
            </button>
          )}
        </p>
      )}
      {children}
    </section>
  );
}

/** "Allow AI agents": the MCP server external agents (Claude Code, Codex,
 * any MCP client) connect to, with ready-made ways to connect each. */
export function AgentsSection() {
  const [info, setInfo] = useState<AgentEndpoint | null>(endpoint);
  const [error, setError] = useState("");
  useEffect(() => setInfo(endpoint), []);
  if (!platform.agents) {
    return (
      <p className="agents-note">
        Coding agents such as Codex and Claude Code connect to the OpenFrame desktop app over MCP: open your project there and turn on Allow AI agents here, under Connect agents.
        In the browser, the AI assistant works with a model on this computer.
      </p>
    );
  }
  const toggle = async (on: boolean) => {
    setError("");
    try {
      endpoint = await platform.agents!.enable(on);
      setInfo(endpoint);
      try {
        localStorage.setItem(KEY, on ? "1" : "0");
      } catch {
        /* the toggle just won't persist */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="agents">
      <div className="agents-head">
        <div>
          <strong>Allow AI agents</strong>
          <span>Let agents such as Codex and Claude Code edit this project over MCP. Only programs on this computer with the token can connect.</span>
        </div>
        <Toggle label="Allow AI agents" on={!!info} onChange={(v) => void toggle(v)} />
      </div>
      {error && <p className="agents-error">{error}</p>}
      {info && (
        <div className="agents-info">
          <Client cli="codex">
            <CopyRow label="Command" value={codexAddLine(info.exe)} />
            <CopyRow label="config.toml" value={codexToml(info.exe)} block />
          </Client>
          <Client cli="claude">
            <CopyRow label="Command" value={claudeAddLine(info.url, info.token)} secret />
          </Client>
          <section className="agent-client" aria-label="Any MCP client">
            <header>
              <strong>Any MCP client</strong>
            </header>
            <CopyRow label="URL" value={info.url} />
            <CopyRow label="Token" value={info.token} secret />
            <CopyRow label="stdio" value={info.stdio} />
          </section>
        </div>
      )}
    </div>
  );
}
