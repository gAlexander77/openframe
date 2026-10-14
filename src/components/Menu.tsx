import { useEffect, useRef, useState } from "react";
import { chordText, type ActionId, ACTION_LABELS } from "../lib/keymap";
import { isMac } from "../platform/env";
import { chordFor, run } from "../state/actions";
import { Check } from "../icons";

export type MenuItem =
  | { action: ActionId; label?: string; disabled?: boolean; checked?: boolean }
  | { label: string; onSelect: () => void; disabled?: boolean; checked?: boolean; hint?: string }
  | "-";

/** A menubar of dropdowns. Hovering across the bar while one menu is open
 * switches menus, the way native menubars behave. */
export function MenuBar(props: { menus: { label: string; items: () => MenuItem[] }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="menubar" ref={ref}>
      {props.menus.map((m, i) => (
        <div key={m.label} className="menubar-item">
          <button
            className={`menubar-button${open === i ? " open" : ""}`}
            onPointerDown={() => setOpen(open === i ? null : i)}
            onPointerEnter={() => open !== null && setOpen(i)}
          >
            {m.label}
          </button>
          {open === i && <MenuList items={m.items()} onDone={() => setOpen(null)} />}
        </div>
      ))}
    </div>
  );
}

export function MenuList(props: { items: MenuItem[]; onDone: () => void; style?: React.CSSProperties }) {
  return (
    <div className="menu" role="menu" style={props.style}>
      {props.items.map((item, i) => {
        if (item === "-") return <div key={i} className="menu-sep" />;
        const label = "action" in item ? (item.label ?? ACTION_LABELS[item.action]) : item.label;
        const chord = "action" in item ? chordFor(item.action) : undefined;
        const hint = chord ? chordText(chord, isMac) : "hint" in item ? item.hint : undefined;
        return (
          <button
            key={i}
            role="menuitem"
            className="menu-item"
            disabled={item.disabled}
            onClick={() => {
              props.onDone();
              if ("action" in item) run(item.action);
              else item.onSelect();
            }}
          >
            <span className="menu-check">{item.checked && <Check size={14} />}</span>
            <span className="menu-label">{label}</span>
            {hint && <span className="menu-hint">{hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
