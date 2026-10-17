import { memo, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { fromDb, toDb } from "../lib/audio";
import { isTimed, setParam, sourceOffset } from "../lib/project/ops";
import { store } from "../state/store";
import { editOnCanvas } from "../state/textEdit";
import { thumbs } from "../engine/thumbs";
import { AudioLines, Group, Image, Snowflake, Sparkles, SlidersHorizontal, Type } from "../icons";
import { EFFECTS, FILTERS } from "../lib/catalog";
import type { Asset, Clip, Project, Track } from "../lib/project/types";
import { PRESETS } from "../lib/speed";
import { formatDuration, framesToSeconds } from "../lib/time";
import { ClipKeys } from "./ClipKeys";

export type ClipZone = "body" | "start" | "end";

interface Props {
  clip: Clip;
  track: Track;
  asset?: Asset;
  fps: Project["fps"];
  zoom: number;
  /** Lane height in px. */
  height: number;
  selected: boolean;
  /** Visible content range in px relative to the clip's left edge. */
  visFrom: number;
  visTo: number;
  playheadRel: number | null;
  /** Px the clip slides right to make room for a drop that will insert
   * before it on the magnetic main track. */
  shift?: number;
  onDown: (e: React.PointerEvent, clip: Clip, zone: ClipZone) => void;
  onContext: (e: React.MouseEvent, clip: Clip) => void;
}

const LABEL_H = 16;
const WAVE_H = 14;

function useThumbVersion() {
  return useSyncExternalStore(thumbs.subscribe, thumbs.version);
}

/** Source second under clip-relative frame r (fractional), following the
 * clip's speed, ramp and direction, so strips and waveforms show what plays. */
function sourceAt(c: Clip, r: number, fps: Project["fps"]): number {
  if (!isTimed(c)) return 0;
  if (c.freeze) return c.in;
  return c.in + (c.reverse ? -1 : 1) * sourceOffset(c, r, fps);
}

/** Paint a filmstrip into the visible slice of the clip. */
function paintStrip(cv: HTMLCanvasElement, p: Props, h: number, x0: number, w: number) {
  const ctx = cv.getContext("2d")!;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const strip = p.asset && thumbs.strip(p.asset);
  if (!strip) return;
  const dpr = cv.width / Math.max(1, w);
  const tileW = h * strip.aspect;
  const first = Math.floor(x0 / tileW) * tileW;
  const c = p.clip;
  for (let x = first; x < x0 + w; x += tileW) {
    let img: ImageBitmap | undefined;
    if (strip.step === Infinity) img = strip.frames[0];
    else {
      const t = sourceAt(c, (x + tileW / 2) / p.zoom, p.fps);
      const i = Math.min(strip.frames.length - 1, Math.max(0, Math.round(t / strip.step)));
      img = strip.frames[i] ?? strip.frames.find(Boolean);
    }
    if (img) ctx.drawImage(img, (x - x0) * dpr, 0, tileW * dpr, h * dpr);
  }
}

function paintWave(cv: HTMLCanvasElement, p: Props, h: number, x0: number, w: number, color: string) {
  const ctx = cv.getContext("2d")!;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const peaks = p.asset && thumbs.peaks(p.asset);
  if (!peaks) return;
  const dpr = cv.width / Math.max(1, w);
  const c = p.clip;
  const gain = "volume" in c ? Math.min(2, c.volume) : 1;
  ctx.fillStyle = color;
  const mid = (h * dpr) / 2;
  for (let px = 0; px < w * dpr; px++) {
    const u = sourceAt(c, (x0 + px / dpr) / p.zoom, p.fps);
    const v = sourceAt(c, (x0 + (px + 1) / dpr) / p.zoom, p.fps);
    const a = Math.min(u, v);
    const b = Math.max(u, v);
    let m = 0;
    for (let i = Math.floor(a * peaks.rate); i <= Math.floor(b * peaks.rate); i++) m = Math.max(m, peaks.data[i] ?? 0);
    const amp = Math.min(1, Math.sqrt(m) * gain) * mid * 0.95;
    if (amp > 0.3) ctx.fillRect(px, mid - amp, 1, amp * 2);
  }
}

function useCanvas(paint: (cv: HTMLCanvasElement) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (ref.current) paint(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function describe(c: Clip): string {
  if (c.type === "text") return c.text.replace(/\n/g, " ") || "Text";
  if (c.type === "color") return "Solid color";
  if (c.type === "adjustment") {
    const parts = [c.filter && FILTERS[c.filter.type]?.label, ...c.effects.map((e) => EFFECTS[e.type]?.label)].filter(Boolean);
    return parts.length ? parts.join(", ") : "Adjustment";
  }
  return c.name ?? "";
}

// ---- audio handles: CapCut's volume line and fade knobs ------------------------

const DB_MIN = -36;
const DB_MAX = 12;
/** Volume line height: 0 dB sits a quarter of the way down, as in CapCut. */
const dbToY = (db: number, h: number) => {
  const t = (Math.min(DB_MAX, Math.max(DB_MIN, db)) - DB_MIN) / (DB_MAX - DB_MIN);
  return h - t * h;
};

function AudioHandles(p: { clip: Clip; zoom: number; height: number; top: number; fps: Project["fps"] }) {
  const c = p.clip as Clip & { volume: number; fadeIn: number; fadeOut: number };
  const [drag, setDrag] = useState<null | { kind: "vol" | "in" | "out"; label: string }>(null);
  const h = p.height;
  const w = c.duration * p.zoom;
  const db = toDb(c.volume);
  const lineY = dbToY(db, h);
  const fi = c.fadeIn * p.zoom;
  const fo = c.fadeOut * p.zoom;
  const start = (e: React.PointerEvent, kind: "vol" | "in" | "out") => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    store.beginGesture();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const v0 = kind === "vol" ? lineY : kind === "in" ? c.fadeIn : c.fadeOut;
    const move = (ev: PointerEvent) => {
      if (kind === "vol") {
        // Shift for fine control: a 30 px lane spans 48 dB otherwise.
        const y = Math.min(h, Math.max(0, v0 + (ev.clientY - y0) * (ev.shiftKey ? 0.2 : 1)));
        const d = DB_MIN + ((h - y) / h) * (DB_MAX - DB_MIN);
        const v = y >= h - 0.5 ? 0 : fromDb(Math.round(d * 10) / 10);
        store.previewGesture((q) => setParam(q, [c.id], "volume", v));
        setDrag({ kind, label: v === 0 ? "-∞ dB" : `${d >= 0 ? "+" : ""}${d.toFixed(1)} dB` });
      } else {
        const dx = (ev.clientX - x0) / p.zoom;
        const f = Math.round(Math.min(c.duration / 2, Math.max(0, v0 + (kind === "in" ? dx : -dx))));
        store.previewGesture((q) => setParam(q, [c.id], kind === "in" ? "fadeIn" : "fadeOut", f));
        setDrag({ kind, label: `Fade ${kind} ${framesToSeconds(f, p.fps).toFixed(1)}s` });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      store.endGesture(kind === "vol" ? "Volume" : kind === "in" ? "Fade in" : "Fade out");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="audio-handles" style={{ top: p.top, height: h }}>
      <svg className="fade-shade" width={w} height={h} aria-hidden>
        {fi > 0 && <path d={`M0,0 L${fi},${lineY} L0,${h} Z`} />}
        {fo > 0 && <path d={`M${w},0 L${w - fo},${lineY} L${w},${h} Z`} />}
      </svg>
      <div className={`vol-line${drag?.kind === "vol" ? " on" : ""}`} style={{ top: lineY, left: fi, right: fo }} data-tip="Drag to change volume (Shift for fine)" onPointerDown={(e) => start(e, "vol")} />
      <div className="fade-knob in" style={{ left: Math.max(8, fi - 5) }} data-tip="Drag to fade in" onPointerDown={(e) => start(e, "in")} />
      <div className="fade-knob out" style={{ right: Math.max(8, fo - 5) }} data-tip="Drag to fade out" onPointerDown={(e) => start(e, "out")} />
      {drag && <span className="handle-readout num">{drag.label}</span>}
    </div>
  );
}

export const ClipView = memo(function ClipView(p: Props) {
  const { clip: c, zoom, height } = p;
  const v = useThumbVersion();
  const w = c.duration * zoom;
  const x0 = Math.max(0, p.visFrom);
  const x1 = Math.min(w, p.visTo);
  const visW = Math.max(0, x1 - x0);
  const dpr = window.devicePixelRatio || 1;
  const isVideo = c.type === "video" || c.type === "image";
  const showWave = (c.type === "video" && !c.muted && p.asset?.hasAudio) || c.type === "audio";
  const bodyH = c.type === "audio" ? height - LABEL_H : height - LABEL_H - (showWave && c.type === "video" ? WAVE_H : 0);

  const strip = useCanvas((cv) => isVideo && paintStrip(cv, p, bodyH, x0, visW), [v, x0, visW, zoom, c, bodyH]);
  const waveH = c.type === "audio" ? bodyH : WAVE_H;
  const wave = useCanvas(
    (cv) => showWave && paintWave(cv, p, waveH, x0, visW, c.type === "audio" ? "#3f95d6" : "rgb(170 230 235 / 55%)"),
    [v, x0, visW, zoom, c, waveH],
  );

  const name = c.type === "video" || c.type === "image" || c.type === "audio" ? (c.name ?? p.asset?.name ?? "") : describe(c);
  const Icon = c.type === "text" ? Type : c.type === "adjustment" ? (c.effects.length ? Sparkles : SlidersHorizontal) : c.type === "audio" ? AudioLines : c.type === "image" ? Image : null;
  const fxCount = "effects" in c ? c.effects.length + ("filter" in c && c.filter ? 1 : 0) : 0;
  const curve = isTimed(c) && c.speedCurve ? (PRESETS[c.speedCurve.preset ?? ""]?.label ?? "Curve") : null;
  const speed = curve ?? ("speed" in c && c.speed !== 1 ? `${+c.speed.toFixed(2)}x` : null);
  const reversed = isTimed(c) && c.reverse && !c.freeze;
  const freeze = "freeze" in c && c.freeze;
  const tiny = w < 34;

  return (
    <div
      className={`clip clip-${c.type}${(c as { caption?: boolean }).caption ? " clip-caption" : ""}${p.selected ? " selected" : ""}${c.disabled ? " disabled" : ""}${p.track.locked ? " locked" : ""}`}
      style={{ transform: `translateX(${c.start * zoom + (p.shift ?? 0)}px)`, width: Math.max(2, w), height }}
      onPointerDown={(e) => p.onDown(e, c, "body")}
      onContextMenu={(e) => p.onContext(e, c)}
      // CapCut: double-click a caption (or title) on the timeline to edit its
      // words; ours opens the canvas editor. The blade's double-click just cuts.
      onDoubleClick={c.type === "text" ? () => store.get().tool === "select" && editOnCanvas(c.id) : undefined}
      data-clip={c.id}
    >
      <div className="clip-label" style={{ height: LABEL_H }}>
        {!tiny && Icon && <Icon size={11} strokeWidth={2} />}
        {!tiny && <span className="clip-name">{name}</span>}
        {!tiny && w > 120 && <span className="clip-dur num">{formatDuration(framesToSeconds(c.duration, p.fps))}</span>}
        {speed && !tiny && <span className="clip-badge num">{speed}</span>}
        {reversed && !tiny && <span className="clip-badge">Reverse</span>}
        {freeze && !tiny && <Snowflake size={11} className="clip-badge-icon" />}
        {c.group && !tiny && <Group size={11} className="clip-badge-icon" aria-label="Grouped" />}
        {fxCount > 0 && !tiny && c.type !== "adjustment" && (
          <span className="clip-badge">
            <Sparkles size={10} /> {fxCount}
          </span>
        )}
      </div>
      {isVideo && visW > 0 && (
        <canvas ref={strip} className="clip-strip" width={Math.ceil(visW * dpr)} height={Math.ceil(bodyH * dpr)} style={{ left: x0, width: visW, height: bodyH, top: LABEL_H }} />
      )}
      {showWave && visW > 0 && (
        <canvas
          ref={wave}
          className="clip-wave"
          width={Math.ceil(visW * dpr)}
          height={Math.ceil(waveH * dpr)}
          style={{ left: x0, width: visW, height: waveH, top: c.type === "audio" ? LABEL_H : height - WAVE_H }}
        />
      )}
      {c.type === "audio" && p.selected && !tiny && <AudioHandles clip={c} zoom={zoom} height={bodyH} top={LABEL_H} fps={p.fps} />}
      {p.selected && <ClipKeys clip={c} zoom={zoom} playheadRel={p.playheadRel} locked={p.track.locked} />}
      {!tiny && !p.track.locked && (
        <>
          <div className="trim trim-start" onPointerDown={(e) => { e.stopPropagation(); p.onDown(e, c, "start"); }} />
          <div className="trim trim-end" onPointerDown={(e) => { e.stopPropagation(); p.onDown(e, c, "end"); }} />
        </>
      )}
    </div>
  );
});
