import { togglePathCorner } from "../lib/maskPath";
import { useRef, useState } from "react";
import { ArrowDown } from "../icons";
import { layerBox } from "../lib/align";
import { dragMask, handleAt, maskFrame, maskHandles, maskOutline, toMask, type MaskHandle } from "../lib/mask";
import { setParam, updateClip } from "../lib/project/ops";
import type { Mask, Project, VisualClip, AdjustmentClip } from "../lib/project/types";
import type { Layer } from "../lib/render/plan";
import { store } from "../state/store";

const LABEL: Record<MaskHandle, string> = {
  move: "Move mask",
  e: "Resize mask",
  w: "Resize mask",
  n: "Resize mask",
  s: "Resize mask",
  rotate: "Rotate mask",
  feather: "Feather mask",
  radius: "Round mask corners",
};
const NUMBERS = ["x", "y", "width", "height", "rotation", "feather", "radius"] as const;

/**
 * CapCut's mask on the viewer, while the Mask tab is open: the outline as
 * the shader draws it (src/lib/mask.ts mirrors maskAlpha), dragged inside
 * to move, by its edges to size, by the knob to turn and by the arrow to
 * feather; a rectangle's corner dot rounds it. Each drag is one undo step,
 * written through setParam so animated numbers get a keyframe at the
 * playhead. Ctrl turns freely, past the 45 degree catches.
 */
