import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { player } from "../engine/player";
import { ChartColumnBig, ChevronLeft, ChevronRight, ImageDown, Maximize2, Pause, Play, Repeat, SkipBack, SkipForward } from "../icons";
import { toast } from "../state/toast";
import { boxesAt, hitClipAt, nudgeClips } from "../lib/align";
import { canvasSize, ratioOf, RATIOS } from "../lib/canvas";
import { expandGroups } from "../lib/project/groups";
import { projectDuration } from "../lib/project/ops";
import { formatTimecode, parseJump } from "../lib/time";
import { provide, run, tipFor } from "../state/actions";
import { store, useEditor } from "../state/store";
import { Meter } from "./Meter";
import { CropBar } from "./CropOverlay";
import { TransformOverlay } from "./TransformOverlay";
import { ViewerGuideControl, ViewerGuides } from "./ViewerGuides";
import { TrimPreview } from "./TrimPreview";
import "./player.css";


/** The viewer: the composited frame, fitted to the panel at the project's
 * aspect ratio, with CapCut's transport bar underneath. */
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Arrow keys on the focused viewer move the selected pictures, as in
 * CapCut and Premiere's Program monitor. A held key is one undo step. */
function useNudge() {
  const held = useRef<{ dx: number; dy: number } | null>(null);
  return useRef({
    down(e: React.KeyboardEvent) {
      const d = ARROWS[e.key];
      const s = store.get();
      if (!d || e.ctrlKey || e.metaKey || e.altKey || s.playing) return;
      if (!boxesAt(s.project, s.selection, s.playhead).length) return;
      e.preventDefault();
      e.stopPropagation(); // not the frame step on the same key
      if (!held.current) {
        held.current = { dx: 0, dy: 0 };
        store.beginGesture();
      }
      const step = e.shiftKey ? 10 : 1;
      const t = held.current;
      t.dx += d[0] * step;
      t.dy += d[1] * step;
      const ids = s.selection, frame = s.playhead;
      store.previewGesture((p) => nudgeClips(p, ids, t.dx, t.dy, frame));
    },
    up(e: React.KeyboardEvent | React.FocusEvent) {
      if (!held.current || ("key" in e && !ARROWS[e.key])) return;
      held.current = null;
      store.endGesture("Nudge");
    },
  }).current;
}

