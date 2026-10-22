// What happens when a library card (text preset, effect, filter,
// transition) is clicked or dropped. CapCut's rules: an effect or filter
// dropped on a clip attaches to that clip; dropped on empty timeline (or
// added with nothing selected) it becomes its own layer clip that affects
// everything below for its duration. A drop (`at` given) always acts where
// it lands, never on the selection, so it does what its preview shows.

import { crossfadeJoin, newCrossfade } from "../lib/crossfadeJoin";
import { edit } from "./actions";
import { prefsStore } from "./prefs";
import { player } from "../engine/player";
import { effectDefaults, FILTERS, TRANSITIONS } from "../lib/catalog";
import { createAdjustmentClip, createColorClip, createTextClip, createTrack, uid } from "../lib/project/defaults";
import * as ops from "../lib/project/ops";
import { animationSpan, placeOnTop, revealSpan } from "../lib/overlays";
import type { Clip, Id, Project, TextClip, TextStyle } from "../lib/project/types";
import { addTemplate, TEXT_TEMPLATES, wordArtStyle } from "../lib/templates";
import { framesToSeconds, secondsToFrames, type Rational } from "../lib/time";
import { titleWrap } from "../lib/ads";
import { footageUnder, underPoint } from "../lib/anchors";
import { runCommand } from "../lib/commands";
import { store } from "./store";
import { toast } from "./toast";

export interface TextPreset {
  label: string;
  text: string;
  style: Partial<TextStyle>;
  y?: number;
  anim?: string;
}

export const TEXT_PRESETS: Record<string, TextPreset> = {
  default: { label: "Default text", text: "Default text", style: {} },
  title: { label: "Title", text: "Your title", style: { size: 150, bold: true, letterSpacing: 2 }, anim: "rise" },
  subtitle: {
    label: "Lower third",
    text: "Name Surname",
    style: { size: 64, bold: true, background: { color: "#000000cc", padding: 18, radius: 8 } },
    y: 0.32,
    anim: "slideRight",
  },
  outline: { label: "Outline", text: "OUTLINE", style: { size: 140, bold: true, color: "#ffffff", stroke: { color: "#000000", width: 8 } } },
  neon: { label: "Neon", text: "Neon glow", style: { size: 120, color: "#7df9ff", shadow: { color: "#00e5ff", blur: 28, x: 0, y: 0 } } },
  caption: {
    label: "Caption",
    text: "Words people say",
    style: { size: 70, bold: true, stroke: { color: "#000000", width: 6 } },
    y: 0.36,
  },
  quote: { label: "Quote", text: "“A line worth quoting”", style: { size: 84, italic: true, font: "Georgia" } },
  label: { label: "Label", text: "NEW", style: { size: 56, bold: true, color: "#111111", background: { color: "#ffd84d", padding: 14, radius: 999 } } },
};

const visualSelection = (p: Project): Clip[] =>
  store.get().selection
    .map((id) => ops.findClip(p, id)?.clip)
    .filter((c): c is Clip => !!c && c.type !== "audio");

/** Seconds a new title, effect, filter or adjustment layer lasts. */
export const layerSeconds = () => prefsStore.get().layerSeconds;
/** Seconds a new transition lasts (shorter when a clip beside it is). */
export const transitionSeconds = () => prefsStore.get().transitionSeconds;
export const audioCrossfadeSeconds = () => prefsStore.get().audioCrossfadeSeconds;

/** A new top video track (CapCut stacks the newest layer on top), under
 * the captions (ADR-121): an effect layer over them would blur them too. */
function topTrack(p: Project, name: string): [Project, Id] {
  const t = createTrack("video", name);
  return [ops.addTrack(p, t), t.id];
}

/** The clip a preset adds; the library card's preview renders this same
 * clip. On a canvas, its lines wrap inside the canvas's title-safe area
 * (on 9:16, the apps' column; titleWrap). */
export function presetClip(preset: TextPreset, start: number, fps: Rational, canvas?: { width: number; height: number }): Clip {
  const style = canvas && preset.style.maxWidth === undefined ? { ...preset.style, maxWidth: titleWrap(canvas, 0) } : preset.style;
  const clip = createTextClip(preset.text, start, secondsToFrames(layerSeconds(), fps), style);
  return {
    ...clip,
    transform: { ...clip.transform, y: preset.y ?? 0 },
    ...(preset.anim ? { animIn: { type: preset.anim, duration: secondsToFrames(0.5, fps) } } : {}),
  };
}

/** A text preset added at `at`, above whatever shows then, like stickers
 * and templates. Pure: the timeline's drop preview runs it too. */
export function placeTextPreset(p: Project, key: string, at: number): { project: Project; clipId: Id } | null {
  const preset = TEXT_PRESETS[key];
  if (!preset) return null;
  const clip = presetClip(preset, at, p.fps, p);
  return { project: placeOnTop(p, clip, "Text"), clipId: clip.id };
}

