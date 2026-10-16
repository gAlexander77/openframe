import { useEffect, useMemo, useRef, useState } from "react";
import { audibleTime, audioContext, scheduleAudio, type Schedule } from "../engine/audio";
import { player } from "../engine/player";
import { AudioLines, ChevronLeft, ChevronRight, Pause, Play } from "../icons";
import { sourceFrames, sourceProject } from "../lib/sourceMonitor";
import type { Asset } from "../lib/project/types";
import { formatTimecode, fpsValue, framesToSeconds } from "../lib/time";
import { addToTimeline } from "../state/media";
import { projectWork } from "../state/projectWork";
import { store } from "../state/store";
import { Dialog } from "./Dialog";
import { FramePreview } from "./FramePreview";
import "./sourceMonitor.css";

export function SourceMonitor({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const project = useMemo(() => sourceProject(asset), [asset]);
  const total = sourceFrames(asset, project.fps), rate = fpsValue(project.fps);
  const [frame, setFrame] = useState(0), [markIn, setIn] = useState(0), [markOut, setOut] = useState(total);
  const [playing, setPlaying] = useState(false), [error, setError] = useState("");
  const [signal] = useState(() => projectWork.signal());
  const transport = useRef<{ schedule?: Schedule; raf?: number; generation: number }>({ generation: 0 });
  const stop = () => {
    const t = transport.current; t.generation++; t.schedule?.stop();
    if (t.raf !== undefined) cancelAnimationFrame(t.raf);
    t.schedule = undefined; t.raf = undefined; setPlaying(false);
  };
  useEffect(() => { player.pause(); return () => { const t = transport.current; t.generation++; t.schedule?.stop(); if (t.raf !== undefined) cancelAnimationFrame(t.raf); }; }, []);
  useEffect(() => { signal.addEventListener("abort", stop); return () => signal.removeEventListener("abort", stop); }, [signal]);
  const seek = (f: number) => { stop(); setFrame(Math.max(0, Math.min(total - 1, f))); };
  const play = async () => {
    if (playing) { stop(); return; }
    if (signal.aborted) return;
    stop(); setError("");
    const generation = transport.current.generation;
    try {
      const ctx = audioContext(); await ctx.resume();
      if (generation !== transport.current.generation || signal.aborted) return;
      const start = frame >= markOut - 1 || frame < markIn ? markIn : frame;
      const at = ctx.currentTime + 0.05;
      const schedule = scheduleAudio(ctx, ctx.destination, project, start / rate, markOut / rate, at);
      transport.current.schedule = schedule;
      void schedule.done.catch((e) => { if (generation === transport.current.generation) { stop(); setError(String(e)); } });
      setPlaying(true);
      const tick = () => {
        if (generation !== transport.current.generation) return;
        const f = start + Math.max(0, Math.floor((audibleTime(ctx) - at) * rate));
        if (f >= markOut) { setFrame(markOut - 1); stop(); return; }
        setFrame(f); transport.current.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { stop(); setError(e instanceof Error ? e.message : String(e)); }
  };
  const still = asset.kind === "image";
  return <Dialog title={`Source: ${asset.name}`} onClose={onClose} className="source-monitor">
    {asset.kind === "audio" ? <div className="source-audio"><AudioLines size={40} /><span>Audio source</span></div> : <FramePreview project={project} frame={frame} label="Source preview" />}
    {!still && <>
      <input className="source-scrub" type="range" aria-label="Source position" min={0} max={total - 1} step={1} value={frame} onChange={(e) => seek(+e.target.value)} />
      <div className="source-transport"><button className="icon-btn" aria-label="Previous source frame" onClick={() => seek(frame - 1)}><ChevronLeft size={18} /></button><button className="icon-btn" aria-label={playing ? "Pause source" : "Play source"} onClick={() => void play()}>{playing ? <Pause size={18} /> : <Play size={18} />}</button><button className="icon-btn" aria-label="Next source frame" onClick={() => seek(frame + 1)}><ChevronRight size={18} /></button><output className="num">{formatTimecode(frame, project.fps)}</output><span className="media-details">{Number(rate.toFixed(3))} fps</span></div>
      <div className="source-marks">
        <div><button className="btn" onClick={() => { stop(); setIn(frame); if (markOut <= frame) setOut(frame + 1); }}>Mark In</button><output className="num" aria-label="Source In">{formatTimecode(markIn, project.fps)}</output></div>
        <div><button className="btn" onClick={() => { stop(); setOut(frame + 1); if (markIn > frame) setIn(frame); }}>Mark Out</button><output className="num" aria-label="Source Out">{formatTimecode(markOut - 1, project.fps)}</output></div>
        <button className="btn ghost" onClick={() => { stop(); setIn(0); setOut(total); }}>Clear marks</button>
      </div>
      <p className="lib-hint">{((markOut - markIn) / rate).toFixed(3)} seconds selected. Out includes the displayed frame. Add range inserts at the playhead using the current timeline mode.</p>
    </>}
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <footer><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => {
      stop();
      try {
        const current = store.get().project.assets.find((a) => a.id === asset.id);
        if (signal.aborted || !current || current.src !== asset.src || current.proxy !== asset.proxy) throw new Error("The source changed. Reopen its preview.");
        addToTimeline(current, undefined, undefined, still ? undefined : { in: framesToSeconds(markIn, project.fps), out: framesToSeconds(markOut, project.fps) });
        onClose();
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    }}>{still ? "Add image" : "Add range"}</button></footer>
  </Dialog>;
}
