import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { player, topClipAt } from "../engine/player";
import { ChevronLeft, ChevronRight, Maximize2, Pause, Play } from "../icons";
import { chordText } from "../lib/keymap";
import { projectDuration } from "../lib/project/ops";
import { formatTimecode } from "../lib/time";
import { isMac } from "../platform/env";
import { chordFor, provide, run } from "../state/actions";
import { store, useEditor } from "../state/store";
import { TransformOverlay } from "./TransformOverlay";
import "./player.css";

const tip = (label: string, id: Parameters<typeof chordFor>[0]) => {
  const c = chordFor(id);
  return c ? `${label} (${chordText(c, isMac)})` : label;
};

/** The viewer: the composited frame, fitted to the panel at the project's
 * aspect ratio, with CapCut's transport bar underneath. */
export function PlayerPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const width = useEditor((s) => s.project.width);
  const height = useEditor((s) => s.project.height);
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
      const r = stage.getBoundingClientRect();
      const k = Math.min(r.width / width, r.height / height);
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
      </header>
      <div
        className="player-stage"
        ref={stageRef}
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
          <TransformOverlay width={box.w} height={box.h} />
        </div>
      </div>
      <Transport />
    </section>
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
