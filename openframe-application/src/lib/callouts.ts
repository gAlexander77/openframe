// A callout (ADR-120): a ring or box that draws on around a part of a
// screen recording, with the rest of the frame dimmed through a hole the
// same shape, pinned to the recording so both follow its zooms and pans,
// and able to glide to other parts. Two shape layers (the dim under the
// ring), grouped, each anchored to the same region (lib/anchors.ts): the
// pieces stay ordinary clips that the inspector, set_shape and versions
// already know, and they move, copy and delete together.

import { anchorProblem, followAnchors } from "./anchors";
import type { Region } from "./align";
import { brandOf } from "./brandKit";
import { groupClips } from "./project/groups";
import { createColorClip } from "./project/defaults";
import { placeStack } from "./overlays";
import type { AnchorKey, Clip, ColorClip, Id, Mask, Project } from "./project/types";

export const CALLOUT_SHAPES = ["ring", "box", "rounded"] as const;
export type CalloutShape = (typeof CALLOUT_SHAPES)[number];

/** Room between the region and the ring, pixels at 1080p on every side. */
export const CALLOUT_PAD = 6;
/** The ring's outline, pixels at 1080p. */
export const CALLOUT_STROKE = 6;
/** A rounded box's corners, as add_shape's rounded_rectangle. */
const ROUNDED = 0.35;

export interface CalloutOptions {
  /** The footage it points at. */
  clipId: Id;
  /** Source fractions of that clip's picture, x and y its top-left. */
  region: Region;
  shape: CalloutShape;
  /** How dark the rest of the frame goes, 0 (none) .. 1. */
  dim: number;
  /** Timeline frame and length. */
  start: number;
  duration: number;
  /** Frames the ring takes to draw on (0: whole at once). */
  drawOn: number;
  /** Later regions: each reached at timeline frame `f`, gliding there
   * over `glide` frames from where it was. */
  to: { region: Region; f: number; glide: number }[];
  color?: string;
  strokeWidth?: number;
}

export class CalloutError extends Error {}

const center = (r: Region) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h });

/** The anchor's keys (callout frames): the first region, then for each
 * glide a hold until it leaves and the new region where it arrives. */
export function calloutKeys(o: Pick<CalloutOptions, "region" | "start" | "duration" | "to">, fps = 30): AnchorKey[] {
  const keys: AnchorKey[] = [{ f: 0, ...center(o.region) }];
  o.to.forEach((t, i) => {
    const arrive = t.f - o.start;
    const prev = keys[keys.length - 1];
    const sec = (fr: number) => +(fr / fps).toFixed(2);
    if (arrive <= prev.f) throw new CalloutError(`to ${i + 1} arrives at ${sec(t.f)} s, not after ${prev.f ? `the glide before it (${sec(o.start + prev.f)} s)` : `the callout starts (${sec(o.start)} s)`}`);
    if (arrive > o.duration - 1) throw new CalloutError(`to ${i + 1} arrives at ${sec(t.f)} s, after the callout ends (${sec(o.start + o.duration)} s): make it longer with duration`);
    const leave = Math.max(prev.f, arrive - Math.max(1, t.glide));
    if (leave > prev.f) keys.push({ ...prev, f: leave, ease: "easeInOut" });
    else prev.ease = "easeInOut";
    keys.push({ f: arrive, ...center(t.region) });
  });
  return keys;
}

/** Add a callout: the dim (when `dim` > 0) and the ring, grouped, above
 * everything showing then. Answers the project and the ring's and dim's ids. */
export function addCallout(p: Project, o: CalloutOptions): { project: Project; ring: Id; dim?: Id } {
  const problem = anchorProblem(p, "", o.clipId);
  if (problem) throw new CalloutError(problem);
  const keys = calloutKeys(o, p.fps.num / p.fps.den);
  const color = o.color ?? brandOf(p).colors.accent;
  const anchor = { clipId: o.clipId, keys, pad: CALLOUT_PAD };
  const round = o.shape === "ring" ? undefined : o.shape === "rounded" ? ROUNDED : 0;
  const fade = Math.max(1, Math.min(9, Math.floor(o.duration / 3)));
  const ringBase = createColorClip(color, o.start, o.duration);
  const ring: ColorClip = {
    ...ringBase,
    name: "Callout",
    shape: {
      kind: o.shape === "ring" ? "ellipse" : "rectangle",
      width: 0.1,
      height: 0.1,
      ...(round ? { radius: round } : {}),
      fill: false,
      stroke: { color, width: o.strokeWidth ?? CALLOUT_STROKE },
    },
    animOut: { type: "fade", duration: fade },
    anchor,
    ...(o.drawOn > 0 ? { keyframes: { "shape.draw": [{ f: 0, v: 0, ease: "easeOut" }, { f: Math.min(o.drawOn, o.duration - 1), v: 1 }] } } : {}),
  };
  const clips: Clip[] = [ring];
  let dimId: Id | undefined;
  if (o.dim > 0) {
    const mask: Mask = { shape: o.shape === "ring" ? "circle" : "rectangle", x: 0, y: 0, width: 0.1, height: 0.1, rotation: 0, feather: 0, invert: true, ...(round ? { radius: round } : {}) };
    const base = createColorClip("#000000", o.start, o.duration);
    const dim: ColorClip = {
      ...base,
      name: "Callout dim",
      shape: { kind: "rectangle", width: 1, height: 1 },
      opacity: Math.min(1, o.dim),
      mask,
      animIn: { type: "fade", duration: Math.max(1, Math.min(o.drawOn || 8, o.duration - 1)) },
      animOut: { type: "fade", duration: fade },
      anchor: { ...anchor, mask: true },
    };
    dimId = dim.id;
    clips.unshift(dim);
  }
  let q = placeStack(p, clips, "Callouts");
  if (clips.length > 1) q = groupClips(q, clips.map((c) => c.id));
  return { project: followAnchors(p, q), ring: ring.id, ...(dimId ? { dim: dimId } : {}) };
}
