import { setParam } from "../lib/project/ops";
import { transformGroup } from "../lib/groupTransform";
import { useRef, useState } from "react";
import { groupBoxes, nudgeClips, otherBoxes, scaleClips, SNAP, snapBox, snapLines, type Box } from "../lib/align";
import { paramAt } from "../lib/keyframes";
import type { Id } from "../lib/project/types";
import { store, useEditor } from "../state/store";

type Drag =
  | { kind: "move"; px: number; py: number; box: Box; lines: { x: number[]; y: number[] } }
  | { kind: "scale"; d0: number; cx: number; cy: number }
  | { kind: "rotate"; a0: number; cx: number; cy: number };

/**
 * One box around a multi-selection's showing pictures, as CapCut and
 * Premiere draw it (a group selects this way too): drag inside to move
 * them all, with the single box's snapping (edges and center to the
 * canvas and to the pictures left out; Ctrl moves freely, Shift keeps one
 * axis), or a corner to scale them together about the box's center,
 * positions with them. Each drag is one undo step. Measured at rest, as
 * the align row measures (ADR-045).
 */
export function GroupOverlay({ ids, width: W }: { ids: Id[]; width: number }) {
  const project = useEditor((s) => s.project);
  const frame = useEditor((s) => s.playhead);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const drag = useRef<Drag | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const g = groupBoxes(project, ids, frame);
  if (!g) return null;
  const k = W / project.width;
  const shown = g.items.map((i) => i.clip.id);
  const { box } = g;

  const local = (e: React.PointerEvent) => {
    const r = ref.current!.parentElement!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const begin = (e: React.PointerEvent, d: Drag) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // not the viewer's click-to-select
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = d;
    store.beginGesture();
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const m = local(e);
    const free = e.ctrlKey || e.metaKey;
    if (d.kind === "move") {
      let dx = (m.x - d.px) / k, dy = (m.y - d.py) / k;
      const held = e.shiftKey ? (Math.abs(dx) > Math.abs(dy) ? "y" : "x") : null;
      if (held === "x") dx = 0;
      if (held === "y") dy = 0;
      const hit: { dx: number; dy: number; gx?: number; gy?: number } = free ? { dx: 0, dy: 0 } : snapBox({ ...d.box, cx: d.box.cx + dx, cy: d.box.cy + dy }, d.lines, SNAP / k);
      const gx = held === "x" ? undefined : hit.gx, gy = held === "y" ? undefined : hit.gy;
      if (gx !== undefined) dx += hit.dx;
      if (gy !== undefined) dy += hit.dy;
      setGuides({ x: gx, y: gy });
      store.previewGesture((p) => nudgeClips(p, shown, dx, dy, frame));
    } else if (d.kind === "scale") {
      let s = Math.max(0.01, Math.hypot(m.x - d.cx, m.y - d.cy) / d.d0);
      if (!free && Math.abs(s - 1) < 0.02) s = 1;
      store.previewGesture((p) => shown.length === 1 ? scaleClips(p, shown, s, frame) : transformGroup(p, shown, { scale: s }, frame));
    } else {
      let rotation = (Math.atan2(m.y - d.cy, m.x - d.cx) - d.a0) * 180 / Math.PI;
      if (!free && Math.abs(rotation - Math.round(rotation / 45) * 45) < 3) rotation = Math.round(rotation / 45) * 45;
      store.previewGesture(p => shown.length === 1 ? setParam(p, shown, "transform.rotation", paramAt(g.items[0].clip, "transform.rotation", g.items[0].rel) + rotation, g.items[0].rel) : transformGroup(p, shown, { rotation }, frame));
    }
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setGuides({});
    store.endGesture(d.kind === "move" ? "Move" : d.kind === "scale" ? "Scale" : "Rotate group");
  };

  const corner = (pos: string) => (
    <div
      key={pos}
      className={`tf-handle tf-${pos}`}
      onPointerDown={(e) => {
        const m = local(e);
        begin(e, { kind: "scale", cx: box.cx * k, cy: box.cy * k, d0: Math.max(1, Math.hypot(m.x - box.cx * k, m.y - box.cy * k)) });
      }}
    />
  );

  return (
    <div className="tf-layer" ref={ref} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}>
      {guides.x !== undefined && <div className="tf-guide tf-guide-v" style={{ left: guides.x * k }} />}
      {guides.y !== undefined && <div className="tf-guide tf-guide-h" style={{ top: guides.y * k }} />}
      {g.items.map(({ clip, rel, box: b }) => (
        <div key={clip.id} className="tf-member" style={{ left: b.cx * k, top: b.cy * k, width: b.w * k, height: b.h * k, transform: `translate(-50%, -50%) rotate(${paramAt(clip, "transform.rotation", rel)}deg)` }} />
      ))}
      <div
        className="tf-box tf-group"
        style={{ left: (box.cx - box.hw) * k, top: (box.cy - box.hh) * k, width: 2 * box.hw * k, height: 2 * box.hh * k }}
        onPointerDown={(e) => {
          const m = local(e);
          begin(e, { kind: "move", px: m.x, py: m.y, box, lines: snapLines(project, otherBoxes(project, frame, ids), store.get().viewerGuides) });
        }}
      >
        {["nw", "ne", "sw", "se"].map(corner)}
        <div className="tf-rotate" onPointerDown={e => {
          const m = local(e), cx = box.cx * k, cy = box.cy * k;
          begin(e, { kind: "rotate", cx, cy, a0: Math.atan2(m.y - cy, m.x - cx) });
        }} />
      </div>
    </div>
  );
}
