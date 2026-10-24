import { useEffect, useRef, useState } from "react";
import { Search } from "../icons";
import { findMoments, momentGroups, shotTime, type Moment, type ShotLog } from "../lib/shotlog";
import { findClip } from "../lib/project/ops";
import { platform } from "../platform";
import type { DescriberStatus } from "../platform/types";
import { analyzeFootage, borrowShotThumbnail, cancelShotLog, describerStatus, holdShotLog, loadShotLog, peekShotLog, SHOTLOG_DESKTOP_NOTE, shotLogJob, useShotLogs } from "../state/shotlog";
import { useEditor } from "../state/store";
import { projectWork } from "../state/projectWork";
import { SourceMonitor } from "./SourceMonitor";
import "./shotlog.css";

function MomentThumbnail({ assetId, moment }: { assetId: string; moment: Moment }) {
  const ref = useRef<HTMLSpanElement>(null), [src, setSrc] = useState<string>();
  useEffect(() => {
    if (!platform.shotlog || !ref.current) return;
    let generation = 0, release = () => {};
    const observer = new IntersectionObserver(entries => {
      const current = ++generation;
      release(); release = () => {}; setSrc(undefined);
      if (entries[0].isIntersecting) void borrowShotThumbnail(assetId, (moment.start + moment.end) / 2).then(value => {
        if (current !== generation) { value?.release(); return; }
        if (value) { release = value.release; setSrc(value.src); }
      }).catch(() => {});
    });
    observer.observe(ref.current);
    return () => { generation++; observer.disconnect(); release(); };
  }, [assetId, moment.start, moment.end]);
  if (!platform.shotlog) return null;
  return <span ref={ref} className="shotlog-thumbnail">{src && <img src={src} alt="" width={160} />}</span>;
}

