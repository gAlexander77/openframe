// Epic edits: the music-synced montage (hype, velocity and AMV edits) an
// agent can make in a handful of calls. Cut a list of shots to the beat,
// put short hits (flash, shake, zoom punch, RGB split, glow) on beats or
// cuts, add bars for a cinematic frame, ramp a shot's speed so its slow
// (or fast) moment lands on a beat, and fit the music to the picture with
// its drop where it belongs. Pure Project -> Project functions; the
// commands in commands.ts (cut_to_beats, add_beat_hits, add_cinematic_bars,
// set_speed_ramp, fit_music) name them, so agents, the UI and the tests
// share one behavior. Times in options are timeline SECONDS, like every
// command's; the results are whole frames.

import { effectDefaults } from "./catalog";
import { clipForAsset, createAdjustmentClip, createTrack, uid } from "./project/defaults";
import * as ops from "./project/ops";
import type { AdjustmentClip, AudioClip, Clip, Effect, Id, Keyframe, Project, SpeedPoint, Track, VideoClip } from "./project/types";
import { CURVE_MAX, CURVE_MIN, PRESETS, type NormPoint } from "./speed";
import { framesToSeconds, secondsToFrames } from "./time";
import type { SectionLabel } from "./analysis/beats";

export class EpicError extends Error {}

// ---- the beat grid, as markers ----------------------------------------------------

/** The markers analyze_music (and mark_beats) leave, by kind. */
export const MUSIC_MARKERS = {
  beats: { label: "Beat", color: "#f5c543" },
  bars: { label: "Bar", color: "#ff9f43" },
  phrases: { label: "Phrase", color: "#ff5c7a" },
  sections: { label: "", color: "#b48cff" },
  drop: { label: "Drop", color: "#ff2d55" },
} as const;

export type MusicMarkerKind = keyof typeof MUSIC_MARKERS;

export const SECTION_NAMES: Record<SectionLabel, string> = { intro: "Intro", verse: "Verse", build: "Build", drop: "Drop", breakdown: "Breakdown", outro: "Outro" };

/** Labels that mark the music itself, so they move when the music does. */
const MUSIC_LABELS = new Set<string>([...Object.values(MUSIC_MARKERS).map((m) => m.label), ...Object.values(SECTION_NAMES)].filter(Boolean));

export type Grid = "beats" | "bars" | "downbeats" | "phrases";

const GRID_LABEL: Record<Grid, string> = { beats: "Beat", bars: "Bar", downbeats: "Bar", phrases: "Phrase" };

/** Grid frames, sorted and distinct: explicit times, or the markers of a
 * grid (Beat, Bar or Phrase) or a label. */
export function gridFrames(p: Project, o: { beats?: number[]; grid?: Grid; marker_label?: string }): number[] {
  const label = o.marker_label ?? GRID_LABEL[o.grid ?? "beats"];
  const frames = o.beats ? o.beats.map((t) => secondsToFrames(t, p.fps)) : p.markers.filter((m) => m.label === label).map((m) => m.frame);
  const out = [...new Set(frames)].filter((f) => f >= 0).sort((a, b) => a - b);
  if (!out.length) {
    if (o.beats) throw new EpicError("beats is empty");
    const how = label === "Beat" ? "run mark_beats or analyze_music on the music first" : label === "Bar" || label === "Phrase" ? `run analyze_music with markers ["${label === "Bar" ? "bars" : "phrases"}"] first` : "add them first";
    throw new EpicError(`there are no ${label} markers: ${how}, or pass beats (timeline seconds)`);
  }
  return out;
}

// ---- tracks for effects -------------------------------------------------------------

const isSticker = (p: Project, c: Clip) => c.type === "image" && !!ops.getAsset(p, c.assetId)?.sticker;

/** A track of adjustment layers only (hits, bars, grades): new titles and
 * media do not land on one (commands.ts landingTrack). */
export const isEffectTrack = (t: Track) => t.kind === "video" && t.clips.length > 0 && t.clips.every((c) => c.type === "adjustment");

/** Where a new effect track goes: above the topmost video track holding
 * what `covers` says the layer must cover, else just above the main track. */
