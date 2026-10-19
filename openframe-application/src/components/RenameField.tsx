import { useRef } from "react";
import { changesName } from "../lib/project/rename";

/** A name as a text field (Rename on a clip or a media card): Enter or
 * leaving keeps what was typed, Escape the old name; an untouched field
 * answers null. Pointer and key events stay here, so the card or clip under
 * it neither drags nor takes the keys. */
export function RenameField({ name, label, className, onDone }: { name: string; label: string; className: string; onDone: (name: string | null) => void }) {
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v !== null && changesName(name, v) ? v : null);
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <input
      className={className}
      aria-label={label}
      defaultValue={name}
      autoFocus
      onFocus={(e) => {
        // All selected, the start in view: select() scrolls a long name to its end.
        const input = e.currentTarget;
        input.setSelectionRange(0, input.value.length, "backward");
        input.scrollLeft = 0;
      }}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
