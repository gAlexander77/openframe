// Text clips rasterized with Canvas2D at render resolution, then drawn by
// the compositor as a "native" source (already canvas-scale pixels). The
// raster is cached by content: transform animation moves the quad, so only
// a text or style change, or a new render size, re-rasterizes. A title
// whose letters, words or lines animate (lib/kinetic.ts) rasterizes each
// frame of that animation, every unit drawn at its own place, scale and
// opacity; preview and export plan the same frame, so they agree.

import { setTextMeasure } from "../lib/align";
import { ANIMATIONS } from "../lib/catalog";
import { casedText } from "../lib/captions";
import { caretAfter, finestUnit, hasSweep, isMoving, KINETIC_PAD, kineticKey, layoutAtoms, lineSweeps, SWEEP_PAD, sweepAt, unitStates, type KineticFrame, type UnitState } from "../lib/kinetic";
import type { TextClip, TextStyle } from "../lib/project/types";
import type { TextLayout } from "../lib/textBox";
import { styleKeyed } from "../lib/textAnim";
import { fontWeight, gradientLine, lookReach, stroke2Width } from "../lib/textLook";
import type { SourceImage } from "./compositor";

const FALLBACK_FONTS = `"Segoe UI", "Helvetica Neue", Arial, sans-serif`;

/** The font family list a style draws with; the canvas editor types in the
 * same one, so its caret lands on these glyphs. */
export const textFamily = (s: TextStyle) => `"${s.font}", ${FALLBACK_FONTS}`;
const textFont = (s: TextStyle, size: number) => `${s.italic ? "italic " : ""}${fontWeight(s)} ${size}px ${textFamily(s)}`;

