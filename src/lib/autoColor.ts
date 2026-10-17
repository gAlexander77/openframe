// Auto adjust (CapCut's Auto adjust, Lumetri's Auto): Basic slider values
// that correct a frame, solved against the color pass's own formulas
// (src/engine/shaders.ts adjustColor): exposure brings the median toward
// mid gray, blacks and whites stretch the 1st and 99th percentiles to the
// ends, and temperature and tint balance the channels (gray world). Each is
// held back by `strength` so a deliberately dark or warm shot is not
// flattened.

export interface FrameStats {
  /** Channel means of the near-neutral pixels, 0..1: what should be gray.
   * Bright colored objects would fool a whole-frame average. */
  r: number;
  g: number;
  b: number;
  /** Share of pixels that are near-neutral; too few leave the balance be. */
  neutral: number;
  /** Luma percentiles, 0..1. */
  p1: number;
  p50: number;
  p99: number;
}

/** Statistics of RGBA pixels (8-bit). Fully transparent pixels are left out. */
export function frameStats(rgba: Uint8ClampedArray | Uint8Array): FrameStats {
  const hist = new Uint32Array(256);
  let r = 0, g = 0, b = 0, m = 0, n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const [R, G, B] = [rgba[i], rgba[i + 1], rgba[i + 2]];
    const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    hist[Math.round(l)]++;
    n++;
    // Near-neutral and neither black nor clipped: a cast shows there.
    if (Math.max(R, G, B) - Math.min(R, G, B) < 40 && l > 25 && l < 240) {
      r += R;
      g += G;
      b += B;
      m++;
    }
  }
  if (!n) return { r: 0.5, g: 0.5, b: 0.5, neutral: 0, p1: 0, p50: 0.5, p99: 1 };
  const pct = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= q * n) return v / 255;
    return 1;
  };
  const k = m ? m * 255 : 1;
  return { r: m ? r / k : 0.5, g: m ? g / k : 0.5, b: m ? b / k : 0.5, neutral: m / n, p1: pct(0.01), p50: pct(0.5), p99: pct(0.99) };
}

export interface AutoAdjust {
  exposure: number;
  temperature: number;
  tint: number;
  blacks: number;
  whites: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const slider = (v: number) => Math.round(v * 100);

/** Slider values (-100..100) that correct a frame with these statistics. */
export function autoAdjust(s: FrameStats, strength = 0.8): AutoAdjust {
  // Exposure first (the pass applies it first): a median outside 0.35-0.65
  // moves toward that band; inside it a frame is left as shot.
  const want = s.p50 < 0.35 ? 0.4 : s.p50 > 0.65 ? 0.55 : s.p50;
  const e = clamp((Math.log2(want / Math.max(s.p50, 0.02)) / 2) * strength, -0.5, 0.5);
  const k = 2 ** (2 * e);
  // Levels on the exposed values, c' = (c - 0.15 b) / (1 + 0.25 w - 0.15 b):
  // a lifted black point comes down, highlights short of white reach 0.98.
  const lo = s.p1 * k, hi = Math.min(1.5, s.p99 * k);
  const blacks = lo > 0.04 ? clamp((lo / 0.15) * strength, 0, 0.4) : 0;
  const whites = hi < 0.94 || hi > 1.02 ? clamp(((hi - 0.98) / 0.25) * strength, -0.5, 0.3) : 0;
  // White balance on the neutral pixels: red and blue meet (temperature),
  // green meets their mean (tint), as the pass scales them. Under 3 %
  // neutral (a frame of saturated color), the balance is left as shot.
  const wb = s.neutral >= 0.03;
  const temperature = wb ? clamp(((s.b - s.r) / (0.2 * Math.max(s.r + s.b, 0.02))) * strength, -0.4, 0.4) : 0;
  const rb = (s.r + s.b) / 2;
  const tint = wb ? clamp(((s.g - rb) / (0.15 * Math.max(s.g, 0.02))) * strength, -0.25, 0.25) : 0;
  return { exposure: slider(e), temperature: slider(temperature), tint: slider(tint), blacks: slider(blacks), whites: slider(whites) };
}
