import { expect, it } from "vitest";
import { SFX } from "./sfx";

it("makes every effect at its length, in range, audible and the same each time", () => {
  for (const [id, s] of Object.entries(SFX)) {
    const [l, r] = s.make(48000);
    expect(l.length, id).toBe(Math.round(s.seconds * 48000));
    expect(r).toEqual(l);
    let peak = 0, energy = 0;
    for (const v of l) {
      expect(Number.isFinite(v), id).toBe(true);
      peak = Math.max(peak, Math.abs(v));
      energy += v * v;
    }
    expect(peak, id).toBeLessThanOrEqual(0.81);
    expect(Math.sqrt(energy / l.length), id).toBeGreaterThan(0.01);
    expect(s.make(48000)[0]).toEqual(l);
  }
});

it("sweeps a whoosh's band up and back down", () => {
  // Zero crossings per window track the band's center: more in the middle.
  const [x] = SFX.whoosh.make(48000);
  const crossings = (from: number, to: number) => {
    let c = 0;
    for (let i = from + 1; i < to; i++) if (Math.sign(x[i]) !== Math.sign(x[i - 1])) c++;
    return c;
  };
  const w = 4800;
  const edge = crossings(4800, 4800 + w), mid = crossings(19200 - w / 2, 19200 + w / 2);
  // A wide band (Q 2) passes plenty either way; the middle is still well up.
  expect(mid).toBeGreaterThan(edge * 1.4);
});
