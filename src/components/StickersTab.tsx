import { EmptyState } from "./EmptyState";
// The Stickers tab: CapCut's sticker library, made locally — emoji from the
// system font and drawn graphics — grouped by category with search. Click +
// (or double-click) to add at the playhead, or drag onto the timeline.

import { useEffect, useRef, useState } from "react";
import { stickerThumb } from "../engine/stickers";
import { Plus, Search } from "../icons";
import { searchStickers, STICKER_CATEGORIES, STICKER_MOTIONS, type StickerCategory, type StickerDef } from "../lib/stickers";
import { beginDrag } from "../state/drag";
import { addSticker, setStickerMotion, stickerMotion } from "../state/stickers";
import { useInView } from "./useInView";

export function StickersTab() {
  const [cat, setCat] = useState<StickerCategory | null>(null);
  const [q, setQ] = useState("");
  const [motion, setMotion] = useState(stickerMotion);
  const list = searchStickers(q, cat);
  const groups = STICKER_CATEGORIES.map((c) => [c, list.filter((s) => s.category === c)] as const).filter(([, items]) => items.length);

  return (
    <div className="lib-split">
      <div className="lib-subnav">
        <button className={!cat ? "on" : ""} onClick={() => setCat(null)}>
          All
        </button>
        {STICKER_CATEGORIES.map((c) => (
          <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="lib-content">
        <div className="lib-toolbar">
          <label className="lib-search">
            <Search size={14} />
            <input className="field" placeholder="Search stickers" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select
            className="field sticker-motion"
            aria-label="Motion for new stickers"
            data-tip="How new stickers move"
            value={motion}
            onChange={(e) => {
              setMotion(e.target.value);
              setStickerMotion(e.target.value);
            }}
          >
            {Object.entries(STICKER_MOTIONS).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        {groups.length === 0 ? (
          <EmptyState icon={<Search size={24} />} title="No stickers match" hint="Try another search or category." />
        ) : (
          groups.map(([c, items]) => (
            <section key={c} className="lib-section">
              <h4 className="lib-group">{c}</h4>
              <div className="card-grid small">
                {items.map((s) => (
                  <StickerCard key={s.id} s={s} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function StickerCard({ s }: { s: StickerDef }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!visible || url) return;
    let live = true;
    void stickerThumb(s).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [visible, url, s]);
  const add = () => void addSticker(s.id);
  return (
    <div
      ref={ref}
      className="card sticker-card"
      title={s.label}
      onPointerDown={(e) => beginDrag(e, { kind: "sticker", id: s.id, label: s.label })}
      onDoubleClick={add}
    >
      <div className="card-thumb sticker-thumb">
        {url ? <img src={url} alt="" draggable={false} /> : <span className="thumb-wait" />}
        <button className="card-add" aria-label={`Add ${s.label} sticker`} onPointerDown={(e) => e.stopPropagation()} onClick={add}>
          <Plus size={14} strokeWidth={2.4} />
        </button>
      </div>
      <span className="card-label">{s.label}</span>
    </div>
  );
}
