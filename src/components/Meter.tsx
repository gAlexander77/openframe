import { useEffect, useRef } from "react";
import { masterBus, peakDb } from "../engine/audio";
import { useEditor } from "../state/store";

const FLOOR = -60;
const HOLD_MS = 1200;

/** A slim stereo peak meter (dBFS) with peak hold, red above -1 dB — the
 * meter every NLE keeps beside the picture. Draws only while playing. */
export function Meter() {
  const playing = useEditor((s) => s.playing);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    cv.width = w * dpr;
    cv.height = h * dpr;
    ctx.scale(dpr, dpr);
    const held = [FLOOR, FLOOR];
    const heldAt = [0, 0];
    const level = [FLOOR, FLOOR];
    let raf = 0;
    const y = (db: number) => h - ((Math.max(FLOOR, Math.min(0, db)) - FLOOR) / -FLOOR) * h;
    const draw = () => {
      const b = playing ? masterBus() : null;
      const now = performance.now();
      ctx.clearRect(0, 0, w, h);
      const bw = (w - 2) / 2;
      [b?.left, b?.right].forEach((a, i) => {
        const db = a ? peakDb(a) : -Infinity;
        // fall back smoothly rather than snapping to silence
        level[i] = Math.max(db, level[i] - 1.2);
        if (level[i] >= held[i] || now - heldAt[i] > HOLD_MS) {
          held[i] = level[i];
          heldAt[i] = now;
        }
        const x = i * (bw + 2);
        ctx.fillStyle = "#2a2a2a";
        ctx.fillRect(x, 0, bw, h);
        const top = y(level[i]);
        const grad = ctx.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, "#1fa36a");
        grad.addColorStop(0.75, "#3ccf8e");
        grad.addColorStop(0.9, "#f2b84b");
        grad.addColorStop(0.985, "#f05a5a");
        ctx.fillStyle = grad;
        ctx.fillRect(x, top, bw, h - top);
        if (held[i] > FLOOR) {
          ctx.fillStyle = held[i] > -1 ? "#f05a5a" : "#e8e8ea";
          ctx.fillRect(x, y(held[i]), bw, 1.5);
        }
      });
      if (playing || level.some((l) => l > FLOOR)) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return <canvas ref={ref} className="meter" aria-label="Audio level" data-tip="Audio level (dBFS); the top line holds the recent peak" />;
}
