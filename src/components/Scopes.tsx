import { useEffect, useRef, useState } from "react";
import { player } from "../engine/player";
import { X } from "../icons";
import { computeScopes, scopeLevel, SKIN_TONE_DEG, TARGETS, vectorPoint, type Scopes } from "../lib/scopes";
import { store } from "../state/store";
import { Segmented } from "./inspector/controls";
import "./scopes.css";

type Kind = "waveform" | "parade" | "vectorscope" | "histogram";
type Mode = "all" | Kind;

/** Frame width the scopes read back (the GPU scales the viewer down). */
const READ_WIDTH = 320;
const COLUMNS = 256;
const VSIZE = 256;
/** At most 8 updates a second while playing (ADR-022). */
const PLAYING_INTERVAL = 125;

const MODES: { value: Mode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "waveform", label: "Waveform" },
  { value: "parade", label: "Parade" },
  { value: "vectorscope", label: "Vector" },
  { value: "histogram", label: "Histogram" },
];
const KINDS: Kind[] = ["waveform", "parade", "vectorscope", "histogram"];
const CAPTION: Record<Kind, string> = { waveform: "Waveform · luma", parade: "RGB parade", vectorscope: "Vectorscope", histogram: "Histogram" };

function loadMode(): Mode {
  try {
    const m = localStorage.getItem("scopes.mode") as Mode | null;
    return m && MODES.some((x) => x.value === m) ? m : "all";
  } catch {
    return "all";
  }
}

/** Waveform, RGB parade, vectorscope and histogram of what the viewer
 * shows, in the media library's place (Premiere's Color workspace puts
 * Lumetri Scopes where the Source monitor was). Updates on every paused
 * frame and at most 8 times a second during playback. */
