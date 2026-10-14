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
  Sticker,
  Type,
  Upload,
  WandSparkles,
} from "../icons";
import { EFFECTS, FILTERS, TRANSITIONS } from "../lib/catalog";
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
        {tab === "stickers" && <StickersTab />}
        {tab === "effects" && <EffectsTab />}
        {tab === "transitions" && <TransitionsTab />}
        {tab === "filters" && <FiltersTab />}
        {tab === "adjustment" && <AdjustmentTab />}
        {tab === "captions" && <CaptionsTab />}
        {tab === "ai" && <AiToolsTab />}
      </div>
    </section>
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
  // Stickers live in their own tab, as in CapCut, not among imported media.
  const list = assets.filter((a) => !a.sticker && (kind === "audio" ? a.kind === "audio" : a.kind !== "audio") && a.name.toLowerCase().includes(q.toLowerCase()));

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