function effectTrackIndex(p: Project, covers: (c: Clip) => boolean): number {
  const i = p.tracks.findIndex((t) => t.kind === "video" && t.clips.some(covers));
  return i >= 0 ? i : p.tracks.findIndex((t) => t.main);
}

/** The first unlocked track named `name...` holding only adjustment layers
 * that has room for every range, else a new one inserted at `index`. */
function effectTrack(p: Project, name: string, ranges: [number, number][], index: () => number): [Project, Id] {
  const free = p.tracks.find((t) => t.kind === "video" && !t.main && !t.locked && t.name.startsWith(name) && t.clips.every((c) => c.type === "adjustment") && ranges.every(([s, e]) => ops.rangeFree(t, s, e - s)));
  if (free) return [p, free.id];
  const n = p.tracks.filter((t) => t.name.startsWith(name)).length;
  const track = createTrack("video", n ? `${name} ${n + 1}` : name);
  return [ops.addTrack(p, track, index()), track.id];
}

/** Last frame of the picture: the end of the last clip on a video track
 * that is not an adjustment layer (bars and hits follow the picture). */
export function pictureEnd(p: Project, except?: Id): number {
  let end = 0;
  for (const t of p.tracks) if (t.kind === "video") for (const c of t.clips) if (c.type !== "adjustment" && c.id !== except) end = Math.max(end, ops.clipEnd(c));
  return end;
}

// ---- cut to the beat ------------------------------------------------------------------

export interface Shot {
  asset_id: string;
  /** Source seconds the shot starts at; default where the last shot of the
   * same media ended (0 for its first). */
  in?: number;
  /** Grid steps this shot lasts, overriding pattern and every. */
  beats?: number;
}

export interface CutToBeats {
  media: Shot[];
  beats?: number[];
  grid?: Grid;
  marker_label?: string;
  every?: number;
  pattern?: number[];
  start?: number;
  end?: number;
  track_id?: string;
  mute?: boolean;
}

/**
 * Lay shots end to end on the main track (or `track_id`) so that every cut
 * lands on the grid: shot k lasts its steps of the grid (beats, bars or
 * phrases) from where the one before ended. The first shot starts at
 * `start`; if no grid point is there, the first one after it counts as the
 * grid's first beat, so a song's pickup or intro stays inside shot one.
 * A shot whose media is too short ends on the last grid point it can fill
 * (slowed to fill one step if it cannot fill even that); a source window
 * past the media's end slides back inside it. Stops when the shots or the
 * grid run out, or at `end`.
 */
export function cutToBeats(p: Project, o: CutToBeats): Project {
  const fps = p.fps;
  const grid = gridFrames(p, o);
  const start = secondsToFrames(o.start ?? 0, fps);
  const end = o.end === undefined ? Infinity : secondsToFrames(o.end, fps);
  const q = grid.filter((g) => g >= start - 1 && g <= end);
  const track = o.track_id === undefined ? ops.mainTrack(p) : ops.findTrack(p, o.track_id);
  if (!track) throw new EpicError(`no track with id ${o.track_id}`);
  if (track.kind !== "video") throw new EpicError("shots go on a video track");
  if (track.locked) throw new EpicError(`track ${track.name} is locked`);
  if (!o.media.length) throw new EpicError("media is empty: list the shots, e.g. [{asset_id: \"a_1\"}, {asset_id: \"a_2\", in: 3}]");
  const every = o.every ?? (o.grid && o.grid !== "beats" ? 1 : 2);
  const steps = (k: number, s: Shot) => Math.max(1, Math.round(s.beats ?? (o.pattern?.length ? o.pattern[k % o.pattern.length] : every)));
  const nextIn = new Map<Id, number>();
  let at = start;
  let idx = 0;
  let placed = 0;
  for (const [k, shot] of o.media.entries()) {
    const asset = ops.getAsset(p, shot.asset_id);
    if (!asset) throw new EpicError(`no media with id ${shot.asset_id}`);
    if (asset.kind === "audio") throw new EpicError(`${asset.name} is audio: shots are video or pictures`);
    // The lowest grid point that can end this shot.
    const lowest = idx < q.length && q[idx] > at ? idx : idx + 1;
    if (lowest >= q.length) break;
    let j = Math.max(lowest, Math.min(idx + steps(k, shot), q.length - 1));
    let source = shot.in ?? nextIn.get(asset.id) ?? 0;
    let speed = 1;
    const seconds = (to: number) => framesToSeconds(q[to] - at, fps);
    if (asset.kind === "video" && asset.duration > 0) {
      const d = asset.duration;
      while (j > lowest && seconds(j) > d + 1e-9) j--;
      const need = seconds(j);
      if (need > d) [speed, source] = [Math.max(0.05, d / need), 0];
      else source = Math.min(Math.max(0, source), d - need);
    }
    const len = q[j] - at;
    let clip = clipForAsset(asset, at, fps);
    clip = { ...clip, duration: len } as Clip;
    if (clip.type === "video") clip = { ...clip, in: source, speed, muted: o.mute !== false } as VideoClip;
    p = ops.addClip(p, track.id, clip, "overwrite");
    nextIn.set(asset.id, source + framesToSeconds(len, fps) * speed);
    at = q[j];
    idx = j;
    placed++;
  }
  if (!placed) throw new EpicError(`no grid point after ${framesToSeconds(start, fps).toFixed(2)} s${o.end !== undefined ? ` and before ${o.end} s` : ""}`);
  return p;
}

