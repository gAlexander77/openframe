// A credits roll (ADR-147): Premiere's roll, Resolve's scroll title, Final
// Cut's scrolling credits. Lines travel up the frame at one steady speed.
// The roll is cut into short blocks, each a title of its own on screen only
// while it crosses: one raster of a hundred lines would be thousands of
// pixels tall (past the text cache, and past some GPUs' largest texture),
// and a block is a title the rest of the app already understands.

import { minTextSize } from "./brandKit";
import { createTextClip, uid } from "./project/defaults";
import { sourceSize, textPad } from "./render/size";
import type { Project, TextClip, TextStyle } from "./project/types";

/** Seconds a line takes from the bottom edge to the top when no length is
 * given: readable online; cinema credits run nearer 8 to 10. */
export const CREDITS_LINE_SECONDS = 6;
/** Lines to a block: about half a frame of type at the default size. */
export const CREDITS_BLOCK = 8;
/** A roll's type when none is given: regular weight, open lines, and a size
 * a little over what check_project calls readable on this frame (a first
 * default of 48 failed the app's own check on 16:9, where the floor is 49). */
export const creditsStyle = (p: Pick<Project, "width" | "height">): Partial<TextStyle> => ({ size: Math.round(minTextSize(p.width, p.height) * 1.15), bold: false, lineHeight: 1.5 });

export interface CreditsRoll {
  clips: TextClip[];
  /** Frames the whole roll takes, first line in to last line out. */
  frames: number;
  /** Seconds each line is on screen. */
  lineSeconds: number;
  lines: number;
}

/**
 * The titles of a roll starting at frame `start`. `text` is its lines; an
 * empty line is a gap one line high. With `frames` the whole roll takes
 * that long; without, each line crosses the frame in `lineSeconds`.
 */
export function creditsRoll(p: Project, text: string, start: number, style: Partial<TextStyle>, o: { frames?: number; lineSeconds?: number; x?: number } = {}): CreditsRoll {
  const fps = p.fps.num / p.fps.den;
  const group = uid("g");
  const type = createTextClip("", 0, 1, style).style;
  const lineGap = (type.size * type.lineHeight) / 1080;
  // Blocks never hold an empty line: the gaps between them are distances,
  // so nothing depends on how the rasterizer draws an empty line.
  const blocks: { clip: TextClip; h: number; pad: number; off: number }[] = [];
  let off = 0, lines = 0, gap = 0;
  const lineList = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lineList.length; ) {
    if (!lineList[i].trim()) {
      if (blocks.length) gap += lineGap;
      i++;
      continue;
    }
    const part: string[] = [];
    while (i < lineList.length && lineList[i].trim() && part.length < CREDITS_BLOCK) part.push(lineList[i++].trim());
    const clip: TextClip = { ...createTextClip(part.join("\n"), 0, 1, style), name: "Credits", group };
    const pad = textPad(p, clip) / p.height;
    const h = sourceSize(p, clip).h / p.height - 2 * pad;
    off += gap;
    blocks.push({ clip, h, pad, off });
    off += h;
    gap = 0;
    lines += part.length;
  }
  if (!blocks.length) return { clips: [], frames: 0, lineSeconds: 0, lines: 0 };
  // Heights of the frame a second: the roll travels its own height plus one frame's.
  const speed = o.frames !== undefined ? ((1 + off) * fps) / Math.max(1, o.frames) : 1 / (o.lineSeconds ?? CREDITS_LINE_SECONDS);
  const total = o.frames ?? Math.ceil(((1 + off) / speed) * fps);
  const clips = blocks.map((b) => {
    const from = Math.max(0, Math.floor(((b.off - b.pad) / speed) * fps));
    // Never past the length asked for: the margin a raster has around its letters is empty.
    const to = Math.min(total, Math.ceil(((1 + b.off + b.h + b.pad) / speed) * fps));
    const duration = Math.max(2, to - from);
    // Where its center is at a frame of the roll: every block on one line
    // of motion, whatever frame its clip starts on.
    const y = (frame: number) => 0.5 + b.off + b.h / 2 - (speed * frame) / fps;
    return {
      ...b.clip,
      start: start + from,
      duration,
      transform: { ...b.clip.transform, x: o.x ?? 0, y: y(from) },
      keyframes: { "transform.y": [{ f: 0, v: y(from) }, { f: duration - 1, v: y(from + duration - 1) }] },
    } as TextClip;
  });
  return { clips, frames: total, lineSeconds: +(1 / speed).toFixed(2), lines };
}

/** A title riding a credits roll: keyed from below the frame to above it. */
export function isRoll(c: { keyframes?: Record<string, { v: number }[]> }): boolean {
  const ks = c.keyframes?.["transform.y"];
  return !!ks && ks.length >= 2 && ks[0].v > 0.5 && ks[ks.length - 1].v < -0.5;
}
