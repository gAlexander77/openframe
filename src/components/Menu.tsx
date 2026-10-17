import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { chordText, type ActionId, ACTION_LABELS } from "../lib/keymap";
import { isMac } from "../platform/env";
import { chordFor, run } from "../state/actions";
import { Check } from "../icons";

export type MenuItem =
  | { action: ActionId; label?: string; disabled?: boolean; checked?: boolean }
  | { label: string; onSelect: () => void; disabled?: boolean; checked?: boolean; hint?: string }
  | "-";

/** A menubar of dropdowns. Hovering across the bar while one menu is open
 * switches menus, the way native menubars behave; from the keyboard, Enter,
 * Space or Down opens a menu on its first item and Left/Right walk the bar. */
export function MenuBar(props: { menus: { label: string; items: () => MenuItem[] }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [byKey, setByKey] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    // Capture, so Escape closes the menu without also deselecting clips;
    // focus that was in the menu goes back to its menubar button.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      if (ref.current?.contains(document.activeElement)) ref.current.querySelectorAll<HTMLButtonElement>(".menubar-button")[open]?.focus();
      setOpen(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);
  const n = props.menus.length;
  const openByKey = (i: number) => {
    setByKey(true);
    setOpen(i);
  };
  return (
    <div className="menubar" ref={ref} data-tauri-drag-region="false">
      {props.menus.map((m, i) => (
        <div key={m.label} className="menubar-item">
          <button
            className={`menubar-button${open === i ? " open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={open === i}
            onPointerDown={() => {
              setByKey(false);
              setOpen(open === i ? null : i);
            }}
            onPointerEnter={() => open !== null && setOpen(i)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " " && e.key !== "ArrowDown") return;
              // Ours, not the app's: Space would play, Down would jump an edit.
              e.preventDefault();
              e.stopPropagation();
              openByKey(i);
            }}
          >
            {m.label}
          </button>
          {open === i && (
            <MenuList
              key={i}
              items={m.items()}
              autoFocus={byKey}
              onDone={() => setOpen(null)}
              onNav={(d) => {
                const j = (i + d + n) % n;
                (ref.current?.querySelectorAll<HTMLButtonElement>(".menubar-button")[j])?.focus();
                openByKey(j);
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function MenuList(props: {
  items: MenuItem[];
  onDone: () => void;
  style?: React.CSSProperties;
  /** Focus the first item (opened from the keyboard). */
  autoFocus?: boolean;
  /** Left/Right: move to the neighboring menu of a menubar. */
  onNav?: (dir: -1 | 1) => void;
  /** The button a dropdown hangs from: a menu that has to open upward
   * goes above it instead of covering it. */
  anchor?: Element | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const items = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)") ?? [])];
  // Keep the menu inside the window. A right-click on the lowest track
  // opened it below the window's edge; open upward from the pointer when
  // there is room above, else slide it up just enough.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    opener.current = document.activeElement;
    if (props.autoFocus) items()[0]?.focus();
    // Layout sizes, not the rect: the open animation scales the menu.
    const { top, left } = el.getBoundingClientRect();
    const h = el.offsetHeight;
    const room = 8;
    let dy = 0;
    const above = props.anchor ? props.anchor.getBoundingClientRect().top - 4 : top;
    if (top + h > innerHeight - room) dy = above - h >= room ? above - h - top : Math.max(room - top, innerHeight - room - top - h);
    const dx = Math.min(0, innerWidth - room - left - el.offsetWidth);
    if (dx || dy) el.style.translate = `${dx}px ${dy}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    // While a menu has focus its keys are the menu's, not the app's shortcuts.
    e.stopPropagation();
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => list[(i + list.length) % list.length]?.focus();
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at < 0 ? -1 : at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(-1);
    else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && props.onNav) props.onNav(e.key === "ArrowLeft" ? -1 : 1);
    else if (e.key === "Escape" || e.key === "Tab") {
      props.onDone();
      if (e.key === "Escape" && opener.current instanceof HTMLElement) opener.current.focus();
    } else return;
    if (e.key !== "Tab") e.preventDefault();
  };
  return (
    <div className="menu" role="menu" style={props.style} ref={ref} onKeyDown={onKeyDown}>
      {props.items.map((item, i) => {
        if (item === "-") return <div key={i} className="menu-sep" role="separator" />;
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
