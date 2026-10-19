import { expect, it } from "vitest";
import { BoxTracker, LOST, thin } from "./track";

const W = 160, H = 90;
/** A fixed random texture (blurred once), like footage: detail everywhere. */
const TEX = 256;
const tex = (() => {
  let s = 11;
  const r = Float32Array.from({ length: TEX * TEX }, () => ((s = (s * 16807) % 2147483647) / 2147483647) * 255);
  return Float32Array.from(r, (_, i) => (r[i] + r[(i + 1) % r.length] + r[(i + TEX) % r.length] + r[(i + TEX + 1) % r.length]) / 4);
})();

/** A dark background with a textured 20 x 20 patch whose corner is at (px, py). */
function frame(px: number, py: number) {
  const g = new Uint8Array(W * H).fill(40);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const X = Math.round(px) + x, Y = Math.round(py) + y;
    if (X >= 0 && X < W && Y >= 0 && Y < H) g[Y * W + X] = tex[y * TEX + x];
  }
  return g;
}

it("follows a moving patch frame by frame", () => {
  const path = Array.from({ length: 40 }, (_, i) => ({ x: 20 + i * 2, y: 30 + Math.round(8 * Math.sin(i / 5)) }));
  const t = new BoxTracker(frame(path[0].x, path[0].y), W, H, { x: path[0].x, y: path[0].y, w: 20, h: 20 });
  for (const p of path.slice(1)) {
    const r = t.next(frame(p.x, p.y));
    expect(r.score).toBeGreaterThan(0.9);
    expect(Math.abs(r.x - (p.x + 10))).toBeLessThan(0.6);
    expect(Math.abs(r.y - (p.y + 10))).toBeLessThan(0.6);
  }
});

it("holds still while the subject is hidden, then picks it up again", () => {
  const t = new BoxTracker(frame(50, 30), W, H, { x: 50, y: 30, w: 20, h: 20 });
  t.next(frame(52, 30));
  const hidden = t.next(new Uint8Array(W * H).fill(40));
  expect(hidden.score).toBeLessThan(LOST);
  expect(hidden.x).toBeCloseTo(62, 0);
  const back = t.next(frame(55, 31));
  expect(back.score).toBeGreaterThan(0.9);
  expect(back.x).toBeCloseTo(65, 0);
});

it("keeps only the turns of a path", () => {
  // A straight run, a corner, another straight run.
  const v = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1];
  expect(thin(v, 0.1)).toEqual([0, 5, 9]);
  expect(thin([3, 3, 3, 3], 0.1)).toEqual([0, 3]);
  expect(thin([7], 0.1)).toEqual([0]);
});
