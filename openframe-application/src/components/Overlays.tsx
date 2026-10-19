import { AudioLines, Blend, Bot, Film, Image, Palette, SlidersHorizontal, Sparkles, Sticker, Type, X } from "../icons";
import { useDrag } from "../state/drag";
import { dismiss, useToasts, type Toast } from "../state/toast";

/** The thing being dragged from the library, following the pointer. */
export function DragGhost() {
  const d = useDrag();
  if (!d) return null;
  const p = d.payload;
  const Icon =
    p.kind === "asset" ? (p.asset.kind === "audio" ? AudioLines : p.asset.kind === "image" ? (p.asset.sticker ? Sticker : Image) : Film) : p.kind === "sfx" ? AudioLines : p.kind === "text" || p.kind === "template" ? Type : p.kind === "transition" ? Blend : p.kind === "filter" || p.kind === "color" ? Palette : p.kind === "adjustment" ? SlidersHorizontal : p.kind === "sticker" ? Sticker : Sparkles;
  const label = p.kind === "asset" ? p.asset.name : p.label;
  return (
    <div className="drag-ghost" style={{ transform: `translate(${d.x + 12}px, ${d.y + 12}px)` }}>
      <Icon size={13} />
      <span>{label}</span>
    </div>
  );
}

/** CapCut-style toasts: small dark pills near the bottom of the window. An
 * AI agent's stand apart at the top, under the Bot icon, so the user can
 * tell the agent's changes from their own. */
export function Toasts() {
  const toasts = useToasts();
  const stack = (list: Toast[], top: boolean) => (
    <div className={`toasts${top ? " toasts-agent" : ""}`} role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.agent && (
            <span className="toast-agent">
              <Bot size={14} />
              AI agent
            </span>
          )}
          <span>{t.text}</span>
          {t.kind === "progress" && t.progress !== undefined && (
            <span className="toast-bar">
              <span style={{ transform: `scaleX(${t.progress})` }} />
            </span>
          )}
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                dismiss(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          )}
          {t.kind !== "progress" && (
            <button className="toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
  return (
    <>
      {stack(toasts.filter((t) => !t.agent), false)}
      {stack(toasts.filter((t) => t.agent), true)}
    </>
  );
}
