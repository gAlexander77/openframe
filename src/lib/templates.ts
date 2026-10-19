// Text templates as data: CapCut's word-art "Effects" (one styled text
// layer) and its multi-layer title templates (a few text and solid-box
// layers with their own animations and stagger). Both become ordinary
// clips — text clips, and color clips cropped to a box — so there is
// nothing new to render, save or export (ADR-025).

import { placeStack } from "./overlays";
import { createColorClip, createTextClip, DEFAULT_TEXT_STYLE, uid } from "./project/defaults";
import type { Animation, Clip, Id, Project, TextStyle } from "./project/types";
import { secondsToFrames, type Rational } from "./time";

export interface TemplateLayer {
  /** A text layer: its words and look... */
  text?: string;
  style?: Partial<TextStyle>;
  /** ...or a solid box, sized as fractions of the canvas. */
  box?: { color: string; w: number; h: number; opacity?: number };
  /** Center offset from the canvas center, as canvas fractions. */
  x?: number;
  y?: number;
  /** Seconds after the template starts, and how long the layer stays
   * (default: until the template ends). */
  delay?: number;
  seconds?: number;
  /** Animation name from the catalog and its length (loops: period). */
  in?: [string, number];
  out?: [string, number];
  loop?: [string, number];
}

export interface TextTemplate {
  label: string;
  category: "Word art" | "Templates";
  /** Total length in seconds. */
  seconds: number;
  /** Bottom layer first. */
  layers: TemplateLayer[];
}

const art = (label: string, text: string, style: Partial<TextStyle>): TextTemplate => ({
  label,
  category: "Word art",
  seconds: 3,
  layers: [{ text, style: { size: 130, ...style } }],
});

/** Word art: fill, stroke, shadow and box combinations, CapCut's text
 * "Effects". Applied to a selected text clip, only the look changes. */
const WORD_ART: Record<string, TextTemplate> = {
  neonPink: art("Neon pink", "Neon", { color: "#ffe3fa", stroke: { color: "#ff6be3", width: 2 }, shadow: { color: "#ff1fd2", blur: 34, x: 0, y: 0 } }),
  neonBlue: art("Neon blue", "Glow", { color: "#e8fdff", stroke: { color: "#47e9ff", width: 2 }, shadow: { color: "#00b3ff", blur: 34, x: 0, y: 0 } }),
  retro: art("Retro", "RETRO", { font: "Impact", bold: false, italic: true, letterSpacing: 6, color: "#ffd23f", stroke: { color: "#ff3e7f", width: 5 }, shadow: { color: "#3b1cff", blur: 0, x: 9, y: 9 } }),
  comic: art("Comic", "POW!", { font: "Impact", bold: false, letterSpacing: 3, color: "#ffe14d", stroke: { color: "#111111", width: 9 }, shadow: { color: "#111111", blur: 0, x: 9, y: 11 } }),
  hollow: art("Hollow", "HOLLOW", { color: "#ffffff00", letterSpacing: 6, stroke: { color: "#ffffff", width: 3 } }),
  gold: art("Gold", "Gold", { font: "Georgia", color: "#ffd86b", stroke: { color: "#7a4b00", width: 3 }, shadow: { color: "#000000b0", blur: 14, x: 0, y: 6 } }),
  fire: art("Fire", "FIRE", { color: "#fff3b8", stroke: { color: "#ff7a00", width: 4 }, shadow: { color: "#ff2a00", blur: 30, x: 0, y: 0 } }),
  frost: art("Frost", "Frost", { color: "#ffffff", stroke: { color: "#49b6ff", width: 4 }, shadow: { color: "#a5ecff", blur: 24, x: 0, y: 0 } }),
  yellow: art("Bold yellow", "Bold", { color: "#ffe600", stroke: { color: "#000000", width: 8 } }),
  hardShadow: art("Hard shadow", "Shadow", { color: "#ffffff", shadow: { color: "#000000", blur: 0, x: 8, y: 8 } }),
  candy: art("Candy", "Candy", { color: "#ffffff", stroke: { color: "#ff4f9a", width: 9 }, shadow: { color: "#7b2cff", blur: 0, x: 0, y: 10 } }),
  sticker: art("Die-cut", "Sticker", { color: "#ff3d7f", stroke: { color: "#ffffff", width: 10 }, shadow: { color: "#00000080", blur: 10, x: 0, y: 5 } }),
  chroma: art("Chromatic", "GLITCH", { color: "#ffffff", letterSpacing: 4, stroke: { color: "#ff0055", width: 2 }, shadow: { color: "#00f0ff", blur: 0, x: 7, y: 0 } }),
  minimal: art("Minimal", "minimal", { bold: false, size: 96, letterSpacing: 26, color: "#ffffff" }),
  typewriter: art("Typewriter", "Typewriter", { font: "Courier New", bold: false, size: 96, color: "#f6eedc", background: { color: "#000000b8", padding: 18, radius: 4 } }),
  highlight: art("Highlight", "Highlight", { color: "#111111", background: { color: "#ffe14d", padding: 14, radius: 6 } }),
};