// ---- hits on the beat ------------------------------------------------------------------

/** Each hit's look at intensity 1, and how long it lasts by default. */
export const HIT_KINDS = {
  flash: { label: "Flash", seconds: 0.2 },
  zoom: { label: "Zoom punch", seconds: 0.25 },
  shake: { label: "Shake", seconds: 0.35 },
  rgbSplit: { label: "RGB split", seconds: 0.25 },
  glow: { label: "Glow", seconds: 0.35 },
  zoomBlur: { label: "Zoom blur", seconds: 0.2 },
} as const;

export type HitKind = keyof typeof HIT_KINDS;

/** WCAG 2.3.1 (Three Flashes): no more than three flashes in any second. */
export const MAX_FLASHES_PER_SECOND = 3;

export interface BeatHits {
  effects: HitKind[];
  times?: number[];
  at_cuts?: boolean;
  marker_label?: string;
  every?: number;
  from?: number;
  to?: number;
  duration?: number;
  intensity?: number;
}

/** The effects of one hit and their keyframes: each starts at its peak on
 * the beat and eases out to nothing by the hit's end. */
function hitLayer(kinds: HitKind[], start: number, len: number, k: number): AdjustmentClip {
  const clip = createAdjustmentClip(start, len);
  const keys: Record<string, Keyframe[]> = {};
  const decay = (path: string, peak: number) => (keys[path] = [{ f: 0, v: +peak.toFixed(3), ease: "easeOut" }, { f: len, v: 0 }]);
  const effects: Effect[] = [];
  const fx = (type: string, params: Record<string, number>, animate: string, peak: number) => {
    const e: Effect = { id: uid("fx"), type, enabled: true, params: { ...effectDefaults(type), ...params, [animate]: 0 } };
    effects.push(e);
    decay(`effects.${e.id}.${animate}`, peak);
  };
  for (const kind of kinds) {
    if (kind === "flash") {
      // Blown out to near white: exposure x4, lifted, whites opened.
      decay("adjust.exposure", 100 * k);
      decay("adjust.brightness", 100 * k);
      decay("adjust.whites", -100 * k);
    } else if (kind === "zoom") fx("zoom", {}, "amount", 25 * k);
    else if (kind === "shake") fx("shake", { speed: 70 }, "amount", 80 * k);
    else if (kind === "rgbSplit") fx("rgbSplit", { angle: 0 }, "amount", 60 * k);
    else if (kind === "glow") fx("glow", { threshold: 50 }, "amount", 80 * k);
    else if (kind === "zoomBlur") fx("zoomBlur", {}, "amount", 60 * k);
  }
  return { ...clip, name: `Hit: ${kinds.map((x) => HIT_KINDS[x].label).join(" + ")}`, effects, keyframes: keys };
}

/** Frames of the flash hits already in the project. */
const flashFrames = (p: Project) => p.tracks.flatMap((t) => t.clips.filter((c) => c.type === "adjustment" && c.name?.startsWith("Hit:") && c.name.includes("Flash")).map((c) => c.start));

