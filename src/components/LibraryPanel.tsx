import { useMemo, useState, useSyncExternalStore } from "react";
import { thumbs } from "../engine/thumbs";
import {
  AudioLines,
  Blend,
  Captions,
  Film,
  Image,
  Music,
  Palette,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Type,
  Upload,
  WandSparkles,
} from "../icons";
import { EFFECTS, FILTERS, TRANSITIONS, type FilterDef } from "../lib/catalog";
import type { Asset } from "../lib/project/types";
import { formatDuration } from "../lib/time";
import { addAdjustmentLayer, addTextPreset, applyEffect, applyFilter, applyTransition, TEXT_PRESETS } from "../state/apply";
import { beginDrag, type DragPayload } from "../state/drag";
import { addToTimeline, pickAndImport } from "../state/media";
import { store, useEditor, type LeftTab } from "../state/store";
import "./library.css";

const TABS: { id: LeftTab; label: string; icon: typeof Film }[] = [
  { id: "media", label: "Media", icon: Film },
  { id: "audio", label: "Audio", icon: Music },
  { id: "text", label: "Text", icon: Type },
  { id: "effects", label: "Effects", icon: Sparkles },
  { id: "transitions", label: "Transitions", icon: Blend },
  { id: "captions", label: "Captions", icon: Captions },
  { id: "filters", label: "Filters", icon: Palette },
  { id: "adjustment", label: "Adjustment", icon: SlidersHorizontal },
  { id: "ai", label: "AI tools", icon: WandSparkles },
];

export function LibraryPanel() {
  const tab = useEditor((s) => s.leftTab);
  return (
    <section className="panel library-panel" aria-label="Library">
      <nav className="lib-tabs" role="tablist">
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
        {tab === "media" && <MediaTab kind="visual" />}
        {tab === "audio" && <MediaTab kind="audio" />}
        {tab === "text" && <TextTab />}
        {tab === "effects" && <EffectsTab />}
        {tab === "transitions" && <TransitionsTab />}
        {tab === "filters" && <FiltersTab />}
        {tab === "adjustment" && <AdjustmentTab />}
        {tab === "captions" && <Placeholder title="Captions" text="Automatic captions from speech run on your computer. Coming in the AI round." />}
        {tab === "ai" && <Placeholder title="AI tools" text="Silence removal, scene detection and beat markers run locally. Coming in the AI round." />}
      </div>
    </section>
  );
}

function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <div className="lib-content">
      <div className="empty">
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </div>
  );
}

// ---- media --------------------------------------------------------------------

function useThumbs() {
  return useSyncExternalStore(thumbs.subscribe, thumbs.version);
}

