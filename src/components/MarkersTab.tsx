import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Plus, Search, Trash2 } from "../icons";
import { runCommand } from "../lib/commands";
import { adjacentMarker, filterMarkers } from "../lib/markers";
import type { Marker } from "../lib/project/types";
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

export function MarkersTab() {
  const markers = useEditor((s) => s.project.markers);
  const fps = useEditor((s) => s.project.fps);
  const frame = useEditor((s) => s.playhead);
  const selected = useEditor((s) => s.markerEdit);
  const [query, setQuery] = useState("");
  const [color, setColor] = useState("");
  const [exporting, setExporting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const colors = [...new Set(markers.map((m) => m.color))];
  const activeColor = colors.includes(color) ? color : "";
  const list = filterMarkers(markers, fps, query, activeColor);
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
  return (
    <div className="lib-content markers-tab">
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
      <button className="btn ghost marker-export-open" disabled={!list.length} onClick={() => setExporting(true)}><Download size={14} /> Export shown markers</button>
      <div className="marker-list" aria-label="Timeline markers" ref={listRef}>
        {!list.length && <p className="lib-hint">{markers.length ? "No markers match. Clear the search or color filter." : "Mark chapters, beats or editing notes. Add a marker at the playhead to get started."}</p>}
        {list.map((m) => <div className={`marker-row${selected === m.id ? " on" : ""}`} key={m.id}>
          <button className="marker-jump" aria-label={`Go to ${m.label || "Untitled marker"} at ${formatTimecode(m.frame, fps)}`} aria-pressed={selected === m.id} onClick={() => openMarkers(m.id)}>
            <i className="marker-dot" style={{ background: m.color }} />
            <span className="marker-note">{m.label || "Untitled marker"}<small className="num">{formatTimecode(m.frame, fps)}</small></span>
          </button>
          <button className="icon-btn small" aria-label={`Delete ${m.label || "untitled marker"}`} data-tip="Delete marker" onClick={() => store.edit("Delete marker", (p) => runCommand(p, "delete_markers", { marker_ids: [m.id] }))}><Trash2 size={13} /></button>
        </div>)}
      </div>
      {current && <MarkerEditor key={`${current.id}:${current.frame}:${current.label}:${current.color}`} marker={current} fps={fps} />}
      {exporting && <MarkerExport markers={list} onClose={() => setExporting(false)} />}
    </div>
  );
}

function MarkerEditor({ marker, fps }: { marker: Marker; fps: Rational }) {
  const [label, setLabel] = useState(marker.label);
  const [time, setTime] = useState(formatTimecode(marker.frame, fps));
  const [color, setColor] = useState(marker.color);
  const frame = parseTimecode(time, fps);
  const valid = frame !== null && Number.isSafeInteger(frame) && frame >= 0;
  const changed = label !== marker.label || frame !== marker.frame || color !== marker.color;
  return (
    <form className="marker-editor" aria-label="Edit marker" onSubmit={(e) => {
      e.preventDefault();
      if (!valid || !changed) return;
      // Notes do not move clips: skip the clip-edit magnet/linkage pass.
      store.edit("Edit marker", (p) => runCommand(p, "update_marker", { marker_id: marker.id, label, color, at: framesToSeconds(frame, fps) }));
      openMarkers(marker.id);
    }} onKeyDown={(e) => {
      if (e.key === "Escape") { e.stopPropagation(); store.set({ markerEdit: null }); }
    }}>
      <label>Note<input className="field" aria-label="Marker note" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
      <label>Position<input className="field num" aria-label="Marker position" aria-invalid={!valid} aria-describedby="marker-time-hint" value={time} onChange={(e) => setTime(e.target.value)} /></label>
      <p className="lib-hint" id="marker-time-hint">{valid ? "Timecode or seconds with s, for example 12.5s." : "Enter a valid nonnegative timecode or seconds with s."}</p>
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