/** Would adding a flash at `f` put more than three in some second? */
function tooManyFlashes(taken: number[], f: number, perSecond: number): boolean {
  const all = [...taken, f].sort((a, b) => a - b);
  for (let i = 0; i + MAX_FLASHES_PER_SECOND < all.length; i++) if (all[i + MAX_FLASHES_PER_SECOND] - all[i] < perSecond) return true;
  return false;
}

/**
 * Short hits on the beat as adjustment layers on one Hits track (above the
 * footage, below bars and titles): each starts at its peak on the beat and
 * eases out, keyframed, so preview and export match. Times are `times`,
 * the main track's cuts (`at_cuts`), or the Beat markers (`marker_label`),
 * kept between `from` and `to` and thinned to every Nth. Flashes keep to
 * at most three a second: a beat that would break that loses its flash.
 */
export function addBeatHits(p: Project, o: BeatHits): Project {
  const fps = p.fps;
  const kinds = [...new Set(o.effects)];
  if (!kinds.length) throw new EpicError("give effect or effects, e.g. \"zoom\" or [\"flash\", \"zoom\"]");
  for (const k of kinds) if (!(k in HIT_KINDS)) throw new EpicError(`no hit named ${k}; hits are ${Object.keys(HIT_KINDS).join(", ")}`);
  let frames: number[];
  if (o.times) frames = o.times.map((t) => secondsToFrames(t, fps));
  else if (o.at_cuts) {
    const main = ops.mainTrack(p).clips;
    frames = main.slice(1).filter((c, i) => c.start === ops.clipEnd(main[i])).map((c) => c.start);
    if (!frames.length) throw new EpicError("the main track has no cuts yet: cut_to_beats first");
  } else frames = gridFrames(p, { marker_label: o.marker_label ?? "Beat" });
  const from = o.from === undefined ? -Infinity : secondsToFrames(o.from, fps);
  const to = o.to === undefined ? Infinity : secondsToFrames(o.to, fps);
  const every = Math.max(1, Math.round(o.every ?? 1));
  frames = [...new Set(frames)].filter((f) => f >= from && f < to && f >= 0).sort((a, b) => a - b).filter((_, i) => i % every === 0);
  if (!frames.length) throw new EpicError("no hit times in that range");
  const k = Math.min(1, Math.max(0, o.intensity ?? 1));
  const dur = Math.max(2, secondsToFrames(o.duration ?? Math.max(...kinds.map((x) => HIT_KINDS[x].seconds)), fps));
  const perSecond = fps.num / fps.den;
  const flashes = flashFrames(p);
  const hits: { start: number; len: number; kinds: HitKind[] }[] = [];
  for (const [i, f] of frames.entries()) {
    let these = kinds;
    if (kinds.includes("flash")) {
      if (tooManyFlashes(flashes, f, perSecond)) these = kinds.filter((x) => x !== "flash");
      else flashes.push(f);
    }
    if (!these.length) continue;
    const next = frames[i + 1] ?? Infinity;
    hits.push({ start: f, len: Math.max(1, Math.min(dur, next - f)), kinds: these });
  }
  const covers = (c: Clip) => c.type === "video" || c.type === "compound" || c.type === "color" || (c.type === "image" && !isSticker(p, c));
  const [q, trackId] = effectTrack(p, "Hits", hits.map((h) => [h.start, h.start + h.len]), () => effectTrackIndex(p, covers));
  return hits.reduce((r, h) => ops.addClip(r, trackId, hitLayer(h.kinds, h.start, h.len, k)), q);
}

// ---- cinematic bars ----------------------------------------------------------------------

export interface CinematicBars {
  ratio?: number;
  start?: number;
  end?: number;
  animate_in?: number;
  animate_out?: number;
}

/**
 * Letterbox the picture to `ratio` (width over height; pillarbox when the
 * canvas is already wider) with the letterbox effect on an adjustment
 * layer on a Bars track above the footage and hits, below titles, so
 * every canvas shape works and titles stay readable. From `start` to the
 * picture's end by default; the bars can slide in and out. A second call
 * over the same time replaces them.
 */
