// CapCut's curve speed graph editor (research §3.6): clip time across, speed
// up the side on a log axis from 0.1x to 10x. Rates change exponentially
// between points, which is a straight line on this axis, so the line drawn
// is exactly what plays (ADR-027). Points drag, add at the playhead, delete
// and reset; the clip's length follows live and the playhead line tracks.

import { useRef, useState } from "react";
import { Plus, RotateCw, Trash2 } from "../../icons";
import * as ops from "../../lib/project/ops";
import type { AudioClip, Project, VideoClip } from "../../lib/project/types";
import { CURVE_MAX, CURVE_MIN, PRESETS, clampSpeed, normalizeWindow, speedAt, toFrames, type NormPoint } from "../../lib/speed";
import { edit, settleOptions } from "../../state/actions";
import { store, useEditor } from "../../state/store";
import "./speed.css";

type Timed = VideoClip | AudioClip;

const W = 260;
const H = 132;
const PAD = { l: 38, r: 10, t: 8, b: 8 };
const LOG_MIN = Math.log(CURVE_MIN);
const LOG_SPAN = Math.log(CURVE_MAX) - LOG_MIN;

const xOf = (t: number) => PAD.l + t * (W - PAD.l - PAD.r);
const yOf = (s: number) => PAD.t + (1 - (Math.log(s) - LOG_MIN) / LOG_SPAN) * (H - PAD.t - PAD.b);
const tOf = (x: number) => (x - PAD.l) / (W - PAD.l - PAD.r);
const sOf = (y: number) => Math.exp(LOG_MIN + (1 - (y - PAD.t) / (H - PAD.t - PAD.b)) * LOG_SPAN);

const GRID = [10, 5, 2, 1, 0.5, 0.2, 0.1];
const LABELS = new Set([10, 1, 0.1]);