export function MaskOverlay(props: { project: Project; clip: VisualClip | AdjustmentClip; layer?: Layer; mask: Mask; k: number }) {
  const { project, clip, layer, mask, k } = props;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: MaskHandle; grab: { x: number; y: number }; start: Mask } | null>(null);
  const box = clip.type === "adjustment" ? { cx: project.width / 2, cy: project.height / 2, w: project.width, h: project.height } : layerBox(project, clip, layer!);
  const [selected, setSelected] = useState<number | null>(null);
  const pen = useRef<{ index: number; side?: "in" | "out"; start: Mask; grab: { x: number; y: number }; adding: boolean } | null>(null);
  const lw = box.w, lh = box.h;
  const fx = layer?.flipX ? -1 : 1, fy = layer?.flipY ? -1 : 1;
  const f = maskFrame(mask, lw, lh);
  const rel = store.get().playhead - clip.start;
  const rad = ((layer?.rotation ?? 0) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);

  /** The pointer in layer pixels: the shader's frame, before rotation and flips. */
  const toLayer = (e: React.PointerEvent) => {
    const r = ref.current!.parentElement!.getBoundingClientRect();
    const x = (e.clientX - r.left) / k - box.cx, y = (e.clientY - r.top) / k - box.cy;
    return { x: (cos * x + sin * y) * fx, y: (-sin * x + cos * y) * fy };
  };
  const localPoint = (e: React.PointerEvent) => {
    const q = toLayer(e), p = toMask(f, q.x, q.y);
    return { x: p.x / (lw * mask.width), y: p.y / (lh * mask.height) };
  };
  const writePath = (next: Mask) => store.previewGesture((p) => updateClip(p, clip.id, (c) => ({ ...c, mask: { ...("mask" in c ? c.mask : mask), points: next.points, closed: next.closed } }) as typeof c));
  const startPen = (index?: number, side?: "in" | "out") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault(); ref.current?.focus();
    const points = mask.points ?? [];
    if (index === 0 && mask.closed === false && points.length >= 3 && !side) {
      store.edit("Close mask path", (p) => updateClip(p, clip.id, (c) => ({ ...c, mask: { ...mask, closed: true } }) as typeof c));
      setSelected(0); return;
    }
    if (index !== undefined && e.altKey && !side) {
      const next = togglePathCorner(points, index);
      store.edit("Toggle mask corner", (p) => updateClip(p, clip.id, (c) => ({ ...c, mask: { ...mask, points: next } }) as typeof c));
      setSelected(index); return;
    }
    if (index === undefined && (points.length >= 256 || mask.closed !== false)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const grab = localPoint(e), adding = index === undefined;
    const i = index ?? points.length;
    const start = adding ? { ...mask, points: [...points, grab] } : mask;
    pen.current = { index: i, side, start, grab, adding };
    setSelected(i); store.beginGesture();
    if (adding) writePath(start);
  };
  const down = (handle: MaskHandle) => (e: React.PointerEvent) => {
    e.stopPropagation(); // not the viewer's click-to-select
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { handle, grab: toLayer(e), start: mask };
    store.beginGesture();
  };
  const move = (e: React.PointerEvent) => {
    const path = pen.current;
    if (path) {
      const q = localPoint(e), dx = q.x - path.grab.x, dy = q.y - path.grab.y;
      const points = path.start.points!.map((p, i) => {
        if (i !== path.index) return p;
        if (path.adding || path.side) {
          if (path.adding && Math.hypot(dx * lw * mask.width * k, dy * lh * mask.height * k) < 3) return p;
          const side = path.side ?? "out";
          const x = q.x - p.x, y = q.y - p.y;
          return { ...p, [side]: [x, y], ...(path.adding ? { in: [-x, -y] as [number, number] } : {}) };
        }
        return { ...p, x: p.x + dx, y: p.y + dy };
      });
      writePath({ ...path.start, points }); return;
    }
    const d = drag.current;
    if (!d) return;
    const next = dragMask(d.start, d.handle, d.grab, toLayer(e), lw, lh, e.ctrlKey || e.metaKey);
    store.previewGesture((p) => {
      for (const n of NUMBERS) if (next[n] !== undefined && next[n] !== d.start[n]) p = setParam(p, [clip.id], `mask.${n}`, next[n]!, rel);
      return p;
    });
  };
  const up = () => {
    if (pen.current) { pen.current = null; store.endGesture("Edit mask path"); return; }
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    store.endGesture(LABEL[d.handle]);
  };

  const handles = maskHandles(mask.shape);
  const at = (h: MaskHandle) => {
    const p = handleAt(mask, f, h, lh);
    return { left: p.x * k, top: p.y * k };
  };
  return (
    <div className={`tf-layer${mask.shape === "path" && mask.closed === false ? " mask-pen-draft" : ""}`} ref={ref} tabIndex={-1} aria-label="Mask editor" onPointerDown={mask.shape === "path" ? startPen() : undefined} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onKeyDown={(e) => {
        if ((e.key !== "Delete" && e.key !== "Backspace") || mask.shape !== "path" || selected === null) return;
        e.preventDefault(); e.stopPropagation();
        const points = (mask.points ?? []).filter((_, i) => i !== selected);
        store.edit("Delete mask point", (p) => updateClip(p, clip.id, (c) => ({ ...c, mask: { ...mask, points, ...(points.length < 3 ? { closed: false } : {}) } }) as typeof c));
        setSelected(null);
      }}>
      <div className="mask-layer" style={{ left: box.cx * k, top: box.cy * k, transform: `rotate(${(layer?.rotation ?? 0)}deg) scale(${fx}, ${fy})` }}>
        <div className="mask-frame" data-shape={mask.shape} style={{ transform: `translate(${f.cx * k}px, ${f.cy * k}px) rotate(${mask.rotation}deg)` }}>
          <svg className="mask-outline" width="1" height="1" aria-hidden>
            <path d={maskOutline(mask, f, k, Math.hypot(lw, lh))} />
            {mask.shape === "path" && (mask.points ?? []).flatMap((p, i) => (["in", "out"] as const).map((side) => p[side] && <path key={`${i}-${side}`} d={`M ${p.x * lw * mask.width * k} ${p.y * lh * mask.height * k} L ${(p.x + p[side]![0]) * lw * mask.width * k} ${(p.y + p[side]![1]) * lh * mask.height * k}`} />))}
          </svg>
          {mask.shape === "path" ? <>
            {(mask.points ?? []).map((p, i) => <div key={i}>
              {(["in", "out"] as const).map((side) => p[side] && <div key={side} className="mask-tangent" role="button" tabIndex={0} onFocus={() => setSelected(i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setSelected(i); } }} style={{ left: (p.x + p[side]![0]) * lw * mask.width * k, top: (p.y + p[side]![1]) * lh * mask.height * k }} onPointerDown={startPen(i, side)} aria-label={`${side === "in" ? "Incoming" : "Outgoing"} handle ${i + 1}`} />)}
              <div className={`mask-point${selected === i ? " selected" : ""}`} role="button" tabIndex={0} onFocus={() => setSelected(i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setSelected(i); } }} style={{ left: p.x * lw * mask.width * k, top: p.y * lh * mask.height * k }} onPointerDown={startPen(i)} aria-label={`Mask point ${i + 1}`} />
            </div>)}
          </> : f.hw > 0 && f.hh > 0 && mask.shape !== "linear" && mask.shape !== "mirror" ? (
            <div className="mask-body" style={{ width: 2 * f.hw * k, height: 2 * f.hh * k }} onPointerDown={down("move")} />
          ) : (
            <div className="mask-handle mask-center" style={at("move")} onPointerDown={down("move")} />
          )}
          {handles
            .filter((h) => h !== "move")
            .map((h) => (
              <div key={h} className={`mask-handle mask-${h}`} data-handle={h} style={at(h)} onPointerDown={down(h)}>
                {h === "feather" && <ArrowDown size={11} />}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