export function addCinematicBars(p: Project, o: CinematicBars): Project {
  const fps = p.fps;
  const start = secondsToFrames(o.start ?? 0, fps);
  const end = o.end === undefined ? pictureEnd(p) : secondsToFrames(o.end, fps);
  if (end <= start) throw new EpicError(o.end === undefined ? "there is no picture after start to put bars on: give end" : "end must come after start");
  const len = end - start;
  const fx: Effect = { id: uid("fx"), type: "letterbox", enabled: true, params: { ...effectDefaults("letterbox"), ratio: o.ratio ?? 2.39, amount: 100 } };
  const path = `effects.${fx.id}.amount`;
  const nIn = Math.min(Math.floor(len / 2), secondsToFrames(o.animate_in ?? 0, fps));
  const nOut = Math.min(Math.floor(len / 2), secondsToFrames(o.animate_out ?? 0, fps));
  const keys: Keyframe[] = [];
  if (nIn > 0) keys.push({ f: 0, v: 0, ease: "easeInOut" }, { f: nIn, v: 100 });
  if (nOut > 0) keys.push({ f: len - nOut, v: 100, ease: "easeInOut" }, { f: len, v: 0 });
  else if (keys.length) keys.push({ f: len, v: 100 });
  const clip: AdjustmentClip = { ...createAdjustmentClip(start, len), name: "Cinematic bars", effects: [fx], ...(keys.length ? { keyframes: { [path]: keys } } : {}) };
  const covers = (c: Clip) => c.type !== "text" && !isSticker(p, c);
  const bars = p.tracks.find((t) => t.kind === "video" && !t.locked && t.name.startsWith("Bars") && t.clips.every((c) => c.type === "adjustment"));
  if (bars) return ops.addClip(p, bars.id, clip, "overwrite");
  const [q, trackId] = effectTrack(p, "Bars", [[start, end]], () => effectTrackIndex(p, covers));
  return ops.addClip(q, trackId, clip);
}

// ---- speed ramp on the beat -------------------------------------------------------------

export interface SpeedRamp {
  clip_id: string;
  at?: number;
  moment?: "slow" | "fast";
  speed?: number;
  base?: number;
  hold?: number;
  ease?: number;
  preset?: string;
}

/** The ramp's speed at clip frame x: `base`, easing (exponentially) to
 * `speed` over `e` frames up to the beat at u, held `h` frames, easing
 * back over `e`. */
function rampAt(x: number, u: number, e: number, h: number, base: number, speed: number): number {
  if (x <= u - e) return base;
  if (x < u) return base * (speed / base) ** ((x - (u - e)) / e);
  if (x <= u + h) return speed;
  if (x < u + h + e) return speed * (base / speed) ** ((x - (u + h)) / e);
  return base;
}

/** A preset's points moved so its slowest (or fastest) point lands at
 * fraction u of the clip; the parts before and after stretch to fit. */
export function alignPreset(points: NormPoint[], u: number, moment: "slow" | "fast"): NormPoint[] {
  const pick = moment === "slow" ? Math.min(...points.map((x) => x.speed)) : Math.max(...points.map((x) => x.speed));
  const te = points.find((x) => x.speed === pick)!.t;
  const map = (t: number) => (t <= te ? (te > 0 ? (t * u) / te : u) : u + ((t - te) * (1 - u)) / (1 - te));
  const out = points.map((x) => ({ t: map(x.t), speed: x.speed }));
  if (out[0].t > 0) out.unshift({ t: 0, speed: out[0].speed });
  if (out[out.length - 1].t < 1) out.push({ t: 1, speed: out[out.length - 1].speed });
  return out;
}

/**
 * Velocity edit: ramp a video or audio clip's speed so its slow (or fast)
 * moment lands exactly on a beat, keeping the clip's start and length so
 * cuts made on the beat stay there; the source the ramp reads changes
 * instead (the in-point moves earlier if the media would run out, and the
 * speeds scale down if the media is shorter than the ramp needs).
 */
