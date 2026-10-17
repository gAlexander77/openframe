import { useEffect, useRef, useState } from "react";
import { masterBus, peakDb, tapLoudness } from "../engine/audio";
import { LiveLoudness } from "../lib/analysis/loudness";
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
  return (
    <>
      <canvas ref={ref} className="meter" aria-label="Audio level" data-tip="Audio level (dBFS); the top line holds the recent peak" />
      <Loudness playing={playing} />
    </>
  );
}

const live = new LiveLoudness();
// Under BS.1770's -70 LUFS absolute gate is silence (a stopped filter's
// tail read -1221).
const lu = (v: number) => (v > -70 ? v.toFixed(1) : "—");

/** EBU R128 loudness of what plays (Premiere's Loudness Meter, in one
 * line): momentary, short-term, and integrated since play started. Stays
 * after a stop, so a pass can be read. */
function Loudness({ playing }: { playing: boolean }) {
  const [v, setV] = useState<[number, number, number] | null>(null);
  useEffect(() => {
    if (!playing) return;
    live.reset();
    let off: (() => void) | undefined;
    let alive = true;
    tapLoudness((ms) => live.push(ms))
      .then((f) => (alive ? (off = f) : f()))
      .catch(() => {});
    const id = setInterval(() => setV([live.momentary(), live.shortTerm(), live.integrated()]), 250);
    return () => {
      alive = false;
      off?.();
      clearInterval(id);
      setV([live.momentary(), live.shortTerm(), live.integrated()]);
    };
  }, [playing]);
  if (!v) return null;
  return (
    <div className="lufs num" aria-label="Loudness" data-tip="Loudness in LUFS (EBU R128): momentary, short-term (3 s) and integrated since play started. Streaming sites play at about -14.">
      <span>M {lu(v[0])}</span>
      <span>S {lu(v[1])}</span>
      <span>I {lu(v[2])}</span>
    </div>
  );
}
