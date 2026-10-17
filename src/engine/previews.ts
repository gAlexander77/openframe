// Library card previews drawn by the app's own engine (ADR-026): a sample
// frame — a generated landscape, or the selected clip's own frame — goes
// through planFrame and an offscreen Compositor with the card's filter,
// effect, transition or text applied. The shaders, the plan and the text
// rasterizer are the ones the viewer and export use, so a card can never
// promise a look the editor does not make.
//
// One offscreen WebGL2 context renders every card. Jobs run one at a time
// with a macrotask between them, only for cards on screen (a job whose card
// scrolled away is dropped), and results are cached as small JPEG blob URLs:
// a still per card, and on hover a sprite strip the card animates with CSS.

import { effectDefaults } from "../lib/catalog";
import { createProject, createTrack, DEFAULT_ADJUST, DEFAULT_CROP, DEFAULT_TRANSFORM } from "../lib/project/defaults";
import { findClip, getAsset } from "../lib/project/ops";
import type { Asset, Clip, ImageClip, Project, VisualClip } from "../lib/project/types";
import { planFrame, type Layer } from "../lib/render/plan";
import { store, type EditorState } from "../state/store";
import { Compositor, type SourceImage } from "./compositor";
import { CursorPool, resolveSources, sourceImages } from "./player";
import { rasterizeText } from "./text";

export type PreviewSpec =
  | { kind: "filter"; type: string }
  | { kind: "effect"; type: string }
  | { kind: "transition"; type: string }
  /** Text clips laid out on a 16:9 frame, shown cropped to their ink.
   * `scene` puts them over the sample (or selected) frame, else a plain
   * card-colored backdrop. */
  | { kind: "text"; id: string; clips: Clip[]; scene: boolean };

export interface PreviewMotion {
  /** A horizontal strip of `frames` frames. */
  sprite: string;
  frames: number;
  seconds: number;
}

const FPS = { num: 30, den: 1 };
const PLAIN = "#2b2b2b";

// ---- the job queue ------------------------------------------------------------------

interface Job {
  alive: () => boolean;
  run: () => Promise<void>;
  cancel: () => void;
}
const queue: Job[] = [];
let busy = false;
let warming: Promise<void> | null = null;

/** Run `work` when its turn comes, unless `alive` says the card is gone by
 * then (resolves null). `urgent` jumps the queue: the user is pointing at it. */
function schedule<T>(alive: () => boolean, work: () => Promise<T>, urgent = false): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const job: Job = {
      alive,
      cancel: () => resolve(null),
      run: () => work().then(resolve, reject),
    };
    if (urgent) queue.unshift(job);
    else queue.push(job);
    void pump();
  });
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    // Shaders compile before the first card, not inside its render.
    await (warming ??= compositor().warm().catch((e) => console.warn("preview shaders:", e)));
    while (queue.length) {
      const job = queue.shift()!;
      if (!job.alive()) {
        job.cancel();
        continue;
      }
      await job.run().catch((e) => console.warn("preview failed:", e));
      // A macrotask between renders keeps scrolling and typing smooth.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    busy = false;
  }
}

const cache = new Map<string, Promise<string | PreviewMotion | null>>();

function cached<T extends string | PreviewMotion>(key: string, make: () => Promise<T | null>): Promise<T | null> {
  let hit = cache.get(key) as Promise<T | null> | undefined;
  if (!hit) {
    hit = make();
    cache.set(key, hit);
    // A canceled job (card scrolled away) or a failure may be asked again.
    void hit.then((v) => v === null && cache.get(key) === hit && cache.delete(key), () => cache.delete(key));
    // ponytail: FIFO cap; scene changes are what fill it, and the oldest
    // entries belong to scenes nobody shows any more.
    while (cache.size > 320) {
      const [k, old] = cache.entries().next().value!;
      cache.delete(k);
      void old.then((v) => v && URL.revokeObjectURL(typeof v === "string" ? v : v.sprite));
    }
  }
  return hit;
}

// ---- scenes ---------------------------------------------------------------------------

interface Scene {
  key: string;
  image: TexImageSource;
  width: number;
  height: number;
}

