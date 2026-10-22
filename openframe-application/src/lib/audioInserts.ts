// Ordered channel-strip settings shared by commands, the inspector and mixer.
import type { EqBand, Insert, InsertParams, InsertType, Project } from "./project/types";
import { uid } from "./project/defaults";
import { cleanCompressor, COMPRESSOR_PRESETS } from "./compressor";
import { cleanFx, ECHO_DEFAULT, REVERB_PRESETS } from "./soundFx";

export const INSERT_NAMES: Record<InsertType, string> = { eq: "Parametric EQ", compressor: "Compressor", gate: "Gate", deesser: "De-esser", limiter: "Limiter", reverb: "Reverb", echo: "Echo" };
export const EQ_TYPES: EqBand["type"][] = ["peaking", "lowshelf", "highshelf", "highpass", "lowpass", "notch"];
export const BAND_DEFAULT: EqBand = { type: "peaking", freq: 1000, gain: 0, q: 1, on: true };
export const INSERT_DEFAULTS: InsertParams = {
  eq: { bands: [BAND_DEFAULT] }, compressor: COMPRESSOR_PRESETS.voice,
  gate: { threshold: -50, ratio: 10, attack: 0.003, hold: 0.08, release: 0.12, range: 40 },
  deesser: { low: 5000, high: 9000, amount: 4 }, limiter: { ceiling: -1, release: 0.1 },
  reverb: REVERB_PRESETS.room, echo: ECHO_DEFAULT,
};
export const INSERT_RANGES: Partial<Record<InsertType, Record<string, [number, number, number, string]>>> = {
  gate: { threshold: [-90, 0, 0.5, "dBFS"], ratio: [1, 100, 1, ":1"], attack: [0.0001, 0.2, 0.001, "s"], hold: [0, 1, 0.01, "s"], release: [0.005, 2, 0.01, "s"], range: [0, 96, 1, "dB"] },
  deesser: { amount: [0, 24, 0.5, "dB"], low: [2000, 16000, 100, "Hz"], high: [2500, 20000, 100, "Hz"] },
  limiter: { ceiling: [-24, 0, 0.1, "dBFS"], release: [0.01, 2, 0.01, "s"] },
  compressor: { threshold: [-60, 0, 0.5, "dBFS"], ratio: [1, 20, 0.5, ":1"], knee: [0, 40, 1, "dB"], attack: [0, 1, 0.001, "s"], release: [0, 1, 0.01, "s"], makeup: [0, 24, 0.5, "dB"] },
  echo: { time: [0.01, 2, 0.01, "s"], feedback: [0, 0.9, 0.01, "ratio"], mix: [0, 1, 0.01, "ratio"] },
  reverb: { size: [0, 1, 0.01, "ratio"], decay: [0.1, 10, 0.1, "s"], mix: [0, 1, 0.01, "ratio"] },
};
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const number = (v: unknown, fallback: number, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
export function cleanInsertParams<K extends InsertType>(type: K, raw: unknown): InsertParams[K] {
  const a = obj(raw);
  if (type === "eq") return { bands: (Array.isArray(a.bands) ? a.bands : INSERT_DEFAULTS.eq.bands).slice(0, 8).map((raw) => {
    const b = obj(raw);
    return { type: EQ_TYPES.includes(b.type as EqBand["type"]) ? b.type : "peaking", freq: number(b.freq, 1000, 20, 20000), gain: number(b.gain, 0, -24, 24), q: number(b.q, 1, 0.1, 30), on: b.on !== false };
  }) } as InsertParams[K];
  if (type === "compressor") return cleanCompressor({ ...INSERT_DEFAULTS.compressor, ...a })! as InsertParams[K];
  if (type === "reverb" || type === "echo") return cleanFx(type, { ...INSERT_DEFAULTS[type], ...a })! as InsertParams[K];
  const result: Record<string, number> = {};
  for (const [key, [lo, hi]] of Object.entries(INSERT_RANGES[type]!)) result[key] = number(a[key], (INSERT_DEFAULTS[type] as unknown as Record<string, number>)[key], lo, hi);
  if (type === "deesser") result.high = Math.max(result.low + 100, result.high);
  return result as unknown as InsertParams[K];
}
export function cleanInserts(raw: unknown): Insert[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = new Set<string>();
  const out: Insert[] = [];
  for (const item of raw.slice(0, 32)) {
    const a = obj(item);
    if (typeof a.type !== "string" || !Object.hasOwn(INSERT_NAMES, a.type)) continue;
    const type = a.type as InsertType;
    const id = typeof a.id === "string" && a.id && !ids.has(a.id) ? a.id : uid("insert");
    ids.add(id);
    out.push({ id, type, on: a.on !== false, params: cleanInsertParams(type, a.params) } as Insert);
  }
  return out.length ? out : undefined;
}
export const newInsert = (type: InsertType, params?: unknown): Insert => ({ id: uid("insert"), type, on: true, params: cleanInsertParams(type, params) } as Insert);
export const DYNAMICS_PRESETS = { dialog_cleanup: "Dialog cleanup", podcast_voice: "Podcast voice", music_bed: "Music bed", broadcast_limiter: "Broadcast limiter" } as const;
export type DynamicsPreset = keyof typeof DYNAMICS_PRESETS;
export function presetInserts(preset: DynamicsPreset): Insert[] {
  if (preset === "broadcast_limiter") return [newInsert("limiter", { ceiling: -2, release: 0.1 })];
  if (preset === "music_bed") return [newInsert("compressor", COMPRESSOR_PRESETS.gentle), newInsert("limiter")];
  return [newInsert("eq", { bands: [{ ...BAND_DEFAULT, type: "highpass", freq: 80 }] }), newInsert("gate", { threshold: preset === "podcast_voice" ? -45 : -50 }), newInsert("deesser", { amount: preset === "podcast_voice" ? 6 : 4 }), newInsert("compressor"), newInsert("limiter")];
}
/** Edits affect the current timeline; edit_compound supplies a nested view. */
export function editInsertOwner(p: Project, target: { track_id?: unknown; clip_id?: unknown }, fn: (inserts: Insert[]) => Insert[]): Project {
  if (!!target.track_id === !!target.clip_id) throw new Error("Give exactly one track_id or clip_id");
  let found = false;
  const tracks = p.tracks.map(t => {
    if (target.track_id === t.id) {
      if (t.locked) throw new Error("Unlock the track before editing inserts");
      if (t.kind !== "audio") throw new Error("Track inserts need an audio track");
      found = true;
      return { ...t, inserts: fn(t.inserts ?? []) };
    }
    return { ...t, clips: t.clips.map(c => {
      if (c.id !== target.clip_id) return c;
      if (t.locked) throw new Error("Unlock the track before editing inserts");
      if (!("volume" in c)) throw new Error("This clip has no sound");
      found = true;
      return { ...c, inserts: fn(c.inserts ?? []) };
    }) };
  });
  if (!found) throw new Error("Audio insert target was not found");
  return { ...p, tracks };
}
export function editInsert(p: Project, id: string, fn: (list: Insert[], index: number) => Insert[]): Project {
  const owners = p.tracks.flatMap(t => [{ track_id: t.id, list: t.inserts ?? [] }, ...t.clips.map(c => ({ clip_id: c.id, list: "inserts" in c ? c.inserts ?? [] : [] }))]);
  const owner = owners.find(o => o.list.some(i => i.id === id));
  if (!owner) throw new Error(`Audio insert ${id} was not found`);
  return editInsertOwner(p, owner, list => fn(list, list.findIndex(i => i.id === id)));
}
/** Tail/settling estimate; stateful inserts replay history in mixdown.ts. */
export function insertsPreroll(inserts?: Insert[]): number {
  return (inserts ?? []).filter(i => i.on).reduce((seconds, i) => seconds + (() => {
    switch (i.type) {
      case "gate": return i.params.hold + i.params.release * 10;
      case "limiter": return i.params.release * 10 + 0.005;
      case "deesser": return 0.5;
      case "compressor": return 1;
      case "eq": return 0.1;
      case "reverb": return i.params.decay + 0.05;
      case "echo": return i.params.feedback > 0 ? i.params.time * Math.ceil(Math.log(0.001) / Math.log(i.params.feedback)) : i.params.time;
    }
  })(), 0);
}

/** Track bus identity ignores clip ids but includes the compound instance. */
export const insertTrackKey = (trackId: string, compoundPath: string[]) => `${compoundPath.join("/")}/track:${trackId}`;
