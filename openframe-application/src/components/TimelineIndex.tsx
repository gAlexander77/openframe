import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Captions, Film, Image, Layers, ListVideo, PaintBucket, Search, SlidersHorizontal, Type } from "../icons";
import { CLIP_LABELS } from "../lib/catalog";
import { filterTimelineRows, timelineRows, type IndexFilter, type IndexRow, type IndexSort } from "../lib/timelineIndex";
import { formatTimecode } from "../lib/time";
import { store, useEditor } from "../state/store";
import { openCompound, revealPlayhead } from "./Timeline";
import { EmptyState } from "./EmptyState";
import "./timelineIndex.css";

const ICONS = { video: Film, audio: AudioLines, text: Type, caption: Captions, image: Image, color: PaintBucket, adjustment: SlidersHorizontal, compound: Layers };
export function TimelineIndex() {
  const p = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<IndexFilter>("all");
  const [sort, setSort] = useState<IndexSort>("start");
  const list = useRef<HTMLDivElement>(null);
  const all = useMemo(() => timelineRows(p), [p]);
  const rows = useMemo(() => filterTimelineRows(all, query, kind, sort), [all, query, kind, sort]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const tabStop = rows.find((r) => selected.has(r.clip.id))?.clip.id ?? rows[0]?.clip.id;
  useEffect(() => {
    list.current?.querySelector("[aria-pressed=true]")?.scrollIntoView({ block: "nearest" });
  }, [selection, rows]);
  const choose = (r: IndexRow) => {
    store.select([r.clip.id]);
    store.set({ hoverFrame: null });
    store.seek(r.start);
    revealPlayhead(r.clip.id);
  };
  return <div className="lib-content timeline-index">
    <label className="lib-search"><Search size={14} /><input className="field" aria-label="Search timeline clips" placeholder="Search clips, media or text" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
    <div className="index-filters">
      <select className="field" aria-label="Filter timeline clips" value={kind} onChange={(e) => setKind(e.target.value as IndexFilter)}>
        {([["all", "All"], ["video", "Video"], ["audio", "Audio"], ["text", "Text"], ["caption", "Captions"], ["image", "Pictures"], ["other", "Other"]] as const).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
      <select className="field" aria-label="Sort timeline clips" value={sort} onChange={(e) => setSort(e.target.value as IndexSort)}>
        <option value="start">Start</option><option value="name">Name</option><option value="track">Track</option>
      </select>
      <span className="index-count">{rows.length} / {all.length}</span>
    </div>
    <div className="index-list" aria-label="Timeline clips" ref={list}>
      {!rows.length && <EmptyState icon={<ListVideo size={24} />} title={all.length ? "No clips match" : "No clips yet"} hint={all.length ? "Clear the search or filter." : "Clips added to this timeline appear here."} />}
      {rows.map((r, i) => {
        const Icon = ICONS[r.kind];
        return <button key={r.clip.id} className={`index-row${r.clip.disabled ? " disabled" : ""}`} data-index-clip={r.clip.id} tabIndex={tabStop === r.clip.id ? 0 : -1}
          aria-label={`${r.name}, ${r.track}, ${formatTimecode(r.start, p.fps)}, duration ${formatTimecode(r.end - r.start, p.fps)}`} aria-pressed={selected.has(r.clip.id)}
          onClick={() => choose(r)} onDoubleClick={() => r.clip.type === "compound" && openCompound(r.clip.id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault(); e.stopPropagation();
              const next = Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
              const row = rows[next];
              list.current?.querySelector<HTMLButtonElement>(`[data-index-clip="${row.clip.id}"]`)?.focus();
              choose(row);
            } else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); choose(r); }
          }}>
          <Icon size={16} /><span className="index-info"><span className="index-name" data-cut>{r.name}</span><small data-cut>{r.track}</small><small className="num">{formatTimecode(r.start, p.fps)} &middot; {formatTimecode(r.end - r.start, p.fps)}</small></span>
          {r.clip.labelColor && <i className="index-label" aria-label={`${r.clip.labelColor} label`} style={{ background: CLIP_LABELS[r.clip.labelColor].color }} />}
        </button>;
      })}
    </div>
  </div>;
}
