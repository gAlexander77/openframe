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

/** Every caption takes the look: its style and height. */
export function applyCaptionLook(p: Project, id: string): Project {
  const style = lookStyle(id), y = CAPTION_LOOKS[id].y;
  return {
    ...p,
    tracks: p.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c): Clip => (c.type === "text" && c.caption ? { ...c, style: structuredClone(style), transform: { ...c.transform, y } } : c)),
    })),
  };
}
