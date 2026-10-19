// The in-app AI assistant: a model running on the user's own machine (Ollama or
// LM Studio, both OpenAI-compatible) edits the timeline through the same MCP
// tools external agents use (ADR-008, ADR-009). Nothing leaves the
// computer. Each tool call is an ordinary undoable edit; "Undo all" rewinds
// a whole turn.

import { useSyncExternalStore } from "react";
import { ASSISTANT_SYSTEM, runTurn, toFunctionTools, type ChatMessage, type Step } from "../lib/assistant";
import { DOCK } from "../lib/dock";
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
  /** The docked column's width, of the window (ADR-064). */
  width: number;
  provider: string;
  model: string;
  models: string[];
  status: "idle" | "connecting" | "thinking" | "offline";
  /** Why it is offline: the server did not answer, or it has no model
   * that can call tools. */
  problem: "unreachable" | "no-models" | null;
  entries: Entry[];
  live: Step[];
  /** When the running turn started (ms), for its elapsed time. */
  started: number;
}

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem("assistant") ?? localStorage.getItem("copilot") ?? "{}") as Partial<AssistantState>;
  } catch {
    return {};
  }
})();

const savedWidth = typeof saved.width === "number" && saved.width > 0 && saved.width < 0.6 ? saved.width : DOCK.assistantShare;
let state: AssistantState = {
  open: false,
  width: savedWidth,
  provider: saved.provider ?? "ollama",
  model: saved.model ?? "",
  models: [],
  status: "idle",
  problem: null,
  entries: [],
  live: [],
  started: 0,
};
let history: ChatMessage[] = [{ role: "system", content: ASSISTANT_SYSTEM }];
const listeners = new Set<() => void>();
const set = (patch: Partial<AssistantState>) => {
  state = { ...state, ...patch };
  try {
    localStorage.setItem("assistant", JSON.stringify({ provider: state.provider, model: state.model, width: state.width }));
  } catch {
    /* settings just won't persist */
  }
  listeners.forEach((l) => l());
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useAssistant(): AssistantState {
  return useSyncExternalStore(subscribe, () => state);
}

/** One value of the state, re-rendering only when it changes: the title
 * bar and the layout need open and width, not every step of a turn. */
export function useAssistantValue<T extends string | number | boolean | null>(pick: (s: AssistantState) => T): T {
  return useSyncExternalStore(subscribe, () => pick(state));
}

/** The docked column's width, of the window (dragged, or the default). */
export function setAssistantWidth(width: number) {
  set({ width });
}

/** What the composer holds, kept while the panel is closed. */
export const draft = { text: "" };

const provider = () => PROVIDERS.find((p) => p.id === state.provider) ?? PROVIDERS[0];

/** Models the local server offers; on Ollama only those that can call tools. */
// The desktop app reaches the model servers through Rust (their CORS
// refuses its origin); the web build fetches them directly.
// ponytail: the desktop's Rust request cannot be aborted; Stop drops its
// answer when it comes (the local server still finishes the request).
const localFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  platform.fetchModel ? platform.fetchModel(url, init) : fetch(url, init);

export async function discoverModels() {
  set({ status: "connecting", problem: null });
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
    set({ models, model: models.includes(state.model) ? state.model : (models[0] ?? ""), status: models.length ? "idle" : "offline", problem: models.length ? null : "no-models" });
  } catch {
    set({ models: [], status: "offline", problem: "unreachable" });
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

async function chat(messages: ChatMessage[], signal?: AbortSignal): Promise<ChatMessage> {
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
    const r = await localFetch(`${p.base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
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
    signal,
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

// Read-only tools: steps that changed nothing to undo.
const READ_ONLY = new Set(["describe_project", "list_catalog", "seek"]);
const editsOf = (steps: Step[]) => steps.filter((s) => s.ok && !READ_ONLY.has(s.tool)).length;

let stopTurn: (() => void) | null = null;

/** Stop the running turn: no further tool runs and the model's pending
 * answer is dropped. What it already changed stays, undoable as one. */
export function stop() {
  stopTurn?.();
}

export async function ask(text: string) {
  const q = text.trim();
  if (!q || state.status === "thinking") return;
  if (!state.model) {
    await discoverModels();
    if (!state.model) {
      set({ entries: [...state.entries, { role: "error", text: `No local model found. Start ${provider().label} with a model that supports tool calling (for example llama3.1 in Ollama).` }] });
      return;
    }
  }
  set({ status: "thinking", live: [], started: Date.now(), entries: [...state.entries, { role: "user", text: q }] });
  // A turn edits the project it started in: after a switch, no further tool
  // runs and the next model round trip stops the turn.
  const session = projectWork.signal();
  const ctrl = new AbortController();
  const stopped = new Promise<never>((_, reject) => ctrl.signal.addEventListener("abort", () => reject(new Error("Stopped."))));
  stopped.catch(() => {});
  stopTurn = () => ctrl.abort();
  try {
    const r = await runTurn(
      history,
      q,
      (m) =>
        session.aborted
          ? Promise.reject(new Error("The project changed during this request, so the AI assistant stopped."))
          : Promise.race([chat(m, ctrl.signal), stopped]),
      async (name, args) => {
        if (session.aborted) return { text: "The project was closed; nothing was changed.", isError: true };
        if (ctrl.signal.aborted) return { text: "Stopped by the user; nothing was changed.", isError: true };
        return callTool(name, args);
      },
      (s) => set({ live: [...state.live, s] }),
    );
    if (session.aborted) return; // the chat was reset for the new project
    if (ctrl.signal.aborted) throw new Error("Stopped.");
    history = r.messages;
    set({ entries: [...state.entries, { role: "assistant", text: r.reply || "Done.", steps: r.steps, edits: editsOf(r.steps) }] });
  } catch (e) {
    // The steps that ran stay listed and undoable as one, unless they
    // belong to a project that is no longer open.
    const steps = session.aborted ? [] : state.live;
    const message = e instanceof Error ? e.message : String(e);
    if (ctrl.signal.aborted) set({ entries: [...state.entries, { role: "assistant", text: "Stopped.", steps, edits: editsOf(steps) }] });
    else set({ entries: [...state.entries, { role: "error", text: message, steps, edits: editsOf(steps) }] });
  } finally {
    stopTurn = null;
    set({ status: "idle", live: [] });
  }
}

/** Ask a failed request again (when it changed nothing): the request and
 * its error leave the chat, as if it had not been sent. */
export function retry(entry: Entry) {
  const i = state.entries.indexOf(entry);
  const request = state.entries[i - 1];
  if (i < 1 || request.role !== "user" || entry.edits || state.status === "thinking") return;
  set({ entries: state.entries.slice(0, i - 1) });
  void ask(request.text);
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
