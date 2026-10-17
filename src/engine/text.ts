// Text clips rasterized with Canvas2D at render resolution, then drawn by
// the compositor as a "native" source (already canvas-scale pixels). The
// raster is cached by content: transform animation moves the quad, so only
// a text or style change, or a new render size, re-rasterizes.

import { setTextMeasure } from "../lib/align";
import { casedText } from "../lib/captions";
import type { TextClip, TextStyle } from "../lib/project/types";
import type { TextLayout } from "../lib/textBox";
import type { SourceImage } from "./compositor";

const FALLBACK_FONTS = `"Segoe UI", "Helvetica Neue", Arial, sans-serif`;

/** The font family list a style draws with; the canvas editor types in the
 * same one, so its caret lands on these glyphs. */
export const textFamily = (s: TextStyle) => `"${s.font}", ${FALLBACK_FONTS}`;
const textFont = (s: TextStyle, size: number) => `${s.italic ? "italic " : ""}${s.bold ? 700 : 400} ${size}px ${textFamily(s)}`;

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

/**
 * Rasterize a text clip for a canvas `width` x `height` render target.
 * Sizes in the style are pixels at a 1080-pixel-tall canvas.
 */
export function rasterizeText(clip: TextClip, width: number, height: number, word?: number): TextRaster {
  const s: TextStyle = clip.style;
  const key = `text:${height}:${width}:${clip.text}:${JSON.stringify(s)}${word !== undefined && s.highlight ? `:w${word}` : ""}`;
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
  const stroke = s.stroke && s.stroke.width > 0 ? s.stroke.width * k : 0;
  const shadow = s.shadow ? s.shadow.blur * k + Math.max(Math.abs(s.shadow.x), Math.abs(s.shadow.y)) * k : 0;
  const bgPad = s.background ? s.background.padding * k : 0;
  const pad = Math.ceil(stroke + shadow + bgPad + 2);
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

  if (s.background) {
    const r = s.background.radius * k;
    ctx.fillStyle = s.background.color;
    ctx.beginPath();
    ctx.roundRect(pad - bgPad, pad - bgPad, textW + bgPad * 2, lineH * lines.length + bgPad * 2, r);
    ctx.fill();
  }
  let firstWord = 0; // index of each line's first word in the whole text
  lines.forEach((line, i) => {
    const y = pad + lineH * (i + 0.5);
    const lineWords = [...line.matchAll(/\S+/g)];
    if (s.shadow) {
      ctx.shadowColor = s.shadow.color;
      ctx.shadowBlur = s.shadow.blur * k;
      ctx.shadowOffsetX = s.shadow.x * k;
      ctx.shadowOffsetY = s.shadow.y * k;
    }
    if (stroke) {
      ctx.lineJoin = "round";
      ctx.lineWidth = stroke * 2;
      ctx.strokeStyle = s.stroke!.color;
      ctx.strokeText(line, x, y);
      ctx.shadowColor = "transparent";
    }
    ctx.fillStyle = s.color;
    ctx.fillText(line, x, y);
    ctx.shadowColor = "transparent";
    if (s.underline) {
      const lw = ctx.measureText(line).width;
      const left = s.align === "left" ? x : s.align === "right" ? x - lw : x - lw / 2;
      ctx.fillRect(left, y + size * 0.42, lw, Math.max(1, size * 0.06));
    }
    // The spoken word, over the line in the highlight color.
    const j = word !== undefined && s.highlight ? word - firstWord : -1;
    if (j >= 0 && j < lineWords.length) {
      const m = lineWords[j];
      const lw = ctx.measureText(line).width;
      const left = s.align === "left" ? x : s.align === "right" ? x - lw : x - lw / 2;
      ctx.textAlign = "left";
      ctx.fillStyle = s.highlight!;
      ctx.fillText(m[0], left + ctx.measureText(line.slice(0, m.index)).width, y);
      ctx.textAlign = s.align;
    }
    firstWord += lineWords.length;
  });

  const layout = { width: w, height: h, pad, textWidth: textW, wrapWidth, size, lineHeight: lineH, letterSpacing: s.letterSpacing * k, baselineShift };
  const out: TextRaster = { image: canvas, width: w, height: h, rotation: 0, native: true, key, layout };
  cache.set(key, out);
  // ponytail: FIFO cap; an LRU only matters with hundreds of live titles.
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return out;
}

// Align and snap measure text by the same raster the compositor draws.
setTextMeasure(rasterizeText);
