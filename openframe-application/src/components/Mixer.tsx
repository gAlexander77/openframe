import { useEffect, useState } from "react";
import { masterBus, readMeter, trackMeter } from "../engine/audio";
import { fromDb, toDb } from "../lib/audio";
import { updateTrack } from "../lib/project/ops";
import { store, useEditor } from "../state/store";
import { X } from "../icons";
import { rangeGesture } from "./inspector/controls";
import { shortTermLufs } from "./Meter";
import "./mixer.css";
const level = (v: number) => Number.isFinite(v) ? v.toFixed(1) : "−∞";
function Levels({ id }: { id?: string }) {
  const playing = useEditor(s => s.playing);
  const [v, setV] = useState(() => [readMeter()]);
  const [lufs, setLufs] = useState(-Infinity);
  useEffect(() => {
    const update = () => {
      setV(id ? [readMeter(playing ? trackMeter(id) : undefined)] : [readMeter(playing ? masterBus().left : undefined), readMeter(playing ? masterBus().right : undefined)]);
      setLufs(shortTermLufs());
    };
    update(); const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [playing, id]);
  return <div className="mix-levels">{v.map((m, i) => <div key={i}><meter aria-label={`${id ?? "Master"} ${i ? "right" : "left"} peak`} min={-60} max={0} value={Math.max(-60, m.peak)} /><span>Peak {level(m.peak)}</span><span>RMS {level(m.rms)}</span></div>)}{!id && <span>Short {level(lufs)} LUFS</span>}</div>;
}
export function Mixer() {
  const open = useEditor(s => s.mixer);
  const p = useEditor(s => s.project);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); store.set({ mixer: false }); } };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [open]);
  if (!open) return null;
  const tracks = p.tracks.filter(t => t.kind === "audio" || t.clips.some(c => c.type === "compound" || c.type === "video" && p.assets.some(a => a.id === c.assetId && a.hasAudio)));
  return <section className="mixer" role="dialog" aria-label="Audio track mixer"><header><strong>Mixer</strong><button className="icon-btn small" aria-label="Close mixer" onClick={() => store.set({ mixer: false })}><X /></button></header><div className="mix-strips">{[...tracks, null].map(t => {
    const name = t?.name ?? "Master";
    const volume = t ? t.volume : p.masterVolume ?? 1;
    const change = (v: number) => store.previewGesture(q => t ? updateTrack(q, t.id, { volume: v }) : { ...q, masterVolume: v }, `${name} volume`);
    // The pan slider says what it is and where it stands, as the track
    // volume popover does: unlabeled, it read as a second volume.
    const pan = t?.pan ?? 0;
    return <div className={`mix-strip${t ? "" : " master"}`} key={t?.id ?? "master"}><strong title={name}>{name}</strong><div className="mix-fader"><input aria-label={`${name} volume`} type="range" min={-60} max={12} step={0.5} value={Math.max(-60, toDb(volume))} {...rangeGesture(`${name} volume`)} onChange={e => change(+e.target.value <= -60 ? 0 : fromDb(+e.target.value))} onDoubleClick={() => change(1)} /><Levels id={t?.id} /></div><span className="mix-value num">{level(toDb(volume))} dB</span>{t && <><span className="mix-value num">Pan {pan === 0 ? "center" : `${Math.round(Math.abs(pan) * 100)} ${pan < 0 ? "L" : "R"}`}</span><input aria-label={`${name} pan`} type="range" min={-1} max={1} step={0.01} value={pan} {...rangeGesture("Track pan")} onChange={e => store.previewGesture(q => updateTrack(q, t.id, { pan: +e.target.value }), "Track pan")} onDoubleClick={() => store.edit("Reset pan", q => updateTrack(q, t.id, { pan: 0 }))} /><div className="mix-switches">{(["muted", "solo"] as const).map(k => <button className="btn" key={k} aria-pressed={!!t[k]} onClick={() => store.edit(k === "muted" ? "Mute track" : "Solo track", q => updateTrack(q, t.id, { [k]: !t[k] }))}>{k === "muted" ? "Mute" : "Solo"}</button>)}</div></>}</div>;
  })}</div></section>;
}
