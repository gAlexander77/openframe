import { expect, it } from "vitest";
import { SFX } from "./sfx";

it("makes every effect at its length, in range, audible and the same each time", () => {
  for (const [id, s] of Object.entries(SFX)) {
    const [l, r] = s.make(48000);
    expect(l.length, id).toBe(Math.round(s.seconds * 48000));
    expect(r).toEqual(l);
    let peak = 0, energy = 0;
    // One expect for the lot: one per sample made the test take seconds.
    expect(l.every(Number.isFinite), id).toBe(true);
    for (const v of l) {
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

it("ends a riser and a reverse cymbal at their peak and starts the hits on theirs", () => {
  // end_at puts a sound's end on a time, so a swell must peak at its end.
  const rms = (x: Float32Array, a: number, b: number) => Math.sqrt(x.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
  const tenth = 4800;
  for (const id of ["rise", "reverseCymbal", "swooshUp"]) {
    const [x] = SFX[id].make(48000);
    expect(rms(x, x.length - 2 * tenth, x.length), id).toBeGreaterThan(3 * rms(x, 0, 2 * tenth));
  }
  for (const id of ["impact", "subDrop", "boom"]) {
    const [x] = SFX[id].make(48000);
    expect(rms(x, 0, 2 * tenth), id).toBeGreaterThan(3 * rms(x, x.length - 2 * tenth, x.length));
  }
});
