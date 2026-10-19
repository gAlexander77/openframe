// Video scopes from a frame's pixels (research "Professional NLE features"
// §6.5): waveform, RGB parade, vectorscope and histogram, binned in one pass
// over a downsampled frame. Pure, so the shapes are testable; the Scopes
// panel only turns the counts into pictures. Rec.709 throughout, the same
// luma the compositor and the grade use.

export interface Frame {
  width: number;
  height: number;
  /** RGBA bytes, rows top first. */
  data: ArrayLike<number>;
}

export const KR = 0.2126;
export const KB = 0.0722;
export const KG = 1 - KR - KB;

export interface Scopes {
  /** Waveform columns (each a 256-level histogram). */
  columns: number;
  /** Luma waveform: counts[level * columns + col], level 0 = black. */
  luma: Uint32Array;
  /** Parade: the same per channel. */
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  /** Vectorscope side length; counts[y * size + x], Cb right, Cr up. */
  size: number;
  vector: Uint32Array;
  /** 256-bin histograms. */
  hist: { r: Uint32Array; g: Uint32Array; b: Uint32Array; luma: Uint32Array };
  /** Pixels binned per waveform column, to scale brightness. */
  perColumn: number;
  pixels: number;
}

/** Bin every scope in one pass. */
export function computeScopes(f: Frame, columns = 256, size = 256): Scopes {
  const { width: w, height: h, data } = f;
  const luma = new Uint32Array(columns * 256);
  const r = new Uint32Array(columns * 256);
  const g = new Uint32Array(columns * 256);
  const b = new Uint32Array(columns * 256);
  const vector = new Uint32Array(size * size);
  const hist = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), luma: new Uint32Array(256) };
  const colOf = new Uint32Array(w);
  for (let x = 0; x < w; x++) colOf[x] = Math.min(columns - 1, Math.floor((x * columns) / w));
  const k = size - 1;
  for (let y = 0; y < h; y++) {
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      const R = data[i];
      const G = data[i + 1];
      const B = data[i + 2];
      const Y = KR * R + KG * G + KB * B;
      const L = Math.round(Y);
      const col = colOf[x];
      luma[L * columns + col]++;
      r[R * columns + col]++;
      g[G * columns + col]++;
      b[B * columns + col]++;
      hist.r[R]++;
      hist.g[G]++;
      hist.b[B]++;
      hist.luma[L]++;
      // Cb, Cr in -0.5..0.5
      const cb = (B - Y) / (2 * (1 - KB) * 255);
      const cr = (R - Y) / (2 * (1 - KR) * 255);
      const vx = Math.round((cb + 0.5) * k);
      const vy = Math.round((0.5 - cr) * k);
      vector[vy * size + vx]++;
    }
  }
  return { columns, luma, r, g, b, size, vector, hist, perColumn: (w * h) / columns, pixels: w * h };
}

/** Where a color (0..1 RGB) lands on a vectorscope of side `size`. */
export function vectorPoint([R, G, B]: [number, number, number], size: number): [number, number] {
  const Y = KR * R + KG * G + KB * B;
  const cb = (B - Y) / (2 * (1 - KB));
  const cr = (R - Y) / (2 * (1 - KR));
  return [(cb + 0.5) * (size - 1), (0.5 - cr) * (size - 1)];
}

/** The six color-bar targets, as broadcast scopes draw them. */
export const TARGETS: { label: string; rgb: [number, number, number] }[] = [
  { label: "R", rgb: [1, 0, 0] },
  { label: "Mg", rgb: [1, 0, 1] },
  { label: "B", rgb: [0, 0, 1] },
  { label: "Cy", rgb: [0, 1, 1] },
  { label: "G", rgb: [0, 1, 0] },
  { label: "Yl", rgb: [1, 1, 0] },
];

/** The skin-tone (flesh) line: every complexion's hue sits near it,
 * ≈123° counterclockwise from the +Cb axis, between red and yellow. */
export const SKIN_TONE_DEG = 123;

/** Display brightness for a bin: log-scaled so a few scattered pixels
 * still show while a flat area saturates; `ref` is the count that reads
 * as full brightness. */
export function scopeLevel(count: number, ref: number): number {
  if (count <= 0) return 0;
  return Math.min(1, Math.log1p(count) / Math.log1p(Math.max(ref, 1)));
}
