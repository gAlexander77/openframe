// Motion tracking (CapCut's Tracking, Resolve's point tracker): follow a box
// from frame to frame by normalized cross-correlation of its picture in a
// window around where it last was, on small gray frames. The template
// adapts slowly while the match is good, so lighting and slow turns do not
// lose it, and holds still while the match is poor (the subject is hidden).
// ponytail: position only; the box keeps its size and angle. A similarity
// fit (scale and rotation from tracked corners) is the upgrade for subjects
// that approach the camera or turn.

/** A box in analysis pixels: top-left corner and size. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the box's center is on a frame, and how well it matched (-1..1). */
export interface Tracked {
  x: number;
  y: number;
  score: number;
}

/** Below this the match is taken as lost and the box holds still. */
export const LOST = 0.5;
/** At most this many template pixels a side: a big box is sampled sparser. */
const SAMPLES = 40;

export class BoxTracker {
  private readonly tpl: Float32Array;
  private readonly offs: Int32Array;
  private readonly bw: number;
  private readonly bh: number;
  private x: number;
  private y: number;

  /** `radius`: the most the box moves between frames, in pixels. */
  constructor(first: Uint8Array, private readonly width: number, private readonly height: number, box: Box, private readonly radius = Math.max(8, Math.round(width * 0.06))) {
    this.bw = Math.max(4, Math.min(width, Math.round(box.w)));
    this.bh = Math.max(4, Math.min(height, Math.round(box.h)));
    this.x = Math.max(0, Math.min(width - this.bw, Math.round(box.x)));
    this.y = Math.max(0, Math.min(height - this.bh, Math.round(box.y)));
    const step = Math.max(1, Math.ceil(Math.max(this.bw, this.bh) / SAMPLES));
    const offs: number[] = [];
    for (let j = 0; j < this.bh; j += step) for (let i = 0; i < this.bw; i += step) offs.push(j * width + i);
    this.offs = Int32Array.from(offs);
    this.tpl = this.patch(first, this.x, this.y);
  }

  /** The box's pixels at (x, y), mean removed, unit length. */
  private patch(gray: Uint8Array, x: number, y: number): Float32Array {
    const out = new Float32Array(this.offs.length);
    const at = y * this.width + x;
    let mean = 0;
    for (let k = 0; k < out.length; k++) mean += out[k] = gray[at + this.offs[k]];
    mean /= out.length;
    let norm = 0;
    for (let k = 0; k < out.length; k++) norm += (out[k] -= mean) ** 2;
    norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < out.length; k++) out[k] /= norm;
    return out;
  }

  /** Correlation of the template with the frame's pixels at (x, y). */
  private score(gray: Uint8Array, x: number, y: number): number {
    const at = y * this.width + x;
    const n = this.offs.length;
    let s = 0, q = 0, c = 0;
    for (let k = 0; k < n; k++) {
      const v = gray[at + this.offs[k]];
      s += v;
      q += v * v;
      c += v * this.tpl[k];
    }
    const sd = Math.sqrt(q - (s * s) / n);
    // The template is zero-mean, so the window's mean drops out of c.
    return sd > 1e-6 ? c / sd : 0;
  }

  /** Where the box is on the next frame. */
  next(gray: Uint8Array): Tracked {
    const r = this.radius;
    const x0 = Math.round(this.x), y0 = Math.round(this.y);
    const lx = Math.max(0, x0 - r), hx = Math.min(this.width - this.bw, x0 + r);
    const ly = Math.max(0, y0 - r), hy = Math.min(this.height - this.bh, y0 + r);
    let best = -2, bx = x0, by = y0;
    for (let y = ly; y <= hy; y++)
      for (let x = lx; x <= hx; x++) {
        const s = this.score(gray, x, y);
        if (s > best) [best, bx, by] = [s, x, y];
      }
    if (best < LOST) return { ...this.center(), score: best };
    // A parabola through the peak and its neighbors finds the fraction.
    const frac = (l: number, c: number, h: number) => {
      const d = l - 2 * c + h;
      return d < 0 ? Math.max(-0.5, Math.min(0.5, (l - h) / (2 * d))) : 0;
    };
    const fx = bx > lx && bx < hx ? frac(this.score(gray, bx - 1, by), best, this.score(gray, bx + 1, by)) : 0;
    const fy = by > ly && by < hy ? frac(this.score(gray, bx, by - 1), best, this.score(gray, bx, by + 1)) : 0;
    this.x = bx + fx;
    this.y = by + fy;
    // Adapt a little while the match is sure; never toward a poor match.
    if (best > 0.8) {
      const now = this.patch(gray, bx, by);
      let norm = 0;
      for (let k = 0; k < now.length; k++) norm += (this.tpl[k] = 0.9 * this.tpl[k] + 0.1 * now[k]) ** 2;
      norm = Math.sqrt(norm) || 1;
      for (let k = 0; k < now.length; k++) this.tpl[k] /= norm;
    }
    return { ...this.center(), score: best };
  }

  private center() {
    return { x: this.x + this.bw / 2, y: this.y + this.bh / 2 };
  }
}

/**
 * Keyframes for a tracked path: the fewest points (Ramer-Douglas-Peucker)
 * whose straight segments stay within `tol` of every sample, so a steady
 * move is two keys and a wobble keeps its turns.
 */
export function thin(values: number[], tol: number): number[] {
  if (values.length <= 2) return values.map((_, i) => i);
  const keep = new Uint8Array(values.length);
  keep[0] = keep[values.length - 1] = 1;
  const stack: [number, number][] = [[0, values.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1, dist = tol;
    for (let i = a + 1; i < b; i++) {
      const line = values[a] + ((values[b] - values[a]) * (i - a)) / (b - a);
      const d = Math.abs(values[i] - line);
      if (d > dist) [far, dist] = [i, d];
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([a, far], [far, b]);
  }
  return [...keep.keys()].filter((i) => keep[i]);
}
