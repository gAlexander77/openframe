import { useRef, useState } from "react";
import { rasterizeText } from "../engine/text";
import { paramAt } from "../lib/keyframes";
import { findClip, getAsset, setParam } from "../lib/project/ops";
import type { Project, VisualClip } from "../lib/project/types";
import { layerAt } from "../lib/render/plan";
import { store, useEditor } from "../state/store";

/** Size of a clip's source in project pixels before transform, and whether
 * it fits to the canvas (media) or keeps its native size (text). */
function sourceSize(p: Project, c: VisualClip): { w: number; h: number; native: boolean } {
  // A compound clip's picture is its inner timeline, drawn at canvas size.
  if (c.type === "color" || c.type === "compound") return { w: p.width, h: p.height, native: true };
  if (c.type === "text") {
    const r = rasterizeText(c, p.width, p.height);
    return { w: r.width, h: r.height, native: true };
  }
  const a = getAsset(p, c.assetId);
  return { w: a?.width || p.width, h: a?.height || p.height, native: false };
}

const SNAP = 0.012; // fraction of the canvas within which guides catch

type Drag =
  | { kind: "move"; x0: number; y0: number; px: number; py: number }
  | { kind: "scale"; s0: number; d0: number }
  | { kind: "rotate"; r0: number; a0: number };

/**
 * CapCut-style handles over the selected visual clip in the viewer: drag
 * the box to move, a corner to scale uniformly, the knob to rotate. Center
 * guides snap; holding Ctrl (Cmd on a Mac) ignores them. Values are written
 * through setParam, so keyframed properties get a keyframe at the playhead.
 */
export function TransformOverlay({ width: W, height: H }: { width: number; height: number }) {
  const sel = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const frame = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const [guides, setGuides] = useState({ v: false, h: false });
  const drag = useRef<Drag | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const loc = sel.length === 1 ? findClip(project, sel[0]) : null;
  const clip = loc?.clip;
  if (!clip || playing || W === 0 || clip.type === "audio" || clip.type === "adjustment") return null;
  if (frame < clip.start || frame >= clip.start + clip.duration || loc!.track.hidden) return null;

  const layer = layerAt(project, clip, frame);
  if (!layer) return null;
  const src = sourceSize(project, clip);
  const fit = src.native ? W / project.width : Math.min(W / src.w, H / src.h);
  const { left, top, right, bottom } = layer.crop;
  const bw = src.w * fit * layer.scale * (1 - left - right);
  const bh = src.h * fit * layer.scale * (1 - top - bottom);
  const rad = (layer.rotation * Math.PI) / 180;
  const sx = ((left - right) / 2) * src.w * fit * layer.scale;
  const sy = ((top - bottom) / 2) * src.h * fit * layer.scale;
  const cx = W / 2 + layer.x * W + Math.cos(rad) * sx - Math.sin(rad) * sy;
  const cy = H / 2 + layer.y * H + Math.sin(rad) * sx + Math.cos(rad) * sy;
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
      let x = d.x0 + (m.x - d.px) / W;
      let y = d.y0 + (m.y - d.py) / H;
      const v = !free && Math.abs(x) < SNAP;
      const h = !free && Math.abs(y) < SNAP;
      if (v) x = 0;
      if (h) y = 0;
      setGuides({ v, h });
      store.previewGesture((p) => setParam(setParam(p, [c.id], "transform.x", x, rel), [c.id], "transform.y", y, rel));
    } else if (d.kind === "scale") {
      const dist = Math.hypot(m.x - cx, m.y - cy);
      let s = Math.max(0.01, d.s0 * (dist / d.d0));
      if (!free && Math.abs(s - 1) < 0.02) s = 1;
      set("transform.scale", +s.toFixed(4));
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
    setGuides({ v: false, h: false });
    store.endGesture(label);
  };

  const corner = (pos: string) => (
    <div
      key={pos}
      className={`tf-handle tf-${pos}`}
      onPointerDown={(e) => {
        const m = local(e);
        begin(e, { kind: "scale", s0: paramAt(c, "transform.scale", rel), d0: Math.max(1, Math.hypot(m.x - cx, m.y - cy)) });
      }}
    />
  );

  return (
    <div className="tf-layer" ref={frameRef} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}>
      {guides.v && <div className="tf-guide tf-guide-v" />}
      {guides.h && <div className="tf-guide tf-guide-h" />}
      <div
        className="tf-box"
        style={{ left: cx, top: cy, width: Math.abs(bw), height: Math.abs(bh), transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)` }}
        onPointerDown={(e) => {
          const m = local(e);
          begin(e, { kind: "move", x0: paramAt(c, "transform.x", rel), y0: paramAt(c, "transform.y", rel), px: m.x, py: m.y });
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
