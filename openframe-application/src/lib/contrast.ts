// What check_project measures instead of guessing (ADR-068): the contrast of
// a title against the rendered picture behind it, by WCAG 2.x's relative
// luminance, and how loud a music clip still is in its last moments. The
// app renders and decodes (automation.ts); these turn pixels and samples
// into numbers, so they are tested.

/** WCAG 2.x relative luminance of an sRGB color, channels 0..1. */
export function luminance([r, g, b]: readonly number[]): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two luminances, 1..21. */
export const contrastRatio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** A box of a picture, in its pixels: left, top, right, bottom. */
export interface PixelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Backdrop {
  /** The worst contrast with the picture behind most of the letters: the
   * backdrop pixel at the 90th percentile toward the text's own lightness. */
  ratio: number;
  /** That backdrop pixel, channels 0..1. */
  backdrop: [number, number, number];
}

/**
 * The contrast of text colors (channels 0..1, alpha last; a gradient gives
 * both ends) with the RGBA pixels of a `width`-wide picture inside `box`.
 * Light text is judged against the bright end of what is behind it, dark
 * text against the dark end: the 90th percentile, so a few stray pixels
 * (a spark, a highlight) do not decide it but a bright half does. A
 * translucent color is mixed with the backdrop first, as it is drawn.
 */
export function measureBackdrop(colors: readonly (readonly number[])[], rgba: ArrayLike<number>, width: number, box: PixelBox): Backdrop | null {
  const height = Math.floor(rgba.length / 4 / width);
  const l = Math.max(0, Math.floor(box.left)), r = Math.min(width, Math.ceil(box.right));
  const t = Math.max(0, Math.floor(box.top)), b = Math.min(height, Math.ceil(box.bottom));
  if (r <= l || b <= t) return null;
  // At most ~4000 samples: a grid over the box.
  const step = Math.max(1, Math.floor(Math.sqrt(((r - l) * (b - t)) / 4000)));
  const px: { lum: number; rgb: [number, number, number] }[] = [];
  for (let y = t; y < b; y += step)
    for (let x = l; x < r; x += step) {
      const i = (y * width + x) * 4;
      const rgb: [number, number, number] = [rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255];
      px.push({ lum: luminance(rgb), rgb });
    }
  px.sort((a, c) => a.lum - c.lum);
  let worst: Backdrop | null = null;
  for (const color of colors) {
    const alpha = color[3] ?? 1;
    const median = px[Math.floor(px.length / 2)];
    const light = luminance(color) >= median.lum;
    const at = px[Math.min(px.length - 1, Math.floor((light ? 0.9 : 0.1) * (px.length - 1) + 0.5))];
    const drawn = [0, 1, 2].map((k) => color[k] * alpha + at.rgb[k] * (1 - alpha));
    const ratio = contrastRatio(luminance(drawn), at.lum);
    if (!worst || ratio < worst.ratio) worst = { ratio: +ratio.toFixed(2), backdrop: at.rgb };
  }
  return worst;
}

/** A color, channels 0..1, as #rrggbb. */
export const hex = (rgb: readonly number[]) => `#${rgb.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;

export interface Tail {
  /** RMS level of the last quarter second, dBFS. */
  endDb: number;
  /** RMS level of the three seconds before the last one, dBFS. */
  bodyDb: number;
}

const db = (x: Float32Array, from: number, to: number) => {
  let e = 0;
  const a = Math.max(0, from), b = Math.min(x.length, to);
  for (let i = a; i < b; i++) e += x[i] * x[i];
  return b > a ? +(10 * Math.log10(e / (b - a) + 1e-12)).toFixed(1) : -120;
};

/** How loud a clip's sound is at its very end against just before: mono
 * samples at `rate` that end where the clip ends (four seconds or so). */
export function tailLevels(x: Float32Array, rate: number): Tail {
  const n = x.length;
  return { endDb: db(x, n - Math.round(rate / 4), n), bodyDb: db(x, n - 4 * rate, n - rate) };
}

/** Does the sound end by itself: silent at the end, or 18 dB or more under
 * what came before (a fade or a ringing-out last chord)? */
export const endsByItself = (t: Tail) => t.endDb < -50 || t.endDb <= t.bodyDb - 18;