/** A sunset landscape with saturated and neutral areas, skin-warm and cool
 * tones and a bright sun, so every look and effect has something to bite;
 * `night` is the contrasting second shot transitions cut to. */
function drawSample(night: boolean): Scene {
  const w = 640;
  const h = 360;
  const c = new OffscreenCanvas(w, h);
  // CPU-backed: uploading a GPU 2D canvas into the WebGL context forced a
  // ~70 ms readback on the first card.
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const sky = g.createLinearGradient(0, 0, 0, h * 0.64);
  if (night) {
    sky.addColorStop(0, "#070b22");
    sky.addColorStop(0.6, "#28306e");
    sky.addColorStop(1, "#b04a7c");
  } else {
    sky.addColorStop(0, "#1f56b0");
    sky.addColorStop(0.55, "#86bde8");
    sky.addColorStop(1, "#fbc98a");
  }
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const [sx, sy] = night ? [w * 0.24, h * 0.22] : [w * 0.68, h * 0.5];
  const glow = g.createRadialGradient(sx, sy, 0, sx, sy, w * 0.28);
  glow.addColorStop(0, night ? "rgba(220,230,255,0.45)" : "rgba(255,244,214,0.95)");
  glow.addColorStop(1, "rgba(255,210,150,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  g.fillStyle = night ? "#eef1ff" : "#fff6d6";
  g.beginPath();
  g.arc(sx, sy, night ? w * 0.035 : w * 0.055, 0, Math.PI * 2);
  g.fill();
  if (night) {
    g.fillStyle = "#ffffff";
    for (let i = 0; i < 40; i++) g.fillRect((Math.sin(i * 91.7) * 0.5 + 0.5) * w, (Math.sin(i * 47.3) * 0.5 + 0.5) * h * 0.45, 1.4, 1.4);
  }
  const ridge = (base: number, amp: number, freq: number, phase: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, h * base - amp * h * (0.6 * Math.sin(x * freq + phase) + 0.4 * Math.sin(x * freq * 2.7 + phase * 1.9)));
    g.lineTo(w, h);
    g.fill();
  };
  ridge(0.6, 0.12, 0.011, 1.2, night ? "#2b2c5e" : "#7d7fbf");
  ridge(0.68, 0.07, 0.017, 4.1, night ? "#1b1d3d" : "#3f7f6a");
  if (night) {
    // A skyline with lit windows.
    for (let i = 0; i < 14; i++) {
      const bw = 26 + ((i * 37) % 22);
      const bh = 50 + ((i * 53) % 90);
      const bx = i * 47 - 10;
      g.fillStyle = "#0d0f24";
      g.fillRect(bx, h * 0.72 - bh, bw, bh);
      g.fillStyle = "#ffcf6e";
      for (let y = h * 0.72 - bh + 8; y < h * 0.72 - 6; y += 12) for (let x = bx + 5; x < bx + bw - 5; x += 9) if (Math.sin(x * 3.1 + y * 1.7) > 0.1) g.fillRect(x, y, 4, 5);
    }
  }
  // Water with the sky mirrored in it, then a near meadow.
  const water = g.createLinearGradient(0, h * 0.72, 0, h * 0.86);
  water.addColorStop(0, night ? "#7a3f75" : "#f2b77c");
  water.addColorStop(1, night ? "#151a45" : "#3d78b8");
  g.fillStyle = water;
  g.fillRect(0, h * 0.72, w, h * 0.14);
  g.fillStyle = night ? "rgba(255,207,110,0.5)" : "rgba(255,248,220,0.7)";
  for (let i = 0; i < 6; i++) g.fillRect(sx - 40 + i * 6, h * 0.74 + i * 7, 80 - i * 12, 2.5);
  const meadow = g.createLinearGradient(0, h * 0.84, 0, h);
  meadow.addColorStop(0, night ? "#14321f" : "#7fb04a");
  meadow.addColorStop(1, night ? "#08150c" : "#2f5a22");
  g.fillStyle = meadow;
  g.beginPath();
  g.moveTo(0, h);
  g.lineTo(0, h * 0.86);
  g.quadraticCurveTo(w * 0.5, h * 0.8, w, h * 0.88);
  g.lineTo(w, h);
  g.fill();
  // A red cabin and dark pines: a hue and a deep shadow to judge looks by.
  g.fillStyle = night ? "#5a1d1d" : "#c8402e";
  g.fillRect(w * 0.14, h * 0.8, w * 0.07, h * 0.06);
  g.fillStyle = night ? "#2a1010" : "#7b2318";
  g.beginPath();
  g.moveTo(w * 0.13, h * 0.8);
  g.lineTo(w * 0.175, h * 0.75);
  g.lineTo(w * 0.22, h * 0.8);
  g.fill();
  g.fillStyle = night ? "#06110a" : "#1d3b1f";
  for (const [x, s] of [[0.82, 1], [0.87, 1.3], [0.92, 0.9], [0.05, 1.1]] as const) {
    g.beginPath();
    g.moveTo(w * x, h * (0.88 - 0.16 * s));
    g.lineTo(w * x + 16 * s, h * 0.9);
    g.lineTo(w * x - 16 * s, h * 0.9);
    g.fill();
  }
  return { key: night ? "scene:night" : "scene:day", image: c, width: w, height: h };
}

