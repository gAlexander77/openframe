import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CURVE_CHANNELS, curveFn, IDENTITY_CURVE, isIdentityCurve, type CurveChannel, type CurvePoints, type Curves } from "../../lib/curves";
import type { Clip } from "../../lib/project/types";
import { store } from "../../state/store";
import { Section } from "./controls";
import { gradePartEdit, setGradePart } from "./gradeEdit";
import "./color.css";

const LABEL: Record<CurveChannel, string> = { luma: "Luma", r: "Red", g: "Green", b: "Blue" };
const COLOR: Record<CurveChannel, string> = { luma: "#ececec", r: "#ff5f57", g: "#3ccf6e", b: "#4b9dff" };
/** Dragging a point this far outside the graph removes it (CapCut, Lumetri). */
const REMOVE_PX = 28;
/** Points keep at least this much input between them. */
const GAP = 0.01;

let lastChannel: CurveChannel = "luma";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Curves with one channel replaced; identity channels are dropped. */
function withChannel(curves: Curves, ch: CurveChannel, pts: CurvePoints | null): Curves | undefined {
  const next = { ...curves };
  if (!pts || isIdentityCurve(pts)) delete next[ch];
  else next[ch] = pts;
  return Object.keys(next).length ? next : undefined;
}

interface Drag {
  index: number;
  base: CurvePoints;
  curves: Curves;
  label: string;
  removing: boolean;
}

/** CapCut's Curves tab: a square graph per channel. Click to add a point,
 * drag to move it, drag it off the graph to remove it. Every drag is one
 * undo step; points also move with the arrow keys. */
