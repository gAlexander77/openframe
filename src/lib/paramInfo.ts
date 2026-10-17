// How an animatable parameter reads to a person: its name and the units the
// inspector shows it in (scale as %, position in pixels with Y up, volume
// in dB). The keyframe panel's lanes, value graph and tooltips use this so
// a key reads "Scale 120%" there just as the slider does.
//
// ponytail: the inspector passes the same show/store pairs to each
// SliderRow by hand; when a third consumer needs them, the inspector should
// read them from here instead.

import { fromDb, toDb } from "./audio";
import { EFFECTS } from "./catalog";
import type { Clip } from "./project/types";

export interface ParamInfo {
  label: string;
  unit: string;
  digits: number;
  /** Stored value -> shown value. */
  show: (v: number) => number;
  /** Shown value -> stored value. */
  store: (v: number) => number;
}

const same = (v: number) => v;

const FIXED: Record<string, Omit<ParamInfo, "show" | "store"> & { scale?: number }> = {
  "transform.scale": { label: "Scale", unit: "%", digits: 0, scale: 100 },
  "transform.scaleY": { label: "Scale Y", unit: "%", digits: 0, scale: 100 },
  "transform.anchorX": { label: "Anchor X", unit: "%", digits: 0, scale: 100 },
  "transform.anchorY": { label: "Anchor Y", unit: "%", digits: 0, scale: 100 },
  "transform.rotation": { label: "Rotate", unit: "°", digits: 1 },
  opacity: { label: "Opacity", unit: "%", digits: 0, scale: 100 },
  pan: { label: "Pan", unit: "", digits: 0, scale: 100 },
  "mask.x": { label: "Mask X", unit: "%", digits: 0, scale: 100 },
  "mask.y": { label: "Mask Y", unit: "%", digits: 0, scale: 100 },
  "mask.width": { label: "Mask width", unit: "%", digits: 0, scale: 100 },
  "mask.height": { label: "Mask height", unit: "%", digits: 0, scale: 100 },
  "mask.rotation": { label: "Mask rotate", unit: "°", digits: 0 },
  "mask.feather": { label: "Mask feather", unit: "%", digits: 0, scale: 100 },
  "chromaKey.similarity": { label: "Key strength", unit: "", digits: 0, scale: 100 },
  "chromaKey.smoothness": { label: "Key feather", unit: "", digits: 0, scale: 100 },
  "chromaKey.spill": { label: "Spill removal", unit: "", digits: 0, scale: 100 },
};

/** CapCut's Adjust labels, where they differ from the field name. */
const ADJUST: Record<string, string> = { temperature: "Temp" };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function paramInfo(path: string, clip: Clip, canvas: { width: number; height: number }): ParamInfo {
  const fixed = FIXED[path];
  if (fixed) {
    const k = fixed.scale ?? 1;
    return { label: fixed.label, unit: fixed.unit, digits: fixed.digits, show: (v) => v * k, store: (v) => v / k };
  }
  if (path === "transform.x") return { label: "Position X", unit: "px", digits: 0, show: (v) => v * canvas.width, store: (v) => v / canvas.width };
  // Shown with up as positive, as the inspector does; stored y grows downward.
  if (path === "transform.y") return { label: "Position Y", unit: "px", digits: 0, show: (v) => -v * canvas.height, store: (v) => -v / canvas.height };
  if (path === "volume") {
    return { label: "Volume", unit: "dB", digits: 1, show: (v) => Math.max(-60, toDb(v)), store: (db) => (db <= -60 ? 0 : fromDb(db)) };
  }
  const [head, id, param] = path.split(".");
  if (head === "adjust" && id) return { label: ADJUST[id] ?? cap(id), unit: "", digits: 0, show: same, store: same };
  if (head === "effects" && id && param) {
    const fx = "effects" in clip ? clip.effects.find((e) => e.id === id) : undefined;
    const def = fx && EFFECTS[fx.type];
    const p = def?.params[param];
    const label = def ? `${def.label} · ${p?.label ?? param}` : `${cap(param)}`;
    return { label, unit: "", digits: p?.step && p.step < 1 ? 2 : 0, show: same, store: same };
  }
  return { label: path, unit: "", digits: 2, show: same, store: same };
}

/** "120%", "-48 px", "-6.0 dB": a value in its display units. */
export function formatParam(info: ParamInfo, stored: number): string {
  const v = info.show(stored);
  const text = Number.isFinite(v) ? v.toFixed(info.digits) : "-∞";
  return info.unit === "%" || info.unit === "°" || !info.unit ? `${text}${info.unit}` : `${text} ${info.unit}`;
}