export function setSpeedRamp(p: Project, o: SpeedRamp): Project {
  const fps = p.fps;
  const loc = ops.findClip(p, o.clip_id);
  if (!loc) throw new EpicError(`no clip with id ${o.clip_id}`);
  const c = loc.clip;
  if (c.type !== "video" && c.type !== "audio") throw new EpicError(`${c.type} clips have no speed to ramp`);
  if (c.freeze || c.reverse) throw new EpicError("a reversed or frozen clip cannot be ramped; set_reverse false first");
  if (loc.track.locked) throw new EpicError(`track ${loc.track.name} is locked`);
  const L = c.duration;
  let u: number;
  if (o.at !== undefined) u = secondsToFrames(o.at, fps) - c.start;
  else {
    const inside = p.markers.filter((m) => m.label === "Beat" && m.frame > c.start && m.frame < ops.clipEnd(c)).map((m) => m.frame - c.start);
    if (!inside.length) throw new EpicError("no Beat marker inside the clip: give at (timeline seconds)");
    u = inside.reduce((b, x) => (Math.abs(x - L / 2) < Math.abs(b - L / 2) ? x : b));
  }
  if (u < 0 || u >= L) throw new EpicError(`at must fall inside the clip (${framesToSeconds(c.start, fps).toFixed(3)} to ${framesToSeconds(ops.clipEnd(c), fps).toFixed(3)} s)`);
  const moment = o.moment ?? "slow";
  let points: SpeedPoint[];
  let preset = "custom";
  if (o.preset !== undefined) {
    const def = PRESETS[o.preset];
    if (!def || o.preset === "custom") throw new EpicError(`no ramp preset ${o.preset}; presets are ${Object.keys(PRESETS).filter((k) => k !== "custom").join(", ")}`);
    points = alignPreset(def.points, u / L, moment).map((x) => ({ f: x.t * L, speed: x.speed }));
    preset = o.preset;
  } else {
    const speed = o.speed ?? (moment === "slow" ? 0.3 : 3);
    const base = o.base ?? (moment === "slow" ? 2 : 1);
    const e = Math.max(1, secondsToFrames(o.ease ?? 0.12, fps));
    const h = Math.max(0, secondsToFrames(o.hold ?? 0.25, fps));
    const at = [0, u - e, u, u + h, u + h + e, L].map((x) => Math.min(L, Math.max(0, x)));
    points = [...new Set(at)].sort((a, b) => a - b).map((x) => ({ f: x, speed: rampAt(x, u, e, h, base, speed) }));
  }
  const clamp = (s: number) => Math.min(CURVE_MAX, Math.max(CURVE_MIN, s));
  points = points.map((x) => ({ ...x, speed: clamp(x.speed) }));
  const media = ops.getAsset(p, c.assetId);
  const d = media && media.duration > 0 ? media.duration : Infinity;
  const read = (pts: SpeedPoint[]) => ops.sourceOffset({ ...c, speedCurve: { points: pts } }, L, fps);
  let need = read(points);
  if (need > d) {
    const k = (d / need) * 0.999;
    points = points.map((x) => ({ ...x, speed: clamp(x.speed * k) }));
    need = read(points);
    if (need > d + 1e-6) throw new EpicError(`${media!.name} is too short for this ramp over ${framesToSeconds(L, fps).toFixed(2)} s; shorten the clip or lower base`);
  }
  const source = Math.max(0, Math.min(c.in, d - need));
  return ops.updateClip(p, c.id, (x) => ({ ...x, in: source, speedCurve: { preset, points } }) as Clip);
}

// ---- fit the music --------------------------------------------------------------------------

export interface FitMusic {
  clip_id: string;
  end?: "video" | "beat" | "bar";
  end_at?: number;
  fade_out?: number;
  fade_in?: number;
  drop?: number;
  drop_at?: number;
  trim_picture?: boolean;
}

/** A timed clip with its first `d` frames cut off (content stays put). */
function cutHead(c: VideoClip | AudioClip, d: number, fps: Project["fps"]): VideoClip | AudioClip {
  return { ...c, start: c.start + d, duration: c.duration - d, in: c.in + ops.sourceOffset(c, d, fps), keyframes: ops.shiftKeys(c.keyframes, -d) };
}

/**
 * Fit a music clip to the cut: with `drop_at`, slide it so its drop (the
 * timeline second `drop`, by default the Drop marker on it) plays at
 * `drop_at`, cutting off what would fall before 0 and moving its beat
 * markers along; then end it with the picture (`end` video), on the last
 * Beat or Bar marker before the picture ends, or at `end_at`, fading out
 * over `fade_out` seconds. trim_picture cuts the picture at the music's
 * new end, so both stop together.
 */
