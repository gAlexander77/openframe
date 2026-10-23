import { useEffect, useState } from "react";
import { Search } from "../icons";
import { findMoments, shotTime, type ShotLog } from "../lib/shotlog";
import { findClip } from "../lib/project/ops";
import { platform } from "../platform";
import type { DescriberStatus } from "../platform/types";
import { analyzeFootage, cancelShotLog, describerStatus, holdShotLog, loadShotLog, peekShotLog, SHOTLOG_DESKTOP_NOTE, shotLogJob, useShotLogs } from "../state/shotlog";
import { useEditor } from "../state/store";
import { projectWork } from "../state/projectWork";
import { SourceMonitor } from "./SourceMonitor";
import "./shotlog.css";

export function ShotLogTab() {
  useShotLogs();
  const project = useEditor(s => s.project), selection = useEditor(s => s.selection);
  const selected = findClip(project, selection[0])?.clip;
  const videos = project.assets.filter(a => a.hasVideo);
  const [picked, setPicked] = useState(() => selected?.type === "video" ? selected.assetId : videos[0]?.id ?? "");
  const [query, setQuery] = useState(""), [error, setError] = useState("");
  const [status, setStatus] = useState<DescriberStatus>();
  const [preview, setPreview] = useState<{ id: string; time: number }>();
  const session = projectWork.signal();
  const [loaded, setLoaded] = useState<{ id: string; session: AbortSignal; log: ShotLog }>();
  const asset = videos.find(a => a.id === picked) ?? videos[0];
  const log = asset && (peekShotLog(asset.id) ?? (loaded?.id === asset.id && loaded.session === session ? loaded.log : undefined));
  const job = asset && shotLogJob(asset.id), busy = job?.state === "running";
  useEffect(() => {
    if (selected?.type === "video") setPicked(selected.assetId);
  }, [selected?.type === "video" ? selected.assetId : ""]);
  useEffect(() => {
    let live = true, release = () => {};
    setLoaded(undefined);
    if (asset) void loadShotLog(asset.id).then(log => {
      if (live && log) { release = holdShotLog(asset.id, log); setLoaded({ id: asset.id, session, log }); }
    }).catch(e => { if (live) setError(String(e)); });
    void describerStatus().then(s => { if (live) setStatus(s); }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; release(); };
  }, [asset?.id, busy, session]);
  const run = (refresh = false) => {
    if (!asset) return;
    setError("");
    try { analyzeFootage(asset.id, { refresh }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const matches = log && query.trim() ? new Set(findMoments([{ asset: asset!.id, log }], query, log.moments.length).map(m => m.start)) : undefined;
  const moments = log?.moments.filter(m => !matches || matches.has(m.start)) ?? [];
  const previewAsset = project.assets.find(a => a.id === preview?.id);
  return <div className="shotlog-tab lib-content">
    {!platform.shotlog && <p className="lib-hint">{SHOTLOG_DESKTOP_NOTE}</p>}
    <label className="shotlog-picker">Video<select className="field" aria-label="Shot log video" value={asset?.id ?? ""} onChange={e => { setPicked(e.target.value); setQuery(""); setError(""); }}>
      {!videos.length && <option value="">Import a video first</option>}
      {videos.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select></label>
    {platform.describer && <p className="lib-hint" role="status">{status?.state === "ready" ? `Describer ready${status.device ? ` (${status.device})` : ""}` : status?.state === "missing" ? `Describing footage downloads a ${status.bytes_needed ? (status.bytes_needed / 1e9).toFixed(1) : "2.9"} GB model once and runs it on this computer` : status?.state === "error" ? status.error : status?.state === "downloading" ? "Downloading the describer" : status?.state === "stopped" ? "Describer installed; starts when needed" : "Preparing the describer"}</p>}
    {platform.shotlog && <div className="lib-toolbar">
      <button className="btn" disabled={!asset || busy} onClick={() => run()}>{log && !log.complete ? "Continue analysis" : "Analyze"}</button>
      <button className="btn" disabled={!asset || busy} onClick={() => run(true)}>Refresh</button>
    </div>}
    {busy && <div className="shotlog-progress" role="status"><span>{job.stage}</span><progress aria-label="Shot log progress" value={job.progress} max={1} /><button className="btn" onClick={() => cancelShotLog(asset!.id)}>Cancel</button></div>}
    {(error || job?.error) && <p role="alert">{error || job?.error}</p>}
    {log && <>
      <p className="lib-hint">{log.moments.filter(m => m.described).length} of {log.moments.length} moments described{log.complete ? "" : " (partial)"}</p>
      <label className="lib-search"><Search size={14} /><input className="field" aria-label="Search shot log" placeholder="Search actions or on-screen text" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="shotlog-moments" aria-label="Shot log moments">
        {moments.map(m => <button className={`shotlog-moment${m.described ? "" : " undescribed"}`} key={m.start} onClick={() => setPreview({ id: asset!.id, time: m.start })} aria-label={`Preview moment at ${shotTime(m.start)}`}>
          <span className="shotlog-time">{shotTime(m.start)}–{shotTime(m.end)}</span>
          {m.described ? <><span className="shotlog-chips"><span>{m.described.shot_size.replaceAll("_", " ")}</span><span>{m.described.camera.replaceAll("_", " ")}</span></span><strong>{m.described.action}</strong><span>{m.described.description}</span>{!!m.described.on_screen_text.length && <span>On screen: {m.described.on_screen_text.join(", ")}</span>}</> : <span>Not described yet. Motion {m.measured.motion.toFixed(2)}, brightness {m.measured.luma.toFixed(2)}, sound {Math.round(m.measured.loudness_db)} dB</span>}
        </button>)}
        {!moments.length && <p className="lib-hint">No matching moments</p>}
      </div>
    </>}
    {platform.shotlog && !log && !busy && <p className="lib-hint">Analyze this video to read what happens on screen beside its speech transcript.</p>}
    {preview && previewAsset && <SourceMonitor key={`${preview.id}:${preview.time}`} asset={previewAsset} initialTime={preview.time} onClose={() => setPreview(undefined)} />}
  </div>;
}
