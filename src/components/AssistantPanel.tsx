import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, CircleAlert, Loader2, SendHorizontal, Square, SquarePen, Undo2, WandSparkles, X } from "../icons";
import { ask, discoverModels, draft, PROVIDERS, resetChat, retry, setModel, setProvider, stop, toggleAssistant, undoTurn, useAssistant, type Entry } from "../state/assistant";
import type { Step } from "../lib/assistant";
import { AgentsSection } from "./AgentsSection";
import "./assistant.css";

const EXAMPLES = ["Add a title that says “Welcome” for the first 3 seconds", "Cut the first clip in half and add a dissolve between the halves", "Make every clip slightly warmer and add a vignette"];

const STATUS = { idle: "Ready", connecting: "Connecting…", thinking: "Working…", offline: "Offline" } as const;

/** The composer grows with its text up to this many lines, then scrolls. */
const MAX_LINES = 5;

function Steps({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  return (
    <div className="msg-steps">
      {steps.map((s, j) => (
        <span key={j} className={`step${s.ok ? "" : " bad"}`} data-tip={s.summary}>
          {s.ok ? <Check size={11} /> : <X size={11} />} {s.tool.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

function Message({ e, prev, busy }: { e: Entry; prev?: Entry; busy: boolean }) {
  return (
    <div className={`msg msg-${e.role}`}>
      {e.steps && <Steps steps={e.steps} />}
      {e.text && (
        <p>
          {e.role === "error" && <CircleAlert size={13} className="msg-icon" />}
          {e.text}
        </p>
      )}
      {(!!e.edits || (e.role === "error" && prev?.role === "user")) && (
        <div className="msg-actions">
          {!!e.edits && (
            <button className="btn ghost msg-action" onClick={() => undoTurn(e)}>
              <Undo2 size={12} /> Undo {e.edits === 1 ? "this change" : `these ${e.edits} changes`}
            </button>
          )}
          {e.role === "error" && prev?.role === "user" && !e.edits && (
            <button className="btn ghost msg-action" disabled={busy} onClick={() => retry(e)}>
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Seconds since `since`, ticking while shown. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="num elapsed">{s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`}</span>;
}

/** The AI assistant: a column docked at the editor's right (ADR-064) where
 * a model on this computer edits the timeline, and where other agents are
 * connected over MCP. */
export function AssistantPanel() {
  const c = useAssistant();
  const [view, setView] = useState<"chat" | "agents">("chat");
  const [text, setTextState] = useState(draft.text);
  const setText = (v: string) => {
    draft.text = v;
    setTextState(v);
  };
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = c.status === "thinking";
  const canSend = !!text.trim() && !busy && c.status !== "connecting" && !!c.model;

  // Follow new messages, unless the reader has scrolled up to read.
  const pinned = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [c.entries.length, c.live.length, busy]);

  // Grow with the text, up to MAX_LINES; then scroll inside.
  useLayoutEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    const cs = getComputedStyle(ta);
    const max = parseFloat(cs.lineHeight) * MAX_LINES + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
    ta.style.overflowY = ta.scrollHeight > max ? "auto" : "hidden";
  }, [text, view]);

  if (!c.open) return null;
  const send = () => {
    if (!canSend) return;
    pinned.current = true;
    void ask(text);
    setText("");
  };
  const provider = PROVIDERS.find((p) => p.id === c.provider) ?? PROVIDERS[0];

  return (
    <aside className="panel assistant" aria-label="AI assistant">
      <header className="assistant-head">
        <WandSparkles size={15} className="assistant-mark" />
        <strong>AI assistant</strong>
        <span className={`assistant-status ${c.status}`} role="status" data-tip={c.status === "offline" ? "No local model server found" : "Runs on this computer"}>
          <i aria-hidden />
          {STATUS[c.status]}
        </span>
        <span className="assistant-spacer" />
        <button className="icon-btn small" aria-label="New conversation" data-tip="New conversation" disabled={!c.entries.length || busy} onClick={resetChat}>
          <SquarePen />
        </button>
        <button className="icon-btn small" aria-label="Close AI assistant" data-tip="Close" onClick={() => toggleAssistant(false)}>
          <X />
        </button>
      </header>
      <nav className="assistant-tabs" role="tablist" aria-label="AI assistant">
        {(
          [
            ["chat", "Chat"],
            ["agents", "Connect agents"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={view === id} className={view === id ? "on" : ""} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </nav>
      {view === "agents" ? (
        <div className="assistant-agents" role="tabpanel" aria-label="Connect agents">
          <AgentsSection />
        </div>
      ) : (
        <>
          <div className="assistant-config">
            <select className="field" value={c.provider} onChange={(e) => setProvider(e.target.value)} aria-label="Model server" disabled={busy}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {/* Long model names are cut to the column; the tip has them whole. */}
            <select className="field" value={c.model} onChange={(e) => setModel(e.target.value)} aria-label="Model" data-tip={c.model || undefined} disabled={!c.models.length || busy}>
              {!c.models.length && <option value="">{c.status === "connecting" ? "Looking for models…" : "No model found"}</option>}
              {c.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div
            className="assistant-list"
            ref={listRef}
            role="log"
            aria-label="Conversation"
            onScroll={(e) => {
              const el = e.currentTarget;
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {c.status === "offline" && (
              <div className="assistant-notice">
                <CircleAlert size={16} />
                <div>
                  <strong>{c.problem === "no-models" ? `${provider.label} has no model that can call tools` : `${provider.label} is not answering`}</strong>
                  <p>
                    The AI assistant uses a model on this computer; nothing is uploaded.{" "}
                    {c.problem === "no-models"
                      ? "Install one that can call tools (for example llama3.1), then look again."
                      : `Start ${provider.label} with a model that can call tools (for example llama3.1), then look again.`}
                  </p>
                  <button className="btn" onClick={() => void discoverModels()}>
                    Look again
                  </button>
                </div>
              </div>
            )}
            {c.entries.length === 0 && c.status !== "offline" && (
              <div className="assistant-empty">
                <span className="assistant-empty-mark" aria-hidden>
                  <WandSparkles size={18} />
                </span>
                <strong>Describe an edit</strong>
                <span>A model on this computer makes it with the editor's own tools. Each answer can be undone in one step.</span>
                <div className="assistant-examples">
                  {EXAMPLES.map((e) => (
                    <button
                      key={e}
                      className="assistant-chip"
                      onClick={() => {
                        setText(e.replace(/[“”]/g, '"'));
                        inputRef.current?.focus();
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {c.entries.map((e, i) => (
              <Message key={i} e={e} prev={c.entries[i - 1]} busy={busy} />
            ))}
            {busy && (
              <div className="msg msg-assistant live">
                <Steps steps={c.live} />
                <div className="thinking">
                  <Loader2 size={13} className="spin" />
                  <span>Working…</span>
                  <Elapsed since={c.started} />
                  <button className="btn ghost msg-action stop-btn" onClick={stop}>
                    <Square size={10} /> Stop
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="assistant-composer">
            <div className={`composer${busy ? " busy" : ""}`} onClick={(e) => e.target === e.currentTarget && inputRef.current?.focus()}>
              <textarea
                ref={inputRef}
                rows={1}
                placeholder="Describe an edit…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter breaks the line, as in every chat
                  // box; never mid-composition (an IME's Enter picks a word).
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send();
                  }
                }}
                aria-label="Ask the AI assistant"
              />
              <button className="composer-send" aria-label="Send" data-tip={busy ? "Working…" : "Send"} disabled={!canSend} onClick={send}>
                {busy ? <Loader2 className="spin" /> : <SendHorizontal />}
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