/** Break text into lines that fit `maxWidth`, keeping explicit newlines. */
function wrap(ctx: OffscreenCanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      const next = line + w;
      if (line && ctx.measureText(next.trimEnd()).width > maxWidth) {
        lines.push(line.trimEnd());
        line = w.trimStart();
      } else line = next;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** A text raster, and how its text was laid out (the on-canvas editor
 * sits on it, ADR-030). */
export type TextRaster = SourceImage & { layout: TextLayout };

const cache = new Map<string, TextRaster>();

/** The marker sweep's warm yellow when the style names no accent. */
const MARKER = "#ffd84d";

/** One run of text to draw: a whole line (aligned as the style says) or a
 * unit of a kinetic title (left-aligned at x, moved by its state about its
 * center). `spoken` marks the karaoke word. */
interface Piece {
  text: string;
  x: number;
  y: number;
  align: CanvasTextAlign;
  /** Unit pieces: the center it moves and scales about, and its state. */
  cx?: number;
  width: number;
  state?: UnitState;
  spoken?: boolean;
  /** Whole lines: where the karaoke word sits in it, to redraw it on top. */
  word?: { text: string; x: number };
}

/**
 * Rasterize a text clip for a canvas `width` x `height` render target.
 * Sizes in the style are pixels at a 1080-pixel-tall canvas. `word` is the
 * spoken word (karaoke), `kinetic` the per-unit animations playing now.
 */
export function rasterizeText(clip: TextClip, width: number, height: number, word?: number, kinetic?: KineticFrame): TextRaster {
  const s: TextStyle = clip.style;
  const kin = kinetic && (kinetic.in || kinetic.out || kinetic.loop) ? kinetic : undefined;
  const key = `text:${height}:${width}:${clip.text}:${JSON.stringify(s)}${word !== undefined && s.highlight ? `:w${word}` : ""}${kin ? `:k${kineticKey(kin)}` : ""}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const k = height / 1080;
  const size = s.size * k;
  const canvas = new OffscreenCanvas(2, 2);
  const ctx = canvas.getContext("2d")!;
  const font = textFont(s, size);
  ctx.font = font;
  ctx.letterSpacing = `${s.letterSpacing * k}px`;
  const wrapWidth = s.maxWidth * width;
  const lines = wrap(ctx, casedText(clip.text, s.case) || " ", wrapWidth);
  const lineH = size * s.lineHeight;
  const textW = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  const reach = lookReach(s, k);
  // Moving units need room to rise, pop and slide without being cut off;
  // a settled title keeps the tight raster the editor and snapping measure.
  // A sweep's marker reaches a little past the letters, at rest too.
  const moving = !!kin && isMoving(kin);
  const pad = Math.ceil(reach.total + 2) + (moving && finestUnit(kin!) ? Math.ceil(size * KINETIC_PAD) : 0) + (hasSweep(clip, ANIMATIONS) ? Math.ceil(size * SWEEP_PAD) : 0);
  const w = Math.ceil(textW + pad * 2);
  const h = Math.ceil(lineH * lines.length + pad * 2);
  // "middle" puts the em box's center on the line's center; CSS puts the
  // center of the font's ascent plus descent there instead.
  const font0 = ctx.measureText("");
  ctx.textBaseline = "middle";
  const aboveMiddle = font0.fontBoundingBoxAscent - ctx.measureText("").fontBoundingBoxAscent;
  const baselineShift = aboveMiddle - (font0.fontBoundingBoxAscent - font0.fontBoundingBoxDescent) / 2;
  canvas.width = w;
  canvas.height = h;
  // Resizing a canvas resets its state.
  ctx.font = font;
  ctx.letterSpacing = `${s.letterSpacing * k}px`;
  ctx.textBaseline = "middle";
  ctx.textAlign = s.align;
  const x = s.align === "left" ? pad : s.align === "right" ? w - pad : w / 2;

  // Each line's left edge and width, whichever way it is aligned.
  const geo = lines.map((line, i) => {
    const lw = ctx.measureText(line).width;
    return { line, y: pad + lineH * (i + 0.5), lw, left: s.align === "left" ? x : s.align === "right" ? x - lw : x - lw / 2 };
  });

  const fine = kin && finestUnit(kin);
  let pieces: Piece[];
  let caretAt: { x: number; y: number } | undefined;
  if (fine) {
    const laid = layoutAtoms(lines, fine);
    const states = unitStates(laid.atoms, laid, kin!, ANIMATIONS);
    pieces = laid.atoms.map((a, i) => {
      const g = geo[a.line];
      const ax = g.left + ctx.measureText(g.line.slice(0, a.start)).width;
      const aw = ctx.measureText(g.line.slice(a.start, a.end)).width;
      return { text: g.line.slice(a.start, a.end), x: ax, y: g.y, align: "left", cx: ax + aw / 2, width: aw, state: states[i], spoken: word !== undefined && !!s.highlight && a.word === word };
    });
    const shown = caretAfter(kin!, laid.letters, ANIMATIONS);
    if (shown !== undefined) {
      const last = laid.atoms.filter((a) => a.letter < shown).at(-1);
      const p = last && pieces[laid.atoms.indexOf(last)];
      caretAt = p ? { x: p.x + p.width + size * 0.04, y: p.y } : { x: geo[0].left, y: geo[0].y };
    }
  } else {
    let firstWord = 0; // index of each line's first word in the whole text
    pieces = geo.map((g) => {
      const lineWords = [...g.line.matchAll(/\S+/g)];
      const j = word !== undefined && s.highlight ? word - firstWord : -1;
      firstWord += lineWords.length;
      const m = j >= 0 && j < lineWords.length ? lineWords[j] : undefined;
      return { text: g.line, x, y: g.y, align: s.align, width: g.lw, ...(m ? { word: { text: m[0], x: g.left + ctx.measureText(g.line.slice(0, m.index)).width } } : {}) };
    });
  }

  // The box arrives and leaves with the units: its opacity follows the
  // most visible one, so a boxed title whose letters fade in does not
  // show an empty box first (the ad drive's first frame did).
  const bgPad = reach.box;
  if (s.background) {
    const r = s.background.radius * k;
    ctx.save();
    ctx.globalAlpha = pieces.some((p) => p.state) ? Math.min(1, Math.max(0, ...pieces.map((p) => p.state?.opacity ?? 1))) : 1;
    ctx.fillStyle = s.background.color;
    ctx.beginPath();
    ctx.roundRect(pad - bgPad, pad - bgPad, textW + bgPad * 2, lineH * lines.length + bgPad * 2, r);
    ctx.fill();
    ctx.restore();
  }

  const sweep = kin && sweepAt(kin, ANIMATIONS);
  const shares = (amount: number) => lineSweeps(geo.map((g) => g.lw), amount);
  if (sweep?.marker) {
    const fractions = shares(sweep.marker);
    // A highlighter pass behind the words, left to right, line by line.
    ctx.fillStyle = s.accent ?? MARKER;
    const px = size * 0.18;
    geo.forEach((g, i) => {
      if (fractions[i] <= 0) return;
      ctx.beginPath();
      ctx.roundRect(g.left - px, g.y - size * 0.42, (g.lw + px * 2) * fractions[i], size * 0.86, size * 0.12);
      ctx.fill();
    });
  }

  // The gradient runs across the whole text block, in raster pixels; a unit
  // drawn moved maps its ends into its own coordinates, so the colors stay
  // put while the letters travel through them.
  const grad = s.gradient && gradientLine(w / 2, h / 2, textW, lineH * lines.length, s.gradient.angle);
  const fillStyle = (spoken?: boolean): string | CanvasGradient => {
    if (spoken) return s.highlight!;
    if (!grad || !s.gradient) return s.color;
    const m = ctx.getTransform().invertSelf();
    const a = m.transformPoint({ x: grad[0], y: grad[1] }), b = m.transformPoint({ x: grad[2], y: grad[3] });
    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    g.addColorStop(0, s.gradient.from);
    g.addColorStop(1, s.gradient.to);
    return g;
  };

  /** Draw every piece once, in the given pass, each with its own move. */
  const each = (draw: (p: Piece) => void) => {
    for (const p of pieces) {
      const st = p.state;
      if (st && st.opacity <= 0.002) continue;
      if (!st) {
        ctx.textAlign = p.align;
        draw(p);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.min(1, st.opacity);
      if (st.blur > 0.05) ctx.filter = `blur(${(st.blur * k).toFixed(2)}px)`;
      ctx.translate(p.cx! + st.x * size, p.y + st.y * size);
      if (st.rotation) ctx.rotate((st.rotation * Math.PI) / 180);
      if (st.scale !== 1) ctx.scale(st.scale, st.scale);
      ctx.translate(-p.cx!, -p.y);
      ctx.textAlign = "left";
      draw(p);
      ctx.restore();
    }
  };
  const shadowOn = () => {
    ctx.shadowColor = s.shadow!.color;
    ctx.shadowBlur = s.shadow!.blur * k;
    ctx.shadowOffsetX = s.shadow!.x * k;
    ctx.shadowOffsetY = s.shadow!.y * k;
  };
  const shadowOff = () => {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
  };
  // The drop shadow goes under the outermost part drawn: the second
  // outline, else the outline, else the fill.
  const outer = reach.stroke2 ? "stroke2" : reach.stroke ? "stroke" : "fill";
  ctx.lineJoin = "round";

  if (s.glow && reach.glow) {
    const n = Math.max(1, Math.min(3, Math.round(s.glow.strength ?? 1)));
    each((p) => {
      ctx.shadowColor = s.glow!.color;
      ctx.shadowBlur = reach.glow;
      ctx.fillStyle = s.glow!.color;
      ctx.strokeStyle = s.glow!.color;
      // The glow surrounds the outlines too.
      const outline = (reach.stroke + reach.stroke2) * 2;
      ctx.lineWidth = outline;
      for (let i = 0; i < n; i++) {
        ctx.fillText(p.text, p.x, p.y);
        if (outline > 0) ctx.strokeText(p.text, p.x, p.y);
      }
      shadowOff();
    });
  }
  if (reach.stroke2) {
    each((p) => {
      if (s.shadow && outer === "stroke2") shadowOn();
      ctx.lineWidth = stroke2Width(reach.stroke, reach.stroke2);
      ctx.strokeStyle = s.stroke2!.color;
      ctx.strokeText(p.text, p.x, p.y);
      shadowOff();
    });
  }
  if (reach.stroke) {
    each((p) => {
      if (s.shadow && outer === "stroke") shadowOn();
      ctx.lineWidth = reach.stroke * 2;
      ctx.strokeStyle = s.stroke!.color;
      ctx.strokeText(p.text, p.x, p.y);
      shadowOff();
    });
  }
  each((p) => {
    if (s.shadow && outer === "fill") shadowOn();
    ctx.fillStyle = fillStyle(p.spoken);
    ctx.fillText(p.text, p.x, p.y);
    shadowOff();
    if (s.underline) {
      const left = p.state ? p.x : p.align === "left" ? p.x : p.align === "right" ? p.x - p.width : p.x - p.width / 2;
      ctx.fillRect(left, p.y + size * 0.42, p.width, Math.max(1, size * 0.06));
    }
    // The spoken word, over the line in the highlight color.
    if (p.word) {
      ctx.textAlign = "left";
      ctx.fillStyle = s.highlight!;
      ctx.fillText(p.word.text, p.word.x, p.y);
    }
  });

  if (sweep?.underline) {
    const fractions = shares(sweep.underline);
    ctx.fillStyle = s.accent ?? s.color;
    const t = Math.max(2, size * 0.08);
    geo.forEach((g, i) => {
      if (fractions[i] <= 0) return;
      ctx.beginPath();
      ctx.roundRect(g.left, g.y + size * 0.52, g.lw * fractions[i], t, t / 2);
      ctx.fill();
    });
  }
  if (caretAt) {
    ctx.fillStyle = s.color;
    ctx.fillRect(caretAt.x, caretAt.y - size * 0.45, Math.max(2, size * 0.07), size * 0.9);
  }

  const layout = { width: w, height: h, pad, textWidth: textW, wrapWidth, size, lineHeight: lineH, letterSpacing: s.letterSpacing * k, baselineShift };
  // A kinetic frame, or a title whose size, spacing or color is keyed
  // (ADR-071), is drawn once: unkeyed, the compositor uploads it into a
  // scratch texture instead of keeping one per frame of the animation.
  const out: TextRaster = { image: canvas, width: w, height: h, rotation: 0, native: true, ...(moving || styleKeyed(clip) ? {} : { key }), layout };
  cache.set(key, out);
  // ponytail: FIFO cap; an LRU only matters with hundreds of live titles.
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return out;
}

// Align and snap measure text by the same raster the compositor draws.
setTextMeasure(rasterizeText);
