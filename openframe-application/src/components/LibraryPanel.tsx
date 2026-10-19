import { EmptyState } from "./EmptyState";
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
  PaintBucket,
  Palette,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sticker,
  Type,
  Upload,
  Video,
  WandSparkles,
  X,
} from "../icons";
import { EFFECTS, FILTERS, TRANSITIONS } from "../lib/catalog";
import { formatBytes } from "../lib/export";
import { filterMedia, mediaUsage, type MediaBrowser, type MediaUse } from "../lib/mediaLibrary";
import { organizeMedia, removeMedia } from "../lib/project/mediaOrganization";
import type { Asset } from "../lib/project/types";
import { formatDuration } from "../lib/time";
import { TEXT_TEMPLATES, templateClips } from "../lib/templates";
import { addAdjustmentLayer, addColorLayer, addTextPreset, applyEffect, applyFilter, applyTemplate, applyTransition, presetClip, TEXT_PRESETS } from "../state/apply";
import { beginDrag, type DragPayload } from "../state/drag";
import { edit } from "../state/actions";
import { addToTimeline, pickAndImport } from "../state/media";
import { toast } from "../state/toast";
import { cancelCapture, canRecordScreen, startCapture, stopCapture, useCapture } from "../state/capture";
import { addSoundEffect, auditionSoundEffect } from "../state/sfx";
import { SFX } from "../lib/sfx";
import { store, useEditor, type LeftTab } from "../state/store";
import { CaptionsTab } from "./CaptionsTab";
import { EnginePreview } from "./EnginePreview";
import { StickersTab } from "./StickersTab";
import "./library.css";
import { AiToolsTab } from "./AiToolsTab";
import { MarkersTab } from "./MarkersTab";
import { MediaManager } from "./MediaManager";
import { MenuList, useDismiss, type MenuItem } from "./Menu";
import { SourceMonitor } from "./SourceMonitor";
import { RenameField } from "./RenameField";
import { renameMedia } from "../state/rename";

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
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(!!menu, menuRef, () => setMenu(null));
  /** The card whose name is a text field (Rename). */
  const [renaming, setRenaming] = useState<string | null>(null);
  const assets = useEditor((s) => s.project.assets);
  const tracks = useEditor((s) => s.project.tracks);
  const compounds = useEditor((s) => s.project.compounds);
  const options = useEditor((s) => s.mediaBrowser);
  const folders = useEditor((s) => s.project.mediaFolders);
  useEffect(() => {
    if (options.folder && !folders?.includes(options.folder)) store.set({ mediaBrowser: { ...store.get().mediaBrowser, folder: null } });
  }, [folders, options.folder]);
  const change = (patch: Partial<MediaBrowser>) => store.set({ mediaBrowser: { ...store.get().mediaBrowser, ...patch } });
  const clearFilters = () => change({ query: "", kind: "all", usage: "all", folder: null, favorites: false });
  useThumbs();
  const usage = useMemo(() => mediaUsage(tracks, compounds), [tracks, compounds]);
  const list = filterMedia(assets, usage, kind === "audio" ? { ...options, kind: "audio" } : options);
  const total = assets.filter((a) => !a.sticker && (kind === "all" || a.kind === "audio")).length;
  const filtered = !!options.query || options.usage !== "all" || options.folder !== null || options.favorites || (kind === "all" && options.kind !== "all");

  return (
    <div className="lib-content media-browser">
      <div className="lib-toolbar">
        <button className="btn import-btn" onClick={() => void pickAndImport()}>
          <Upload size={14} /> Import
        </button>
        {kind === "all" && <RecordButton />}
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
        <button className={`drop-box${kind === "audio" ? " compact" : ""}`} onClick={() => void pickAndImport()}>
          <Upload size={22} />
          <strong>Import</strong>
          <span>{kind === "audio" ? "No audio imported yet. Click to browse." : "Drag videos, audio or photos here, or click to browse"}</span>
        </button>
      ) : list.length === 0 ? (
        <EmptyState icon={<Search size={24} />} title="No media matches" hint="Clear the search or filters to see more media." />
      ) : (
        <div className={options.view === "list" ? "media-list" : "card-grid"}>
          {list.map((a) => (
            <MediaCard
              key={a.id}
              asset={a}
              uses={usage.get(a.id) ?? []}
              list={options.view === "list"}
              onPreview={() => setSource(a)}
              onMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, items: mediaMenu(a, usage.get(a.id)?.length ?? 0, () => setSource(a), () => setRenaming(a.id)) });
              }}
              renaming={renaming === a.id}
              onRename={(name) => {
                if (name === undefined) return setRenaming(a.id);
                setRenaming(null);
                if (name !== null) renameMedia(a.id, name);
              }}
            />
          ))}
        </div>
      )}
      {menu && (
        <div className="ctx-anchor" ref={menuRef} style={{ left: menu.x, top: menu.y }}>
          <MenuList items={menu.items} onDone={() => setMenu(null)} style={{ top: 0 }} />
        </div>
      )}
      {kind === "audio" && <SoundEffects />}
      {managing && <MediaManager onClose={() => setManaging(false)} />}
      {source && <SourceMonitor asset={source} onClose={() => setSource(null)} />}
    </div>
  );
}

