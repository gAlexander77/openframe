import { useEffect, useState } from "react";
import { Check, Copy } from "../icons";
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

function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [done, setDone] = useState(false);
  const [show, setShow] = useState(!secret);
  return (
    <div className="agent-row">
      <span className="agent-label">{label}</span>
      <code className="agent-value" onClick={() => setShow(true)} data-tip={secret && !show ? "Click to reveal" : undefined}>
        {show ? value : "•".repeat(Math.min(24, value.length))}
      </code>
      <button
        className="icon-btn small"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }}
      >
        {done ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

/** "Allow AI agents": the MCP server external agents (Claude Code, Codex,
 * any MCP client) connect to, with copy-ready connection details. */
export function AgentsSection() {
  const [info, setInfo] = useState<AgentEndpoint | null>(endpoint);
  const [error, setError] = useState("");
  useEffect(() => setInfo(endpoint), []);
  if (!platform.agents) {
    return <p className="agents-note">External AI agents connect to the desktop app over MCP. In the browser, Copilot works with a model on this computer.</p>;
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
          <span>Let agents such as Claude Code edit this project over MCP. Only programs on this computer with the token can connect.</span>
        </div>
        <Toggle label="Allow AI agents" on={!!info} onChange={(v) => void toggle(v)} />
      </div>
      {error && <p className="agents-error">{error}</p>}
      {info && (
        <div className="agents-info">
          <CopyRow label="URL" value={info.url} />
          <CopyRow label="Token" value={info.token} secret />
          <CopyRow label="Claude Code" value={`claude mcp add --transport http video-editor ${info.url} --header "Authorization: Bearer ${info.token}"`} secret />
          <CopyRow label="stdio" value={info.stdio} />
        </div>
      )}
    </div>
  );
}
