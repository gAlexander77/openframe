import { useRef } from "react";
import { ArrowDown } from "../icons";
import { layerBox } from "../lib/align";
import { dragMask, handleAt, maskFrame, maskHandles, maskOutline, type MaskHandle } from "../lib/mask";
import { setParam } from "../lib/project/ops";
import type { Mask, Project, VisualClip } from "../lib/project/types";
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
export function MaskOverlay(props: { project: Project; clip: VisualClip; layer: Layer; mask: Mask; k: number }) {
  const { project, clip, layer, mask, k } = props;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: MaskHandle; grab: { x: number; y: number }; start: Mask } | null>(null);
  const box = layerBox(project, clip, layer);
  const lw = box.w, lh = box.h;
  const fx = layer.flipX ? -1 : 1, fy = layer.flipY ? -1 : 1;
  const f = maskFrame(mask, lw, lh);
  const rel = store.get().playhead - clip.start;
  const rad = (layer.rotation * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);

  /** The pointer in layer pixels: the shader's frame, before rotation and flips. */
  const toLayer = (e: React.PointerEvent) => {
    const r = ref.current!.parentElement!.getBoundingClientRect();
    const x = (e.clientX - r.left) / k - box.cx, y = (e.clientY - r.top) / k - box.cy;
    return { x: (cos * x + sin * y) * fx, y: (-sin * x + cos * y) * fy };
  };
  const down = (handle: MaskHandle) => (e: React.PointerEvent) => {
    e.stopPropagation(); // not the viewer's click-to-select
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { handle, grab: toLayer(e), start: mask };
    store.beginGesture();
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const next = dragMask(d.start, d.handle, d.grab, toLayer(e), lw, lh, e.ctrlKey || e.metaKey);
    store.previewGesture((p) => {
      for (const n of NUMBERS) if (next[n] !== undefined && next[n] !== d.start[n]) p = setParam(p, [clip.id], `mask.${n}`, next[n]!, rel);
      return p;
    });
  };
  const up = () => {
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
    <div className="tf-layer" ref={ref} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="mask-layer" style={{ left: box.cx * k, top: box.cy * k, transform: `rotate(${layer.rotation}deg) scale(${fx}, ${fy})` }}>
        <div className="mask-frame" data-shape={mask.shape} style={{ transform: `translate(${f.cx * k}px, ${f.cy * k}px) rotate(${mask.rotation}deg)` }}>
          <svg className="mask-outline" width="1" height="1" aria-hidden>
            <path d={maskOutline(mask, f, k, Math.hypot(lw, lh))} />
          </svg>
          {f.hw > 0 && f.hh > 0 && mask.shape !== "linear" && mask.shape !== "mirror" ? (
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