const ACCENT = "#00c1cd";
const SOFT_SHADOW = { color: "#000000c0", blur: 18, x: 0, y: 4 };

/** Title templates: lower thirds, callouts, chapter cards. Bottom layer
 * first; positions are tuned for the default words. */
const TITLES: Record<string, TextTemplate> = {
  lowerThird: {
    // "Lower third" is taken by the basic preset; two cards with one name confuse.
    label: "Name and title",
    category: "Templates",
    seconds: 5,
    layers: [
      { box: { color: "#111317", w: 0.3, h: 0.115, opacity: 0.88 }, x: -0.31, y: 0.33, in: ["slideRight", 0.5], out: ["fade", 0.4] },
      { box: { color: ACCENT, w: 0.006, h: 0.115 }, x: -0.457, y: 0.33, in: ["slideRight", 0.5], out: ["fade", 0.4] },
      { text: "Alex Rivera", style: { size: 56 }, x: -0.31, y: 0.311, delay: 0.2, in: ["rise", 0.4], out: ["fade", 0.4] },
      { text: "Creative director", style: { size: 34, bold: false, color: "#b9c3cc" }, x: -0.31, y: 0.358, delay: 0.3, in: ["rise", 0.4], out: ["fade", 0.4] },
    ],
  },
  nameTag: {
    label: "Name tag",
    category: "Templates",
    seconds: 4,
    layers: [
      { text: "Jordan Lee", style: { size: 50, color: "#111111", background: { color: "#ffffff", padding: 16, radius: 999 } }, x: -0.32, y: 0.3, in: ["pop", 0.45], out: ["fade", 0.3] },
      { text: "@jordanlee", style: { size: 30, color: "#ffffff", background: { color: "#ff2d78", padding: 12, radius: 999 } }, x: -0.32, y: 0.375, delay: 0.15, in: ["pop", 0.45], out: ["fade", 0.3] },
    ],
  },
  subscribe: {
    label: "Subscribe",
    category: "Templates",
    seconds: 4,
    layers: [
      {
        text: "🔔  SUBSCRIBE",
        style: { size: 64, letterSpacing: 2, color: "#ffffff", background: { color: "#ff2d3d", padding: 22, radius: 999 } },
        y: 0.28,
        in: ["pop", 0.5],
        loop: ["heartbeat", 1.2],
        out: ["fade", 0.4],
      },
      { text: "for more videos like this", style: { size: 34, bold: false, shadow: SOFT_SHADOW }, y: 0.38, delay: 0.25, in: ["rise", 0.4], out: ["fade", 0.4] },
    ],
  },
  chapter: {
    label: "Chapter title",
    category: "Templates",
    seconds: 4,
    layers: [
      { text: "CHAPTER ONE", style: { size: 34, letterSpacing: 14, color: ACCENT, shadow: SOFT_SHADOW }, y: -0.085, in: ["fade", 0.5], out: ["fade", 0.4] },
      { box: { color: "#ffffff", w: 0.1, h: 0.003 }, y: -0.04, delay: 0.15, in: ["zoomIn", 0.5], out: ["fade", 0.4] },
      { text: "The Beginning", style: { size: 120, font: "Georgia", bold: false, shadow: SOFT_SHADOW }, y: 0.04, delay: 0.2, in: ["rise", 0.6], out: ["fade", 0.4] },
    ],
  },
  quote: {
    label: "Quote card",
    category: "Templates",
    seconds: 6,
    layers: [
      { box: { color: "#000000", w: 0.62, h: 0.42, opacity: 0.62 }, in: ["fade", 0.5], out: ["fade", 0.5] },
      { text: "“Simplicity is the ultimate\nsophistication.”", style: { size: 64, font: "Georgia", bold: false, italic: true, maxWidth: 0.56 }, y: -0.04, delay: 0.2, in: ["blurIn", 0.7], out: ["fade", 0.5] },
      { text: "— Leonardo da Vinci", style: { size: 32, bold: false, color: "#cfcfcf" }, y: 0.12, delay: 0.6, in: ["fade", 0.5], out: ["fade", 0.5] },
    ],
  },
  countdown: {
    label: "Countdown",
    category: "Templates",
    seconds: 3,
    layers: ["3", "2", "1"].map((n, i) => ({
      text: n,
      style: { size: 300, color: "#ffffff", stroke: { color: ACCENT, width: 6 }, shadow: { color: ACCENT, blur: 40, x: 0, y: 0 } },
      delay: i,
      seconds: 1,
      in: ["pop", 0.3],
      out: ["zoomOut", 0.25],
    })),
  },
  location: {
    label: "Location tag",
    category: "Templates",
    seconds: 4,
    layers: [
      { text: "📍 Kyoto, Japan", style: { size: 44, color: "#111111", background: { color: "#ffffff", padding: 16, radius: 999 } }, x: -0.34, y: -0.36, in: ["drop", 0.45], loop: ["float", 2.5], out: ["fade", 0.3] },
      { text: "Day 3 · Golden hour", style: { size: 28, bold: false, shadow: SOFT_SHADOW }, x: -0.34, y: -0.285, delay: 0.25, in: ["fade", 0.4], out: ["fade", 0.3] },
    ],
  },
  opener: {
    label: "Big opener",
    category: "Templates",
    seconds: 4,
    layers: [
      { text: "SUMMER", style: { size: 210, font: "Impact", bold: false, letterSpacing: 18, shadow: { color: "#00000099", blur: 30, x: 0, y: 6 } }, y: -0.04, in: ["zoomOut", 0.6], out: ["fade", 0.4] },
      { text: "VLOG · EPISODE 04", style: { size: 40, letterSpacing: 12, shadow: SOFT_SHADOW }, y: 0.12, delay: 0.35, in: ["rise", 0.5], out: ["fade", 0.4] },
    ],
  },
  news: {
    label: "News banner",
    category: "Templates",
    seconds: 5,
    layers: [
      { box: { color: "#0f1115", w: 0.81, h: 0.075, opacity: 0.92 }, x: 0.085, y: 0.35, delay: 0.1, in: ["slideLeft", 0.5], out: ["fade", 0.3] },
      { box: { color: "#d7192b", w: 0.17, h: 0.075 }, x: -0.405, y: 0.35, in: ["slideRight", 0.4], out: ["fade", 0.3] },
      { text: "BREAKING", style: { size: 38, letterSpacing: 4 }, x: -0.405, y: 0.35, delay: 0.3, in: ["fade", 0.3], out: ["fade", 0.3] },
      { text: "Your headline goes here", style: { size: 38, bold: false }, x: 0.085, y: 0.35, delay: 0.45, in: ["fade", 0.3], out: ["fade", 0.3] },
    ],
  },
  social: {
    label: "Social handle",
    category: "Templates",
    seconds: 4,
    layers: [
      { text: "@yourhandle", style: { size: 64, background: { color: "#000000a0", padding: 18, radius: 14 } }, y: 0.3, in: ["pop", 0.45], out: ["fade", 0.3] },
      { text: "Follow for more", style: { size: 32, bold: false, shadow: SOFT_SHADOW }, y: 0.385, delay: 0.2, in: ["rise", 0.4], out: ["fade", 0.3] },
    ],
  },
  endCard: {
    label: "Thanks for watching",
    category: "Templates",
    seconds: 5,
    layers: [
      { text: "Thanks for watching!", style: { size: 110, shadow: { color: "#000000aa", blur: 24, x: 0, y: 6 } }, y: -0.04, in: ["pop", 0.5], out: ["fade", 0.5] },
      { text: "See you next time", style: { size: 44, shadow: SOFT_SHADOW }, y: 0.09, delay: 0.3, in: ["rise", 0.5], out: ["fade", 0.5] },
    ],
  },
  linkInBio: {
    label: "Link in bio",
    category: "Templates",
    seconds: 4,
    layers: [
      { text: "LINK IN BIO 👇", style: { size: 60, letterSpacing: 2, color: "#111111", background: { color: "#ffe14d", padding: 18, radius: 10 } }, y: 0.3, in: ["pop", 0.45], loop: ["pulse", 1], out: ["fade", 0.3] },
    ],
  },
};

