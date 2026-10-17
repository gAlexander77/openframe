// The in-app AI assistant: a model running on the user's own machine (Ollama or
// LM Studio, both OpenAI-compatible) edits the timeline through the same MCP
// tools external agents use (ADR-008, ADR-009). Nothing leaves the
// computer. Each tool call is an ordinary undoable edit; "Undo all" rewinds
// a whole turn.

import { useSyncExternalStore } from "react";
import { ASSISTANT_SYSTEM, runTurn, toFunctionTools, type ChatMessage, type Step } from "../lib/assistant";
import { listTools } from "../lib/mcp";
import { platform } from "../platform";
import { projectWork } from "./projectWork";
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

interface AssistantState {
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
    return JSON.parse(localStorage.getItem("assistant") ?? localStorage.getItem("copilot") ?? "{}") as Partial<AssistantState>;
  } catch {
    return {};
  }
})();

let state: AssistantState = { open: false, provider: saved.provider ?? "ollama", model: saved.model ?? "", models: [], status: "idle", entries: [], live: [] };
let history: ChatMessage[] = [{ role: "system", content: ASSISTANT_SYSTEM }];
const listeners = new Set<() => void>();
const set = (patch: Partial<AssistantState>) => {
  state = { ...state, ...patch };
  try {
    localStorage.setItem("assistant", JSON.stringify({ provider: state.provider, model: state.model }));
  } catch {
    /* settings just won't persist */
  }
  listeners.forEach((l) => l());
};

export function useAssistant(): AssistantState {
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
// The desktop app reaches the model servers through Rust (their CORS
// refuses its origin); the web build fetches them directly.
const localFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  platform.fetchModel ? platform.fetchModel(url, init) : fetch(url, init);

export async function discoverModels() {
  set({ status: "connecting" });
  const p = provider();
  try {
    let models: string[];
    if (p.id === "ollama") {
      const r = await localFetch(`${p.base}/api/tags`);
      const j = (await r.json()) as { models: { name: string; capabilities?: string[] }[] };
      models = j.models.filter((m) => !m.capabilities || m.capabilities.includes("tools")).map((m) => m.name);
    } else {
      const r = await localFetch(`${p.base}/v1/models`);
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

export function toggleAssistant(open = !state.open) {
  set({ open });
  if (open && !state.models.length) void discoverModels();
}

// A small local model loses its way among all 30 tools (the first live run
// with a 9B model called freeze, marker and transition tools instead of
// adding a title). The assistant gets the everyday edits; external agents
// still see everything over MCP.
const ASSISTANT_TOOLS = new Set([
  "describe_project", "add_text", "add_media_clip", "add_color_clip", "split", "delete_clips", "move_clip",
  "trim_clip", "set_speed", "set_param", "set_transition", "add_effect", "set_filter", "set_animation", "undo",
]);
const TOOLS = toFunctionTools(listTools().filter((t) => ASSISTANT_TOOLS.has(t.name)));

/** The timeline as it is right now, so the model starts with the ids
 * instead of spending a step (or getting lost) looking them up. */
function contextMessage(): ChatMessage {
  return { role: "system", content: `Current timeline (times in seconds):\n${JSON.stringify(window.videoEditor.describe())}` };
}

type OllamaMessage = { role: string; content: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[]; tool_name?: string };

async function chat(messages: ChatMessage[]): Promise<ChatMessage> {
  const p = provider();
  const withContext = [messages[0], contextMessage(), ...messages.slice(1)];
  if (p.id === "ollama") {
    // Ollama's native API can switch reasoning off, which makes small models
    // far quicker and more decisive with tools.
    const body = {
      model: state.model,
      stream: false,
      think: false,
      options: { temperature: 0.1 },
      tools: TOOLS,
      messages: withContext.map((m): OllamaMessage => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls.map((t) => ({ function: { name: t.function.name, arguments: JSON.parse(t.function.arguments || "{}") } })) } : {}),
      })),
    };
    const r = await localFetch(`${p.base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Ollama answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const m = ((await r.json()) as { message: OllamaMessage }).message;
    return {
      role: "assistant",
      content: m.content ?? "",
      tool_calls: m.tool_calls?.map((t, i) => ({ id: `call_${Date.now()}_${i}`, type: "function", function: { name: t.function.name, arguments: JSON.stringify(t.function.arguments ?? {}) } })),
    };
  }
  const r = await localFetch(`${p.base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: state.model, messages: withContext, tools: TOOLS, temperature: 0.1, stream: false }),
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
  // A turn edits the project it started in: after a switch, no further tool
  // runs and the next model round trip stops the turn.
  const session = projectWork.signal();
  try {
    const r = await runTurn(history, q, (m) => (session.aborted ? Promise.reject(new Error("The project changed during this request, so the AI assistant stopped.")) : chat(m)), async (name, args) => {
      if (session.aborted) return { text: "The project was closed; nothing was changed.", isError: true };
      const out = await callTool(name, args);
      if (!out.isError && store.get().undoLabel !== before) edits++;
      return out;
    }, (s) => set({ live: [...state.live, s] }));
    if (session.aborted) return; // the chat was reset for the new project
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

// A chat belongs to one open project: its history describes that project,
// and Undo turn steps back through that project's history.
let chatSession = projectWork.signal();
store.subscribe(() => {
  if (projectWork.signal() === chatSession) return;
  chatSession = projectWork.signal();
  resetChat();
});

/** Undo every edit an assistant turn made. */
export function undoTurn(entry: Entry) {
  for (let i = 0; i < (entry.edits ?? 0); i++) store.undo();
  set({ entries: state.entries.map((e) => (e === entry ? { ...e, edits: 0 } : e)) });
}

export function resetChat() {
  history = [{ role: "system", content: ASSISTANT_SYSTEM }];
  set({ entries: [] });
}
