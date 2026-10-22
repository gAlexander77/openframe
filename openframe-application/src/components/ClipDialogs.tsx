import { useRef, useState } from "react";
import { thumbs } from "../engine/thumbs";
import { dragCrop, type CropHandle } from "../lib/crop";
import { momentsFromMarkers, type ClipTemplate } from "../lib/clipProjects";
import type { Asset, Crop } from "../lib/project/types";
import { findClip } from "../lib/project/ops";
import type { SourceRegion } from "../lib/streamLayout";
import { createClips } from "../state/clips";
import { beginStreamCrop } from "../state/cropEdit";
import { exportProjects } from "../state/export";
import { store, useEditor } from "../state/store";
import { toast } from "../state/toast";
import { Dialog } from "./Dialog";
import "./clips.css";

/** Uses the crop overlay's source-coordinate drag math and handles. The
 * fields offer the same box without needing a pointer. */
function FacecamBox({ asset, value, onChange }: { asset: Asset; value: SourceRegion; onChange: (r: SourceRegion) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: CropHandle; x: number; y: number; crop: Crop } | null>(null);
  const down = (handle: CropHandle) => (e: React.PointerEvent) => {
    e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, crop: { left: value.x, top: value.y, right: 1 - value.x - value.w, bottom: 1 - value.y - value.h } };
  };
  return <fieldset className="clip-facecam"><legend>Facecam region in the source</legend>
    <div ref={ref} className="clip-source" style={{ aspectRatio: `${asset.width || 16} / ${asset.height || 9}` }} onPointerMove={e => {
      const d = drag.current, rect = ref.current?.getBoundingClientRect();
      if (!d || !rect) return;
      const c = dragCrop(d.crop, d.handle, (e.clientX - d.x) / rect.width, (e.clientY - d.y) / rect.height, { w: asset.width || 1920, h: asset.height || 1080 }, null);
      onChange({ x: c.left, y: c.top, w: 1 - c.left - c.right, h: 1 - c.top - c.bottom });
    }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {thumbs.poster(asset) && <img src={thumbs.poster(asset)!} alt="VOD source" />}
      <div className="crop-rect" style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%`, width: `${value.w * 100}%`, height: `${value.h * 100}%` }} onPointerDown={down("move")}>
        {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as CropHandle[]).map(h => <span key={h} className={`crop-handle crop-${h}`} onPointerDown={down(h)} />)}
      </div>
    </div>
    <div className="clip-region-fields">{(["x", "y", "w", "h"] as const).map(k => <label key={k}>{k.toUpperCase()}<input className="field" aria-label={`Facecam ${k}`} type="number" min={0} max={1} step={0.01} value={+value[k].toFixed(3)} onChange={e => onChange({ ...value, [k]: Number(e.target.value) })} /></label>)}</div>
  </fieldset>;
}

export function MakeClipsDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [layout, setLayout] = useState<NonNullable<ClipTemplate["layout"]>>("stream");
  const [facecam, setFacecam] = useState(false);
  const [region, setRegion] = useState<SourceRegion>({ x: 0, y: 0, w: 0.25, h: 0.35 });
  const [captions, setCaptions] = useState(true), [hook, setHook] = useState(true);
  const [name, setName] = useState(""), [handle, setHandle] = useState("");
  const [site, setSite] = useState<"twitch" | "youtube" | "kick">("twitch");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const p = store.document();
  const moments = momentsFromMarkers(p, asset.id);
  return <Dialog title="Make clips from markers" busy={busy} onClose={onClose}><form className="dialog-form" onSubmit={async e => {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const made = await createClips({ asset_id: asset.id, clips: moments, template: { layout, ...(facecam && layout === "stream" ? { facecam: region } : {}), captions: captions ? {} : false, hook, ...(name.trim() ? { credit: { name: name.trim(), handle: handle.trim(), platform: site } } : {}) } });
      toast(`Saved ${made.projects.length} clips. Open them from Home to review captions, hook and credit.`);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }}>
    <p className="lib-hint">{moments.length} range markers labeled Highlight N on this VOD. Each becomes its own saved project; the source stays open.</p>
    <label>Layout<select className="field" disabled={busy} value={layout} onChange={e => setLayout(e.target.value as typeof layout)}><option value="stream">Stream: facecam over gameplay</option><option value="vertical_fill">Vertical fill</option><option value="full">Full 16:9</option></select></label>
    {layout === "stream" && <><label className="dialog-check"><input type="checkbox" disabled={busy} checked={facecam} onChange={e => setFacecam(e.target.checked)} />Include facecam band</label>{facecam && <FacecamBox asset={asset} value={region} onChange={setRegion} />}</>}
    <label className="dialog-check"><input type="checkbox" disabled={busy} checked={captions} onChange={e => setCaptions(e.target.checked)} />Two-word pop captions</label>
    <label className="dialog-check"><input type="checkbox" disabled={busy} checked={hook} onChange={e => setHook(e.target.checked)} />Opening title hook</label>
    <label>Streamer credit name<input className="field" disabled={busy} value={name} onChange={e => setName(e.target.value)} /></label>
    <label>Handle<input className="field" disabled={busy} value={handle} onChange={e => setHandle(e.target.value)} /></label>
    <label>Platform<select className="field" disabled={busy} value={site} onChange={e => setSite(e.target.value as typeof site)}><option value="twitch">Twitch</option><option value="youtube">YouTube</option><option value="kick">Kick</option></select></label>
    <p className="lib-hint">Credit the streamer in every clip. Review speech recognition and add real editing before publishing.</p>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <footer><button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !moments.length}>{busy ? "Making clips…" : `Make ${moments.length} clips`}</button></footer>
  </form></Dialog>;
}

export function ExportProjectsDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [folder, setFolder] = useState(""), [loudness, setLoudness] = useState(-14);
  const [ratio, setRatio] = useState<"original" | "16:9" | "9:16" | "1:1" | "4:5">("original");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <Dialog title="Export selected projects" busy={busy} onClose={onClose}><form className="dialog-form" onSubmit={async e => {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try { await exportProjects({ project_ids: ids, ...(folder.trim() ? { folder: folder.trim() } : {}), loudness, ...(ratio !== "original" ? { ratios: [ratio] } : {}) }); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }}>
    <p className="lib-hint">Export {ids.length} projects in order. Each keeps its original shape; optionally add another version. Follow progress in the export toast.</p>
    <label>Folder (desktop; blank uses the default)<input className="field" disabled={busy} value={folder} onChange={e => setFolder(e.target.value)} /></label>
    <label>Loudness (LUFS)<input className="field" type="number" min={-40} max={-5} value={loudness} disabled={busy} onChange={e => setLoudness(Number(e.target.value))} /></label>
    <label>Additional shape<select className="field" disabled={busy} value={ratio} onChange={e => setRatio(e.target.value as typeof ratio)}>{["original", "16:9", "9:16", "1:1", "4:5"].map(r => <option key={r} value={r}>{r === "original" ? "Original only" : r}</option>)}</select></label>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <footer><button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? "Exporting…" : "Export selected"}</button></footer>
  </form></Dialog>;
}

export function StreamLayoutsTab() {
  const p = useEditor(s => s.project), ids = useEditor(s => s.selection);
  const c = ids.length === 1 ? findClip(p, ids[0]) : undefined;
  const valid = c?.clip.type === "video" && !c.clip.streamLayout && !c.clip.group && !c.track.locked && !c.track.hidden;
  return <div className="lib-section"><h3>Layouts</h3><button className="btn stream-layout-entry" disabled={!valid} onClick={() => beginStreamCrop(ids[0])}>Stream: facecam over gameplay</button><p className="lib-hint">Select a video, then place the facecam box on the viewer. Apply to make a vertical layout with gameplay below and sound on one band. A wide canvas changes to 1080 × 1920.</p></div>;
}
