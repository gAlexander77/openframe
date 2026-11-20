// Multicam (ADR-148): cut between camera angles of one moment. The angles
// are clips stacked on different tracks, already in sync. Nothing is split:
// each angle keeps its place and length, and the switch is an opacity key
// that holds (the angle's own opacity while it shows, 0 otherwise). So sync
// cannot slip, the render plan skips the angles that are off (a layer at
// opacity 0 is not drawn or decoded), and calling again with other cuts
// replaces the program instead of cutting pieces of pieces.

import { clipEnd, findClip, getAsset, updateClip } from "./project/ops";
import type { Clip, Id, Keyframe, Project, VisualClip } from "./project/types";
import { framesToSeconds } from "./time";

export class AngleError extends Error {}

export interface AngleCut {
  /** Timeline frame the angle takes over at. */
  at: number;
  angle: Id;
}

export interface Switched {
  project: Project;
  /** The program: which angle shows from which frame, runs of one angle merged. */
  program: AngleCut[];
  /** Angles whose own sound plays (more than one usually wants sound_from). */
  sounding: Id[];
}

const sounds = (p: Project, c: Clip) => (c.type === "video" || c.type === "compound") && !c.muted && !c.disabled && (c.type === "compound" || getAsset(p, c.assetId)?.hasAudio !== false);

/**
 * Show `angles[0]` until the first cut, then each cut's angle from its
 * frame on. `soundFrom` keeps one clip's sound (an angle, or an audio clip
 * such as a recorder's) and mutes the other angles; without it sound is
 * left as it is.
 */
export function switchAngles(p: Project, angles: Id[], cuts: AngleCut[], soundFrom?: Id): Switched {
  if (new Set(angles).size !== angles.length || angles.length < 2) throw new AngleError("angles needs two or more different clips");
  const clips = angles.map((id) => {
    const loc = findClip(p, id);
    if (!loc) throw new AngleError(`no clip with id ${id}`);
    if (!("transform" in loc.clip)) throw new AngleError(`${id} is ${loc.clip.type === "audio" || loc.clip.type === "adjustment" ? "an" : "a"} ${loc.clip.type} clip: an angle is a picture (a video, an image, a compound clip)`);
    if (loc.track.locked) throw new AngleError(`track ${loc.track.id} is locked`);
    return loc.clip as VisualClip;
  });
  const s = (frame: number) => `${+framesToSeconds(frame, p.fps).toFixed(3)} s`;
  for (const c of cuts) if (!angles.includes(c.angle)) throw new AngleError(`cut at ${s(c.at)}: ${c.angle} is not one of the angles`);
  const from = Math.min(...clips.map((c) => c.start)), to = Math.max(...clips.map(clipEnd));
  // The program over the angles' whole stretch, runs of one angle merged.
  const program: AngleCut[] = [];
  for (const c of [{ at: from, angle: angles[0] }, ...[...cuts].sort((a, b) => a.at - b.at)]) {
    const at = Math.min(Math.max(c.at, from), to);
    while (program.length && program[program.length - 1].at >= at) program.pop();
    if (program[program.length - 1]?.angle !== c.angle && at < to) program.push({ at, angle: c.angle });
  }
  // Every stretch needs its angle there to show.
  program.forEach((seg, i) => {
    const c = clips[angles.indexOf(seg.angle)], end = program[i + 1]?.at ?? to;
    if (c.start > seg.at || clipEnd(c) < end) throw new AngleError(`${seg.angle} is asked to show from ${s(seg.at)} to ${s(end)} but is on the timeline from ${s(c.start)} to ${s(clipEnd(c))}: cut to another angle there, or trim the others to it`);
  });
  let q = p;
  for (const c of clips) {
    const on = c.opacity > 0 ? c.opacity : 1;
    const keys: Keyframe[] = [];
    for (const seg of program) {
      const f = Math.max(0, seg.at - c.start), v = seg.angle === c.id ? on : 0;
      if (f >= c.duration) break;
      // Stretches before the clip begins fold into its first frame.
      if (keys.length && keys[keys.length - 1].f === f) keys[keys.length - 1].v = v;
      else if (!keys.length || keys[keys.length - 1].v !== v) keys.push({ f, v, ease: "hold" });
    }
    const always = keys.length === 1 && keys[0].v === on;
    q = updateClip(q, c.id, (x) => {
      const { opacity: _, ...rest } = x.keyframes ?? {};
      const keyframes = always ? rest : { ...rest, opacity: keys };
      return { ...x, opacity: on, keyframes: Object.keys(keyframes).length ? keyframes : undefined } as Clip;
    });
  }
  if (soundFrom !== undefined) {
    const src = findClip(q, soundFrom)?.clip;
    if (!src) throw new AngleError(`no clip with id ${soundFrom}`);
    if (src.type !== "audio" && !angles.includes(soundFrom)) throw new AngleError(`sound_from ${soundFrom} is neither one of the angles nor an audio clip`);
    for (const c of clips) if (c.type === "video" || c.type === "compound") q = updateClip(q, c.id, (x) => ({ ...x, muted: c.id !== soundFrom }) as Clip);
  }
  return { project: q, program, sounding: angles.filter((id) => sounds(q, findClip(q, id)!.clip)) };
}