/** CapCut's hover scrub: across a video card, the filmstrip frame under the
 * pointer, with a line where it is. Uses the timeline's thumbnails, so it
 * decodes nothing. */
function HoverScrub({ asset }: { asset: Asset }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [at, setAt] = useState<number | null>(null);
  const draw = (e: React.PointerEvent<HTMLDivElement>) => {
    const strip = thumbs.strip(asset);
    if (!strip || !canvas.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
    const frames = strip.frames;
    let i = Math.min(frames.length - 1, Math.floor(x * frames.length));
    while (i > 0 && !frames[i]) i--; // still decoding: the nearest earlier one
    const bmp = frames[i];
    if (!bmp) return;
    const c = canvas.current;
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    setAt(x);
  };
  return (
    <div className="hover-scrub" onPointerMove={draw} onPointerLeave={() => setAt(null)}>
      <canvas ref={canvas} hidden={at === null} />
      {at !== null && <span className="hover-scrub-line" style={{ left: `${at * 100}%` }} />}
    </div>
  );
}

/** CapCut's Record beside Import: the camera or the screen, a live pill
 * with the elapsed time while it runs, and the take imported and placed
 * at the playhead on Stop (state/capture.ts). */
function RecordButton() {
  const phase = useCapture();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(!!menu, menuRef, () => setMenu(null));
  const [, tick] = useState(0);
  useEffect(() => {
    if (phase.kind !== "recording") return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [phase.kind]);
  if (phase.kind === "recording")
    return (
      <span className="rec-live" role="status">
        <span className="rec-dot" aria-hidden="true" />
        <span className="num">{formatDuration((performance.now() - phase.since) / 1000)}</span>
        <button className="btn" onClick={() => void stopCapture()}>Stop</button>
        <button className="icon-btn small" aria-label="Discard recording" data-tip="Discard" onClick={cancelCapture}>
          <X size={13} />
        </button>
      </span>
    );
  return (
    <>
      <button
        className="btn"
        disabled={phase.kind !== "idle"}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({
            x: r.left,
            y: r.bottom + 4,
            items: [
              { label: "Record camera", onSelect: () => void startCapture("camera") },
              { label: "Record screen", disabled: !canRecordScreen(), onSelect: () => void startCapture("screen") },
            ],
          });
        }}
      >
        <Video size={14} /> {phase.kind === "saving" ? "Saving…" : "Record"}
      </button>
      {menu && (
        <div className="ctx-anchor" ref={menuRef} style={{ left: menu.x, top: menu.y }}>
          <MenuList items={menu.items} onDone={() => setMenu(null)} style={{ top: 0 }} />
        </div>
      )}
    </>
  );
}

/** A media card's right-click menu. Removing takes the media out of the
 * project only; a file the timeline uses says so and takes its clips. */