let day: Scene | null = null;
let night: Scene | null = null;
const sample = () => (day ??= drawSample(false));
const nightScene = () => (night ??= drawSample(true));

// The selected clip's frame stands in for the sample, so a card shows what
// it would do to this shot. Tracked from the store, debounced, never while
// playing.
let sceneKey = "sample";
let clipScene: Promise<Scene> | null = null;
let clipSceneKey = "";
const sceneListeners = new Set<() => void>();
let timer = 0;
let watching = false;

function keyFor(s: EditorState): string {
  const loc = s.selection.length === 1 ? findClip(s.project, s.selection[0]) : null;
  const c = loc?.clip;
  if (!c || (c.type !== "video" && c.type !== "image") || c.disabled) return "sample";
  // The source location too: a relink keeps the asset ID.
  const src = s.project.assets.find((a) => a.id === c.assetId)?.src;
  if (c.type === "image") return `image:${c.assetId}:${src}`;
  const f = Math.min(Math.max(s.playhead, c.start), c.start + c.duration - 1);
  return `video:${c.id}:${c.assetId}:${src}:${c.in}:${c.speed}:${f - c.start}`;
}

function watch() {
  if (watching) return;
  watching = true;
  sceneKey = keyFor(store.get());
  store.subscribe(() => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const s = store.get();
      if (s.playing) return;
      const k = keyFor(s);
      if (k === sceneKey) return;
      sceneKey = k;
      sceneListeners.forEach((l) => l());
    }, 250);
  });
}

/** Subscribe to scene changes; `previewScene()` is the current scene's key. */
export function subscribePreviewScene(l: () => void) {
  watch();
  sceneListeners.add(l);
  return () => {
    sceneListeners.delete(l);
  };
}
export const previewScene = () => sceneKey;

const pool = new CursorPool();

/** The bare source frame of the selected clip under the playhead: no look,
 * no transform, decoded and drawn by the same code the viewer uses. */
async function grabClip(key: string): Promise<Scene> {
  const s = store.get();
  const loc = findClip(s.project, s.selection[0]);
  const clip = loc?.clip as VisualClip & ImageClip;
  const asset = clip && getAsset(s.project, clip.assetId);
  if (!clip || !asset?.width || !asset.height) return sample();
  const k = 480 / Math.max(asset.width, asset.height);
  const w = Math.max(2, Math.round(asset.width * k));
  const h = Math.max(2, Math.round(asset.height * k));
  const r = Math.min(Math.max(s.playhead - clip.start, 0), clip.duration - 1);
  const bare = {
    ...clip,
    start: 0,
    transform: DEFAULT_TRANSFORM,
    crop: DEFAULT_CROP,
    adjust: DEFAULT_ADJUST,
    opacity: 1,
    blend: "normal",
    effects: [],
    filter: undefined,
    mask: undefined,
    chromaKey: undefined,
    canvas: undefined,
    animIn: undefined,
    animOut: undefined,
    animLoop: undefined,
    keyframes: undefined,
    transitionOut: undefined,
  } as Clip;
  const mini: Project = { ...createProject({ width: w, height: h, fps: s.project.fps }), assets: [asset], tracks: [{ ...createTrack("video", "Main", true), clips: [bare] }] };
  const plan = planFrame(mini, r);
  const resolved = await resolveSources(mini, plan, pool);
  const comp = compositor();
  comp.resize(w, h);
  comp.render(plan, sourceImages(resolved, w, h), "#000000");
  const image = await createImageBitmap(comp.canvas);
  pool.clear();
  return { key: `scene:${key}`, image, width: w, height: h };
}

