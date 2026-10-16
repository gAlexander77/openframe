import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { thumbs } from "../engine/thumbs";
import {
  AudioLines,
  Blend,
  Bookmark,
  Captions,
  Film,
  Image,
  LayoutGrid,
  List,
  Music,
  Palette,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sticker,
  Type,
  Upload,
  WandSparkles,
} from "../icons";
import { EFFECTS, FILTERS, TRANSITIONS } from "../lib/catalog";
import { formatBytes } from "../lib/export";
import { filterMedia, mediaUsage, type MediaBrowser, type MediaUse } from "../lib/mediaLibrary";
import type { Asset } from "../lib/project/types";
import { formatDuration } from "../lib/time";
import { TEXT_TEMPLATES, templateClips } from "../lib/templates";
import { addAdjustmentLayer, addTextPreset, applyEffect, applyFilter, applyTemplate, applyTransition, presetClip, TEXT_PRESETS } from "../state/apply";
import { beginDrag, type DragPayload } from "../state/drag";
import { addToTimeline, pickAndImport } from "../state/media";
import { store, useEditor, type LeftTab } from "../state/store";
import { CaptionsTab } from "./CaptionsTab";
import { EnginePreview } from "./EnginePreview";
import { StickersTab } from "./StickersTab";
import "./library.css";
import { AiToolsTab } from "./AiToolsTab";
import { MarkersTab } from "./MarkersTab";
import { MediaManager } from "./MediaManager";
import { SourceMonitor } from "./SourceMonitor";

const TABS: { id: LeftTab; label: string; icon: typeof Film }[] = [
  { id: "media", label: "Media", icon: Film },
  { id: "audio", label: "Audio", icon: Music },
  { id: "text", label: "Text", icon: Type },
  { id: "stickers", label: "Stickers", icon: Sticker },
  { id: "effects", label: "Effects", icon: Sparkles },
  { id: "transitions", label: "Transitions", icon: Blend },
  { id: "captions", label: "Captions", icon: Captions },
  { id: "filters", label: "Filters", icon: Palette },
  { id: "adjustment", label: "Adjustment", icon: SlidersHorizontal },
  { id: "ai", label: "AI tools", icon: WandSparkles },
  { id: "markers", label: "Markers", icon: Bookmark },
];

/** The tab strip scrolls sideways when the panel is narrower than its
 * tabs: edges fade where tabs are hidden, the mouse wheel scrolls it, and
 * the open tab is kept in view (it can be opened from elsewhere). */
