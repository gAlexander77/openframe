import { useRef, useState } from "react";
import { player } from "../engine/player";
import { ChevronDown, Columns2 } from "../icons";
import { run, tipFor } from "../state/actions";
import { store, useEditor } from "../state/store";
import { toast } from "../state/toast";
import { MenuList, useDismiss } from "./Menu";

export function CompareControl() {
  const c = useEditor(s => s.compare);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(menu !== null, ref, () => setMenu(null));
  const capture = () => void player.captureReference().catch(e => toast((e as Error).message, "error"));
  return <div ref={ref} className="compare-control">
    <button className={`icon-btn small${c.mode !== "off" ? " on" : ""}`} aria-label="Compare" aria-pressed={c.mode !== "off"} data-tip={tipFor("toggleCompare")} onClick={() => run("toggleCompare")}><Columns2 size={14} /></button>
    <button className="icon-btn small" aria-label="Comparison options" aria-haspopup="menu" aria-expanded={menu !== null} onClick={e => {
      const r = e.currentTarget.getBoundingClientRect();
      setMenu(menu ? null : { x: r.left, y: r.bottom });
    }}><ChevronDown size={12} /></button>
    {menu && <div className="ctx-anchor" style={{ left: menu.x, top: menu.y }}><MenuList autoFocus onDone={() => setMenu(null)} style={{ top: 0 }} items={[
      { label: "Compare off", checked: c.mode === "off", onSelect: () => { if (c.mode !== "off") run("toggleCompare"); } },
      { label: "Before/after", checked: c.mode === "beforeAfter", onSelect: () => store.set({ compare: { ...c, mode: "beforeAfter" } }) },
      { label: "Reference frame", checked: c.mode === "reference", onSelect: () => { void player.showReference().catch(e => toast((e as Error).message, "error")); } },
      { label: "Capture reference", onSelect: capture },
      "-",
      { label: "Vertical split", checked: c.orientation === "vertical", onSelect: () => store.set({ compare: { ...c, orientation: "vertical" } }) },
      { label: "Horizontal split", checked: c.orientation === "horizontal", onSelect: () => store.set({ compare: { ...c, orientation: "horizontal" } }) },
    ]} /></div>}
  </div>;
}

export function CompareOverlay() {
  const c = useEditor(s => s.compare);
  if (c.mode === "off") return null;
  const horizontal = c.orientation === "horizontal";
  const set = (split: number) => store.set({ compare: { ...store.get().compare, split: Math.max(0, Math.min(1, split)) } });
  return <div className={`compare-divider${horizontal ? " horizontal" : ""}`} style={horizontal ? { top: `${c.split * 100}%` } : { left: `${c.split * 100}%` }}>
    <button className="compare-handle" aria-label="Comparison split" role="slider" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.split * 100)} aria-orientation={horizontal ? "vertical" : "horizontal"}
      onPointerDown={e => { e.stopPropagation(); e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        e.stopPropagation();
        const r = e.currentTarget.closest(".player-frame")!.getBoundingClientRect();
        set(horizontal ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width);
      }}
      onPointerUp={e => { e.stopPropagation(); e.currentTarget.releasePointerCapture(e.pointerId); }}
      onDoubleClick={e => { e.stopPropagation(); set(0.5); }}
      onKeyDown={e => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        set(e.key === "Home" ? 0 : e.key === "End" ? 1 : c.split + (["ArrowRight", "ArrowDown"].includes(e.key) ? 0.01 : -0.01));
      }}><Columns2 size={12} /></button>
  </div>;
}
