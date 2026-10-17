import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { player, topClipAt } from "../engine/player";
import { Activity, ChevronLeft, ChevronRight, Maximize2, Pause, Play } from "../icons";
import { chordText } from "../lib/keymap";
import { boxesAt, nudgeClips } from "../lib/align";
import { canvasSize, ratioOf, RATIOS } from "../lib/canvas";
import { projectDuration } from "../lib/project/ops";
import { formatTimecode } from "../lib/time";
import { isMac } from "../platform/env";
import { chordFor, provide, run } from "../state/actions";
import { store, useEditor } from "../state/store";
import { Meter } from "./Meter";
import { TransformOverlay } from "./TransformOverlay";
import { ViewerGuideControl, ViewerGuides } from "./ViewerGuides";
import { TrimPreview } from "./TrimPreview";
import "./player.css";

const tip = (label: string, id: Parameters<typeof chordFor>[0]) => {
  const c = chordFor(id);
  return c ? `${label} (${chordText(c, isMac)})` : label;
};

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
      const k = Math.max(0, Math.min(r.width / width, r.height / height));
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
  }, [width, height]);

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
        onPointerDown={() => {
          // Click the picture to select what is on top there, as in CapCut.
          const s = store.get();
          const hit = topClipAt(s.project, s.playhead);
          store.select(hit ? [hit.id] : []);
        }}
      >
        <div className="player-frame" style={{ width: box.w, height: box.h }}>
          <canvas ref={canvasRef} className="player-canvas" />
          <ViewerGuides />
          <TransformOverlay width={box.w} height={box.h} />
        </div>
        <Meter />
        {trimPreview && <TrimPreview state={trimPreview} />}
      </div>
      <Transport />
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
      <Activity size={14} />
    </button>
  );
}

function Transport() {
  const playing = useEditor((s) => s.playing);
  return (
    <div className="transport">
      <Timecodes />
      <div className="transport-center">
        <button className="icon-btn" aria-label="Previous frame" data-tip={tip("Previous frame", "stepBack")} onClick={() => run("stepBack")}>
          <ChevronLeft />
        </button>
        <button className="play-btn" aria-label={playing ? "Pause" : "Play"} data-tip={tip(playing ? "Pause" : "Play", "playPause")} onClick={() => run("playPause")}>
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <button className="icon-btn" aria-label="Next frame" data-tip={tip("Next frame", "stepForward")} onClick={() => run("stepForward")}>
          <ChevronRight />
        </button>
      </div>
      <div className="transport-right">
        <CanvasRatio />
        <PreviewQuality />
        <button className="icon-btn" aria-label="Full screen" data-tip={tip("Full screen", "fullscreenPreview")} onClick={() => run("fullscreenPreview")}>
          <Maximize2 />
        </button>
      </div>
    </div>
  );
}

function Timecodes() {
  const playhead = useEditor((s) => s.hoverFrame ?? s.playhead);
  const project = useEditor((s) => s.project);
  const total = projectDuration(project);
  return (
    <div className="timecodes num">
      <span className="tc-now">{formatTimecode(playhead, project.fps)}</span>
      <span className="tc-sep">/</span>
      <span className="tc-total">{formatTimecode(total, project.fps)}</span>
    </div>
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
      {!ratio && <option value="">{w}x{h}</option>}
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