function useTabStrip(tab: string) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const edges = () => {
      el.classList.toggle("more-left", el.scrollLeft > 1);
      el.classList.toggle("more-right", el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    const wheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    const ro = new ResizeObserver(() => {
      // Scroll only this strip. scrollIntoView can also move clipped panels.
      const active = el.querySelector(".lib-tab.on");
      if (active) {
        const r = active.getBoundingClientRect(), strip = el.getBoundingClientRect();
        if (r.left < strip.left) el.scrollLeft += r.left - strip.left;
        else if (r.right > strip.right) el.scrollLeft += r.right - strip.right;
      }
      edges();
    });
    ro.observe(el);
    el.addEventListener("scroll", edges, { passive: true });
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", edges);
      el.removeEventListener("wheel", wheel);
    };
  }, []);
  useEffect(() => {
    const el = ref.current, active = el?.querySelector(".lib-tab.on");
    if (!el || !active) return;
    const r = active.getBoundingClientRect(), strip = el.getBoundingClientRect();
    const delta = r.left < strip.left ? r.left - strip.left : r.right > strip.right ? r.right - strip.right : 0;
    el.scrollBy({ left: delta, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [tab]);
  return ref;
}

export function LibraryPanel() {
  const tab = useEditor((s) => s.leftTab);
  const strip = useTabStrip(tab);
  return (
    <section className="panel library-panel" aria-label="Library">
      <nav className="lib-tabs" role="tablist" ref={strip}>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`lib-tab${tab === t.id ? " on" : ""}`}
            onClick={() => store.set({ leftTab: t.id })}
          >
            <t.icon size={18} strokeWidth={1.6} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="lib-body" key={tab}>
        {tab === "media" && <MediaTab kind="all" />}
        {tab === "audio" && <MediaTab kind="audio" />}
        {tab === "text" && <TextTab />}
        {tab === "stickers" && <StickersTab />}
        {tab === "effects" && <EffectsTab />}
        {tab === "transitions" && <TransitionsTab />}
        {tab === "filters" && <FiltersTab />}
        {tab === "adjustment" && <AdjustmentTab />}
        {tab === "captions" && <CaptionsTab />}
        {tab === "ai" && <AiToolsTab />}
        {tab === "markers" && <MarkersTab />}
      </div>
    </section>
  );
}

// ---- media --------------------------------------------------------------------

function useThumbs() {
  return useSyncExternalStore(thumbs.subscribe, thumbs.version);
}

/** Media lists every import, as CapCut's Media › Import does (an imported
 * MP3 used to vanish into Audio); Audio shows just the sound files. */
function MediaTab({ kind }: { kind: "all" | "audio" }) {
  const [managing, setManaging] = useState(false);
  const [source, setSource] = useState<Asset | null>(null);
  const assets = useEditor((s) => s.project.assets);
  const tracks = useEditor((s) => s.project.tracks);
  const options = useEditor((s) => s.mediaBrowser);
  const folders = useEditor((s) => s.project.mediaFolders);
  useEffect(() => {
    if (options.folder && !folders?.includes(options.folder)) store.set({ mediaBrowser: { ...store.get().mediaBrowser, folder: null } });
  }, [folders, options.folder]);
  const change = (patch: Partial<MediaBrowser>) => store.set({ mediaBrowser: { ...store.get().mediaBrowser, ...patch } });
  const clearFilters = () => change({ query: "", kind: "all", usage: "all", folder: null, favorites: false });
  useThumbs();
  const usage = useMemo(() => mediaUsage(tracks), [tracks]);
  const list = filterMedia(assets, usage, kind === "audio" ? { ...options, kind: "audio" } : options);
  const total = assets.filter((a) => !a.sticker && (kind === "all" || a.kind === "audio")).length;
  const filtered = !!options.query || options.usage !== "all" || options.folder !== null || options.favorites || (kind === "all" && options.kind !== "all");

  return (
    <div className="lib-content media-browser">
      <div className="lib-toolbar">
        <button className="btn import-btn" onClick={() => void pickAndImport()}>
          <Upload size={14} /> Import
        </button>
        <label className="lib-search">
          <Search size={14} />
          <input className="field" aria-label={kind === "audio" ? "Search audio" : "Search media"} placeholder={kind === "audio" ? "Search audio" : "Search media"} value={options.query} onChange={(e) => change({ query: e.target.value })} />
        </label>
      </div>
      <div className="media-filters">
        {kind === "all" && <select className="field" aria-label="Media type" value={options.kind} onChange={(e) => change({ kind: e.target.value as MediaBrowser["kind"] })}>
          <option value="all">All types</option><option value="video">Video</option><option value="audio">Audio</option><option value="image">Images</option>
        </select>}
        <select className="field" aria-label="Timeline usage" value={options.usage} onChange={(e) => change({ usage: e.target.value as MediaBrowser["usage"] })}>
          <option value="all">All usage</option><option value="used">Used</option><option value="unused">Unused</option>
        </select>
        <select className="field" aria-label="Sort media" value={options.sort} onChange={(e) => change({ sort: e.target.value as MediaBrowser["sort"] })}>
          <option value="import">Import order</option><option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option>
          <option value="duration">Shortest first</option><option value="duration-desc">Longest first</option>
        </select>
      </div>
      <div className="media-results">
        <button className="media-clear" onClick={() => setManaging(true)}>Manage media</button>
        <span role="status">{list.length} of {total} {kind === "audio" ? "audio files" : "media files"}</span>
        {filtered && <button className="media-clear" onClick={clearFilters}>Clear filters</button>}
        <div className="media-views" role="group" aria-label="Media view">
          <button className="icon-btn" aria-label="Grid view" data-tip="Grid view" aria-pressed={options.view === "grid"} onClick={() => change({ view: "grid" })}><LayoutGrid size={14} /></button>
          <button className="icon-btn" aria-label="List view" data-tip="List view" aria-pressed={options.view === "list"} onClick={() => change({ view: "list" })}><List size={14} /></button>
        </div>
      </div>
      <div className="media-organization media-folder-filter">
        <select className="field" aria-label="Filter by folder" value={JSON.stringify(options.folder)} onChange={(e) => change({ folder: JSON.parse(e.target.value) })}><option value="null">All folders</option><option value={'""'}>Unfiled</option>{folders?.map((f) => <option key={f} value={JSON.stringify(f)}>{f}</option>)}</select>
        <label><input type="checkbox" checked={options.favorites} onChange={(e) => change({ favorites: e.target.checked })} />Favorites only</label>
      </div>
      {total === 0 ? (
        <button className="drop-box" onClick={() => void pickAndImport()}>
          <Upload size={22} />
          <strong>Import</strong>
          <span>{kind === "audio" ? "No audio imported yet. Click to browse." : "Drag videos, audio or photos here, or click to browse"}</span>
        </button>
      ) : list.length === 0 ? (
        <div className="empty">No media matches these filters.</div>
      ) : (
        <div className={options.view === "list" ? "media-list" : "card-grid"}>
          {list.map((a) => (
            <MediaCard key={a.id} asset={a} uses={usage.get(a.id) ?? []} list={options.view === "list"} onPreview={() => setSource(a)} />
          ))}
        </div>
      )}
      {managing && <MediaManager onClose={() => setManaging(false)} />}
      {source && <SourceMonitor asset={source} onClose={() => setSource(null)} />}
    </div>
  );
}

function MediaCard({ asset, uses, list, onPreview }: { asset: Asset; uses: MediaUse[]; list: boolean; onPreview: () => void }) {
  const poster = thumbs.poster(asset);
  const Icon = asset.kind === "audio" ? AudioLines : asset.kind === "image" ? Image : Film;
  const metadata = [asset.kind === "image" ? "Still image" : `${asset.kind === "audio" ? "Audio" : "Video"} · ${formatDuration(asset.duration)}`,
    asset.width && asset.height ? `${asset.width}×${asset.height}` : null,
    asset.fps ? `${Number(asset.fps.toFixed(3))} fps` : null,
    asset.size ? formatBytes(asset.size) : null].filter(Boolean).join(" · ");
  const add = <button
    className={list ? "icon-btn media-add" : "card-add"}
    aria-label={`Add ${asset.name} to the timeline`} data-tip="Add to timeline"
    onPointerDown={(e) => e.stopPropagation()}
    onDoubleClick={(e) => e.stopPropagation()}
    onClick={(e) => { e.stopPropagation(); addToTimeline(asset); }}
  ><Plus size={14} strokeWidth={2.4} /></button>;
  return (
    <div
      className="card media-card"
      title={`${asset.name}\n${metadata}`}
      onPointerDown={(e) => beginDrag(e, { kind: "asset", asset })}
      onDoubleClick={() => addToTimeline(asset)}
    >
      <div className={`card-thumb${asset.kind === "audio" ? " audio" : ""}`}>
        {poster ? <img src={poster} alt="" draggable={false} /> : <Icon size={22} strokeWidth={1.4} />}
        {!list && asset.kind !== "image" && <span className="chip num">{formatDuration(asset.duration)}</span>}
        {!list && uses.length > 0 && <span className="badge-added">Added</span>}
        {!list && add}
      </div>
      <div className="media-info">
        <span className="card-label">{asset.name}</span>
        <button className="media-preview-button" aria-label={`Preview ${asset.name}`} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onPreview(); }}>Preview</button>
        {(asset.folder || asset.favorite) && <span className="media-details">{[asset.favorite ? "Favorite" : "", asset.folder].filter(Boolean).join(" · ")}</span>}
        {list && <>
          <span className="media-details">{metadata}</span>
          {uses.length ? <button className="media-uses" aria-label={`Select ${uses.length} timeline uses of ${asset.name}`}
            onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); store.select(uses.map((u) => u.clipId)); store.set({ hoverFrame: null }); store.seek(uses[0].start); }}>
            {uses.length} timeline {uses.length === 1 ? "use" : "uses"}
          </button> : <span className="media-details">Unused</span>}
        </>}
      </div>
      {list && add}
    </div>
  );
}

