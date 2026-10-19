// Motion blur from movement (ADR-058), After Effects' model: a layer with
// motion blur on is drawn at several instants spread over the shutter and
// averaged. 180 degrees (AE's default, with its phase of -90) opens a
// quarter frame before the frame and closes a quarter after. The plan
// decides the instants (pure, here); the compositor draws and averages.

export interface Placement {
  x: number;
  y: number;
  scale: number;
  scaleY?: number;
  rotation: number;
}

/** Most samples a moving layer gets: every frame of an export (and the
 * paused viewer, which agents read through preview_frame), and fewer
 * while playing, where a frame has a few milliseconds. */
export const MOTION_SAMPLES = { full: 32, playing: 6 };

/** A sample per this many pixels of travel, as AE's adaptive sampling
 * adds samples for fast moves. */
const SPACING = 2;

/** Less travel than this over the shutter draws the layer once. */
export const STILL_PX = 0.5;

/** The offsets (frames from the frame) of `n` stratified samples over a
 * shutter of `angle` degrees centered on the frame. */
export function shutterOffsets(n: number, angle: number): number[] {
  const open = Math.max(0, Math.min(720, angle)) / 360;
  if (n <= 1 || open === 0) return [0];
  return Array.from({ length: n }, (_, k) => ((k + 0.5) / n - 0.5) * open);
}

/** Canvas pixels of the picture's corners at a placement: `w`, `h` its
 * size at scale 1, `W`, `H` the canvas. */
function corners(t: Placement, w: number, h: number, W: number, H: number): [number, number][] {
  const cx = W / 2 + t.x * W, cy = H / 2 + t.y * H;
  const hx = (w * t.scale) / 2, hy = (h * (t.scaleY ?? t.scale)) / 2;
  const rad = (t.rotation * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + c * a * hx - s * b * hy, cy + s * a * hx + c * b * hy]);
}

/** How far (canvas pixels) the picture's farthest-moving corner travels
 * along a path of placements. */
export function travel(path: Placement[], w: number, h: number, W: number, H: number): number {
  const pts = path.map((t) => corners(t, w, h, W, H));
  let most = 0;
  for (let k = 0; k < 4; k++) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][k][0] - pts[i - 1][k][0], pts[i][k][1] - pts[i - 1][k][1]);
    most = Math.max(most, d);
  }
  return most;
}

/** How many samples a travel of `px` needs, 1 (still) to `max`. */
export function samplesFor(px: number, max: number): number {
  if (max <= 1 || px < STILL_PX) return 1;
  return Math.max(2, Math.min(max, Math.ceil(px / SPACING)));
}

/** The transitions whose pictures move, in progress units: their shader
 * pass averages over the shutter too. */
export const MOVING_TRANSITIONS = new Set(["slideLeft", "slideRight", "pushLeft", "pushUp", "zoomIn", "zoomOut", "spin"]);
