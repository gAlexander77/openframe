// Caption looks (CapCut's caption templates, Resolve 20's subtitle
// styles): a whole caption style and a height, applied to every caption
// at once. The spoken-word highlight is part of a look (Word pop); words
// and timings stay as they are.

import { DEFAULT_TEXT_STYLE } from "./project/defaults";
import type { Clip, Project, TextStyle } from "./project/types";

export interface CaptionLook {
  label: string;
  style: Partial<TextStyle>;
  /** Vertical offset from the canvas center, as a fraction of its height. */
  y: number;
}

const BASE: TextStyle = { ...DEFAULT_TEXT_STYLE, size: 64, bold: true, color: "#ffffff", maxWidth: 0.84, lineHeight: 1.15, stroke: undefined };

export const CAPTION_LOOKS: Record<string, CaptionLook> = {
  classic: { label: "Classic", style: { stroke: { color: "#000000", width: 6 } }, y: 0.36 },
  yellow: { label: "Bold yellow", style: { font: "Arial Black", size: 72, color: "#ffd400", stroke: { color: "#000000", width: 8 }, case: "upper" }, y: 0.3 },
  boxed: { label: "Boxed", style: { size: 58, background: { color: "#000000b3", padding: 14, radius: 10 } }, y: 0.36 },
  pop: { label: "Word pop", style: { size: 72, stroke: { color: "#000000", width: 8 }, highlight: "#2ee59d", case: "upper" }, y: 0.25 },
  neon: { label: "Neon", style: { color: "#e8fdff", shadow: { color: "#00e5ff", blur: 18, x: 0, y: 0 } }, y: 0.36 },
  minimal: { label: "Minimal", style: { font: "Georgia", bold: false, size: 56, shadow: { color: "#000000aa", blur: 6, x: 0, y: 2 } }, y: 0.38 },
};

/** A look's full style: what it sets over the caption base, and nothing
 * left over from the style it replaces (no stray stroke or box). */
export function lookStyle(id: string): TextStyle {
  const look = CAPTION_LOOKS[id];
  if (!look) throw new Error(`No caption look ${id}; there are ${Object.keys(CAPTION_LOOKS).join(", ")}`);
  const s: TextStyle = { ...BASE, ...look.style };
  for (const k of ["stroke", "shadow", "background", "highlight", "case"] as const) if (s[k] === undefined) delete s[k];
  return s;
}

/** Where captions sit on this canvas: on a tall one the apps draw their own
 * captions and buttons over the bottom 35% (VERTICAL_SAFE), so a caption
 * meant for the bottom sits just under the middle instead. */
export const captionY = (p: { width: number; height: number }, y: number) => (p.height > p.width ? Math.min(y, 0.05) : y);

/** On a tall canvas the apps' side rails leave a column from x -0.39 to
 * 0.31 (VERTICAL_SAFE's left 11% and right 19%): captions wrap inside it
 * (0.62 of the width, room left for an outline) and center on it. */
export const captionFit = (p: { width: number; height: number }, style: TextStyle, x: number): { style: TextStyle; x: number } =>
  p.height > p.width ? { style: { ...style, maxWidth: Math.min(style.maxWidth, 0.62) }, x: -0.04 } : { style, x };

/** A caption style's pixel sizes (pixels at a 1080-tall frame) for this
 * canvas's short side: on 1080x1920 a caption gets 1080/1920 of them, the
 * pixels it has on 1920x1080, instead of growing with the height to a
 * dozen letters a line. Wide canvases keep them. */
export function captionSized<T extends Partial<TextStyle>>(p: { width: number; height: number }, s: T): T {
  const k = Math.min(p.width, p.height) / p.height;
  if (k >= 1) return s;
  const r = (v: number) => +(v * k).toFixed(2);
  return {
    ...s,
    ...(s.size !== undefined ? { size: r(s.size) } : {}),
    ...(s.stroke ? { stroke: { ...s.stroke, width: r(s.stroke.width) } } : {}),
    ...(s.shadow ? { shadow: { ...s.shadow, blur: r(s.shadow.blur), x: r(s.shadow.x), y: r(s.shadow.y) } } : {}),
    ...(s.background ? { background: { ...s.background, padding: r(s.background.padding), radius: r(s.background.radius) } } : {}),
  };
}

/** The largest caption a look gives this canvas, as a style size: 72 on a
 * square or wide one (Word pop, Bold yellow: 6.7% of a 16:9 frame's
 * height; broadcast subtitles are 4.6-5.6%), the same pixels on a tall
 * one. What a landscape version brings a tall short's captions down to
 * (ADR-118). */
export const captionMax = (p: { width: number; height: number }) => Math.max(...Object.keys(CAPTION_LOOKS).map((id) => captionSized(p, lookStyle(id)).size));

/** The width captions wrap within on a canvas that is not tall: two lines
 * of a subtitle, as add_captions and the looks have them. */
export const CAPTION_WRAP = BASE.maxWidth;

/** Every caption takes the look: its style and height. */
export function applyCaptionLook(p: Project, id: string): Project {
  const y = captionY(p, CAPTION_LOOKS[id].y);
  return {
    ...p,
    tracks: p.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c): Clip => {
        if (c.type !== "text" || !c.caption) return c;
        const fit = captionFit(p, captionSized(p, lookStyle(id)), c.transform.x);
        return { ...c, style: fit.style, transform: { ...c.transform, x: fit.x, y } };
      }),
    })),
  };
}