/** The scene the A side of a card is drawn on. Only called from inside a
 * job, so the grab is already serialized with every other render (and
 * must not be scheduled itself: the queue is waiting on this job). */
function sceneA(): Promise<Scene> {
  if (sceneKey === "sample") return Promise.resolve(sample());
  if (clipSceneKey !== sceneKey || !clipScene) {
    clipSceneKey = sceneKey;
    clipScene = grabClip(sceneKey).catch(() => sample());
  }
  return clipScene;
}

// ---- rendering ------------------------------------------------------------------------

let comp: Compositor | null = null;
const compositor = () => (comp ??= new Compositor(new OffscreenCanvas(2, 2)));

function sceneAsset(sc: Scene): Asset {
  return { id: sc.key, kind: "image", name: sc.key, src: sc.key, duration: 0, width: sc.width, height: sc.height, hasVideo: true, hasAudio: false };
}

/** An image clip of `sc` that covers a w x h frame. */
function sceneClip(sc: Scene, start: number, duration: number, w: number, h: number): ImageClip {
  const scale = Math.max(w / sc.width, h / sc.height) / Math.min(w / sc.width, h / sc.height);
  return {
    id: `${sc.key}@${start}`,
    type: "image",
    assetId: sc.key,
    start,
    duration,
    transform: { ...DEFAULT_TRANSFORM, scale },
    opacity: 1,
    blend: "normal",
    crop: { ...DEFAULT_CROP },
    adjust: { ...DEFAULT_ADJUST },
    effects: [],
  };
}

function project(w: number, h: number, scenes: Scene[], tracks: Clip[][], background = "#000000"): Project {
  const p = createProject({ width: w, height: h, fps: FPS });
  return {
    ...p,
    background,
    assets: scenes.map(sceneAsset),
    // tracks[0] is the bottom (main) track; the project lists top first.
    tracks: tracks.map((clips, i) => ({ ...createTrack("video", `T${i}`, i === 0), clips })).reverse(),
  };
}

/** Draw `frames` of `p` into a strip of out x outH cells. `crop` picks the
 * part of the w x h frame each cell shows (default: all of it). */
function draw(p: Project, scenes: Scene[], frames: number[], outW: number, outH: number, crop?: { x: number; y: number; w: number; h: number }) {
  const c = compositor();
  c.resize(p.width, p.height);
  const byKey = new Map(scenes.map((s) => [s.key, s]));
  const sources = (l: Layer): SourceImage | null => {
    if (l.source.kind === "text") return rasterizeText(l.source.clip, p.width, p.height);
    if (l.source.kind !== "image") return null;
    const sc = byKey.get(l.source.assetId);
    return sc ? { image: sc.image, width: sc.width, height: sc.height, rotation: 0, key: sc.key } : null;
  };
  const strip = new OffscreenCanvas(outW * frames.length, outH);
  const g = strip.getContext("2d")!;
  g.fillStyle = p.background;
  g.fillRect(0, 0, strip.width, outH);
  const r = crop ?? { x: 0, y: 0, w: p.width, h: p.height };
  frames.forEach((f, i) => {
    c.render(planFrame(p, f), sources, p.background);
    // Copy only the part of the crop that lies inside the frame.
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(p.width, r.x + r.w);
    const y1 = Math.min(p.height, r.y + r.h);
    const k = outW / r.w;
    g.drawImage(c.canvas, x0, y0, x1 - x0, y1 - y0, i * outW + (x0 - r.x) * k, (y0 - r.y) * k, (x1 - x0) * k, (y1 - y0) * k);
  });
  return strip;
}