export function ScopesPanel() {
  const [mode, setModeState] = useState<Mode>(loadMode);
  const canvases = useRef<Partial<Record<Kind, HTMLCanvasElement | null>>>({});
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem("scopes.mode", m);
    } catch {
      /* private window: the choice just won't persist */
    }
  };
  const visible = mode === "all" ? KINDS : [mode];

  useEffect(() => {
    let raf = 0;
    let timer = 0;
    let last = 0;
    const update = () => {
      raf = 0;
      last = performance.now();
      const px = player.pixels(READ_WIDTH);
      if (!px) return;
      const s = computeScopes(px, COLUMNS, VSIZE);
      for (const k of visible) {
        const c = canvases.current[k];
        if (c) DRAW[k](c, s);
      }
    };
    const schedule = () => {
      if (raf || timer) return;
      const wait = player.playing ? PLAYING_INTERVAL - (performance.now() - last) : 0;
      if (wait > 0) {
        timer = window.setTimeout(() => {
          timer = 0;
          raf = requestAnimationFrame(update);
        }, wait);
      } else raf = requestAnimationFrame(update);
    };
    const off = player.onFrame(schedule);
    schedule();
    return () => {
      off();
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [mode]);

  return (
    <section className="panel scopes-panel" aria-label="Scopes">
      <header className="panel-head scopes-head">
        <span className="panel-title">Scopes</span>
        <Segmented value={mode} onChange={setMode} options={MODES} />
        <button className="icon-btn small scopes-close" aria-label="Close scopes" data-tip="Back to the media library" onClick={() => store.set({ scopes: false })}>
          <X size={14} />
        </button>
      </header>
      <div className={`scopes-body mode-${mode === "all" ? "all" : "one"}`}>
        {visible.map((k) => (
          <figure key={k} className={`scope scope-${k}`}>
            <div className="scope-plot">
              {k === "vectorscope" ? (
                <div className="vector-square">
                  <div className="vector-face">
                  <canvas ref={(el) => void (canvases.current[k] = el)} role="img" aria-label="Vectorscope of the viewer" />
                  {TARGETS.map((t) => {
                    const [x, y] = vectorPoint(t.rgb, VSIZE);
                    // nudge each label outward, past its target
                    const mid = (VSIZE - 1) / 2;
                    const len = Math.hypot(x - mid, y - mid) || 1;
                    const style = {
                      left: `${(x / (VSIZE - 1)) * 100}%`,
                      top: `${(y / (VSIZE - 1)) * 100}%`,
                      "--dx": `${((x - mid) / len) * 9}px`,
                      "--dy": `${((y - mid) / len) * 9}px`,
                    } as React.CSSProperties;
                    return (
                      <span key={t.label} className="vector-label" style={style}>
                        {t.label}
                      </span>
                    );
                  })}
                  </div>
                </div>
              ) : (
                <>
                  <canvas ref={(el) => void (canvases.current[k] = el)} role="img" aria-label={`${CAPTION[k]} of the viewer`} />
                  {k !== "histogram" && (
                    <div className="scope-scale" aria-hidden>
                      {[100, 75, 50, 25, 0].map((v) => (
                        <span key={v} style={{ top: `${100 - v}%` }}>
                          {v}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <figcaption>{CAPTION[k]}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

// ---- drawing ---------------------------------------------------------------------
// Counts become pixels in an ImageData at the scope's own resolution; CSS
// scales the canvas to the panel. Graticules are drawn on top.

const BG = [11, 11, 11];

function canvas2d(c: HTMLCanvasElement, w: number, h: number) {
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c.getContext("2d")!;
}

/** One waveform (256 levels tall) into `img` at column offset `x0`. */
function paintWave(img: ImageData, x0: number, counts: Uint32Array, columns: number, ref: number, tint: number[]) {
  const W = img.width;
  for (let level = 0; level < 256; level++) {
    const row = 255 - level;
    for (let col = 0; col < columns; col++) {
      const v = scopeLevel(counts[level * columns + col], ref);
      if (!v) continue;
      const i = (row * W + x0 + col) * 4;
      // Bright cores whiten, like a phosphor trace.
      const white = v * v * 0.35;
      img.data[i] = Math.min(255, BG[0] + tint[0] * v + 255 * white);
      img.data[i + 1] = Math.min(255, BG[1] + tint[1] * v + 255 * white);
      img.data[i + 2] = Math.min(255, BG[2] + tint[2] * v + 255 * white);
    }
  }
}

function blank(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = BG[0];
    img.data[i + 1] = BG[1];
    img.data[i + 2] = BG[2];
    img.data[i + 3] = 255;
  }
  return img;
}

function levelLines(ctx: CanvasRenderingContext2D, w: number) {
  ctx.strokeStyle = "rgb(255 255 255 / 11%)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    const y = Math.round((1 - v) * 255) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
}

const GAP = 6;

const DRAW: Record<Kind, (c: HTMLCanvasElement, s: Scopes) => void> = {
  waveform(c, s) {
    const ctx = canvas2d(c, s.columns, 256);
    const img = blank(ctx, s.columns, 256);
    paintWave(img, 0, s.luma, s.columns, Math.max(4, s.perColumn * 0.15), [120, 230, 170]);
    ctx.putImageData(img, 0, 0);
    levelLines(ctx, s.columns);
  },
  parade(c, s) {
    const w = s.columns * 3 + GAP * 2;
    const ctx = canvas2d(c, w, 256);
    const img = blank(ctx, w, 256);
    const ref = Math.max(4, s.perColumn * 0.15);
    paintWave(img, 0, s.r, s.columns, ref, [255, 70, 60]);
    paintWave(img, s.columns + GAP, s.g, s.columns, ref, [60, 230, 90]);
    paintWave(img, 2 * (s.columns + GAP), s.b, s.columns, ref, [70, 130, 255]);
    ctx.putImageData(img, 0, 0);
    levelLines(ctx, w);
    ctx.fillStyle = "#1c1c1c";
    ctx.fillRect(s.columns, 0, GAP, 256);
    ctx.fillRect(2 * s.columns + GAP, 0, GAP, 256);
  },
  vectorscope(c, s) {
    const n = s.size;
    const ctx = canvas2d(c, n, n);
    const img = blank(ctx, n, n);
    const ref = Math.max(4, s.pixels * 0.002);
    const hue = vectorHues(n);
    // A flat color is one bin; spread each bin a little so it reads as a
    // phosphor spot rather than a single dim pixel.
    const level = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
      const v = scopeLevel(s.vector[i], ref);
      if (!v) continue;
      level[i] = Math.max(level[i], v);
      const x = i % n;
      for (const j of [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, i - n, i + n]) if (j >= 0 && j < n * n) level[j] = Math.max(level[j], v * 0.55);
    }
    for (let i = 0; i < n * n; i++) {
      const v = level[i];
      if (!v) continue;
      const white = v * v * 0.45;
      for (let ch = 0; ch < 3; ch++) img.data[i * 4 + ch] = Math.min(255, BG[ch] + hue[i * 3 + ch] * v + 255 * white);
    }
    ctx.putImageData(img, 0, 0);
    const mid = (n - 1) / 2;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgb(255 255 255 / 12%)";
    ctx.beginPath();
    ctx.arc(mid, mid, mid, 0, Math.PI * 2);
    ctx.moveTo(mid, 4);
    ctx.lineTo(mid, n - 4);
    ctx.moveTo(4, mid);
    ctx.lineTo(n - 4, mid);
    ctx.stroke();
    // skin-tone line
    const a = (SKIN_TONE_DEG * Math.PI) / 180;
    ctx.strokeStyle = "rgb(255 196 150 / 45%)";
    ctx.beginPath();
    ctx.moveTo(mid, mid);
    ctx.lineTo(mid + Math.cos(a) * mid, mid - Math.sin(a) * mid);
    ctx.stroke();
    // 75% targets as boxes, 100% as small dots
    for (const t of TARGETS) {
      const [x75, y75] = vectorPoint(t.rgb.map((v) => v * 0.75) as [number, number, number], n);
      ctx.strokeStyle = "rgb(255 255 255 / 55%)";
      ctx.strokeRect(Math.round(x75) - 4.5, Math.round(y75) - 4.5, 9, 9);
      const [x, y] = vectorPoint(t.rgb, n);
      ctx.fillStyle = "rgb(255 255 255 / 40%)";
      ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
    }
  },
  histogram(c, s) {
    const H = 128;
    const ctx = canvas2d(c, 256, H);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgb(${BG.join(" ")})`;
    ctx.fillRect(0, 0, 256, H);
    // Scale by the tallest bin away from the ends, so a black border or a
    // clipped sky does not flatten everything else.
    let max = 1;
    for (const h of [s.hist.r, s.hist.g, s.hist.b]) for (let i = 1; i < 255; i++) max = Math.max(max, h[i]);
    const bar = (h: Uint32Array, i: number) => Math.min(H, Math.round((h[i] / max) * (H - 4)));
    ctx.globalCompositeOperation = "lighter";
    for (const [h, color] of [
      [s.hist.r, "rgb(230 60 50 / 80%)"],
      [s.hist.g, "rgb(50 200 80 / 80%)"],
      [s.hist.b, "rgb(60 110 240 / 80%)"],
    ] as const) {
      ctx.fillStyle = color;
      for (let i = 0; i < 256; i++) {
        const v = bar(h, i);
        if (v) ctx.fillRect(i, H - v, 1, v);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgb(255 255 255 / 70%)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const y = H - Math.min(H, (s.hist.luma[i] / max) * (H - 4)) + 0.5;
      if (i) ctx.lineTo(i + 0.5, y);
      else ctx.moveTo(0.5, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgb(255 255 255 / 8%)";
    ctx.beginPath();
    for (const q of [64, 128, 192]) {
      ctx.moveTo(q + 0.5, 0);
      ctx.lineTo(q + 0.5, H);
    }
    ctx.stroke();
  },
};

/** The color each vectorscope cell stands for (its Cb/Cr at mid luma),
 * computed once per size. */
const hueCache = new Map<number, Float32Array>();
function vectorHues(n: number): Float32Array {
  const hit = hueCache.get(n);
  if (hit) return hit;
  const out = new Float32Array(n * n * 3);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const cb = (x / (n - 1) - 0.5) * 1.6;
      const cr = (0.5 - y / (n - 1)) * 1.6;
      const Y = 0.62;
      const r = Y + 1.5748 * cr;
      const b = Y + 1.8556 * cb;
      const g = (Y - 0.2126 * r - 0.0722 * b) / 0.7152;
      const i = (y * n + x) * 3;
      out[i] = Math.max(0.25, Math.min(1, r)) * 255;
      out[i + 1] = Math.max(0.25, Math.min(1, g)) * 255;
      out[i + 2] = Math.max(0.25, Math.min(1, b)) * 255;
    }
  hueCache.set(n, out);
  return out;
}
