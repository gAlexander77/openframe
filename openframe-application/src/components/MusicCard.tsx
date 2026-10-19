// The Audio tab's "Generate music" card: an original score made on this
// computer (state/music.ts, the same generate_music agents call), with a
// style, length, tempo, key, ending and seed; Preview plays it without
// adding it, Add puts it on an audio track at the playhead.

import { DraftNumber } from "./DraftNumber";
import { useEffect, useRef, useState } from "react";
import { Dices, Loader2, Music, Play, Plus, Square, X } from "../icons";
import { STYLE_IDS, STYLES, type StyleId } from "../lib/music/styles";
import { PITCH_FLAT } from "../lib/music/theory";
import { framesToSeconds } from "../lib/time";
import { generateMusic, previewMusic, stopPreview } from "../state/music";
import { store } from "../state/store";
import { toast } from "../state/toast";
import "./music.css";

const KEYS = PITCH_FLAT.flatMap((k) => [`${k} major`, `${k} minor`]);
const newSeed = () => Math.floor(Math.random() * 100000);

type Busy = { kind: "preview" | "add"; progress: number } | null;

export function MusicCard() {
  const [style, setStyle] = useState<StyleId>("launch");
  const [length, setLength] = useState(30);
  const [bpm, setBpm] = useState<number | "">("");
  const [key, setKey] = useState("");
  const [ending, setEnding] = useState<"ring" | "stop">("ring");
  const [seed, setSeed] = useState(newSeed);
  const [stems, setStems] = useState(false);
  const [markers, setMarkers] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("");
  const abort = useRef<AbortController | null>(null);

  // Leaving the tab stops a preview and drops a render in flight.
  useEffect(() => () => {
    abort.current?.abort();
    stopPreview();
  }, []);

  const args = () => {
    const [tonic, mode] = key ? key.split(" ") : [undefined, undefined];
    return { style, length, ...(bpm ? { bpm } : {}), ...(tonic ? { key: tonic, mode } : {}), ending, seed };
  };
  const fail = (e: unknown) => {
    if ((e as Error)?.name !== "AbortError") toast(e instanceof Error ? e.message : String(e), "error");
  };

  const preview = async () => {
    if (playing) {
      stopPreview();
      setPlaying(false);
      return;
    }
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy({ kind: "preview", progress: 0 });
    try {
      const m = await previewMusic(args(), (p) => setBusy({ kind: "preview", progress: p }), ctl.signal, () => setPlaying(false));
      setPlaying(true);
      setStatus(`Previewing · ${m.lufs.toFixed(1)} LUFS`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    stopPreview();
    setPlaying(false);
    setBusy({ kind: "add", progress: 0 });
    try {
      const s = store.get();
      const start = +framesToSeconds(s.playhead, s.project.fps).toFixed(3);
      const r = await generateMusic({ ...args(), start, stems, markers: markers ? ["bars", "drop"] : [] }, (p) => setBusy({ kind: "add", progress: p }));
      setStatus(`Added at ${r.start.toFixed(1)} s · ${Math.round(r.bpm)} BPM · ${r.key}`);
      toast(`Added ${STYLES[style].label.toLowerCase()} music, ${r.duration.toFixed(0)} s, ${r.bpm.toFixed(0)} BPM in ${r.key}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const pct = busy ? Math.round(busy.progress * 100) : 0;
  const blurb = STYLES[style].blurb.replace(/^./, (c) => c.toUpperCase());
  return (
    <section className={`music-card${busy ? " running" : ""}`} aria-label="Generate music">
      <div className="music-head">
        <div className="music-icon">
          <Music size={18} strokeWidth={1.7} />
        </div>
        <div className="music-title">
          <h3>Generate music</h3>
          <p>An original score, made on this computer. Free to use.</p>
        </div>
      </div>
      <label className="music-field wide">
        <span>Style</span>
        <select className="field" value={style} onChange={(e) => setStyle(e.target.value as StyleId)}>
          {STYLE_IDS.map((id) => (
            <option key={id} value={id}>{STYLES[id].label}</option>
          ))}
        </select>
        <small title={blurb}>{blurb}</small>
      </label>
      <div className="music-grid">
        <label className="music-field">
          <span>Length (s)</span>
          <DraftNumber className="field num" min={4} max={300} step={1} value={length} onCommit={v => setLength(Number(v))} />
        </label>
        <label className="music-field">
          <span>Tempo (BPM)</span>
          <DraftNumber className="field num" min={40} max={220} placeholder={String(STYLES[style].bpm)} value={bpm} optional onCommit={setBpm} />
        </label>
        <label className="music-field">
          <span>Key</span>
          <select className="field" value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="">{`${STYLES[style].key} ${STYLES[style].mode}`}</option>
            {KEYS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="music-field">
          <span>Ending</span>
          <select className="field" value={ending} onChange={(e) => setEnding(e.target.value as "ring" | "stop")}>
            <option value="ring">Ring out</option>
            <option value="stop">Hard stop</option>
          </select>
        </label>
        <label className="music-field">
          <span>Seed</span>
          <span className="music-seed">
            <DraftNumber className="field num" min={0} value={seed} integer onCommit={v => setSeed(Number(v))} />
            <button className="icon-btn" aria-label="New take" data-tip="New take" onClick={() => setSeed(newSeed())}>
              <Dices size={15} />
            </button>
          </span>
        </label>
        <div className="music-checks">
          <label><input type="checkbox" checked={markers} onChange={(e) => setMarkers(e.target.checked)} /> Bar and drop markers</label>
          <label><input type="checkbox" checked={stems} onChange={(e) => setStems(e.target.checked)} /> Stems too</label>
        </div>
      </div>
      <div className="music-foot">
        {busy ? (
          <>
            <div className="ai-progress" role="progressbar" aria-label={busy.kind === "add" ? "Making the music" : "Making the preview"} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ transform: `scaleX(${busy.progress})` }} />
            </div>
            <span className="ai-pct num">
              <Loader2 size={13} className="spin" /> {pct}%
            </span>
            {busy.kind === "preview" && (
              <button className="icon-btn" aria-label="Cancel" onClick={() => abort.current?.abort()}>
                <X />
              </button>
            )}
          </>
        ) : (
          <>
            <span className="music-status" title={status}>{status || "Ready"}</span>
            <button className="btn" onClick={() => void preview()}>
              {playing ? <Square size={13} /> : <Play size={13} />} {playing ? "Stop" : "Preview"}
            </button>
            <button className="btn primary" onClick={() => void add()}>
              <Plus size={14} /> Add
            </button>
          </>
        )}
      </div>
    </section>
  );
}
