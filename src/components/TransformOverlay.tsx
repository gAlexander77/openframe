import { useRef, useState } from "react";
import { layerBox, snapBox, snapLines, tidy, type Box } from "../lib/align";
import { paramAt } from "../lib/keyframes";
import { findClip, setParam } from "../lib/project/ops";
import type { Project, VisualClip } from "../lib/project/types";
import { layerAt } from "../lib/render/plan";
import { store, useEditor } from "../state/store";
import { editOnCanvas } from "../state/textEdit";
import { TextEditor } from "./TextEditor";

const SNAP = 6; // screen pixels within which an edge or center catches

/** Boxes of the other visible pictures at `frame`, for snapping. */
function otherBoxes(p: Project, frame: number, except: string): Box[] {
  const out: Box[] = [];
  for (const t of p.tracks) {
    if (t.hidden || t.kind !== "video") continue;
    for (const c of t.clips) {
      if (c.id === except || c.disabled || c.type === "audio" || c.type === "adjustment") continue;
      if (frame < c.start || frame >= c.start + c.duration) continue;
      const l = layerAt(p, c, frame);
      if (l) out.push(layerBox(p, c, l));
    }
  }
  return out;
}

type Drag =
  | { kind: "move"; x0: number; y0: number; px: number; py: number; box: Box; lines: { x: number[]; y: number[] } }
  | { kind: "scale"; s0: number; sy0?: number; d0: number }
  | { kind: "rotate"; r0: number; a0: number };

/**
 * CapCut-style handles over the selected visual clip in the viewer: drag
 * the box to move, a corner to scale uniformly, the knob to rotate. A moved
 * box snaps its edges and center to the canvas's and to the other visible
 * pictures'; holding Ctrl (Cmd on a Mac) ignores them, Shift keeps the move
 * on one axis. Values are written
 * through setParam, so keyframed properties get a keyframe at the playhead.
 * Double-click a text clip's box to type into it on the canvas instead.
 */
export function TransformOverlay({ width: W, height: H }: { width: number; height: number }) {
  const sel = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const frame = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const editing = useEditor((s) => s.textEdit);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const drag = useRef<Drag | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const loc = sel.length === 1 ? findClip(project, sel[0]) : null;
  const clip = loc?.clip;
  if (!clip || playing || W === 0 || clip.type === "audio" || clip.type === "adjustment") return null;
  if (frame < clip.start || frame >= clip.start + clip.duration || loc!.track.hidden) return null;

  const layer = layerAt(project, clip, frame);
  if (!layer) return null;
  if (clip.type === "text" && editing === clip.id) {
    return (
      <div className="tf-layer">
        <TextEditor key={clip.id} clip={clip} layer={layer} project={project} width={W} height={H} />
      </div>
    );
  }
  const k = W / project.width;
  const box = layerBox(project, clip, layer);
  const cx = box.cx * k, cy = box.cy * k, bw = box.w * k, bh = box.h * k;
  const rel = frame - clip.start;
  const c = clip as VisualClip;

  const set = (path: string, v: number) => store.previewGesture((p) => setParam(p, [c.id], path, v, rel));

  const begin = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = d;
    store.beginGesture();
  };
  const local = (e: React.PointerEvent) => {
    const r = frameRef.current!.parentElement!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const m = local(e);
    const free = e.ctrlKey || e.metaKey;
    if (d.kind === "move") {
      let dx = (m.x - d.px) / k, dy = (m.y - d.py) / k;
      // Shift holds the axis the drag mostly isn't on; it never snaps.
      const held = e.shiftKey ? (Math.abs(dx) > Math.abs(dy) ? "y" : "x") : null;
      if (held === "x") dx = 0;
      if (held === "y") dy = 0;
      const hit: { dx: number; dy: number; gx?: number; gy?: number } = free ? { dx: 0, dy: 0 } : snapBox({ ...d.box, cx: d.box.cx + dx, cy: d.box.cy + dy }, d.lines, SNAP / k);
      const gx = held === "x" ? undefined : hit.gx, gy = held === "y" ? undefined : hit.gy;
      if (gx !== undefined) dx += hit.dx;
      if (gy !== undefined) dy += hit.dy;
      setGuides({ x: gx, y: gy });
      const x = tidy(d.x0 + dx / project.width), y = tidy(d.y0 + dy / project.height);
      store.previewGesture((p) => setParam(setParam(p, [c.id], "transform.x", x, rel), [c.id], "transform.y", y, rel));
    } else if (d.kind === "scale") {
      const dist = Math.hypot(m.x - cx, m.y - cy);
      let s = Math.max(0.01, d.s0 * (dist / d.d0));
      if (!free && Math.abs(s - 1) < 0.02) s = 1;
      // A stretched picture keeps its proportions while a corner scales it.
      const sy = d.sy0 === undefined ? undefined : +((d.sy0 * s) / d.s0).toFixed(4);
      store.previewGesture((p) => {
        p = setParam(p, [c.id], "transform.scale", +s.toFixed(4), rel);
        return sy === undefined ? p : setParam(p, [c.id], "transform.scaleY", sy, rel);
      });
    } else {
      const a = (Math.atan2(m.y - cy, m.x - cx) * 180) / Math.PI;
      let r = d.r0 + (a - d.a0);
      if (!free) {
        const snapped = Math.round(r / 45) * 45;
        if (Math.abs(r - snapped) < 3) r = snapped;
      }
      set("transform.rotation", +r.toFixed(2));
    }
  };

  const end = () => {
    if (!drag.current) return;
    const label = drag.current.kind === "move" ? "Move" : drag.current.kind === "scale" ? "Scale" : "Rotate";
    drag.current = null;
    setGuides({});
    store.endGesture(label);
  };

  const corner = (pos: string) => (
    <div
      key={pos}
      className={`tf-handle tf-${pos}`}
      onPointerDown={(e) => {
        const m = local(e);
        const sy0 = c.transform.scaleY === undefined ? undefined : paramAt(c, "transform.scaleY", rel);
        begin(e, { kind: "scale", s0: paramAt(c, "transform.scale", rel), sy0, d0: Math.max(1, Math.hypot(m.x - cx, m.y - cy)) });
      }}
    />
  );

  return (
    <div className="tf-layer" ref={frameRef} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}>
      {guides.x !== undefined && <div className="tf-guide tf-guide-v" style={{ left: guides.x * k }} />}
      {guides.y !== undefined && <div className="tf-guide tf-guide-h" style={{ top: guides.y * k }} />}
      <div
        className="tf-box"
        style={{ left: cx, top: cy, width: Math.abs(bw), height: Math.abs(bh), transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)` }}
        onPointerDown={(e) => {
          const m = local(e);
          const lines = snapLines(project, otherBoxes(project, frame, c.id));
          begin(e, { kind: "move", x0: paramAt(c, "transform.x", rel), y0: paramAt(c, "transform.y", rel), px: m.x, py: m.y, box, lines });
        }}
        onDoubleClick={(e) => {
          if (c.type !== "text") return;
          e.stopPropagation(); // not the stage's full screen
          editOnCanvas(c.id);
        }}
      >
        {["nw", "ne", "sw", "se"].map(corner)}
        <div
          className="tf-rotate"
          onPointerDown={(e) => {
            const m = local(e);
            begin(e, { kind: "rotate", r0: paramAt(c, "transform.rotation", rel), a0: (Math.atan2(m.y - cy, m.x - cx) * 180) / Math.PI });
          }}
        />
      </div>
    </div>
  );
}