function MediaTab({ kind }: { kind: "visual" | "audio" }) {
  const assets = useEditor((s) => s.project.assets);
  const tracks = useEditor((s) => s.project.tracks);
  const [q, setQ] = useState("");
  useThumbs();
  const used = useMemo(() => new Set(tracks.flatMap((t) => t.clips.map((c) => ("assetId" in c ? c.assetId : "")))), [tracks]);
  const list = assets.filter((a) => (kind === "audio" ? a.kind === "audio" : a.kind !== "audio") && a.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="lib-content">
      <div className="lib-toolbar">
        <button className="btn import-btn" onClick={() => void pickAndImport()}>
          <Upload size={14} /> Import
        </button>
        <label className="lib-search">
          <Search size={14} />
          <input className="field" placeholder={kind === "audio" ? "Search audio" : "Search media"} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {assets.length === 0 ? (
        <button className="drop-box" onClick={() => void pickAndImport()}>
          <Upload size={22} />
          <strong>Import</strong>
          <span>Drag videos, audio or photos here, or click to browse</span>
        </button>
      ) : list.length === 0 ? (
        <div className="empty">{q ? `Nothing matches “${q}”` : kind === "audio" ? "No audio imported yet" : "No video or photos imported yet"}</div>
      ) : (
        <div className="card-grid">
          {list.map((a) => (
            <MediaCard key={a.id} asset={a} used={used.has(a.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function MediaCard({ asset, used }: { asset: Asset; used: boolean }) {
  const poster = thumbs.poster(asset);
  const Icon = asset.kind === "audio" ? AudioLines : asset.kind === "image" ? Image : Film;
  return (
    <div
      className="card media-card"
      title={asset.name}
      onPointerDown={(e) => beginDrag(e, { kind: "asset", asset })}
      onDoubleClick={() => addToTimeline(asset)}
    >
      <div className={`card-thumb${asset.kind === "audio" ? " audio" : ""}`}>
        {poster ? <img src={poster} alt="" draggable={false} /> : <Icon size={22} strokeWidth={1.4} />}
        {asset.kind !== "image" && <span className="chip num">{formatDuration(asset.duration)}</span>}
        {used && <span className="badge-added">Added</span>}
        <button
          className="card-add"
          aria-label={`Add ${asset.name} to the timeline`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => addToTimeline(asset)}
        >
          <Plus size={14} strokeWidth={2.4} />
        </button>
      </div>
      <span className="card-label">{asset.name}</span>
    </div>
  );
}

// ---- catalogs -----------------------------------------------------------------

function CatalogCard(props: { label: string; payload: DragPayload; onAdd: () => void; preview: React.ReactNode; className?: string }) {
  return (
    <div className={`card ${props.className ?? ""}`} onPointerDown={(e) => beginDrag(e, props.payload)} onDoubleClick={props.onAdd}>
      <div className="card-thumb">
        {props.preview}
        <button className="card-add" aria-label={`Add ${props.label}`} onPointerDown={(e) => e.stopPropagation()} onClick={props.onAdd}>
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
          <div key={c}>
            <h4 className="lib-group">{c}</h4>
            <div className="card-grid small">{items.map(([k, d]) => props.render(k, d))}</div>
          </div>
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
          preview={<div className={`fx-preview fx-${k}`}><Sparkles size={18} strokeWidth={1.4} /></div>}
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
          preview={
            <div className={`tr-preview tr-${d.category.toLowerCase()} tr-${k}`}>
              <div className="tr-a" />
              <div className="tr-b" />
            </div>
          }
        />
      )}
    />
  );
}

/** A CSS approximation of a look, for the card preview only. */
function cssLook(f: FilterDef): string {
  const a = f.adjust;
  const parts = [
    `saturate(${Math.max(0, 1 + (a.saturation ?? 0) / 100 + (a.vibrance ?? 0) / 200)})`,
    `contrast(${1 + (a.contrast ?? 0) / 100 - (a.fade ?? 0) / 300})`,
    `brightness(${1 + ((a.exposure ?? 0) + (a.brightness ?? 0)) / 150})`,
  ];
  if (a.temperature) parts.push(`sepia(${Math.max(0, a.temperature / 120)})`, `hue-rotate(${a.temperature < 0 ? 180 + a.temperature / 2 : 0}deg)`);
  if (a.tint) parts.push(`hue-rotate(${a.tint / 3}deg)`);
  return parts.join(" ");
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
          preview={<div className="filter-preview" style={{ filter: cssLook(d) }} />}
        />
      )}
    />
  );
}

function TextTab() {
  const defs = Object.fromEntries(Object.entries(TEXT_PRESETS).map(([k, v]) => [k, { ...v, category: "Text" }]));
  return (
    <CatalogTab
      defs={defs}
      hint="Click + to add at the playhead, or drag onto the timeline."
      render={(k, d) => (
        <CatalogCard
          key={k}
          label={d.label}
          payload={{ kind: "text", preset: k, label: d.label }}
          onAdd={() => addTextPreset(k)}
          preview={
            <div className="text-preview">
              <span
                style={{
                  color: d.style.color ?? "#fff",
                  fontWeight: d.style.bold === false ? 400 : 700,
                  fontStyle: d.style.italic ? "italic" : undefined,
                  fontFamily: d.style.font,
                  WebkitTextStroke: d.style.stroke ? `1px ${d.style.stroke.color}` : undefined,
                  textShadow: d.style.shadow ? `0 0 8px ${d.style.shadow.color}` : undefined,
                  background: d.style.background?.color,
                  padding: d.style.background ? "1px 6px" : undefined,
                  borderRadius: d.style.background ? Math.min(d.style.background.radius, 10) : undefined,
                }}
              >
                {d.text.length > 12 ? d.label : d.text}
              </span>
            </div>
          }
        />
      )}
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
