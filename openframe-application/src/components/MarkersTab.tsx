import { EmptyState } from "./EmptyState";
import { useEffect, useRef, useState } from "react";
import { Bookmark, ChevronLeft, ChevronRight, Download, Link2, Plus, Search, Trash2, Unlink2 } from "../icons";
import { runCommand } from "../lib/commands";
import { adjacentMarker, filterMarkers } from "../lib/markers";
import { allTracks, getAsset } from "../lib/project/ops";
import type { Id, Marker, Project } from "../lib/project/types";
import { formatTimecode, framesToSeconds, parseTimecode, type Rational } from "../lib/time";
import { run, tipFor } from "../state/actions";
import { openMarkers } from "../state/markers";
import { store, useEditor } from "../state/store";
import "./markers.css";
import { MarkerExport } from "./MarkerExport";

const COLORS = [
  ["#3be0f0", "Cyan"], ["#6a9bff", "Blue"], ["#67d88b", "Green"],
  ["#ffc45c", "Amber"], ["#ff6b75", "Red"], ["#bf8cff", "Purple"],
] as const;
const colorName = (color: string) => COLORS.find(([v]) => v === color)?.[1] ?? color;

/** The name of the clip a marker follows (ADR-119): its own name, else its
 * file's; inside a compound clip too, where a song's markers follow it. */
function clipName(p: Project, id: Id): string | undefined {
  const c = allTracks(p).flatMap((t) => t.clips).find((x) => x.id === id);
  if (!c) return undefined;
  return c.name ?? ("assetId" in c ? getAsset(p, c.assetId)?.name : undefined) ?? "a clip";
}

export function MarkersTab() {
  const markers = useEditor((s) => s.project.markers);
  const project = useEditor((s) => s.project);
  const nameOf = (id: Id) => clipName(project, id);
  const fps = useEditor((s) => s.project.fps);
  const frame = useEditor((s) => s.playhead);
  const selected = useEditor((s) => s.markerEdit);
  const [query, setQuery] = useState("");
  const [color, setColor] = useState("");
  const [exporting, setExporting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const colors = [...new Set(markers.map((m) => m.color))];
  const activeColor = colors.includes(color) ? color : "";
  const list = filterMarkers(markers, fps, query, activeColor, nameOf);
  const current = markers.find((m) => m.id === selected);
  const prev = adjacentMarker(markers, frame, -1);
  const next = adjacentMarker(markers, frame, 1);
  useEffect(() => {
    const el = listRef.current, row = el?.querySelector(".marker-row.on");
    if (!el || !row) return;
    const r = row.getBoundingClientRect(), list = el.getBoundingClientRect();
    if (r.top < list.top) el.scrollTop += r.top - list.top;
    else if (r.bottom > list.bottom) el.scrollTop += r.bottom - list.bottom;
  }, [selected, markers, query, activeColor]);
  // The editor opens under the list; bring its Save button into view. At
  // the default 1600 x 940 window it sat just below the panel's edge.
  const tabRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) tabRef.current?.querySelector(".marker-editor")?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <div className="lib-content markers-tab" ref={tabRef}>
      <div className="marker-toolbar">
        <button className="btn" onClick={() => {
          run("addMarker");
          const added = store.get().project.markers.filter((m) => !markers.some((old) => old.id === m.id)).at(-1);
          setQuery(""); setColor("");
          if (added) openMarkers(added.id);
        }} data-tip={tipFor("addMarker")}><Plus size={14} /> Add marker</button>
        <span className="marker-count">{list.length} / {markers.length}</span>
        <button className="icon-btn small" aria-label="Previous marker" data-tip={tipFor("prevMarker")} disabled={!prev} onClick={() => prev && openMarkers(prev.id)}><ChevronLeft size={14} /></button>
        <button className="icon-btn small" aria-label="Next marker" data-tip={tipFor("nextMarker")} disabled={!next} onClick={() => next && openMarkers(next.id)}><ChevronRight size={14} /></button>
      </div>
      <div className="marker-search">
        <label className="lib-search"><Search size={14} /><input className="field" aria-label="Search markers" placeholder="Search notes or timecode" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <select className="field" aria-label="Filter markers by color" value={activeColor} onChange={(e) => setColor(e.target.value)}>
          <option value="">All colors</option>
          {colors.map((c) => <option key={c} value={c}>{colorName(c)}</option>)}
        </select>
      </div>
      <div className="marker-bulk">
        <button className="btn ghost marker-export-open" aria-label="Export shown markers" disabled={!list.length} onClick={() => setExporting(true)}><Download size={14} /> Export shown</button>
        <button className="btn ghost" aria-label="Delete shown markers" disabled={!list.length} onClick={() => store.edit(`Delete ${list.length === 1 ? "marker" : `${list.length} markers`}`, (p) => runCommand(p, "delete_markers", { marker_ids: list.map((m) => m.id) }))}><Trash2 size={14} /> Delete shown</button>
      </div>
      <div className="marker-list" aria-label="Timeline markers" ref={listRef}>
        {!list.length && <EmptyState icon={<Bookmark size={24} />} title={markers.length ? "No markers match" : "No markers yet"} hint={markers.length ? "Clear the search or color filter." : "Add a marker at the playhead for chapters, beats or editing notes."} />}
        {list.map((m) => {
          // A marker on a clip moves with it; the timeline's own stay put.
          const on = m.follows ? nameOf(m.follows.clip) : undefined;
          return <div className={`marker-row${selected === m.id ? " on" : ""}`} key={m.id}>
          <button className="marker-jump" aria-label={`Go to ${m.label || "Untitled marker"} at ${formatTimecode(m.frame, fps)}${on ? `, on ${on}` : ""}`} aria-pressed={selected === m.id} onClick={() => openMarkers(m.id)}>
            <i className="marker-dot" style={{ background: m.color }} />
            <span className="marker-note"><span data-cut>{m.label || "Untitled marker"}</span><small className="num">{formatTimecode(m.frame, fps)}{m.duration ? `, ${formatTimecode(m.duration, fps)} long` : ""}{m.chapter ? ", Chapter" : ""}{on && <span className="marker-follows"><Link2 size={11} /> {on}</span>}</small></span>
          </button>
          {m.follows && <button className="icon-btn small" aria-label={`Detach ${m.label || "untitled marker"} from ${on ?? "its clip"}`} data-tip="Detach from its clip: it stays here" onClick={() => store.edit("Detach marker", (p) => runCommand(p, "update_marker", { marker_id: m.id, detach: true }))}><Unlink2 size={13} /></button>}
          <button className="icon-btn small" aria-label={`Delete ${m.label || "untitled marker"}`} data-tip="Delete marker" onClick={() => store.edit("Delete marker", (p) => runCommand(p, "delete_markers", { marker_ids: [m.id] }))}><Trash2 size={13} /></button>
        </div>;
        })}
      </div>
      {current && <MarkerEditor key={`${current.id}:${current.frame}:${current.label}:${current.color}:${current.duration}:${current.chapter}`} marker={current} fps={fps} on={current.follows ? nameOf(current.follows.clip) : undefined} />}
      {exporting && <MarkerExport markers={list} onClose={() => setExporting(false)} />}
    </div>
  );
}