export function ShotLogTab() {
  useShotLogs();
  const project = useEditor(s => s.project), selection = useEditor(s => s.selection);
  const selected = findClip(project, selection[0])?.clip;
  const videos = project.assets.filter(a => a.kind === "video" && a.hasVideo);
  const [picked, setPicked] = useState(() => selected?.type === "video" ? selected.assetId : videos[0]?.id ?? "");
  const [query, setQuery] = useState(""), [error, setError] = useState("");
  const [status, setStatus] = useState<DescriberStatus>();
  const [preview, setPreview] = useState<{ id: string; time: number; end: number }>();
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [speechChoice, setSpeechChoice] = useState<{ id: string; value: boolean }>();
  const session = projectWork.signal();
  const [loaded, setLoaded] = useState<{ id: string; session: AbortSignal; log: ShotLog }>();
  const asset = videos.find(a => a.id === picked) ?? videos[0];
  const log = asset && (peekShotLog(asset.id) ?? (loaded?.id === asset.id && loaded.session === session ? loaded.log : undefined));
  const includeSpeech = speechChoice && speechChoice.id === asset?.id ? speechChoice.value : (asset?.duration ?? Infinity) < 1200;
  const job = asset && shotLogJob(asset.id), busy = job?.state === "running";
  useEffect(() => {
    if (selected?.type === "video") setPicked(selected.assetId);
  }, [selected?.type === "video" ? selected.assetId : ""]);
  useEffect(() => {
    let live = true, release = () => {};
    setLoaded(undefined); setExpanded(new Set());
    if (asset) void loadShotLog(asset.id).then(log => {
      if (live && log) { release = holdShotLog(asset.id, log); setLoaded({ id: asset.id, session, log }); }
    }).catch(e => { if (live) setError(String(e)); });
    void describerStatus().then(s => { if (live) setStatus(s); }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; release(); };
  }, [asset?.id, busy, session]);
  const run = (refresh = false) => {
    if (!asset) return;
    setError("");
    try { analyzeFootage(asset.id, { refresh, speech: includeSpeech }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const matches = log && query.trim() ? new Set(findMoments([{ asset: asset!.id, log }], query, log.moments.length).map(m => m.start)) : undefined;
  const groups = log ? matches ? log.moments.filter(m => matches.has(m.start)).map(m => ({ start: m.start, end: m.end, moments: [m] })) : momentGroups(log) : [];
  const renderMoment = (m: Moment) => <button className={`shotlog-moment${m.described ? "" : " undescribed"}`} key={m.start} onClick={() => setPreview({ id: asset!.id, time: m.start, end: m.end })} aria-label={`Open in source monitor: ${shotTime(m.start)}`}>
    <MomentThumbnail assetId={asset!.id} moment={m} />
    <span className="shotlog-time">{shotTime(m.start)}-{shotTime(m.end)}</span>
    {m.described ? <><span className="shotlog-chips"><span>{m.described.shot_size.replaceAll("_", " ")}</span><span>{m.described.camera.replaceAll("_", " ")}</span></span><strong>{m.described.action}</strong><span>{m.described.description}</span>{!!m.described.on_screen_text.length && <span>On screen: {m.described.on_screen_text.join(", ")}</span>}</> : <span>Not described yet. Motion {m.measured.motion.toFixed(2)}, brightness {m.measured.luma.toFixed(2)}{log?.has_audio === false ? ", no audio" : `, sound ${Math.round(m.measured.loudness_db)} dB`}</span>}
    <span className="shotlog-open">Open in source monitor</span>
  </button>;
  const previewAsset = project.assets.find(a => a.id === preview?.id);
  return <div className="shotlog-tab lib-content">
    {!platform.shotlog && <p className="lib-hint">{SHOTLOG_DESKTOP_NOTE}</p>}
    <label className="shotlog-picker">Video<select className="field" aria-label="Shot log video" value={asset?.id ?? ""} onChange={e => { setPicked(e.target.value); setQuery(""); setError(""); }}>
      {!videos.length && <option value="">Import a video first</option>}
      {videos.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select></label>
    {platform.describer && <p className="lib-hint" role="status">{busy ? job.stage : status?.state === "ready" ? `Describer ready${status.device ? ` (${status.device})` : ""}` : status?.state === "missing" ? `Describing footage downloads a ${status.bytes_needed ? (status.bytes_needed / 1e9).toFixed(1) : "2.9"} GB model once and runs it on this computer` : status?.state === "error" ? status.error : status?.state === "downloading" ? "Downloading the describer" : status?.state === "stopped" ? "Describer installed; starts when needed" : "Preparing the describer"}</p>}
    {platform.shotlog && <label className="shotlog-speech"><input type="checkbox" aria-label="Include speech" checked={includeSpeech} disabled={!asset?.hasAudio || busy} onChange={e => setSpeechChoice({ id: asset!.id, value: e.target.checked })} />Include speech</label>}
    {platform.shotlog && <div className="lib-toolbar">
      <button className="btn" disabled={!asset || busy} onClick={() => run()}>{log && !log.complete ? "Continue analysis" : "Analyze"}</button>
      <button className="btn" disabled={!asset || busy} onClick={() => run(true)}>Refresh</button>
    </div>}
    {busy && <div className="shotlog-progress" role="status"><progress aria-label="Shot log progress" value={job.progress} max={1} /><button className="btn" onClick={() => cancelShotLog(asset!.id)}>Cancel</button></div>}
    {(error || job?.error) && <p role="alert">{error || job?.error}</p>}
    {log && <>
      <p className="lib-hint">{log.moments.filter(m => m.described).length} of {log.moments.length} moments described{log.complete ? "" : " (partial)"}</p>
      <label className="lib-search"><Search size={14} /><input className="field" aria-label="Search shot log" placeholder="Search actions or on-screen text" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="shotlog-moments" aria-label="Shot log moments">
        {groups.map(group => group.moments.length === 1 ? renderMoment(group.moments[0]) : <div className="shotlog-group" key={group.start}>
          <button className="btn shotlog-fold" aria-expanded={expanded.has(group.start)} onClick={() => setExpanded(old => { const next = new Set(old); if (next.has(group.start)) next.delete(group.start); else next.add(group.start); return next; })}>
            {shotTime(group.start)}-{shotTime(group.end)} (alike x{group.moments.length})
          </button>
          {expanded.has(group.start) && group.moments.map(renderMoment)}
        </div>)}
        {!groups.length && <p className="lib-hint">No matching moments</p>}
      </div>
    </>}
    {platform.shotlog && !log && !busy && <p className="lib-hint">Analyze this video to read what happens on screen beside its speech transcript.</p>}
    {preview && previewAsset && <SourceMonitor key={`${preview.id}:${preview.time}`} asset={previewAsset} initialTime={preview.time} initialIn={preview.time} initialOut={preview.end} onClose={() => setPreview(undefined)} />}
  </div>;
}