export function addTextPreset(key: string, at?: number) {
  const preset = TEXT_PRESETS[key];
  if (!preset) return;
  const f = at ?? store.get().playhead;
  let id = "";
  store.edit(`Add ${preset.label.toLowerCase()}`, (p0) => {
    const r = placeTextPreset(p0, key, f)!;
    id = r.clipId;
    return r.project;
  });
  store.select([id]);
  revealAdded([id]);
}

/**
 * UX-15: a title added at the playhead starts on the first frame of its In
 * animation, where nothing shows yet. Play the animation once, silently,
 * then restore the playhead; reduced motion skips the preview. Leaves playback, and
 * a playhead the clips already show at, alone.
 */
export function revealAdded(ids: Id[]) {
  const s = store.get();
  if (s.playing) return;
  const clips = ids.map((id) => ops.findClip(s.project, id)?.clip).filter((c): c is Clip => !!c);
  const span = revealSpan(clips, s.playhead);
  if (!span) return;
  if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  player.preview(span.from, span.to);
}

/**
 * CapCut's preview on pick: an animation chosen in the Animation tab plays
 * once in the viewer, silently, over the clip's In, Out or one loop cycle
 * (animationSpan), and stops where that ends. Playback, if any, gives way
 * to it, as to any transport command. With reduced motion nothing plays;
 * the playhead goes to where the clip shows settled.
 */
export function previewAnimation(id: Id, slot: "in" | "out" | "loop") {
  const clip = ops.findClip(store.get().project, id)?.clip;
  const span = clip && animationSpan(clip, slot);
  if (!span) return;
  if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) store.seek(slot === "out" ? span.from : span.to);
  else player.preview(span.from, span.to);
}

/** A word art or title template from the Text tab. Word art restyles text
 * when there is some to restyle — the text clip it was dropped on, or the
 * selected text clips on a click — as CapCut's text Effects do; otherwise
 * it, like every template, adds its clips at `at` (default: the playhead). */
export function applyTemplate(key: string, at?: number, clipId?: Id) {
  const t = TEXT_TEMPLATES[key];
  if (!t) return;
  const s = store.get();
  if (t.category === "Word art") {
    const ids = clipId ? [clipId] : at === undefined ? s.selection : [];
    const texts = ids.map((id) => ops.findClip(s.project, id)?.clip).filter((c): c is TextClip => c?.type === "text");
    if (texts.length) {
      store.edit(`${t.label} style`, (p) => texts.reduce((q, c) => ops.updateClip(q, c.id, (x) => (x.type === "text" ? { ...x, style: wordArtStyle(x.style, t) } : x)), p));
      return;
    }
  }
  let ids: Id[] = [];
  store.edit(`Add ${t.label.toLowerCase()}`, (p) => {
    const r = addTemplate(p, t, at ?? s.playhead);
    ids = r.clipIds;
    return r.project;
  });
  store.select(ids);
  revealAdded(ids);
}

/** The clips an effect or filter attaches to: `clipId` when it was dropped
 * on one, the selection on a click, none for a drop on empty timeline. */
const attachTargets = (p: Project, clipId?: Id, at?: number): Clip[] =>
  clipId ? [ops.findClip(p, clipId)?.clip].filter((c): c is Clip => !!c && c.type !== "audio") : at === undefined ? visualSelection(p) : [];

/** Attach an effect to `clipId`, or to the selection, or add it as a layer. */
export function applyEffect(type: string, clipId?: Id, at?: number) {
  const s = store.get();
  const targets = attachTargets(s.project, clipId, at);
  if (targets.length) {
    store.edit("Add effect", (p) => {
      for (const c of targets) {
        p = ops.updateClip(p, c.id, (x) =>
          "effects" in x ? ({ ...x, effects: [...x.effects, { id: uid("fx"), type, enabled: true, params: effectDefaults(type) }] } as Clip) : x,
        );
      }
      return p;
    });
    return;
  }
  const f = at ?? s.playhead;
  let id = "";
  store.edit("Add effect layer", (p0) => {
    const [p, tid] = topTrack(p0, "Effect");
    const clip = { ...createAdjustmentClip(f, secondsToFrames(layerSeconds(), p.fps)), effects: [{ id: uid("fx"), type, enabled: true, params: effectDefaults(type) }] };
    id = clip.id;
    return ops.addClip(p, tid, clip);
  });
  store.select([id]);
}

export function applyFilter(type: string, clipId?: Id, at?: number) {
  if (!FILTERS[type]) return;
  const s = store.get();
  const targets = attachTargets(s.project, clipId, at);
  if (targets.length) {
    store.edit("Apply filter", (p) => {
      for (const c of targets) p = ops.updateClip(p, c.id, (x) => ("adjust" in x ? ({ ...x, filter: { type, intensity: 1 } } as Clip) : x));
      return p;
    });
    return;
  }
  const f = at ?? s.playhead;
  let id = "";
  store.edit("Add filter layer", (p0) => {
    const [p, tid] = topTrack(p0, "Filter");
    const clip = { ...createAdjustmentClip(f, secondsToFrames(layerSeconds(), p.fps)), filter: { type, intensity: 1 } };
    id = clip.id;
    return ops.addClip(p, tid, clip);
  });
  store.select([id]);
}

