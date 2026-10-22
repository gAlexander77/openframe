// The mixer and clip inspector edit the same ordered insert settings.
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2, X } from "../icons";
import { BAND_DEFAULT, DYNAMICS_PRESETS, EQ_TYPES, INSERT_DEFAULTS, INSERT_NAMES, INSERT_RANGES } from "../lib/audioInserts";
import { commandLabel } from "../lib/commandLabels";
import { runCommand } from "../lib/commands";
import type { EqBand, Insert, InsertType } from "../lib/project/types";
import { store } from "../state/store";
import { rangeGesture, useCommitOnLeave } from "./inspector/controls";
import "./audioInserts.css";

type Target = { track_id: string } | { clip_id: string };
const edit = (name: string, args: Record<string, unknown>) => store.edit(commandLabel(name, args), p => runCommand(p, name, args));
function InsertRange({ insert, name, range }: { insert: Insert; name: string; range: [number, number, number, string] }) {
  const [min, max, step, unit] = range;
  const value = (insert.params as unknown as Record<string, number>)[name];
  const label = `${INSERT_NAMES[insert.type]} ${name}`;
  return <label className="audio-insert-range"><span>{name}<output>{value} {unit}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} {...rangeGesture(label)} onChange={e => store.previewGesture(p => runCommand(p, "update_audio_insert", { insert_id: insert.id, params: { [name]: +e.target.value } }), label)} /></label>;
}
function BandNumber({ value, label, unit, min, max, step, commit }: { value: number; label: string; unit: string; min: number; max: number; step: number; commit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = (text: string) => {
    if (text.trim() && Number.isFinite(Number(text))) commit(Number(text));
    setDraft(null);
  };
  useCommitOnLeave(draft, save);
  return <label>{unit}<input className="field" aria-label={label} type="number" min={min} max={max} step={step} value={draft ?? value} onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft !== null) save(draft); }} onKeyDown={e => {
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDraft(null); }
  }} /></label>;
}
function BandControls({ insert }: { insert: Extract<Insert, { type: "eq" }> }) {
  const bands = insert.params.bands;
  const set = (next: EqBand[]) => edit("update_audio_insert", { insert_id: insert.id, params: { bands: next } });
  const patch = (index: number, change: Partial<EqBand>) => set(bands.map((b, n) => n === index ? { ...b, ...change } : b));
  return <div className="audio-eq-bands">{bands.map((b, n) => <fieldset key={n}><legend>Band {n + 1}</legend>
    <label><input type="checkbox" aria-label={`Band ${n + 1} enabled`} checked={b.on} onChange={e => patch(n, { on: e.target.checked })} />On</label>
    <select className="field" aria-label={`Band ${n + 1} type`} value={b.type} onChange={e => patch(n, { type: e.target.value as EqBand["type"] })}>{EQ_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select>
    {([ ["freq", "Hz", 20, 20000, 1], ["gain", "dB", -24, 24, 0.5], ["q", "Q", 0.1, 30, 0.1] ] as const).map(([key, unit, min, max, step]) => <BandNumber key={key} unit={unit} label={`Band ${n + 1} ${key}`} min={min} max={max} step={step} value={b[key]} commit={value => patch(n, { [key]: value })} />)}
    <button className="icon-btn small" aria-label={`Remove band ${n + 1}`} onClick={() => set(bands.filter((_, i) => i !== n))}><Trash2 size={12} /></button>
  </fieldset>)}<button className="btn ghost" disabled={bands.length >= 8} onClick={() => set([...bands, { ...BAND_DEFAULT }])}><Plus size={12} />Add band</button></div>;
}
export function InsertControls({ insert, more = false }: { insert: Insert; more?: boolean }) {
  if (insert.type === "eq") return <BandControls insert={insert} />;
  const ranges = Object.entries(INSERT_RANGES[insert.type]!);
  const rows = ranges.map(([name, range]) => <InsertRange key={name} insert={insert} name={name} range={range} />);
  return <div className="audio-insert-controls">{more ? <>{rows[0]}<details><summary>More {INSERT_NAMES[insert.type]} controls</summary>{rows.slice(1)}</details></> : rows}<button className="btn ghost" onClick={() => edit("update_audio_insert", { insert_id: insert.id, params: INSERT_DEFAULTS[insert.type] })}><RotateCcw size={12} />Reset {INSERT_NAMES[insert.type]}</button></div>;
}
export function InsertPresets({ target }: { target: Target }) {
  return <select className="field audio-insert-presets" aria-label={"track_id" in target ? "Track effects preset" : "Dynamics preset"} value="" onChange={e => { if (e.target.value) edit("track_id" in target ? "add_audio_insert" : "set_dynamics", { ...target, preset: e.target.value }); }}><option value="">{"track_id" in target ? "Add preset?" : "Apply preset?"}</option>{Object.entries(DYNAMICS_PRESETS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>;
}
export function AudioInserts({ target, inserts = [] }: { target: Target; inserts?: Insert[] }) {
  const [type, setType] = useState<InsertType>("compressor");
  const [open, setOpen] = useState<string | null>(null);
  const current = inserts.find(i => i.id === open);
  const move = (id: string, index: number) => edit("move_audio_insert", { insert_id: id, index });
  return <div className="audio-inserts" aria-label="Effects"><strong>Effects</strong><InsertPresets target={target} />
    <div className="audio-insert-list">{inserts.map((i, n) => <div className="audio-insert-item" key={i.id} draggable onDragStart={e => { e.dataTransfer.setData("application/openframe-insert", i.id); e.dataTransfer.effectAllowed = "move"; }} onDragOver={e => { if (e.dataTransfer.types.includes("application/openframe-insert")) e.preventDefault(); }} onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData("application/openframe-insert"); if (id !== i.id && inserts.some(i => i.id === id)) move(id, n); }}>
      <input type="checkbox" checked={i.on} aria-label={`${INSERT_NAMES[i.type]} enabled`} onChange={e => edit("update_audio_insert", { insert_id: i.id, on: e.target.checked })} />
      <button className="audio-insert-name" title={INSERT_NAMES[i.type]} onClick={() => setOpen(i.id)}>{INSERT_NAMES[i.type]}</button>
      <button className="icon-btn small" aria-label={`Move ${INSERT_NAMES[i.type]} up`} disabled={n === 0} onClick={() => move(i.id, n - 1)}><ArrowUp size={11} /></button>
      <button className="icon-btn small" aria-label={`Move ${INSERT_NAMES[i.type]} down`} disabled={n === inserts.length - 1} onClick={() => move(i.id, n + 1)}><ArrowDown size={11} /></button>
      <button className="icon-btn small" aria-label={`Remove ${INSERT_NAMES[i.type]}`} onClick={() => edit("remove_audio_insert", { insert_id: i.id })}><Trash2 size={11} /></button>
    </div>)}</div>
    <div className="audio-insert-add"><select className="field" aria-label="Insert type" value={type} onChange={e => setType(e.target.value as InsertType)}>{Object.entries(INSERT_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><button className="icon-btn small" disabled={inserts.length >= 32} aria-label="Add insert" onClick={() => edit("add_audio_insert", { ...target, type })}><Plus size={13} /></button></div>
    {current && <section className="audio-insert-popover" role="dialog" aria-label={`${INSERT_NAMES[current.type]} controls`} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setOpen(null); } }}><header><strong>{INSERT_NAMES[current.type]}</strong><button className="icon-btn small" aria-label="Close insert controls" onClick={() => setOpen(null)}><X size={13} /></button></header><InsertControls insert={current} /></section>}
  </div>;
}
