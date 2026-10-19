import { useRef } from "react";
import { setTrackBox, type TrackBox } from "../state/tracking";

const CORNERS = ["nw", "ne", "se", "sw"] as const;
type Corner = (typeof CORNERS)[number];

/** The box placed on the subject to track (CapCut's tracking box): drag it
 * onto the subject, a corner to size it, the opposite corner holding. */
export function TrackBoxOverlay({ box, k }: { box: TrackBox; k: number }) {
  const drag = useRef<{ mode: "move" | Corner; x: number; y: number; b: TrackBox } | null>(null);
  const down = (mode: "move" | Corner) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // not the viewer's click-to-select
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, b: box };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / k, dy = (e.clientY - d.y) / k;
    if (d.mode === "move") return setTrackBox({ ...d.b, cx: d.b.cx + dx, cy: d.b.cy + dy });
    const sx = d.mode.includes("e") ? 1 : -1, sy = d.mode.includes("s") ? 1 : -1;
    const w = Math.max(16, d.b.w + sx * dx), h = Math.max(16, d.b.h + sy * dy);
    setTrackBox({ cx: d.b.cx + (sx * (w - d.b.w)) / 2, cy: d.b.cy + (sy * (h - d.b.h)) / 2, w, h });
  };
  const up = () => {
    drag.current = null;
  };
  return (
    <div className="tf-layer" onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="track-box" style={{ left: (box.cx - box.w / 2) * k, top: (box.cy - box.h / 2) * k, width: box.w * k, height: box.h * k }} onPointerDown={down("move")} aria-label="Subject to track">
        {CORNERS.map((c) => (
          <div key={c} className={`crop-handle crop-${c}`} onPointerDown={down(c)} />
        ))}
      </div>
    </div>
  );
}