export function fitMusic(p: Project, o: FitMusic): Project {
  const fps = p.fps;
  const loc = ops.findClip(p, o.clip_id);
  if (!loc) throw new EpicError(`no clip with id ${o.clip_id}`);
  let c = loc.clip;
  if (c.type !== "audio" && c.type !== "video") throw new EpicError(`${c.type} clips have no sound to fit`);
  if (c.speedCurve || c.reverse || c.freeze) throw new EpicError("fit_music needs the music at a constant speed, forward");
  if (loc.track.locked) throw new EpicError(`track ${loc.track.name} is locked`);
  const trackId = loc.track.id;
  if (o.drop_at !== undefined) {
    let drop: number;
    if (o.drop !== undefined) drop = secondsToFrames(o.drop, fps);
    else {
      const m = p.markers.find((x) => x.label === "Drop" && x.frame >= c.start && x.frame < ops.clipEnd(c));
      if (!m) throw new EpicError("no Drop marker on the music: give drop (timeline seconds where the drop plays now, from analyze_music), or run analyze_music with markers [\"drop\"]");
      drop = m.frame;
    }
    const shift = secondsToFrames(o.drop_at, fps) - drop;
    if (shift) {
      const [from, to] = [c.start, ops.clipEnd(c)];
      let moved = { ...c, start: c.start + shift } as VideoClip | AudioClip;
      if (moved.start < 0) moved = cutHead(moved, -moved.start, fps);
      if (moved.duration < 1) throw new EpicError("the drop would land before the music starts");
      p = { ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, clips: t.clips.filter((x) => x.id !== c.id) } : t)) };
      p = ops.addClip(p, trackId, moved, "overwrite");
      p = { ...p, markers: p.markers.map((m) => (MUSIC_LABELS.has(m.label) && m.frame >= from && m.frame < to ? { ...m, frame: m.frame + shift } : m)).filter((m) => m.frame >= 0).sort((a, b) => a.frame - b.frame) };
      c = moved;
    }
  }
  const picture = pictureEnd(p, c.id);
  let end: number;
  if (o.end_at !== undefined) end = secondsToFrames(o.end_at, fps);
  else if (o.end === "beat" || o.end === "bar") {
    const label = o.end === "beat" ? "Beat" : "Bar";
    const last = p.markers.filter((m) => m.label === label && m.frame > c.start && m.frame <= picture).pop();
    if (!last) throw new EpicError(`no ${label} marker between the music's start and the picture's end`);
    end = last.frame;
  } else {
    if (!picture) throw new EpicError("there is no picture to fit the music to");
    end = picture;
  }
  if (end <= c.start) throw new EpicError("the music would end before it starts");
  if (end < ops.clipEnd(c)) p = ops.updateClip(p, c.id, (x) => ({ ...x, duration: end - x.start }) as Clip);
  else if (end > ops.clipEnd(c)) p = ops.trimClip(p, c.id, "end", end);
  p = ops.updateClip(p, c.id, (x) => {
    const s = x as VideoClip | AudioClip;
    const fadeOut = Math.min(s.duration, secondsToFrames(o.fade_out ?? 1, fps));
    const fadeIn = o.fade_in === undefined ? s.fadeIn : Math.min(s.duration, secondsToFrames(o.fade_in, fps));
    return { ...s, fadeOut, fadeIn } as Clip;
  });
  if (o.trim_picture) {
    const stop = ops.clipEnd(ops.findClip(p, c.id)!.clip);
    p = {
      ...p,
      tracks: p.tracks.map((t) => {
        if (t.kind !== "video" || t.locked) return t;
        const clips = t.clips.filter((x) => x.start < stop).map((x) => {
          if (ops.clipEnd(x) < stop) return x;
          const { transitionOut: _, ...rest } = x as Clip & { transitionOut?: unknown };
          return { ...rest, duration: stop - x.start } as Clip;
        });
        return clips.length === t.clips.length && clips.every((x, i) => x === t.clips[i]) ? t : { ...t, clips };
      }),
    };
  }
  return p;
}