function MarkerEditor({ marker, fps, on }: { marker: Marker; fps: Rational; on?: string }) {
  const [label, setLabel] = useState(marker.label);
  const [time, setTime] = useState(formatTimecode(marker.frame, fps));
  const [color, setColor] = useState(marker.color);
  const [duration, setDuration] = useState(formatTimecode(marker.duration ?? 0, fps));
  const [chapter, setChapter] = useState(marker.chapter === true);
  const length = parseTimecode(duration, fps);
  const frame = parseTimecode(time, fps);
  const valid = frame !== null && Number.isSafeInteger(frame) && frame >= 0 && length !== null && Number.isSafeInteger(length) && length >= 0;
  const changed = label !== marker.label || frame !== marker.frame || color !== marker.color || length !== (marker.duration ?? 0) || chapter !== (marker.chapter === true);
  return (
    <form className="marker-editor" aria-label="Edit marker" onSubmit={(e) => {
      e.preventDefault();
      if (!valid || !changed) return;
      // Notes do not move clips: skip the clip-edit magnet/linkage pass.
      store.edit("Edit marker", (p) => runCommand(p, "update_marker", { marker_id: marker.id, label, color, at: framesToSeconds(frame, fps), duration: framesToSeconds(length!, fps), chapter }));
      openMarkers(marker.id);
    }} onKeyDown={(e) => {
      if (e.key === "Escape") { e.stopPropagation(); store.set({ markerEdit: null }); }
    }}>
      <label>Note<input className="field" aria-label="Marker note" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
      <label>Position<input className="field num" aria-label="Marker position" aria-invalid={!valid} aria-describedby="marker-time-hint" value={time} onChange={(e) => setTime(e.target.value)} /></label>
      <p className="lib-hint" id="marker-time-hint">{valid ? "Timecode or seconds with s, for example 12.5s." : "Enter a valid nonnegative timecode or seconds with s."}{valid && on ? ` It moves with ${on}; a new position detaches it.` : ""}</p>
      <label>Duration<input className="field num" aria-label="Marker duration" aria-invalid={length === null || length < 0} value={duration} onChange={(e) => setDuration(e.target.value)} /></label>
      <label>Chapter<input type="checkbox" role="switch" aria-label="Chapter" checked={chapter} onChange={(e) => setChapter(e.target.checked)} /></label>
      <div className="marker-palette" role="group" aria-label="Marker color">
        {COLORS.map(([value, name]) => <button type="button" key={value} aria-label={name} aria-pressed={color === value} data-tip={name} onClick={() => setColor(value)} style={{ background: value }} />)}
      </div>
      <div className="marker-actions">
        <button className="btn primary" disabled={!valid || !changed}>Save marker</button>
        <button className="btn ghost" type="button" onClick={() => store.set({ markerEdit: null })}>Cancel</button>
      </div>
    </form>
  );
}
