// What an animation preset's tile draws (the Animation tab): a little
// frame with the layer settled in it and a dashed ghost where the motion
// starts (In), ends (Out) or swings to (loops), read from the catalog's own
// numbers, so every preset looks like what it does and no two look alike.
// Titles' per-letter, word and line presets draw their units mid-way, the
// first ones settled and the later ones still on their way. CapCut's tiles
// are little animations; these move on hover (inspector.css).

import type { AnimationDef } from "./catalog";

/** The tile's frame, in CSS pixels. */
export const THUMB_W = 40;
export const THUMB_H = 26;

export type ThumbSlot = "in" | "out" | "loop";

/** One drawn mark, centered on (x, y) in the frame. */
export interface ThumbMark {
  kind: "solid" | "ghost" | "ring" | "unit" | "caret" | "marker" | "underline";
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  /** Degrees. */
  rotation: number;
  opacity: number;
  blur: boolean;
}

type Pose = Partial<Record<"x" | "y" | "scale" | "rotation" | "opacity" | "blur", number>>;

const LAYER = { w: 16, h: 11 };
const CX = THUMB_W / 2;
const CY = THUMB_H / 2;

/** A canvas-fraction offset as pixels: big moves reach the frame's edge,
 * small ones (a rise, a float) still show. */
const travel = (v: number, max: number) => (v ? Math.sign(v) * Math.min(max, Math.max(3, Math.abs(v) * 30)) : 0);
/** Turns as drawn: a spin's half turn would look like none. */
const turn = (r: number) => (r ? Math.sign(r) * Math.min(45, Math.max(10, Math.abs(r))) : 0);
/** Sizes as drawn: a pulse's 6% would not show. */
const size = (s: number) => (s < 1 ? Math.max(0.3, s) : s > 1 ? 1 + Math.min(0.6, Math.max(0.15, (s - 1) * 2.5)) : 1);

const mark = (kind: ThumbMark["kind"], x: number, y: number, w: number, h: number, extra: Partial<ThumbMark> = {}): ThumbMark => ({
  kind,
  x: +x.toFixed(2),
  y: +y.toFixed(2),
  w,
  h,
  scale: 1,
  rotation: 0,
  opacity: 1,
  blur: false,
  ...extra,
});

/** The layer at `pose`, as a ghost of the settled one. */
function ghost(pose: Pose): ThumbMark | null {
  const g = mark("ghost", CX + travel(pose.x ?? 0, 14), CY + travel(pose.y ?? 0, 9), LAYER.w, LAYER.h, {
    scale: +size(pose.scale ?? 1).toFixed(2),
    rotation: turn(pose.rotation ?? 0),
    opacity: (pose.opacity ?? 1) < 0.99 ? 0.45 : 1,
    blur: (pose.blur ?? 0) > 0,
  });
  const still = g.x === CX && g.y === CY && g.scale === 1 && g.rotation === 0 && g.opacity === 1 && !g.blur;
  return still ? null : g;
}

/** A loop's two extremes over a cycle, property by property. */
function extremes(loop: (t: number) => Pose): [Pose, Pose] {
  const hi: Pose = {}, lo: Pose = {};
  for (let i = 0; i < 64; i++) {
    for (const [k, v] of Object.entries(loop(i / 64)) as [keyof Pose, number][]) {
      hi[k] = Math.max(hi[k] ?? -Infinity, v);
      lo[k] = Math.min(lo[k] ?? Infinity, v);
    }
  }
  return [hi, lo];
}

/** A title preset's units part-way through: letters as dots, words as
 * bars, lines as rows; the first settled, the rest still at the start
 * pose (Out: the other way round). */
function textMarks(def: AnimationDef, slot: ThumbSlot): ThumbMark[] {
  const t = def.text!;
  if (t.sweep) {
    const words = [6, 9, 7].map((w, i, a) => mark("unit", 8 + a.slice(0, i).reduce((s, x) => s + x + 2, 0) + w / 2, CY, w, 4));
    if (t.sweep === "marker") return [mark("marker", 8 + 9, CY, 18, 8), ...words];
    return [...words, mark("underline", 8 + 9, CY + 5, 18, 1.5)];
  }
  const unit = t.unit ?? "word";
  const sizes = unit === "letter" ? Array(6).fill([3, 5]) : unit === "word" ? [[7, 4], [9, 4], [6, 4]] : [[24, 3], [18, 3]];
  const n = sizes.length;
  const from = def.from ?? {};
  const out: ThumbMark[] = [];
  let x = unit === "line" ? CX : 7;
  sizes.forEach(([w, h], i) => {
    // How far along this unit is: earlier units lead (In), trail (Out).
    const lead = slot === "out" ? n - 1 - i : i;
    const p = t.step ? (lead < n / 2 ? 1 : 0) : Math.max(0, 1 - lead / (n - 1));
    const cx = unit === "line" ? CX : x + w / 2;
    const cy = unit === "line" ? CY - 4 + i * 7 : CY;
    const k = 1 - p;
    out.push(
      mark("unit", cx + travel((from.x ?? 0) * k * 3, 6), cy + travel((from.y ?? 0) * k * 3, 6), w, h, {
        scale: +(1 + ((from.scale ?? 1) - 1) * k).toFixed(2),
        opacity: from.opacity !== undefined ? +(1 - (1 - from.opacity) * k * 0.8).toFixed(2) : 1,
      }),
    );
    x += w + (unit === "letter" ? 1.5 : 2);
  });
  if (t.caret) {
    const last = out.filter((m) => m.opacity === 1 && m.scale === 1).at(-1);
    out.push(mark("caret", (last ? last.x + last.w / 2 : 6) + 2, CY, 1.5, 9));
  }
  return out;
}

/** The marks for preset `type` in a slot; null draws the None tile. */
export function animThumb(type: string | null, slot: ThumbSlot, defs: Record<string, AnimationDef>): ThumbMark[] {
  const def = type ? defs[type] : undefined;
  if (!def) return [];
  if (def.text) return textMarks(def, slot);
  let solid = mark("solid", CX, CY, LAYER.w, LAYER.h);
  let ghosts = (slot === "loop" && def.loop ? extremes(def.loop).map(ghost) : [ghost(def.from ?? {})]).filter((g): g is ThumbMark => !!g);
  // A ghost right behind the layer (a fade, a blur, a flicker) would be
  // hidden by it: the layer itself shows it, dimmed or blurred.
  const behind = ghosts.find((g) => g.x === CX && g.y === CY && g.scale === 1 && g.rotation === 0);
  if (behind) {
    solid = { ...solid, opacity: behind.opacity < 1 ? 0.4 : 1, blur: behind.blur };
    ghosts = ghosts.filter((g) => g !== behind);
  }
  // Pop overshoots: a ring just past the settled size.
  const ring = def.overshoot && slot !== "loop" ? [mark("ring", CX, CY, LAYER.w, LAYER.h, { scale: 1.25 })] : [];
  return [...ghosts, ...ring, solid];
}