export function CurvesPanel({ clip }: { clip: Clip }) {
  const [channel, setChannelState] = useState<CurveChannel>(lastChannel);
  const graphRef = useRef<HTMLDivElement | null>(null);
  const [graphEl, setGraphEl] = useState<HTMLDivElement | null>(null);
  const graphCallback = useCallback((el: HTMLDivElement | null) => {
    graphRef.current = el;
    setGraphEl(el);
  }, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [size, setSize] = useState(0);
  const [drag, setDrag] = useState<{ index: number; removing: boolean } | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const curves: Curves = ("adjust" in clip ? clip.adjust.curves : undefined) ?? {};
  const points = curves[channel] ?? IDENTITY_CURVE;
  const setChannel = (ch: CurveChannel) => {
    lastChannel = ch;
    setChannelState(ch);
  };

  // The graph mounts and unmounts with its section; observe whichever is live.
  useLayoutEffect(() => {
    if (!graphEl) return;
    const ro = new ResizeObserver(() => setSize(graphEl.clientWidth));
    ro.observe(graphEl);
    setSize(graphEl.clientWidth);
    return () => ro.disconnect();
  }, [graphEl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && size) drawCurves(canvas, size, curves, channel);
  }, [size, curves, channel, graphEl]);

  if (!("adjust" in clip)) return null;

  const commitPoints = (label: string, pts: CurvePoints | null) => store.edit(label, gradePartEdit(clip.id, "curves", withChannel(curves, channel, pts)));

  const at = (e: React.PointerEvent) => {
    const r = graphRef.current!.getBoundingClientRect();
    const outside = Math.max(r.left - e.clientX, e.clientX - r.right, r.top - e.clientY, e.clientY - r.bottom, 0);
    return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height, outside };
  };

  const begin = (e: React.PointerEvent, index: number, base: CurvePoints, label: string) => {
    e.preventDefault();
    graphRef.current!.setPointerCapture(e.pointerId);
    store.beginGesture();
    dragRef.current = { index, base, curves, label, removing: false };
    setDrag({ index, removing: false });
    setFocus(index);
    store.previewGesture(gradePartEdit(clip.id, "curves", withChannel(curves, channel, base)));
  };

  const move = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const { x, y, outside } = at(e);
    const pts = d.base.map((p) => [...p] as [number, number]);
    d.removing = outside > REMOVE_PX && pts.length > 2;
    if (d.removing) pts.splice(d.index, 1);
    else {
      const lo = d.index > 0 ? pts[d.index - 1][0] + GAP : 0;
      const hi = d.index < pts.length - 1 ? pts[d.index + 1][0] - GAP : 1;
      pts[d.index] = [clamp(x, lo, hi), clamp(y, 0, 1)];
    }
    setDrag({ index: d.index, removing: d.removing });
    store.previewGesture(gradePartEdit(clip.id, "curves", withChannel(d.curves, channel, pts)));
  };

  const end = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDrag(null);
    if (d.removing) setFocus(null);
    store.endGesture(d.removing ? "Remove curve point" : d.label);
  };

  const addAt = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y } = at(e);
    // Near the line, the new point lands on it (the curve does not jump);
    // elsewhere it goes where you clicked, as in Photoshop.
    const onCurve = curveFn(points)(x);
    const py = Math.abs(onCurve - y) * size < 10 ? onCurve : y;
    let index = points.findIndex((p) => p[0] > x);
    if (index < 0) index = points.length;
    const near = [index - 1, index].find((i) => points[i] && Math.abs(points[i][0] - x) < GAP);
    if (near !== undefined) return begin(e, near, points, "Move curve point");
    const base = [...points.slice(0, index), [clamp(x, 0, 1), clamp(py, 0, 1)] as [number, number], ...points.slice(index)];
    begin(e, index, base, "Add curve point");
  };

  const nudge = (i: number, dx: number, dy: number) => {
    const pts = points.map((p) => [...p] as [number, number]);
    const lo = i > 0 ? pts[i - 1][0] + GAP : 0;
    const hi = i < pts.length - 1 ? pts[i + 1][0] - GAP : 1;
    pts[i] = [clamp(pts[i][0] + dx, lo, hi), clamp(pts[i][1] + dy, 0, 1)];
    commitPoints("Move curve point", pts);
  };

  const remove = (i: number) => {
    if (points.length <= 2) return;
    setFocus(null);
    commitPoints("Remove curve point", points.filter((_, k) => k !== i));
  };

  const shown = drag?.index ?? focus;
  const readout =
    drag?.removing ? "Release to remove" : shown !== null && points[shown] ? `In ${Math.round(points[shown][0] * 255)} · Out ${Math.round(points[shown][1] * 255)}` : "Click to add a point";

  return (
    <>
      <div className="curve-channels" role="radiogroup" aria-label="Curve channel">
        {CURVE_CHANNELS.map((ch) => (
          <button
            key={ch}
            role="radio"
            aria-checked={ch === channel}
            className={`curve-ch${ch === channel ? " on" : ""}`}
            style={{ "--ch": COLOR[ch] } as React.CSSProperties}
            onClick={() => setChannel(ch)}
          >
            <span className="curve-ch-dot" />
            {LABEL[ch]}
            {curves[ch] && <span className="edited-dot" aria-label="adjusted" />}
          </button>
        ))}
      </div>
      <Section title={`${LABEL[channel]} curve`} onReset={() => commitPoints(`Reset ${LABEL[channel].toLowerCase()} curve`, null)}>
        <div
          className={`curve-graph${drag ? " dragging" : ""}`}
          ref={graphCallback}
          role="group"
          aria-label={`${LABEL[channel]} curve, ${points.length} points`}
          style={{ "--ch": COLOR[channel] } as React.CSSProperties}
          onPointerDown={addAt}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
        >
          <canvas ref={canvasRef} className="curve-canvas" />
          {points.map(([x, y], i) => (
            <button
              key={i}
              className={`curve-pt${drag?.index === i ? " drag" : ""}${drag?.index === i && drag.removing ? " removing" : ""}`}
              style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%` }}
              aria-label={`Point ${i + 1} of ${points.length}: input ${Math.round(x * 255)}, output ${Math.round(y * 255)}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (e.button === 0) begin(e, i, points, "Move curve point");
              }}
              onDoubleClick={() => remove(i)}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus((f) => (f === i ? null : f))}
              onKeyDown={(e) => {
                const step = (e.shiftKey ? 10 : 1) / 255;
                const k = e.key;
                if (k === "Delete" || k === "Backspace") remove(i);
                else if (k === "ArrowLeft") nudge(i, -step, 0);
                else if (k === "ArrowRight") nudge(i, step, 0);
                else if (k === "ArrowUp") nudge(i, 0, step);
                else if (k === "ArrowDown") nudge(i, 0, -step);
                else return;
                e.preventDefault();
              }}
            />
          ))}
        </div>
        <div className="curve-foot">
          <span className={`curve-readout num${drag?.removing ? " warn" : ""}`}>{readout}</span>
          <span className="insp-hint">Drag a point off the graph to remove it</span>
        </div>
      </Section>
      {Object.keys(curves).length > 0 && (
        <div className="grade-foot">
          <button className="btn ghost" onClick={() => setGradePart(clip.id, "Reset curves", "curves", undefined)}>
            Reset all curves
          </button>
        </div>
      )}
    </>
  );
}

/** Grid, the identity diagonal, the other channels faintly, the active one
 * bright. Canvas, not SVG: icons are the only drawn vectors in the UI. */
function drawCurves(canvas: HTMLCanvasElement, size: number, curves: Curves, active: CurveChannel) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgb(255 255 255 / 7%)";
  ctx.beginPath();
  for (const q of [0.25, 0.5, 0.75]) {
    ctx.moveTo(Math.round(q * size) + 0.5, 0);
    ctx.lineTo(Math.round(q * size) + 0.5, size);
    ctx.moveTo(0, Math.round(q * size) + 0.5);
    ctx.lineTo(size, Math.round(q * size) + 0.5);
  }
  ctx.stroke();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = "rgb(255 255 255 / 14%)";
  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.lineTo(size, 0);
  ctx.stroke();
  ctx.setLineDash([]);
  const trace = (pts: CurvePoints) => {
    const f = curveFn(pts);
    ctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const x = i / 160;
      const px = x * size;
      const py = (1 - f(x)) * size;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.stroke();
  };
  ctx.lineWidth = 1.25;
  for (const ch of CURVE_CHANNELS) {
    if (ch === active || !curves[ch]) continue;
    ctx.strokeStyle = COLOR[ch] + "59";
    trace(curves[ch]!);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR[active];
  trace(curves[active] ?? IDENTITY_CURVE);
}
