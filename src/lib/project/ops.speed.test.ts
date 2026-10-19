// Speed curves and reverse through every op that touches `in` or a clip's
// length. The property each test pins: frames that are still on screen after
// the edit show exactly the source they showed before it (ADR-027).

import { describe, expect, it } from "vitest";
import { PRESETS, speedAt } from "../speed";
import { clipForAsset, createColorClip, createProject, normalizeProject } from "./defaults";
import {
  addClip,
  detachAudio,
  findClip,
  freezeFrame,
  reverseProblem,
  roomLeft,
  roomRight,
  rollEdit,
  setChangePitch,
  setFps,
  setReverse,
  setSpeed,
  setSpeedCurve,
  slideClip,
  slipClip,
  sourceOffset,
  sourceRange,
  sourceTimeAt,
  splitClip,
  trimClip,
} from "./ops";
import type { Rational } from "../time";
import type { Asset, AudioClip, Clip, Project, VideoClip } from "./types";

const asset: Asset = { id: "a1", kind: "video", name: "a.mp4", src: "a.mp4", duration: 10, hasVideo: true, hasAudio: true };
const fps = { num: 30, den: 1 };

function project(...spec: [number, number, number][]): Project {
  let p = { ...createProject(), assets: [asset] };
  spec.forEach(([start, duration, inS], i) => {
    p = addClip(p, p.tracks[0].id, { ...clipForAsset(asset, start, p.fps), id: `c${i + 1}`, duration, in: inS } as Clip);
  });
  return p;
}

const clip = (p: Project, id: string) => findClip(p, id)!.clip as VideoClip;

/** c1 = 3 s of source from 2 s with the Montage curve (optionally reversed),
 * followed by c2. */
function curved(reverse = false): Project {
  let p = setSpeedCurve(project([0, 90, 2], [90, 30, 0]), "c1", PRESETS.montage.points, "montage");
  if (reverse) p = setReverse(p, "c1", true);
  return p;
}

/** Source time shown at each timeline frame a clip covers. */
function picture(c: VideoClip | AudioClip): Map<number, number> {
  const m = new Map<number, number>();
  for (let f = c.start; f < c.start + c.duration; f++) m.set(f, sourceTimeAt(c, f, fps));
  return m;
}