function mediaMenu(asset: Asset, uses: number, preview: () => void, rename: () => void): MenuItem[] {
  const remove = (withClips: boolean) => {
    try {
      edit(withClips ? `Remove ${asset.name} and its clips` : `Remove ${asset.name}`, (p) => removeMedia(p, [asset.id], withClips));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };
  return [
    { label: "Add to timeline", onSelect: () => addToTimeline(asset) },
    { label: "Preview", onSelect: preview },
    { label: "Rename…", onSelect: rename },
    { label: "Favorite", checked: !!asset.favorite, onSelect: () => edit("Favorite media", (p) => organizeMedia(p, [asset.id], { favorite: !asset.favorite })) },
    "-",
    uses
      ? { label: `Remove from project and its ${uses === 1 ? "clip" : `${uses} clips`}`, onSelect: () => remove(true) }
      : { label: "Remove from project", hint: "The file stays", onSelect: () => remove(false) },
  ];
}

function MediaCard({ asset, uses, list, onPreview, onMenu, renaming, onRename }: { asset: Asset; uses: MediaUse[]; list: boolean; onPreview: () => void; onMenu: (e: React.MouseEvent) => void; renaming: boolean; onRename: (name?: string | null) => void }) {
  const poster = thumbs.poster(asset);
  const Icon = asset.kind === "audio" ? AudioLines : asset.kind === "image" ? Image : Film;
  const metadata = [asset.animated ? `Animated image · ${formatDuration(asset.duration)}` : asset.kind === "image" ? "Still image" : `${asset.kind === "audio" ? "Audio" : "Video"} · ${formatDuration(asset.duration)}`,
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
      data-tip={`${asset.name}\n${metadata}`}
      onPointerDown={(e) => beginDrag(e, { kind: "asset", asset })}
      onDoubleClick={() => addToTimeline(asset)}
      onContextMenu={onMenu}
    >
      <div className={`card-thumb${asset.kind === "audio" ? " audio" : ""}`}>
        {poster ? <img src={poster} alt="" draggable={false} /> : <Icon size={22} strokeWidth={1.4} />}
        {!list && (asset.kind === "video" || asset.animated) && asset.hasVideo && <HoverScrub asset={asset} />}
        {!list && asset.kind !== "image" && <span className="chip num">{formatDuration(asset.duration)}</span>}
        {!list && uses.length > 0 && <span className="badge-added">Added</span>}
        {!list && add}
      </div>
      <div className="media-info">
        {renaming ? (
          <RenameField name={asset.name} label={`New name for ${asset.name}`} className="field card-rename" onDone={onRename} />
        ) : (
          // In the grid, double-click the name under the picture to rename;
          // elsewhere on the card it adds the file to the timeline. A list
          // row is mostly its name, so there a double-click adds, as the
          // user guide says; rename is in the menu.
          <span className="card-label" onDoubleClick={list ? undefined : (e) => (e.stopPropagation(), onRename())}>{asset.name}</span>
        )}
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

/** The built-in sound effects (lib/sfx.ts), made on this computer: play
 * one from its card, double-click, + or drag it in to add it. */
function SoundEffects() {
  const add = (id: string) => void addSoundEffect(id).catch((e) => toast(e instanceof Error ? e.message : String(e), "error"));
  return (
    <section className="lib-section">
      <h4 className="lib-group">Sound effects</h4>
      <div className="card-grid small">
        {Object.entries(SFX).map(([id, s]) => (
          <CatalogCard
            key={id}
            label={s.label}
            payload={{ kind: "sfx", id, label: s.label }}
            onAdd={() => add(id)}
            preview={
              <div className="fx-preview">
                <button className="sfx-play" aria-label={`Play ${s.label}`} data-tip="Listen" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onClick={() => auditionSoundEffect(id)}>
                  <Play size={16} />
                </button>
              </div>
            }
          />
        ))}
      </div>
    </section>
  );
}

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
      <p className="lib-hint">An adjustment layer grades everything below it on the timeline for its length. A solid color is a plain background or a flash; set its color in the inspector.</p>
      <div className="card-grid small">
        <CatalogCard
          label="Custom adjustment"
          payload={{ kind: "adjustment", label: "Adjustment" }}
          onAdd={() => addAdjustmentLayer()}
          preview={<div className="fx-preview"><SlidersHorizontal size={18} strokeWidth={1.4} /></div>}
        />
        <CatalogCard
          label="Solid color"
          payload={{ kind: "color", label: "Solid color" }}
          onAdd={() => addColorLayer()}
          preview={<div className="fx-preview"><PaintBucket size={18} strokeWidth={1.4} /></div>}
        />
      </div>
    </div>
  );
}