async function toUrl(c: OffscreenCanvas): Promise<string> {
  return URL.createObjectURL(await c.convertToBlob({ type: "image/jpeg", quality: 0.86 }));
}

/** Decode before handing a sprite to CSS, so the first hover frame is not blank. */
async function decoded(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => undefined);
  return url;
}

const SQUARE = 176;

/** The frames a card's still and its hover loop show. */
interface Plan {
  p: Project;
  scenes: Scene[];
  still: number;
  motion: number[];
  seconds: number;
  out: [number, number];
  crop?: { x: number; y: number; w: number; h: number };
}

async function planFor(spec: PreviewSpec, outW: number, outH: number): Promise<Plan> {
  if (spec.kind === "text") return textPlan(spec, outW, outH, spec.scene ? await sceneA() : null);
  const a = await sceneA();
  const w = outW;
  const h = outH;
  const range = (from: number, to: number, n: number) => Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * i) / (n - 1)));
  if (spec.kind === "filter") {
    const clip = { ...sceneClip(a, 0, 30, w, h), filter: { type: spec.type, intensity: 1 } };
    return { p: project(w, h, [a], [[clip]]), scenes: [a], still: 0, motion: [], seconds: 0, out: [w, h] };
  }
  if (spec.kind === "effect") {
    const clip = { ...sceneClip(a, 0, 60, w, h), effects: [{ id: "fx", type: spec.type, enabled: true, params: effectDefaults(spec.type) }] };
    return { p: project(w, h, [a], [[clip]]), scenes: [a], still: 15, motion: range(0, 45, 16), seconds: 1.6, out: [w, h] };
  }
  // Transition: the A shot cuts to the night shot at frame 30, 1 s long.
  const b = nightScene();
  const from = { ...sceneClip(a, 0, 30, w, h), transitionOut: { type: spec.type, duration: 30 } };
  const to = sceneClip(b, 30, 30, w, h);
  return {
    p: project(w, h, [a, b], [[from, to]]),
    scenes: [a, b],
    // A bit before the midpoint: dips are not yet solid and wipes show both sides.
    still: 25,
    motion: [10, 10, ...range(15, 44, 15), 52, 52, 52],
    seconds: 1.5,
    out: [w, h],
  };
}

/** Text: lay the clips out on a 16:9 frame, then crop to their settled ink
 * (padded, in the card's shape) at a resolution where the crop is about the
 * card's size, so small titles stay legible and large ones stay sharp. */
function textPlan(spec: Extract<PreviewSpec, { kind: "text" }>, outW: number, outH: number, scene: Scene | null): Plan {
  const settle = settledFrame(spec.clips);
  // Measure at a nominal size, then pick the render size from the result.
  const box = inkBox(spec.clips, 960, 540, settle);
  const pad = Math.max(box.w, box.h) * 0.12 + 12;
  let cw = box.w + pad * 2;
  let ch = box.h + pad * 2;
  if (cw / ch > outW / outH) ch = (cw * outH) / outW;
  else cw = (ch * outW) / outH;
  // Never show past the frame's edges: shrink to fit, then slide inside.
  const fit = Math.min(1, 960 / cw, 540 / ch);
  cw *= fit;
  ch *= fit;
  const cx = Math.min(Math.max(box.x + box.w / 2 - cw / 2, 0), 960 - cw);
  const cy = Math.min(Math.max(box.y + box.h / 2 - ch / 2, 0), 540 - ch);
  // Capped: six framebuffers at this size, so never past 1920 x 1080.
  const k = Math.min(2, Math.max(0.25, outW / cw));
  const W = Math.round(960 * k);
  const H = Math.round(540 * k);
  const crop = { x: cx * k, y: cy * k, w: cw * k, h: ch * k };
  const end = Math.max(...spec.clips.map((c) => c.start + c.duration));
  const tracks: Clip[][] = scene ? [[sceneClip(scene, 0, end, W, H)]] : [];
  for (const c of spec.clips) tracks.push([c]);
  const span = Math.min(end - 1, settle + 14);
  const n = 18;
  // Word art has no motion: no hover loop to render.
  const moves = spec.clips.some((c) => "transform" in c && (c.animIn || c.animOut || c.animLoop));
  const motion = moves ? Array.from({ length: n }, (_, i) => Math.round((span * i) / (n - 1))) : [];
  return {
    p: project(W, H, scene ? [scene] : [], tracks, scene ? "#000000" : PLAIN),
    scenes: scene ? [scene] : [],
    still: Math.min(settle, end - 1),
    motion: moves ? [...motion, span, span, span] : [],
    seconds: (n + 3) / 15,
    out: [outW, outH],
    crop,
  };
}