export const TEXT_TEMPLATES: Record<string, TextTemplate> = { ...WORD_ART, ...TITLES };

/** The clips a template adds at `start`, bottom layer first.
 * ponytail: layers are placed by their centers, tuned for the default
 * words; a much longer name grows both ways past its box. A group clip
 * that lays out its children is the upgrade path. */
export function templateClips(t: TextTemplate, start: number, fps: Rational): Clip[] {
  const end = start + secondsToFrames(t.seconds, fps);
  const anim = (a?: [string, number]): Animation | undefined => (a ? { type: a[0], duration: Math.max(1, secondsToFrames(a[1], fps)) } : undefined);
  return t.layers.map((l) => {
    const s = start + secondsToFrames(l.delay ?? 0, fps);
    const duration = Math.max(1, l.seconds !== undefined ? secondsToFrames(l.seconds, fps) : end - s);
    const base = l.box ? createColorClip(l.box.color, s, duration) : createTextClip(l.text ?? "", s, duration, l.style ?? {});
    const extra = {
      transform: { ...base.transform, x: l.x ?? 0, y: l.y ?? 0 },
      ...(l.in ? { animIn: anim(l.in) } : {}),
      ...(l.out ? { animOut: anim(l.out) } : {}),
      ...(l.loop ? { animLoop: anim(l.loop) } : {}),
    };
    if (!l.box) return { ...base, ...extra };
    // A color clip fills the canvas; cropping it evenly leaves a centered box.
    const cx = (1 - l.box.w) / 2;
    const cy = (1 - l.box.h) / 2;
    return { ...base, ...extra, name: t.label, opacity: l.box.opacity ?? 1, crop: { left: cx, right: cx, top: cy, bottom: cy } };
  });
}

