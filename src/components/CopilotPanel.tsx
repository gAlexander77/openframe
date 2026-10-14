import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Undo2, WandSparkles, X } from "../icons";
import { ask, PROVIDERS, resetChat, setModel, setProvider, toggleCopilot, undoTurn, useCopilot, discoverModels } from "../state/copilot";
import "./copilot.css";

const EXAMPLES = ["Add a title that says “Welcome” for the first 3 seconds", "Cut the first clip in half and add a dissolve between the halves", "Make every clip slightly warmer and add a vignette"];

/** A drawer over the inspector where a local model edits the timeline. */
export function CopilotPanel() {
  const c = useCopilot();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [c.entries.length, c.live.length]);
  if (!c.open) return null;
  const send = () => {
    void ask(text);
    setText("");
  };
  return (
    <aside className="copilot" aria-label="Copilot">
      <header className="copilot-head">
        <WandSparkles size={15} />
        <strong>Copilot</strong>
        <span className={`copilot-dot ${c.status}`} data-tip={c.status === "offline" ? "No local model server found" : "Runs on this computer"} />
        <span className="copilot-spacer" />
        <button className="icon-btn small" aria-label="New conversation" data-tip="New conversation" onClick={resetChat}>
          <Undo2 size={13} />
        </button>
        <button className="icon-btn small" aria-label="Close Copilot" onClick={() => toggleCopilot(false)}>
          <X size={14} />
        </button>
      </header>
      <div className="copilot-config">
        <select className="field" value={c.provider} onChange={(e) => setProvider(e.target.value)} aria-label="Model server">
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select className="field" value={c.model} onChange={(e) => setModel(e.target.value)} aria-label="Model" disabled={!c.models.length}>
          {!c.models.length && <option value="">{c.status === "connecting" ? "Looking for models…" : "No model found"}</option>}
          {c.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div className="copilot-list" ref={listRef}>
        {c.status === "offline" && (
          <div className="copilot-note">
            Copilot uses a model on this computer — nothing is uploaded. Start Ollama or LM Studio with a model that can call tools (for example <b>qwen3.5</b>), then{" "}
            <button className="link-btn" onClick={() => void discoverModels()}>
              look again
            </button>
            .
          </div>
        )}
        {c.entries.length === 0 && c.status !== "offline" && (
          <div className="copilot-examples">
            <span>Ask for an edit, for example:</span>
            {EXAMPLES.map((e) => (
              <button key={e} className="chip-btn" onClick={() => setText(e.replace(/[“”]/g, '"'))}>
                {e}
              </button>
            ))}
          </div>
        )}
        {c.entries.map((e, i) => (
          <div key={i} className={`msg msg-${e.role}`}>
            {e.steps && e.steps.length > 0 && (
              <div className="msg-steps">
                {e.steps.map((s, j) => (
                  <span key={j} className={`step${s.ok ? "" : " bad"}`} data-tip={s.summary}>
                    {s.ok ? <Check size={11} /> : <X size={11} />} {s.tool.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}
            <p>{e.text}</p>
            {e.role === "assistant" && !!e.edits && (
              <button className="btn ghost undo-turn" onClick={() => undoTurn(e)}>
                <Undo2 size={12} /> Undo {e.edits === 1 ? "this change" : `these ${e.edits} changes`}
              </button>
            )}
          </div>
        ))}
        {c.status === "thinking" && (
          <div className="msg msg-assistant live">
            <div className="msg-steps">
              {c.live.map((s, j) => (
                <span key={j} className={`step${s.ok ? "" : " bad"}`}>
                  {s.ok ? <Check size={11} /> : <X size={11} />} {s.tool.replace(/_/g, " ")}
                </span>
              ))}
            </div>
            <p className="thinking">
              <Loader2 size={13} className="spin" /> Working…
            </p>
          </div>
        )}
      </div>
      <div className="copilot-input">
        <textarea
          className="field"
          rows={2}
          placeholder="Describe an edit…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          aria-label="Ask Copilot"
        />
        <button className="btn primary" disabled={!text.trim() || c.status === "thinking"} onClick={send}>
          Send
        </button>
      </div>
    </aside>
  );
}
