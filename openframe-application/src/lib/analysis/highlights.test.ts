import { sceneSampling, SCENE_BUDGET_SECONDS } from "./highlights";
import { describe, expect, it } from "vitest";
import { findHighlights, HighlightAudio, highlightWindow, refineHighlight, rollingBaseline, type HighlightFeature } from "./highlights";

const features = (duration: number, bursts: [number, number][] = []): HighlightFeature[] => Array.from({ length: duration * 2 }, (_, i) => {
  const time = i / 2 + 0.25, loud = bursts.some(([a, b]) => time >= a && time < b);
  return { time, loudness: loud ? -15 : -30, momentary: loud ? -15 : -30, speech: 0.8, vocal: 0 };
});

describe("long VOD highlight ranking", () => {
  it("finds a burst above the surrounding median, with numeric reasons", () => {
    const found = findHighlights(features(600, [[120, 123]]), 600, { count: 3 });
    expect(found).toHaveLength(1);
    expect(Math.abs(found[0].peak - 121.5)).toBeLessThan(1.5);
    expect(found[0].reasons[0]).toContain("+15.0 LU");
    expect(found[0].score).toBeGreaterThan(0.5);
  });
  it("adapts to a sustained loud section instead of calling the whole section a highlight", () => {
    const f = features(1800, [[300, 1500]]);
    expect(rollingBaseline(f.map(x => x.loudness))[1200]).toBe(-15);
    expect(findHighlights(f, 1800)).toEqual([]);
  });
  it("suppresses nearby peaks and respects a requested minimum gap", () => {
    const found = findHighlights(features(600, [[120, 123], [130, 133], [300, 303]]), 600, { count: 10, min_gap: 30 });
    expect(found).toHaveLength(2);
    expect(Math.abs(found[0].peak - found[1].peak)).toBeGreaterThanOrEqual(30);
  });
  it("uses chat spikes, emotes, given times, optional scenes and weights", () => {
    const chat = Array.from({ length: 50 }, (_, i) => ({ time: 100 + i / 25, text: "KEKW clip that" }));
    const found = findHighlights([], 600, { count: 3, times: [400] }, chat, [99, 100, 101, 102]);
    expect(found[0].reasons.join(" ")).toContain("viewer clip at 00:06:40");
    expect(found.some(h => Math.abs(h.peak - 101) < 2 && h.reasons.some(r => r.includes("chat")))).toBe(true);
    expect(found.every(h => h.score >= 0 && h.score <= 1)).toBe(true);
    expect(findHighlights(features(600, [[120, 123]]), 600, { weights: { audio: 0, speech: 0 } })).toEqual([]);
  });
  it("ranks only the requested clip range while keeping the whole-source baseline", () => {
    const found = findHighlights(features(600, [[100, 103], [400, 403]]), 600, {}, undefined, undefined, [390, 410]);
    expect(found).toHaveLength(1);
    expect(found[0].start).toBeGreaterThanOrEqual(390);
    expect(found[0].end).toBeLessThanOrEqual(410);
  });
  it("snaps to pauses and holds min/max and the peak at both file edges", () => {
    expect(highlightWindow(100, 96, 104, 600, [91, 111], { min_length: 15, max_length: 60 })).toEqual({ start: 91, end: 111 });
    for (const peak of [0.25, 10, 290, 599.75]) {
      const h = highlightWindow(peak, peak - 50, peak + 50, 600, [0, 12, 280, 600], { min_length: 15, max_length: 30 });
      expect(h.end - h.start).toBeGreaterThanOrEqual(15);
      expect(h.end - h.start).toBeLessThanOrEqual(30);
      expect(h.start).toBeGreaterThanOrEqual(0); expect(h.end).toBeLessThanOrEqual(600);
      expect(h.start).toBeLessThanOrEqual(peak); expect(h.end).toBeGreaterThanOrEqual(peak);
    }
    expect(highlightWindow(2, 1, 3, 5, []).end).toBe(5);
  });
  it("refines sentences, keyword reasons and a short quotable title", () => {
    const h = { rank: 1, start: 90, end: 110, peak: 100, score: 0.5, reasons: ["audio"] };
    const words = [{ text: "This is a longer complete line.", start: 90, end: 96 }, { text: "No way!", start: 97, end: 101 }, { text: "We did it!", start: 102, end: 109 }];
    const r = refineHighlight(h, words, 600, { keywords: ["no way"] });
    expect(r.snippet).toContain("No way!"); expect(r.title).toBe("No way!");
    expect(r.reasons).toContain("said 'no way'"); expect(r.score).toBe(0.8);
  });
  it("detects a 10 dB speech-like burst within one second, independent of input chunks", () => {
    const rate = 16000, pcm = new Float32Array(rate * 120);
    let seed = 42, filtered = 0;
    for (let i = 0; i < pcm.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      filtered = 0.6 * filtered + 0.4 * (seed / 4294967296 * 2 - 1);
      const t = i / rate, gain = t >= 60 && t < 63 ? Math.sqrt(10) : 1;
      pcm[i] = filtered * 0.04 * gain * (0.7 + 0.3 * Math.sin(2 * Math.PI * 6 * t));
    }
    const meter = new HighlightAudio();
    for (let k = 0; k < pcm.length; k += 7777) meter.push(pcm.subarray(k, k + 7777));
    const f = meter.finish(), found = findHighlights(f, 120, { count: 1 });
    expect(f).toHaveLength(240);
    expect(found).toHaveLength(1);
    expect(Math.abs(found[0].peak - 61.5)).toBeLessThanOrEqual(1);
    expect(found[0].reasons.join(" ")).toMatch(/loudness \+\d/);
    const one = new HighlightAudio(); one.push(pcm);
    expect(one.finish()).toEqual(f);
  });
  it("finds all three ten-minute drive bursts with matching chat", () => {
    const rate = 16000, duration = 600, centers = [121.5, 301.5, 481.5];
    const pcm = new Float32Array(rate * duration);
    let seed = 42, filtered = 0;
    for (let i = 0; i < pcm.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      filtered = 0.6 * filtered + 0.4 * (seed / 4294967296 * 2 - 1);
      const t = i / rate, gain = centers.some(c => Math.abs(t - c) < 1.5) ? Math.sqrt(10) : 1;
      pcm[i] = filtered * 0.04 * gain * (0.7 + 0.3 * Math.sin(2 * Math.PI * 6 * t));
    }
    const audio = new HighlightAudio();
    for (let k = 0; k < pcm.length; k += 160000) audio.push(pcm.subarray(k, k + 160000));
    const chat = Array.from({ length: 150 }, (_, i) => ({ time: i * 4, text: "hello" }));
    for (const c of centers) for (let j = 0; j < 120; j++) chat.push({ time: c - 1.5 + j / 40, text: "KEKW clip that W" });
    const h = findHighlights(audio.finish(), duration, { count: 3, min_length: 20, max_length: 60 }, chat);
    expect(h).toHaveLength(3);
    const peaks = h.map(x => x.peak).sort((a, b) => a - b);
    peaks.forEach((peak, i) => expect(Math.abs(peak - centers[i])).toBeLessThanOrEqual(1.5));
    expect(h.every(x => x.reasons.some(r => r.includes("chat")))).toBe(true);
  });
  it("keeps sentence refinement inside a trimmed clip", () => {
    const h = { rank: 1, start: 390, end: 410, peak: 400, score: 0.5, reasons: [] };
    const refined = refineHighlight(h, [{ start: 388, end: 412, text: "A line beyond this clip!" }], 600, {}, [390, 410]);
    expect(refined.start).toBeGreaterThanOrEqual(390);
    expect(refined.end).toBeLessThanOrEqual(410);
    expect(refined.end - refined.start).toBeGreaterThanOrEqual(15);
  });
  it("returns no candidates for silence or empty signals", () => {
    const audio = new HighlightAudio(); audio.push(new Float32Array(16000 * 10));
    expect(findHighlights(audio.finish(), 10)).toEqual([]);
    expect(findHighlights([], 600)).toEqual([]);
  });
  it("ranks six hours of compact features without holding PCM", () => {
    const found = findHighlights(features(21600, [[3600, 3603], [10800, 10803], [20000, 20003]]), 21600, { count: 3 });
    expect(found).toHaveLength(3);
    expect(found.map(h => h.peak).sort((a, b) => a - b)).toEqual([3600.25, 10800.25, 20000.25]);
  });
});


it("samples long files sparsely within a bounded scene-reading budget", () => {
  expect(sceneSampling(1200)).toEqual({ interval_seconds: 1 });
  expect(sceneSampling(1201)).toEqual({ interval_seconds: 4 });
  expect(sceneSampling(45 * 60)).toEqual({ interval_seconds: 4 });
  expect(SCENE_BUDGET_SECONDS).toBe(75);
});
