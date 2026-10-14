// What happens when a library card (text preset, effect, filter,
// transition) is clicked or dropped. CapCut's rules: an effect or filter
// dropped on a clip attaches to that clip; dropped on empty timeline (or
// added with nothing selected) it becomes its own layer clip that affects
// everything below for its duration.

import { effectDefaults, FILTERS, TRANSITIONS } from "../lib/catalog";
import { createAdjustmentClip, createTextClip, createTrack, uid } from "../lib/project/defaults";
import * as ops from "../lib/project/ops";
import type { Clip, Id, Project, TextStyle } from "../lib/project/types";
import { secondsToFrames } from "../lib/time";
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

/** A new top video track (CapCut stacks the newest layer on top). */
function topTrack(p: Project, name: string): [Project, Id] {
  const t = createTrack("video", name);
  return [ops.addTrack(p, t, 0), t.id];
}

export function addTextPreset(key: string, at?: number) {
  const preset = TEXT_PRESETS[key];
  if (!preset) return;
  const s = store.get();
  const f = at ?? s.playhead;
  let id = "";
  store.edit(`Add ${preset.label.toLowerCase()}`, (p0) => {
    const dur = secondsToFrames(3, p0.fps);
    let clip: Clip = createTextClip(preset.text, f, dur, preset.style);
    clip = {
      ...clip,
      transform: { ...clip.transform, y: preset.y ?? 0 },
      ...(preset.anim ? { animIn: { type: preset.anim, duration: secondsToFrames(0.5, p0.fps) } } : {}),
    };
    id = clip.id;
    const free = p0.tracks.find((t) => t.kind === "video" && !t.main && !t.locked && ops.rangeFree(t, f, dur));
    if (free) return ops.addClip(p0, free.id, clip);
    const [p, tid] = topTrack(p0, "Text");
    return ops.addClip(p, tid, clip);
  });
  store.select([id]);
}

/** Attach an effect to `clipId`, or to the selection, or add it as a layer. */
export function applyEffect(type: string, clipId?: Id, at?: number) {
  const s = store.get();
  const targets = clipId ? [ops.findClip(s.project, clipId)?.clip].filter((c): c is Clip => !!c && c.type !== "audio") : visualSelection(s.project);
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
    const clip = { ...createAdjustmentClip(f, secondsToFrames(3, p.fps)), effects: [{ id: uid("fx"), type, enabled: true, params: effectDefaults(type) }] };
    id = clip.id;
    return ops.addClip(p, tid, clip);
  });
  store.select([id]);
}

export function applyFilter(type: string, clipId?: Id, at?: number) {
  if (!FILTERS[type]) return;
  const s = store.get();
  const targets = clipId ? [ops.findClip(s.project, clipId)?.clip].filter((c): c is Clip => !!c && c.type !== "audio") : visualSelection(s.project);
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
    const clip = { ...createAdjustmentClip(f, secondsToFrames(3, p.fps)), filter: { type, intensity: 1 } };
    id = clip.id;
    return ops.addClip(p, tid, clip);
  });
  store.select([id]);
}

/** Put a transition on a cut: the one after `clipId`, or the cut nearest the
 * playhead on the main track. */
export function applyTransition(type: string, clipId?: Id) {
  if (!TRANSITIONS[type]) return;
  const s = store.get();
  const p = s.project;
  let left: Clip | undefined;
  if (clipId) left = ops.findClip(p, clipId)?.clip;
  else {
    const sel = s.selection.length === 1 ? ops.findClip(p, s.selection[0]) : null;
    const track = sel?.track ?? ops.mainTrack(p);
    const cuts = track.clips.filter((c, i) => track.clips[i + 1]?.start === c.start + c.duration);
    left = sel && cuts.includes(sel.clip) ? sel.clip : cuts.sort((a, b) => Math.abs(a.start + a.duration - s.playhead) - Math.abs(b.start + b.duration - s.playhead))[0];
  }
  if (!left) {
    toast("Transitions go between two touching clips — add another clip first");
    return;
  }
  const before = store.get().project;
  store.edit(`Add ${TRANSITIONS[type].label.toLowerCase()}`, (q) => ops.setTransition(q, left!.id, { type, duration: secondsToFrames(0.5, q.fps) }));
  if (store.get().project === before) toast("Transitions go between two touching clips on the same track");
}

/** CapCut's "Custom adjustment": an empty adjustment layer at the playhead. */
export function addAdjustmentLayer(at?: number) {
  const f = at ?? store.get().playhead;
  let id = "";
  store.edit("Add adjustment layer", (p0) => {
    const [p, tid] = topTrack(p0, "Adjustment");
    const clip = createAdjustmentClip(f, secondsToFrames(3, p.fps));
    id = clip.id;
    return ops.addClip(p, tid, clip);
  });
  store.select([id]);
}
