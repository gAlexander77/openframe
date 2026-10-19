// Edits the grade panels share: replace or remove one part of a clip's
// grade (removing a part also removes its keyframes), as one undo step or
// as a step of a drag gesture.

import { updateClip } from "../../lib/project/ops";
import type { Clip, Grade, Id, Project } from "../../lib/project/types";
import { patchClip } from "./controls";

/** The clip with one grade part set, or removed when `value` is undefined
 * (keyframes under `keyPrefix` go with it). */
export function withGradePart<K extends keyof Grade>(c: Clip, key: K, value: Grade[K] | undefined, keyPrefix?: string): Clip {
  if (!("adjust" in c)) return c;
  const adjust = { ...c.adjust, [key]: value };
  if (value === undefined) delete adjust[key];
  let keyframes = c.keyframes;
  if (keyPrefix && keyframes) {
    keyframes = Object.fromEntries(Object.entries(keyframes).filter(([path]) => !path.startsWith(keyPrefix)));
    if (!Object.keys(keyframes).length) keyframes = undefined;
  }
  return { ...c, adjust, keyframes } as Clip;
}

/** One undoable change to a grade part. */
export function setGradePart<K extends keyof Grade>(id: Id, label: string, key: K, value: Grade[K] | undefined, keyPrefix?: string) {
  patchClip(id, label, (c) => withGradePart(c, key, value, keyPrefix));
}

/** The same change as a pure project edit, for drag gestures. */
export const gradePartEdit =
  <K extends keyof Grade>(id: Id, key: K, value: Grade[K] | undefined) =>
  (p: Project) =>
    updateClip(p, id, (c) => withGradePart(c, key, value));

/** True when any keyframe sits under `prefix`. */
export const hasKeys = (c: Clip, prefix: string) => !!c.keyframes && Object.keys(c.keyframes).some((k) => k.startsWith(prefix));