/** Crossfade a touching audio join using the preferred audio length,
 * capped to its handles. The clip menu can toggle an existing one off. */
export function crossfadeInto(clipId: Id, toggle: boolean): boolean {
  const join = crossfadeJoin(store.get().project, clipId);
  if (!join) return false;
  const off = toggle && join.plays > 0;
  if (!off && join.why) {
    toast(join.why, "error");
    return false;
  }
  const seconds = off ? 0 : newCrossfade(join, audioCrossfadeSeconds());
  try {
    edit(seconds ? "Crossfade" : "Remove crossfade", (p) => runCommand(p, "set_crossfade", { clip_id: clipId, seconds }));
    return true;
  } catch (err) {
    toast((err as Error).message, "error");
    return false;
  }
}

/** Put a transition on a cut: the one after `clipId`, or on a click (not
 * `dropped`) the selected clip's or the one nearest the playhead on the
 * main track. */
export function applyTransition(type: string, clipId?: Id, dropped = false) {
  if (!TRANSITIONS[type]) return;
  const s = store.get();
  const p = s.project;
  let left: Clip | undefined;
  if (clipId) left = ops.findClip(p, clipId)?.clip;
  else if (!dropped) {
    const sel = s.selection.length === 1 ? ops.findClip(p, s.selection[0]) : null;
    const track = sel?.track ?? ops.mainTrack(p);
    const cuts = track.clips.filter((c, i) => track.clips[i + 1]?.start === c.start + c.duration);
    left = sel && cuts.includes(sel.clip) ? sel.clip : cuts.sort((a, b) => Math.abs(a.start + a.duration - s.playhead) - Math.abs(b.start + b.duration - s.playhead))[0];
  }
  if (!left) {
    toast("Transitions go between two touching clips — add another clip first");
    return;
  }
  if (left.type === "audio") {
    if (crossfadeInto(left.id, false)) store.select([left.id]);
    return;
  }
  const before = store.get().project;
  store.edit(`Add ${TRANSITIONS[type].label.toLowerCase()}`, (q) => ops.setTransition(q, left!.id, { type, duration: secondsToFrames(transitionSeconds(), q.fps) }));
  if (store.get().project === before) toast("Transitions go between two touching clips on the same track");
  else {
    store.select([left.id]);
    store.set({ transitionEdit: left.id });
  }
}

/** CapCut's "Custom adjustment": an empty adjustment layer at the playhead. */
/** A solid color layer (CapCut's color background) on a new top track at
 * the playhead, white until its Color is set. */
export function addColorLayer(at?: number) {
  const f = at ?? store.get().playhead;
  let id = "";
  store.edit("Add solid color", (p0) => {
    const [p, tid] = topTrack(p0, "Color");
    const clip = createColorClip("#ffffff", f, secondsToFrames(layerSeconds(), p.fps));
    id = clip.id;
    return ops.addClip(p, tid, clip);
  });
  store.select([id]);
}

/** A callout (ADR-120) on the video or picture under the playhead: a
 * rounded ring around the middle of what the viewer shows, the rest
 * dimmed, both pinned to that clip. The ring is selected, to be dragged
 * onto what it points at (its hole goes with it) and sized in Shape. */
export function addCalloutLayer(at?: number) {
  const s = store.get(), f = at ?? s.playhead, p = s.project;
  const shot = footageUnder(p, f);
  if (!shot) return void toast("Move the playhead over a video or picture to point at");
  // A box an eighth of the frame high around the canvas center, in the
  // picture's own fractions, kept inside it.
  const r = underPoint(p, shot, f, 0, 0, (0.16 * p.height) / p.width, 0.125);
  const w = Math.min(1, r.w), h = Math.min(1, r.h);
  const region = { x: Math.min(1 - w, Math.max(0, r.x - w / 2)), y: Math.min(1 - h, Math.max(0, r.y - h / 2)), w, h };
  let ring = "";
  try {
    store.edit("Add callout", (q) => {
      const next = runCommand(q, "add_callout", { clip_id: shot.id, region, at: framesToSeconds(f, q.fps), duration: 2 });
      ring = next.tracks.flatMap((t) => t.clips).find((c) => c.name === "Callout" && !ops.findClip(q, c.id))?.id ?? "";
      return next;
    });
  } catch (e) {
    return void toast(e instanceof Error ? e.message : String(e), "error");
  }
  if (ring) store.select([ring]);
}

export function addAdjustmentLayer(at?: number) {
  const f = at ?? store.get().playhead;
  let id = "";
  store.edit("Add adjustment layer", (p0) => {
    const [p, tid] = topTrack(p0, "Adjustment");
    const clip = createAdjustmentClip(f, secondsToFrames(layerSeconds(), p.fps));
    id = clip.id;
    return ops.addClip(p, tid, clip);
  });
  store.select([id]);
}