/** The first frame where the opening layers have finished animating in. */
function settledFrame(clips: Clip[]): number {
  const firstEnd = Math.min(...clips.map((c) => c.start + c.duration));
  let f = 0;
  for (const c of clips) {
    if (c.start >= firstEnd || !("transform" in c)) continue;
    f = Math.max(f, c.start + (c.animIn?.duration ?? 0) + 2);
  }
  const outs = clips.filter((c) => "transform" in c && c.animOut && c.start < firstEnd).map((c) => c.start + c.duration - (c as VisualClip).animOut!.duration - 1);
  return Math.max(0, Math.min(f, ...outs, firstEnd - 1));
}

/** Bounding box (pixels at w x h) of the clips' settled layout. */
function inkBox(clips: Clip[], w: number, h: number, f: number) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of clips) {
    if (!("transform" in c) || c.start > f) continue;
    const t = c.transform;
    let bw: number;
    let bh: number;
    if (c.type === "text") {
      const r = rasterizeText(c, w, h);
      bw = r.width * t.scale;
      bh = r.height * (t.scaleY ?? t.scale);
    } else {
      bw = w * t.scale * (1 - c.crop.left - c.crop.right);
      bh = h * (t.scaleY ?? t.scale) * (1 - c.crop.top - c.crop.bottom);
    }
    const cx = w / 2 + t.x * w;
    const cy = h / 2 + t.y * h;
    x0 = Math.min(x0, cx - bw / 2);
    y0 = Math.min(y0, cy - bh / 2);
    x1 = Math.max(x1, cx + bw / 2);
    y1 = Math.max(y1, cy + bh / 2);
  }
  if (x1 < x0) return { x: 0, y: 0, w, h };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const specKey = (s: PreviewSpec) => (s.kind === "text" ? `text:${s.id}` : `${s.kind}:${s.type}`);
const usesScene = (s: PreviewSpec) => s.kind !== "text" || s.scene;

/** The cache key for a card in the current scene; changes when the scene does. */
export function previewKey(spec: PreviewSpec, shape: "square" | "wide") {
  return `${specKey(spec)}:${shape}${usesScene(spec) ? `@${sceneKey}` : ""}`;
}

const dims = (shape: "square" | "wide"): [number, number] => (shape === "square" ? [SQUARE, SQUARE] : [288, 180]);

/** The card's still, as a JPEG blob URL; null when the card left the screen
 * before its turn. */
export function previewStill(spec: PreviewSpec, shape: "square" | "wide", alive: () => boolean): Promise<string | null> {
  watch();
  return cached(`${previewKey(spec, shape)}:still`, () =>
    schedule(alive, async () => {
      const [w, h] = dims(shape);
      const plan = await planFor(spec, w, h);
      return toUrl(draw(plan.p, plan.scenes, [plan.still], ...plan.out, plan.crop));
    }),
  );
}

/** The card's hover loop as a sprite strip; null for cards with no motion. */
export function previewMotion(spec: PreviewSpec, shape: "square" | "wide", alive: () => boolean): Promise<PreviewMotion | null> {
  if (spec.kind === "filter") return Promise.resolve(null);
  watch();
  return cached(`${previewKey(spec, shape)}:motion`, () =>
    schedule(
      alive,
      async () => {
        const [w, h] = dims(shape);
        const plan = await planFor(spec, w, h);
        if (!plan.motion.length) return null;
        const sprite = await decoded(await toUrl(draw(plan.p, plan.scenes, plan.motion, ...plan.out, plan.crop)));
        return { sprite, frames: plan.motion.length, seconds: plan.seconds };
      },
      true,
    ),
  );
}
