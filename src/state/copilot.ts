// The in-app copilot: a model running on the user's own machine (Ollama or
// LM Studio, both OpenAI-compatible) edits the timeline through the same MCP
// tools external agents use (ADR-008, ADR-009). Nothing leaves the
// computer. Each tool call is an ordinary undoable edit; "Undo all" rewinds
// a whole turn.

import { useSyncExternalStore } from "react";
import { COPILOT_SYSTEM, runTurn, toFunctionTools, type ChatMessage, type Step } from "../lib/copilot";
import { listTools } from "../lib/mcp";
import { store } from "./store";

export interface Provider {
  id: string;
  label: string;
  base: string;
}

export const PROVIDERS: Provider[] = [
  { id: "ollama", label: "Ollama", base: "http://127.0.0.1:11434" },
  { id: "lmstudio", label: "LM Studio", base: "http://127.0.0.1:1234" },
];

export interface Entry {
  role: "user" | "assistant" | "error";
  text: string;
  steps?: Step[];
  /** Undo depth the turn added, for Undo all. */
  edits?: number;
}

interface CopilotState {
  open: boolean;
  provider: string;
  model: string;
  models: string[];
  status: "idle" | "connecting" | "thinking" | "offline";
  entries: Entry[];
  live: Step[];
}

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem("copilot") ?? "{}") as Partial<CopilotState>;
  } catch {
    return {};
  }
})();

let state: CopilotState = { open: false, provider: saved.provider ?? "ollama", model: saved.model ?? "", models: [], status: "idle", entries: [], live: [] };
let history: ChatMessage[] = [{ role: "system", content: COPILOT_SYSTEM }];
const listeners = new Set<() => void>();
const set = (patch: Partial<CopilotState>) => {
  state = { ...state, ...patch };
  try {
    localStorage.setItem("copilot", JSON.stringify({ provider: state.provider, model: state.model }));
  } catch {
    /* settings just won't persist */
  }
  listeners.forEach((l) => l());
};

export function useCopilot(): CopilotState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => state,
  );
}

const provider = () => PROVIDERS.find((p) => p.id === state.provider) ?? PROVIDERS[0];

/** Models the local server offers; on Ollama only those that can call tools. */
export async function discoverModels() {
  set({ status: "connecting" });
  const p = provider();
  try {
    let models: string[];
    if (p.id === "ollama") {
      const r = await fetch(`${p.base}/api/tags`);
      const j = (await r.json()) as { models: { name: string; capabilities?: string[] }[] };
      models = j.models.filter((m) => !m.capabilities || m.capabilities.includes("tools")).map((m) => m.name);
    } else {
      const r = await fetch(`${p.base}/v1/models`);
      const j = (await r.json()) as { data: { id: string }[] };
      models = j.data.map((m) => m.id).filter((id) => !/embed/i.test(id));
    }
    set({ models, model: models.includes(state.model) ? state.model : (models[0] ?? ""), status: models.length ? "idle" : "offline" });
  } catch {
    set({ models: [], status: "offline" });
  }
}

export function setProvider(id: string) {
  set({ provider: id, model: "" });
  void discoverModels();
}

export function setModel(model: string) {
  set({ model });
}

export function toggleCopilot(open = !state.open) {
  set({ open });
  if (open && !state.models.length) void discoverModels();
}

// The image tool needs a vision model and a richer message format; the
// copilot works from describe_project instead.
const TOOLS = toFunctionTools(listTools().filter((t) => t.name !== "preview_frame"));

async function chat(messages: ChatMessage[]): Promise<ChatMessage> {
  const p = provider();
  const r = await fetch(`${p.base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: state.model, messages, tools: TOOLS, temperature: 0.2, stream: false }),
  });
  if (!r.ok) throw new Error(`${p.label} answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { choices: { message: ChatMessage }[] };
  const m = j.choices[0].message;
  return { role: "assistant", content: m.content ?? "", tool_calls: m.tool_calls };
}

async function callTool(name: string, args: unknown) {
  const res = await window.videoEditor.mcp({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args as Record<string, unknown> } });
  if (!res) return { text: "no response", isError: true };
  if (res.error) return { text: res.error.message, isError: true };
  const r = res.result as { content: { type: string; text?: string }[]; isError?: boolean };
  return { text: r.content.map((c) => c.text ?? "[image]").join("\n"), isError: !!r.isError };
}

export async function ask(text: string) {
  const q = text.trim();
  if (!q || state.status === "thinking") return;
  if (!state.model) {
    await discoverModels();
    if (!state.model) {
      set({ entries: [...state.entries, { role: "error", text: `No local model found. Start ${provider().label} with a model that supports tool calling (for example qwen3.5 in Ollama).` }] });
      return;
    }
  }
  set({ status: "thinking", live: [], entries: [...state.entries, { role: "user", text: q }] });
  const before = store.get().undoLabel;
  let edits = 0;
  const unsub = store.subscribe(() => void 0);
  try {
    const r = await runTurn(history, q, chat, async (name, args) => {
      const out = await callTool(name, args);
      if (!out.isError && store.get().undoLabel !== before) edits++;
      return out;
    }, (s) => set({ live: [...state.live, s] }));
    history = r.messages;
    const changed = r.steps.filter((s) => s.ok && !["describe_project", "list_catalog", "seek"].includes(s.tool)).length;
    set({ entries: [...state.entries, { role: "assistant", text: r.reply || "Done.", steps: r.steps, edits: changed }] });
  } catch (e) {
    set({ entries: [...state.entries, { role: "error", text: e instanceof Error ? e.message : String(e) }] });
  } finally {
    unsub();
    set({ status: "idle", live: [] });
  }
}

/** Undo every edit a copilot turn made. */
export function undoTurn(entry: Entry) {
  for (let i = 0; i < (entry.edits ?? 0); i++) store.undo();
  set({ entries: state.entries.map((e) => (e === entry ? { ...e, edits: 0 } : e)) });
}

export function resetChat() {
  history = [{ role: "system", content: COPILOT_SYSTEM }];
  set({ entries: [] });
}
