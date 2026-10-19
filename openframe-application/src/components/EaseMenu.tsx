import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "../icons";
import { ease } from "../lib/keyframes";
import { EASE_PRESETS, presetOf } from "../lib/keyframeEdit";
import type { Ease } from "../lib/project/types";
import "./keyframes.css";

/** The shape of an ease as a small path, so the menu shows what each
 * preset does instead of only naming it (CapCut's preset grid does the
 * same). A data drawing like the graph, not an icon. */
function curvePath(e: Ease, w: number, h: number): string {
  const pts: string[] = [];
  for (let i = 0; i <= 24; i++) {
    const x = i / 24;
    // Hold steps at the end; draw the step instead of a flat line.
    const y = e === "hold" ? (i === 24 ? 1 : 0) : ease(e, x);
    pts.push(`${(x * w).toFixed(1)},${(h - 3 - y * (h - 6)).toFixed(1)}`);
  }
  return `M${pts.join("L")}`;
}

export function EaseCurve({ value, w = 26, h = 16 }: { value: Ease; w?: number; h?: number }) {
  return (
    <svg className="ease-curve" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={curvePath(value, w, h)} />
    </svg>
  );
}

/**
 * Easing presets for the selected keyframes, opened at a point (a
 * right-click, or under a button). Rendered into the body so a transformed
 * ancestor (timeline clips are) cannot trap its fixed position, and moved
 * up when it would run off the bottom of the window.
 */
export function EaseMenu(props: { x: number; y: number; current: Ease | undefined; onPick: (e: Ease) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  const current = presetOf(props.current);

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({
      left: Math.max(6, Math.min(props.x, window.innerWidth - r.width - 6)),
      top: Math.max(6, Math.min(props.y, window.innerHeight - r.height - 6)),
    });
  }, [props.x, props.y]);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) props.onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Before the app's own Escape (deselect).
      e.stopImmediatePropagation();
      props.onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [props]);

  return createPortal(
    <div ref={ref} className="menu ease-menu" role="menu" aria-label="Easing" style={{ left: pos.left, top: pos.top }}>
      <div className="ease-menu-title">Easing</div>
      {EASE_PRESETS.map((p) => (
        <button
          key={p.id}
          role="menuitemradio"
          aria-checked={current?.id === p.id}
          className="menu-item ease-item"
          onClick={() => {
            props.onClose();
            props.onPick(p.ease);
          }}
        >
          <span className="menu-check">{current?.id === p.id && <Check size={14} />}</span>
          <EaseCurve value={p.ease} />
          <span className="menu-label">{p.label}</span>
          <span className="menu-hint">{p.hint}</span>
        </button>
      ))}
      {!current && props.current && (
        <div className="menu-item ease-item custom" aria-disabled>
          <span className="menu-check">
            <Check size={14} />
          </span>
          <EaseCurve value={props.current} />
          <span className="menu-label">Custom curve</span>
          <span className="menu-hint">Drag the handles in the graph</span>
        </div>
      )}
    </div>,
    document.body,
  );
}