/** Every frame `after` still covers shows what `before` showed there. */
function samePicture(before: VideoClip, after: VideoClip) {
  const want = picture(before);
  let checked = 0;
  for (const [f, t] of picture(after)) {
    if (!want.has(f)) continue;
    expect(t, `frame ${f}`).toBeCloseTo(want.get(f)!, 9);
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
}

describe("speed curve mapping", () => {
  it("source time is the integral of the curve (checked numerically)", () => {
    const c = clip(curved(), "c1");
    for (const r of [0, 1, 17, 45, c.duration - 1]) {
      let area = 0;
      const n = 4000;
      for (let i = 0; i < n; i++) area += speedAt(c.speedCurve!.points, ((i + 0.5) / n) * r) * (r / n);
      expect(sourceTimeAt(c, r, fps)).toBeCloseTo(2 + area / 30, 5);
    }
  });

  it("applying a curve keeps the source range and sets length = span / mean speed", () => {
    const p = curved();
    const c = clip(p, "c1");
    // Montage averages ~1.53x, so 90 frames of source take 59.
    expect(c.duration).toBe(59);
    expect(c.speedCurve!.preset).toBe("montage");
    const [lo, hi] = sourceRange(c, fps);
    expect(lo).toBe(2);
    expect(Math.abs(hi - 5)).toBeLessThan(0.5 * (2 / 30)); // within half a frame at the end speed
    expect(clip(p, "c2").start).toBe(59); // the rest rippled
  });

  it("removing the curve returns to the constant speed over the same source", () => {
    const p = setSpeedCurve(curved(), "c1", null);
    const c = clip(p, "c1");
    expect(c.speedCurve).toBeUndefined();
    expect([c.duration, clip(p, "c2").start]).toEqual([90, 90]);
  });

  it("a constant speed replaces the curve and keeps the span", () => {
    const c = clip(setSpeed(curved(), "c1", 2), "c1");
    expect(c.speedCurve).toBeUndefined();
    expect(c.duration).toBe(45);
  });
});

describe("reverse", () => {
  it("shows the source range backward, frame for frame", () => {
    const p = setReverse(project([0, 30, 1]), "c1", true);
    const c = clip(p, "c1");
    expect(c.in).toBe(2);
    const frames = [...picture(c).values()].map((t) => Math.floor(t * 30 + 0.25));
    expect(frames).toEqual(Array.from({ length: 30 }, (_, i) => 59 - i));
  });

  it("at 2x and 0.5x shows the exact reverse of the forward sequence", () => {
    for (const speed of [2, 0.5]) {
      const fwd = clip(setSpeed(project([0, 30, 1]), "c1", speed), "c1");
      const rev = clip(setReverse(setSpeed(project([0, 30, 1]), "c1", speed), "c1", true), "c1");
      const seq = (c: VideoClip) => [...picture(c).values()].map((t) => Math.floor(t * 30 + 0.25));
      expect(seq(rev)).toEqual(seq(fwd).reverse());
    }
  });

  it("toggling twice restores the clip", () => {
    const p = curved();
    const back = setReverse(setReverse(p, "c1", true), "c1", false);
    expect(clip(back, "c1").in).toBeCloseTo(2, 12);
    expect(clip(back, "c1").reverse).toBeUndefined();
  });

  it("a reversed curve plays the forward source range backward", () => {
    const f = clip(curved(), "c1");
    const r = clip(curved(true), "c1");
    expect(sourceRange(r, fps)[0]).toBeCloseTo(sourceRange(f, fps)[0], 9);
    expect(sourceRange(r, fps)[1]).toBeCloseTo(sourceRange(f, fps)[1], 9);
  });

  it("room runs out at the source's ends, mirrored", () => {
    const c = clip(setReverse(project([0, 30, 1]), "c1", true), "c1"); // reads 2 s down to 1 s
    const p = setReverse(project([0, 30, 1]), "c1", true);
    expect(roomRight(p, c)).toBe(30); // 1 s left below
    expect(roomLeft(p, c)).toBe(240); // 8 s left above
  });
});

describe.each([false, true])("ops keep the picture (reverse=%s)", (reverse) => {
  it("split: both halves show what the whole showed", () => {
    const p = curved(reverse);
    const before = clip(p, "c1");
    const q = splitClip(p, "c1", 25);
    const [l, r] = q.tracks[0].clips as VideoClip[];
    samePicture(before, l);
    samePicture(before, r);
    expect(l.duration + r.duration).toBe(before.duration);
  });

  it("trims: what stays shows the same source; untrimming restores the ramp", () => {
    const p = curved(reverse);
    const before = clip(p, "c1");
    const head = trimClip(p, "c1", "start", 20);
    samePicture(before, clip(head, "c1"));
    const tail = trimClip(p, "c1", "end", 40);
    samePicture(before, clip(tail, "c1"));
    // Points outside the clip are kept, so dragging back is exact.
    const back = trimClip(trimClip(head, "c1", "start", 0), "c1", "end", before.duration);
    const again = clip(back, "c1");
    expect([again.start, again.duration]).toEqual([0, before.duration]);
    samePicture(before, again);
    // Ripple at the head keeps the start and shifts the content left.
    const rip = clip(trimClip(p, "c1", "start", 20, true), "c1");
    expect([rip.start, rip.duration]).toEqual([0, before.duration - 20]);
    for (let k = 0; k < rip.duration; k++) expect(sourceTimeAt(rip, k, fps)).toBeCloseTo(sourceTimeAt(before, k + 20, fps), 9);
  });

  it("trims stop where the source runs out", () => {
    // Far from timeline frame 0, so only the source can stop the start.
    let p = setSpeedCurve(project([600, 90, 2]), "c1", PRESETS.montage.points, "montage");
    if (reverse) p = setReverse(p, "c1", true);
    const c = clip(trimClip(trimClip(p, "c1", "start", -1000), "c1", "end", 2000, true), "c1");
    const [lo, hi] = sourceRange(c, fps);
    const step = 4 / 30; // a frame of source at the fastest end speed, generous
    expect(lo).toBeGreaterThanOrEqual(-1e-9);
    expect(lo).toBeLessThan(step);
    expect(hi).toBeLessThanOrEqual(10 + 1e-9);
    expect(hi).toBeGreaterThan(10 - step);
  });

  it("roll: the cut moves, both sides keep their pictures", () => {
    const p = curved(reverse);
    const q = rollEdit(p, "c1", "c2", 70);
    samePicture(clip(p, "c1"), clip(q, "c1"));
    samePicture(clip(p, "c2"), clip(q, "c2"));
    expect(clip(q, "c2").start).toBe(70);
  });

  it("slide: neighbors keep their pictures, the clip keeps its own", () => {
    let p = project([0, 30, 0], [30, 90, 2], [120, 30, 6]);
    p = setSpeedCurve(p, "c2", PRESETS.bullet.points, "bullet");
    if (reverse) p = setReverse(p, "c2", true);
    const mid = clip(p, "c2");
    const q = slideClip(p, "c2", 10);
    samePicture(clip(p, "c1"), clip(q, "c1"));
    samePicture(clip(p, "c3"), clip(q, "c3"));
    const moved = clip(q, "c2");
    expect(moved.start).toBe(mid.start + 10);
    for (let k = 0; k < mid.duration; k++) {
      expect(sourceTimeAt(moved, moved.start + k, fps)).toBeCloseTo(sourceTimeAt(mid, mid.start + k, fps), 9);
    }
  });

  it("slip: the ramp stays, the source under it moves by the mean rate, within the file", () => {
    const p = curved(reverse);
    const c = clip(p, "c1");
    const q = clip(slipClip(p, "c1", 15), "c1");
    expect(q.speedCurve).toEqual(c.speedCurve);
    const mean = (sourceRange(c, fps)[1] - sourceRange(c, fps)[0]) / c.duration;
    expect(q.in - c.in).toBeCloseTo(15 * mean, 9);
    for (const d of [-1000, 1000]) {
      const [lo, hi] = sourceRange(clip(slipClip(p, "c1", d), "c1"), fps);
      expect(lo).toBeGreaterThanOrEqual(-1e-9);
      expect(hi).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it("freeze holds exactly the frame on screen at the playhead", () => {
    const p = curved(reverse);
    const before = clip(p, "c1");
    const q = freezeFrame(p, "c1", 30, 15);
    const hold = q.tracks[0].clips.find((c) => (c as VideoClip).freeze) as VideoClip;
    expect(hold.in).toBeCloseTo(sourceTimeAt(before, 30, fps), 12);
    expect(hold.speedCurve).toBeUndefined();
    expect(hold.reverse).toBeUndefined();
    // The two halves around it still show their original frames (shifted by the hold).
    const [left, , right] = q.tracks[0].clips as VideoClip[];
    samePicture(before, left);
    for (let k = 0; k < right.duration; k++) {
      expect(sourceTimeAt(right, right.start + k, fps)).toBeCloseTo(sourceTimeAt(before, 30 + k, fps), 9);
    }
  });

  it("detached audio follows the same curve and direction", () => {
    const p = setChangePitch(curved(reverse), ["c1"], true);
    const q = detachAudio(p, "c1");
    const a = q.tracks.find((t) => t.kind === "audio")!.clips[0] as AudioClip;
    expect(a.speedCurve).toEqual(clip(p, "c1").speedCurve);
    expect(!!a.reverse).toBe(reverse);
    expect(a.changePitch).toBe(true);
    const v = clip(q, "c1");
    for (let f = 0; f < v.duration; f++) expect(sourceTimeAt(a, f, fps)).toBeCloseTo(sourceTimeAt(v, f, fps), 12);
  });

  it("setFps keeps every second of the ramp on the same source", () => {
    const p = curved(reverse);
    const c = clip(p, "c1");
    const at = (x: VideoClip, sec: number, rate: Rational) => x.in + (x.reverse ? -1 : 1) * sourceOffset(x, (sec * rate.num) / rate.den, rate);
    for (const rate of [{ num: 24, den: 1 }, { num: 60000, den: 1001 }]) {
      const q = clip(setFps(p, rate), "c1");
      expect(q.in).toBe(c.in);
      for (const sec of [0, 0.3, 1, 1.7, 2]) expect(at(q, sec, rate)).toBeCloseTo(at(c, sec, fps), 9);
    }
  });
});

describe("normalizeProject and retiming fields", () => {
  const file = (clipJson: Record<string, unknown>) => ({
    assets: [{ id: "a1", src: "a.mp4", duration: 10 }],
    tracks: [{ kind: "video", clips: [{ type: "video", assetId: "a1", start: 0, duration: 30, ...clipJson }] }],
  });

  it("loads a file from before speed curves unchanged", () => {
    const c = normalizeProject(file({ in: 1, speed: 2 })).tracks[0].clips[0] as VideoClip;
    expect(c).not.toHaveProperty("speedCurve");
    expect(c).not.toHaveProperty("reverse");
    expect(c).not.toHaveProperty("changePitch");
    expect([c.in, c.speed]).toEqual([1, 2]);
  });

  it("keeps a valid curve, repairs a messy one, drops a hopeless one", () => {
    const ok = normalizeProject(file({ speedCurve: { preset: "bullet", points: [{ f: 20, speed: 0.2 }, { f: 0, speed: 4 }] } }));
    expect((ok.tracks[0].clips[0] as VideoClip).speedCurve).toEqual({ preset: "bullet", points: [{ f: 0, speed: 4 }, { f: 20, speed: 0.2 }] });
    const messy = normalizeProject(file({ speedCurve: { points: [{ f: 0, speed: 99 }, "x", { f: "y", speed: 1 }] } }));
    expect((messy.tracks[0].clips[0] as VideoClip).speedCurve).toEqual({ points: [{ f: 0, speed: 10 }] });
    const bad = normalizeProject(file({ speedCurve: { points: [] }, reverse: "yes", changePitch: 1 }));
    const c = bad.tracks[0].clips[0] as VideoClip;
    expect(c).not.toHaveProperty("speedCurve");
    expect(c).not.toHaveProperty("reverse");
    expect(c).not.toHaveProperty("changePitch");
  });
});

describe("reverseProblem", () => {
  it("lets video and audio play backward, not stills, freezes or compounds", () => {
    const asset: Asset = { id: "v", src: "v.mp4", name: "v", kind: "video", duration: 10, width: 640, height: 360, fps: 30, hasAudio: true, hasVideo: true };
    const v = clipForAsset(asset, 0, { num: 30, den: 1 }) as VideoClip;
    expect(reverseProblem(v)).toBeNull();
    expect(reverseProblem({ ...v, freeze: true } as Clip)).toMatch(/freeze/);
    expect(reverseProblem(createColorClip("#fff", 0, 30))).toMatch(/cannot play backward/);
    expect(reverseProblem({ ...v, type: "compound", compoundId: "k" } as unknown as Clip)).toMatch(/compound/);
  });
});
