// Titles that count (add_counter, set_counter, ADR-147).
import { describe, expect, it } from "vitest";
import { describeProject, runCommand } from "./commands";
import { countedClip, counterValue, formatCount, widestCount } from "./counter";
import { createProject, createTextClip } from "./project/defaults";
import { layerAt } from "./render/plan";
import type { Counter, Project, TextClip } from "./project/types";

const fps = { num: 30, den: 1 };
const titles = (p: Project) => p.tracks.flatMap((t) => t.clips).filter((c): c is TextClip => c.type === "text");
/** What a title reads at a timeline second, as the render plan draws it. */
const reads = (p: Project, c: TextClip, seconds: number) => {
  const s = layerAt(p, c, c.start + Math.round(seconds * 30))!.source;
  return s.kind === "text" ? s.clip.text : "";
};

describe("a counter's number", () => {
  it("runs from one value to the other over its seconds, then holds", () => {
    const c: Counter = { from: 0, to: 100, seconds: 2, ease: "linear" };
    expect([0, 29.5, 59, 200].map((r) => counterValue(c, r, fps))).toEqual([0, 50, 100, 100]);
    // By default a statistic arrives fast and settles: past halfway at the midpoint.
    expect(counterValue({ from: 0, to: 100, seconds: 2 }, 29.5, fps)).toBeGreaterThan(60);
    expect(counterValue({ from: 10, to: 0, seconds: 10, format: "time" }, 150, fps)).toBeCloseTo(4.98, 1);
  });

  it("never shows a number the count has not reached: rising rounds down, falling up", () => {
    expect(formatCount(12499.7, { from: 0, to: 12500, seconds: 1 })).toBe("12,499");
    expect(formatCount(12500, { from: 0, to: 12500, seconds: 1 })).toBe("12,500");
    expect(formatCount(9.2, { from: 10, to: 0, seconds: 10 })).toBe("10");
    expect(formatCount(4.25, { from: 0, to: 4.9, seconds: 1, decimals: 1 })).toBe("4.2");
    expect(formatCount(2026, { from: 1990, to: 2026, seconds: 1, format: "plain" })).toBe("2026");
  });

  it("reads seconds as a clock", () => {
    const t = (v: number, extra: Partial<Counter> = {}) => formatCount(v, { from: 0, to: 7200, seconds: 1, format: "time", ...extra });
    expect([t(0), t(65.9), t(600), t(3725)]).toEqual(["0:00", "1:05", "10:00", "1:02:05"]);
    expect(t(9.57, { decimals: 1 })).toBe("0:09.5");
    // A countdown reads 0:10 for its whole first second.
    expect(formatCount(9.01, { from: 10, to: 0, seconds: 10, format: "time" })).toBe("0:10");
  });

  it("fills every {n}, and a styled run over it covers the whole number", () => {
    const clip: TextClip = { ...createTextClip("Up {n}% to {n}", 0, 60, { runs: [{ start: 3, end: 7, color: "#ff0" }, { start: 11, end: 14, weight: 900 }] }), counter: { from: 0, to: 1250, seconds: 2 } };
    const end = countedClip(clip, 59, fps);
    expect(end.text).toBe("Up 1,250% to 1,250");
    expect(end.style.runs!.map((r) => end.text.slice(r.start, r.end))).toEqual(["1,250%", "1,250"]);
    expect(countedClip(clip, 0, fps).text).toBe("Up 0% to 0");
    expect(widestCount(clip, fps).text).toBe("Up 1,250% to 1,250");
    expect(countedClip({ ...clip, counter: undefined }, 30, fps)).toEqual({ ...clip, counter: undefined });
  });
});

describe("add_counter and set_counter", () => {
  const made = () => runCommand(createProject({ fps }), "add_counter", { text: "{n}+ creators", from: 0, to: 12500, start: 1, duration: 3, count_seconds: 1.5, ease: "linear", style: { size: 150 } });

  it("adds a title the render plan counts: its first number, the last, then held", () => {
    const p = made();
    const [c] = titles(p);
    expect(c.text).toBe("{n}+ creators");
    expect(c.counter).toEqual({ from: 0, to: 12500, seconds: 1.5, ease: "linear" });
    expect([0, 0.5, 1.5, 2.9].map((s) => reads(p, c, s))).toEqual(["0+ creators", "4,261+ creators", "12,500+ creators", "12,500+ creators"]);
    expect(c.style.size).toBe(150);
    expect((describeProject(p).tracks.flatMap((t) => t.clips)[0] as { counter?: unknown }).counter).toEqual({ from: 0, to: 12500, count_seconds: 1.5, ease: "linear" });
  });

  it("counts for two thirds of the clip by default, and for all of it as a clock", () => {
    const p = runCommand(createProject({ fps }), "add_counter", { from: 0, to: 90, start: 0, duration: 3 });
    expect(titles(p)[0].counter).toEqual({ from: 0, to: 90, seconds: 2 });
    const timer = runCommand(createProject({ fps }), "add_counter", { from: 10, to: 0, format: "time", start: 0, duration: 10 });
    const [t] = titles(timer);
    expect(t.counter).toEqual({ from: 10, to: 0, seconds: 10, format: "time" });
    expect([0, 0.5, 5, 9.99].map((s) => reads(timer, t, s))).toEqual(["0:10", "0:10", "0:05", "0:00"]);
  });

  it("set_counter changes what is given, turns a title into a counter, and stops one", () => {
    const p = made();
    const id = titles(p)[0].id;
    const q = runCommand(p, "set_counter", { clip_id: id, to: 20000, format: "plain" });
    expect(titles(q)[0].counter).toEqual({ from: 0, to: 20000, seconds: 1.5, format: "plain", ease: "linear" });
    expect(titles(runCommand(q, "set_counter", { clip_id: id, off: true }))[0].counter).toBeUndefined();
    const plain = runCommand(createProject({ fps }), "add_text", { text: "Sold: {n}", start: 0, duration: 3 });
    const tid = titles(plain)[0].id;
    expect(() => runCommand(plain, "set_counter", { clip_id: tid, to: 5 })).toThrow("give from and to");
    expect(titles(runCommand(plain, "set_counter", { clip_id: tid, from: 0, to: 5 }))[0].counter).toEqual({ from: 0, to: 5, seconds: 2 });
  });

  it("asks for {n} where the number goes", () => {
    expect(() => runCommand(createProject({ fps }), "add_counter", { text: "creators", from: 0, to: 9, start: 0, duration: 2 })).toThrow("text needs {n}");
    const plain = runCommand(createProject({ fps }), "add_text", { text: "Sold", start: 0, duration: 3 });
    expect(() => runCommand(plain, "set_counter", { clip_id: titles(plain)[0].id, from: 0, to: 5 })).toThrow("its text has no {n}");
  });
});