// ---- catalogs -----------------------------------------------------------------

function CatalogCard(props: { label: string; payload: DragPayload; onAdd: () => void; preview: React.ReactNode; className?: string }) {
  return (
    <div className={`card ${props.className ?? ""}`} onPointerDown={(e) => beginDrag(e, props.payload)} onDoubleClick={props.onAdd}>
      <div className="card-thumb">
        {props.preview}
        <button className="card-add" aria-label={`Add ${props.label}`} data-tip={`Add ${props.label}`} onPointerDown={(e) => e.stopPropagation()} onClick={props.onAdd}>
          <Plus size={14} strokeWidth={2.4} />
        </button>
      </div>
      <span className="card-label">{props.label}</span>
    </div>
  );
}

function grouped<T extends { category: string }>(defs: Record<string, T>) {
  const groups = new Map<string, [string, T][]>();
  for (const [k, d] of Object.entries(defs)) {
    if (!groups.has(d.category)) groups.set(d.category, []);
    groups.get(d.category)!.push([k, d]);
  }
  return [...groups.entries()];
}

function CatalogTab<T extends { category: string; label: string }>(props: {
  defs: Record<string, T>;
  hint: string;
  render: (key: string, def: T) => React.ReactNode;
  /** Grid class per category (default: small square cards). */
  grid?: (category: string) => string;
}) {
  const [cat, setCat] = useState<string | null>(null);
  const groups = grouped(props.defs);
  const shown = cat ? groups.filter(([c]) => c === cat) : groups;
  return (
    <div className="lib-split">
      <div className="lib-subnav">
        <button className={!cat ? "on" : ""} onClick={() => setCat(null)}>All</button>
        {groups.map(([c]) => (
          <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="lib-content">
        <p className="lib-hint">{props.hint}</p>
        {shown.map(([c, items]) => (
          <section key={c} className="lib-section">
            <h4 className="lib-group">{c}</h4>
            <div className={props.grid?.(c) ?? "card-grid small"}>{items.map(([k, d]) => props.render(k, d))}</div>
          </section>
        ))}
      </div>
    </div>
  );
}

function EffectsTab() {
  return (
    <CatalogTab
      defs={EFFECTS}
      hint="Drop on a clip to apply it there, or on empty timeline to affect everything below."
      render={(k, d) => (
        <CatalogCard
          key={k}
          label={d.label}
          payload={{ kind: "effect", type: k, label: d.label }}
          onAdd={() => applyEffect(k)}
          preview={<EnginePreview spec={{ kind: "effect", type: k }} />}
        />
      )}
    />
  );
}

function TransitionsTab() {
  return (
    <CatalogTab
      defs={TRANSITIONS}
      hint="Drop on the cut between two clips, or select a clip and click +."
      render={(k, d) => (
        <CatalogCard
          key={k}
          label={d.label}
          payload={{ kind: "transition", type: k, label: d.label }}
          onAdd={() => applyTransition(k)}
          preview={<EnginePreview spec={{ kind: "transition", type: k }} />}
        />
      )}
    />
  );
}

function FiltersTab() {
  return (
    <CatalogTab
      defs={FILTERS}
      hint="Drop on a clip to apply it, or on empty timeline for a filter layer."
      render={(k, d) => (
        <CatalogCard
          key={k}
          label={d.label}
          payload={{ kind: "filter", type: k, label: d.label }}
          onAdd={() => applyFilter(k)}
          preview={<EnginePreview spec={{ kind: "filter", type: k }} />}
        />
      )}
    />
  );
}

const PREVIEW_FPS = { num: 30, den: 1 };

/** Basic presets add a text clip; word art and templates come from
 * src/lib/templates.ts. Each card's preview renders the exact clips it adds. */
function TextTab() {
  const defs: Record<string, { category: string; label: string }> = {
    ...Object.fromEntries(Object.entries(TEXT_PRESETS).map(([k, v]) => [`preset:${k}`, { category: "Basic", label: v.label }])),
    ...Object.fromEntries(Object.entries(TEXT_TEMPLATES).map(([k, v]) => [`template:${k}`, { category: v.category, label: v.label }])),
  };
  return (
    <CatalogTab
      defs={defs}
      hint="Click + to add at the playhead, or drag onto the timeline. Word art restyles the selected text."
      grid={(c) => (c === "Templates" ? "card-grid wide" : "card-grid small")}
      render={(id, d) => {
        const [kind, k] = id.split(":");
        if (kind === "preset") {
          return (
            <CatalogCard
              key={id}
              label={d.label}
              payload={{ kind: "text", preset: k, label: d.label }}
              onAdd={() => addTextPreset(k)}
              preview={<EnginePreview spec={{ kind: "text", id, clips: [presetClip(TEXT_PRESETS[k], 0, PREVIEW_FPS)], scene: false }} />}
            />
          );
        }
        const t = TEXT_TEMPLATES[k];
        const titles = t.category === "Templates";
        return (
          <CatalogCard
            key={id}
            label={d.label}
            payload={{ kind: "template", id: k, label: d.label }}
            onAdd={() => applyTemplate(k)}
            preview={<EnginePreview spec={{ kind: "text", id, clips: templateClips(t, 0, PREVIEW_FPS), scene: titles }} shape={titles ? "wide" : "square"} />}
          />
        );
      }}
    />
  );
}

function AdjustmentTab() {
  return (
    <div className="lib-content">
      <p className="lib-hint">An adjustment layer grades everything below it on the timeline for its length.</p>
      <div className="card-grid small">
        <CatalogCard
          label="Custom adjustment"
          payload={{ kind: "adjustment", label: "Adjustment" }}
          onAdd={() => addAdjustmentLayer()}
          preview={<div className="fx-preview"><SlidersHorizontal size={18} strokeWidth={1.4} /></div>}
        />
      </div>
    </div>
  );
}