export function PlayerPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const nudge = useNudge();
  const panelRef = useRef<HTMLElement>(null);
  const width = useEditor((s) => s.project.width);
  const height = useEditor((s) => s.project.height);
  const trimPreview = useEditor((s) => s.trimPreview);
  const cropping = useEditor((s) => s.cropEdit);
  const zoom = useEditor((s) => s.viewerZoom);
  const pan = useEditor((s) => s.viewerPan);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    player.attach(canvasRef.current);
    return () => player.attach(null);
  }, []);

  useEffect(() => {
    provide({
      fullscreenPreview: () => {
        const el = panelRef.current;
        if (!el) return;
        if (document.fullscreenElement) void document.exitFullscreen();
        else void el.requestFullscreen();
      },
    });
  }, []);

  // Fit the canvas inside the stage at the project aspect (contain).
  useLayoutEffect(() => {
    const stage = stageRef.current!;
    const fit = () => {
      // Fit inside the content box: the stage's padding keeps the rotate
      // knob clear of the transport and gives the meter its own gutter.
      // Fitting the border box cropped the picture and put the meter on it.
      const cs = getComputedStyle(stage);
      const r = {
        width: stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        height: stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
      };
      const fitK = Math.max(0, Math.min(r.width / width, r.height / height));
      fitRef.current = fitK;
      const k = zoom ?? fitK;
      const w = Math.floor(width * k);
      const h = Math.floor(height * k);
      setBox({ w, h });
      const dpr = window.devicePixelRatio || 1;
      player.setDisplaySize(w * dpr, h * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [width, height, zoom]);

  // Premiere's Program monitor zoom: Ctrl+wheel magnifies at the pointer,
  // the wheel (Shift: sideways) or a middle-button drag pans once zoomed.
  const fitRef = useRef(1);
  useEffect(() => {
    const stage = stageRef.current!;
    const onWheel = (e: WheelEvent) => {
      const s = store.get();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const k = s.viewerZoom ?? fitRef.current;
        const next = Math.min(8, Math.max(0.05, k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        // Keep the point under the pointer still: it sits d from the
        // picture's center now and d * ratio after, so the pan takes the rest.
        const r = stage.querySelector(".player-frame")!.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const ratio = next / k;
        if (next <= fitRef.current * 1.001) store.set({ viewerZoom: null, viewerPan: { x: 0, y: 0 } });
        else store.set({ viewerZoom: next, viewerPan: { x: s.viewerPan.x + dx * (1 - ratio), y: s.viewerPan.y + dy * (1 - ratio) } });
      } else if (s.viewerZoom !== null) {
        e.preventDefault();
        const sideways = e.shiftKey ? e.deltaY : e.deltaX;
        store.set({ viewerPan: { x: s.viewerPan.x - sideways, y: s.viewerPan.y - (e.shiftKey ? 0 : e.deltaY) } });
      }
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);
  const panFrom = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  return (
    <section className="panel player-panel" aria-label="Player" ref={panelRef}>
      <header className="panel-head">
        <span className="panel-title">Player</span>
        <ViewerGuideControl />
        <ScopesToggle />
      </header>
      <div
        className="player-stage"
        ref={stageRef}
        // Focus follows a click on the picture, so the arrow keys nudge the
        // selection there (1 px, Shift 10 px) and step frames elsewhere.
        tabIndex={-1}
        onPointerDownCapture={() => stageRef.current?.focus({ preventScroll: true })}
        onKeyDown={nudge.down}
        onKeyUp={nudge.up}
        onBlur={nudge.up}
        onDoubleClick={() => run("fullscreenPreview")}
        onPointerMove={(e) => {
          const d = panFrom.current;
          if (d) store.set({ viewerPan: { x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py } });
        }}
        onPointerUp={() => (panFrom.current = null)}
        onPointerDown={(e) => {
          // The middle button pans a zoomed-in viewer.
          if (e.button === 1) {
            const s = store.get();
            if (s.viewerZoom === null) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            panFrom.current = { ...s.viewerPan, px: e.clientX, py: e.clientY };
            return;
          }
          // Click the picture to select what is on top there, as in CapCut;
          // a grouped picture brings its group, as on the timeline (Alt: alone).
          const s = store.get();
          const rect = canvasRef.current!.getBoundingClientRect();
          const hit = hitClipAt(s.project, s.playhead,
            (e.clientX - rect.left) * s.project.width / rect.width,
            (e.clientY - rect.top) * s.project.height / rect.height);
          store.select(hit ? (e.altKey ? [hit.id] : expandGroups(s.project, [hit.id])) : []);
        }}
      >
        <div className="player-frame" style={{ width: box.w, height: box.h, ...(zoom !== null ? { transform: `translate(${pan.x}px, ${pan.y}px)` } : {}) }}>
          <canvas ref={canvasRef} className="player-canvas" />
          <ViewerGuides />
          <TransformOverlay width={box.w} height={box.h} />
        </div>
        <Meter />
        {trimPreview && <TrimPreview state={trimPreview} />}
      </div>
      {cropping ? <CropBar session={cropping} /> : <Transport />}
    </section>
  );
}

function ScopesToggle() {
  const on = useEditor((s) => s.scopes);
  return (
    <button
      className={`icon-btn small player-scopes${on ? " on" : ""}`}
      aria-label="Scopes"
      aria-pressed={on}
      data-tip={on ? "Hide scopes" : "Scopes: waveform, parade, vectorscope, histogram"}
      onClick={() => store.set({ scopes: !on })}
    >
      <ChartColumnBig size={14} />
    </button>
  );
}

function Transport() {
  const playing = useEditor((s) => s.playing);
  const loop = useEditor((s) => s.loop);
  return (
    <div className="transport">
      <Timecodes />
      <div className="transport-center">
        <button className="icon-btn" aria-label="Go to start" data-tip={tipFor("goStart")} onClick={() => run("goStart")}>
          <SkipBack />
        </button>
        <button className="icon-btn" aria-label="Previous frame" data-tip={tipFor("stepBack")} onClick={() => run("stepBack")}>
          <ChevronLeft />
        </button>
        <button className="play-btn" aria-label={playing ? "Pause" : "Play"} data-tip={tipFor("playPause", playing ? "Pause" : "Play")} onClick={() => run("playPause")}>
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <button className="icon-btn" aria-label="Next frame" data-tip={tipFor("stepForward")} onClick={() => run("stepForward")}>
          <ChevronRight />
        </button>
        <button className="icon-btn" aria-label="Go to end" data-tip={tipFor("goEnd")} onClick={() => run("goEnd")}>
          <SkipForward />
        </button>
        <button className={`icon-btn loop-btn${loop ? " on" : ""}`} aria-label="Loop playback" aria-pressed={loop} data-tip={tipFor("toggleLoop", "Loop playback")} onClick={() => run("toggleLoop")}>
          <Repeat />
        </button>
      </div>
      <div className="transport-right">
        <ViewerZoom />
        <CanvasRatio />
        <PreviewQuality />
        <button className="icon-btn" aria-label="Save frame as PNG" data-tip={tipFor("saveFrame")} onClick={() => run("saveFrame")}>
          <ImageDown />
        </button>
        <button className="icon-btn" aria-label="Full screen" data-tip={tipFor("fullscreenPreview", "Full screen")} onClick={() => run("fullscreenPreview")}>
          <Maximize2 />
        </button>
      </div>
    </div>
  );
}

/** The playhead's time; click it to type where to go (Premiere's Playhead
 * Position): a timecode, digits read right to left, or +/- an offset. */
function Timecodes() {
  const playhead = useEditor((s) => s.hoverFrame ?? s.playhead);
  const project = useEditor((s) => s.project);
  const total = projectDuration(project);
  const [typing, setTyping] = useState<string | null>(null);
  const go = () => {
    const f = typing === null ? null : parseJump(typing, project.fps, store.get().playhead);
    setTyping(null);
    if (f !== null) store.seek(f);
    else if (typing?.trim()) toast(`"${typing.trim()}" is not a timecode`, "error");
  };
  return (
    <div className="timecodes num">
      {typing === null ? (
        <button className="tc-now" aria-label="Go to timecode" data-tip="Type a time to go there; +15 or -15 moves by frames" onClick={() => setTyping(formatTimecode(playhead, project.fps))}>
          {formatTimecode(playhead, project.fps)}
        </button>
      ) : (
        <input
          className="tc-now tc-input"
          aria-label="Go to timecode"
          value={typing}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setTyping(e.target.value)}
          onBlur={() => setTyping(null)}
          onKeyDown={(e) => {
            e.stopPropagation(); // not the editor's keys while typing
            if (e.key === "Enter") go();
            if (e.key === "Escape") setTyping(null);
          }}
        />
      )}
      <span className="tc-sep">/</span>
      <span className="tc-total">{formatTimecode(total, project.fps)}</span>
    </div>
  );
}

const ZOOMS = [0.25, 0.5, 1, 2, 4];

/** The viewer's magnification: Fit, or a share of the project's own
 * pixels (100% shows one project pixel per screen pixel). */
function ViewerZoom() {
  const zoom = useEditor((s) => s.viewerZoom);
  const dpr = window.devicePixelRatio || 1;
  const value = zoom === null ? "fit" : String(Math.round(zoom * dpr * 100));
  return (
    <select
      className="quality-select"
      aria-label="Viewer zoom"
      data-tip={tipFor("viewerZoom", "Viewer zoom; wheel or middle-drag pans")}
      value={value}
      onChange={(e) => store.set(e.target.value === "fit" ? { viewerZoom: null, viewerPan: { x: 0, y: 0 } } : { viewerZoom: Number(e.target.value) / 100 / dpr, viewerPan: { x: 0, y: 0 } })}
    >
      <option value="fit">Fit</option>
      {zoom !== null && !ZOOMS.some((z) => String(z * 100) === value) && <option value={value}>{value}%</option>}
      {ZOOMS.map((z) => (
        <option key={z} value={String(z * 100)}>{z * 100}%</option>
      ))}
    </select>
  );
}

/** CapCut's Ratio menu beside the preview quality: the canvas shape
 * without leaving the clip being edited for project Details. */
function CanvasRatio() {
  const w = useEditor((s) => s.project.width);
  const h = useEditor((s) => s.project.height);
  const ratio = ratioOf(w, h);
  return (
    <select
      className="quality-select"
      aria-label="Canvas ratio"
      data-tip="Canvas ratio"
      value={ratio?.label ?? ""}
      onChange={(e) => {
        const r = RATIOS.find((r) => r.label === e.target.value)!;
        const [nw, nh] = canvasSize(r.w, r.h, Math.min(w, h));
        store.edit("Canvas size", (q) => ({ ...q, width: nw, height: nh, canvasFixed: true }));
      }}
    >
      {!ratio && <option value="">{w}×{h}</option>}
      {RATIOS.map((r) => (
        <option key={r.label} value={r.label}>{r.label}</option>
      ))}
    </select>
  );
}

function PreviewQuality() {
  const scale = useEditor((s) => s.previewScale);
  return (
    <select
      className="quality-select"
      aria-label="Preview quality"
      data-tip="Preview resolution: lower plays more smoothly"
      value={scale}
      onChange={(e) => store.set({ previewScale: Number(e.target.value) as 1 | 0.5 | 0.25 })}
    >
      <option value={1}>Full</option>
      <option value={0.5}>1/2</option>
      <option value={0.25}>1/4</option>
    </select>
  );
}