/** Add a template's layers at `start` as one block above what shows
 * then (placeStack, ADR-073): Text rows of their own, grouped
 * when there are several, so they select and move together, as an ad
 * element does (Alt+click picks one layer). */
export function addTemplate(p: Project, t: TextTemplate, start: number): { project: Project; clipIds: Id[] } {
  let clips = templateClips(t, start, p.fps);
  if (clips.length > 1) {
    const group = uid("g");
    clips = clips.map((c) => ({ ...c, group }));
  }
  return { project: placeStack(p, clips, "Text"), clipIds: clips.map((c) => c.id) };
}

/** The look word art sets; size, alignment and wrapping stay the clip's. */
const LOOK: (keyof TextStyle)[] = ["font", "color", "bold", "italic", "letterSpacing", "stroke", "shadow", "background"];

/** A text clip's style restyled by word art: every look property comes
 * from the word art or the default, so an old shadow or box never lingers. */
export function wordArtStyle(base: TextStyle, t: TextTemplate): TextStyle {
  const look = t.layers[0]?.style ?? {};
  const out: Record<string, unknown> = { ...base };
  for (const k of LOOK) {
    const v = k in look ? look[k] : DEFAULT_TEXT_STYLE[k];
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as unknown as TextStyle;
}

/** Look a template up by key or label, the way an agent might name it. */
export function findTemplate(name: string): [string, TextTemplate] | undefined {
  const n = name.trim().toLowerCase();
  return Object.entries(TEXT_TEMPLATES).find(([k, t]) => k.toLowerCase() === n || t.label.toLowerCase() === n);
}