/** A preset's shape at tile size: the same mapping, scaled down. */
export function CurvePreview({ points }: { points: NormPoint[] }) {
  const d = points.map((p, i) => `${i ? "L" : "M"}${xOf(p.t).toFixed(1)} ${yOf(p.speed).toFixed(1)}`).join(" ");
  return (
    <svg className="curve-preview" viewBox={`${PAD.l - 4} 0 ${W - PAD.l + 4} ${H}`} preserveAspectRatio="none" aria-hidden>
      <line x1={PAD.l} x2={W - PAD.r} y1={yOf(1)} y2={yOf(1)} className="sg-unity" />
      <path d={d} className="sg-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function SpeedGraph({ clip }: { clip: Timed }) {
  const playhead = useEditor((s) => s.playhead);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ i: number; base: NormPoint[] } | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const curve = clip.speedCurve;
  if (!curve) return null;
  const pts = normalizeWindow(curve.points, clip.duration);
  const last = pts.length - 1;
  const selected = sel !== null && sel <= last ? sel : null;
  const preset = curve.preset;
  const apply = (p: Project, next: NormPoint[]) => ops.setSpeedCurve(p, clip.id, next, preset);

  const local = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  /** Point i moved to (t, speed); the ends stay at t = 0 and 1, the rest
   * between their neighbors. */
  const moved = (base: NormPoint[], i: number, t: number, speed: number): NormPoint[] => {
    const next = base.map((p) => ({ ...p }));
    const lo = i === 0 ? 0 : base[i - 1].t + 0.01;
    const hi = i === base.length - 1 ? 1 : base[i + 1].t - 0.01;
    next[i] = { t: i === 0 ? 0 : i === base.length - 1 ? 1 : Math.min(hi, Math.max(lo, t)), speed: +clampSpeed(speed).toFixed(3) };
    return next;
  };

  const onPointDown = (e: React.PointerEvent, i: number) => {
    e.stopPropagation();
    setSel(i);
    drag.current = { i, base: pts };
    svg.current!.setPointerCapture(e.pointerId);
    store.beginGesture();
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = local(e);
    const next = moved(d.base, d.i, tOf(x), sOf(y));
    store.previewGesture((p) => ops.settle(p, apply(p, next), settleOptions()));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    store.endGesture("Edit speed curve");
  };

  const rel = playhead - clip.start;
  const at = rel >= 0 && rel < clip.duration ? rel / clip.duration : null;
  /** Add a point where the playhead is (or in the widest gap), on the curve,
   * so adding never changes what plays until it is dragged. */
  const addPoint = () => {
    let t = at;
    if (t === null || pts.some((p) => Math.abs(p.t - t!) < 0.02)) {
      let gap = 0;
      for (let i = 0; i < last; i++) if (pts[i + 1].t - pts[i].t > gap) [gap, t] = [pts[i + 1].t - pts[i].t, (pts[i].t + pts[i + 1].t) / 2];
    }
    const speed = speedAt(toFrames(pts, 1), t!);
    const next = [...pts, { t: t!, speed }].sort((a, b) => a.t - b.t);
    setSel(next.findIndex((p) => p.t === t));
    edit("Add speed point", (p) => apply(p, next));
  };
  const deletable = selected !== null && selected > 0 && selected < last;
  const deletePoint = () => {
    if (!deletable) return;
    const next = pts.filter((_, i) => i !== selected);
    setSel(null);
    edit("Delete speed point", (p) => apply(p, next));
  };
  const reset = () => edit("Reset speed curve", (p) => apply(p, PRESETS[preset ?? "custom"]?.points ?? PRESETS.custom.points));
  const onKey = (e: React.KeyboardEvent) => {
    if (selected === null) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const k = (e.shiftKey ? 1.25 : 1.05) ** (e.key === "ArrowUp" ? 1 : -1);
      edit("Edit speed curve", (p) => apply(p, moved(pts, selected, pts[selected].t, pts[selected].speed * k)));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deletePoint();
    }
  };

  const line = pts.map((p, i) => `${i ? "L" : "M"}${xOf(p.t).toFixed(1)} ${yOf(p.speed).toFixed(1)}`).join(" ");
  const area = `${line} L${xOf(1)} ${H - PAD.b} L${xOf(0)} ${H - PAD.b} Z`;
  return (
    <div className="speed-graph">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="sg-plot"
        tabIndex={0}
        role="application"
        aria-label="Speed curve: drag points up for faster, down for slower"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
      >
        {GRID.map((s) => (
          <g key={s}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yOf(s)} y2={yOf(s)} className={s === 1 ? "sg-unity" : "sg-grid"} />
            {LABELS.has(s) && (
              <text x={PAD.l - 10} y={yOf(s) + 3.5} className="sg-label" textAnchor="end">
                {s}x
              </text>
            )}
          </g>
        ))}
        <path d={area} className="sg-area" />
        <path d={line} className="sg-line" />
        {at !== null && <line x1={xOf(at)} x2={xOf(at)} y1={PAD.t} y2={H - PAD.b} className="sg-playhead" />}
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={xOf(p.t)}
            cy={yOf(p.speed)}
            r={selected === i ? 5.5 : 4.5}
            className={`sg-point${selected === i ? " on" : ""}`}
            onPointerDown={(e) => onPointDown(e, i)}
          />
        ))}
      </svg>
      <div className="sg-tools">
        <span className="sg-readout num">{selected !== null ? `${pts[selected].speed.toFixed(2)}x` : " "}</span>
        <button className="icon-btn small" aria-label="Add point" data-tip="Add point at the playhead" onClick={addPoint}>
          <Plus size={13} />
        </button>
        <button className="icon-btn small" aria-label="Delete point" data-tip="Delete point" disabled={!deletable} onClick={deletePoint}>
          <Trash2 size={13} />
        </button>
        <button className="icon-btn small" aria-label="Reset curve" data-tip="Reset" onClick={reset}>
          <RotateCw size={13} />
        </button>
      </div>
    </div>
  );
}
