// Scene cut detection for "Split scenes": a TypeScript port of the
// ContentDetector, its FlashFilter and the AdaptiveDetector from
// PySceneDetect (BSD 3-Clause, Copyright (C) 2014, Brandon Castellano; the
// full notice is in docs/AI tools.md). Same scores, same defaults, same
// first-frame and minimum-length rules as its main branch in 2026, so
// PySceneDetect's documentation and tuning advice apply here.
//
// Pure: per-frame HSV pixels in, a score per frame, cut frames out. The
// engine decodes frames small (src/engine/analyze.ts) and keeps only the
// scores, so an hour of video costs a few hundred kilobytes.
//
// ponytail: no edge component (PySceneDetect's default weight for it is 0
// anyway) and no Threshold/Hash/Histogram detectors; fades to black and
// gradual transitions wait for ThresholdDetector or TransNetV2.

/** HSV channel weights: hue, saturation, value. PySceneDetect's default is
 * equal weights; `luma_only` is (0, 0, 1). */
export type Weights = [number, number, number];
export const DEFAULT_WEIGHTS: Weights = [1, 1, 1];
export const LUMA_WEIGHTS: Weights = [0, 0, 1];

/** RGBA pixels to 8-bit HSV the way OpenCV does it (H 0..179, S and V
 * 0..255), three bytes per pixel. PySceneDetect's thresholds are in these
 * units. Reuses `out` when it is the right size. */
export function rgbaToHsv(rgba: ArrayLike<number>, out?: Uint8Array): Uint8Array {
  const n = rgba.length >> 2;
  const hsv = out && out.length === n * 3 ? out : new Uint8Array(n * 3);
  for (let i = 0, j = 0; i < n * 4; i += 4, j += 3) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const v = Math.max(r, g, b);
    const d = v - Math.min(r, g, b);
    let h = 0;
    if (d > 0) {
      if (v === r) h = (60 * (g - b)) / d;
      else if (v === g) h = 120 + (60 * (b - r)) / d;
      else h = 240 + (60 * (r - g)) / d;
      if (h < 0) h += 360;
    }
    const h8 = Math.round(h / 2);
    hsv[j] = h8 >= 180 ? 0 : h8;
    hsv[j + 1] = v === 0 ? 0 : Math.round((255 * d) / v);
    hsv[j + 2] = v;
  }
  return hsv;
}

/** ContentDetector's frame score: the weighted mean, over H, S and V, of
 * the mean absolute per-pixel difference from the previous frame. */
export function contentScore(prev: Uint8Array, cur: Uint8Array, weights: Weights = DEFAULT_WEIGHTS): number {
  let dh = 0;
  let ds = 0;
  let dv = 0;
  for (let i = 0; i < cur.length; i += 3) {
    dh += Math.abs(cur[i] - prev[i]);
    ds += Math.abs(cur[i + 1] - prev[i + 1]);
    dv += Math.abs(cur[i + 2] - prev[i + 2]);
  }
  const px = cur.length / 3;
  const sum = weights[0] * dh + weights[1] * ds + weights[2] * dv;
  return sum / px / (Math.abs(weights[0]) + Math.abs(weights[1]) + Math.abs(weights[2]));
}

export type FlashMode = "merge" | "suppress";

/**
 * PySceneDetect's FlashFilter over "is this frame's score above the
 * threshold" flags, starting at frame `first` (frame 0 has no previous
 * frame, so no score). `length` is the minimum scene length in frames.
 * - merge (default): cuts closer than `length` to the previous cut are
 *   merged; the group emits one cut at its last above-threshold frame once
 *   `length` calm frames have passed.
 * - suppress: a cut is dropped until `length` frames have passed since the
 *   last emitted cut.
 * Like PySceneDetect, the first cut must also be `length` frames from the
 * first frame.
 */
export function flashFilter(above: ArrayLike<boolean>, length: number, mode: FlashMode = "merge", first = 1): number[] {
  const cuts: number[] = [];
  if (!(length > 0)) {
    for (let f = first; f < above.length; f++) if (above[f]) cuts.push(f);
    return cuts;
  }
  let lastAbove = first;
  let mergeEnabled = false;
  let mergeTriggered = false;
  let mergeStart = first;
  for (let f = first; f < above.length; f++) {
    const lengthMet = f - lastAbove >= length;
    if (mode === "suppress") {
      if (above[f] && lengthMet) {
        lastAbove = f;
        cuts.push(f);
      }
      continue;
    }
    if (above[f]) lastAbove = f;
    if (mergeTriggered) {
      if (lengthMet && !above[f] && lastAbove - mergeStart >= length) {
        mergeTriggered = false;
        cuts.push(lastAbove);
      }
      continue;
    }
    if (!above[f]) continue;
    if (lengthMet) {
      mergeEnabled = true;
      cuts.push(f);
    } else if (mergeEnabled) {
      mergeTriggered = true;
      mergeStart = f;
    }
  }
  return cuts;
}

export interface ContentOptions {
  /** Score at or above which a frame starts a new scene. */
  threshold: number;
  /** Frames. */
  minSceneLen: number;
  filter: FlashMode;
}

export const CONTENT_DEFAULTS: ContentOptions = { threshold: 27, minSceneLen: 15, filter: "merge" };

/** ContentDetector: cut where the score crosses a fixed threshold. Returns
 * the frame indices that start a new scene. */
export function contentCuts(scores: ArrayLike<number>, options: Partial<ContentOptions> = {}): number[] {
  const o = { ...CONTENT_DEFAULTS, ...options };
  const above = Array.from(scores, (s) => s >= o.threshold);
  return flashFilter(above, o.minSceneLen, o.filter);
}

export interface AdaptiveOptions {
  /** How many times the neighbors' average score a frame must reach. */
  adaptiveThreshold: number;
  /** Neighbors on each side of the frame being judged. */
  windowWidth: number;
  /** A cut also needs at least this content score. */
  minContentVal: number;
  /** Frames. */
  minSceneLen: number;
}

export const ADAPTIVE_DEFAULTS: AdaptiveOptions = { adaptiveThreshold: 3, windowWidth: 2, minContentVal: 15, minSceneLen: 15 };

/** AdaptiveDetector: a frame is a cut when its score stands out from its
 * neighbors' (ratio to their mean), which ignores the steady high scores of
 * a fast pan or handheld shake that fool a fixed threshold. */
export function adaptiveCuts(scores: ArrayLike<number>, options: Partial<AdaptiveOptions> = {}): number[] {
  const o = { ...ADAPTIVE_DEFAULTS, ...options };
  const w = o.windowWidth;
  const cuts: number[] = [];
  // Frame 0 has no score; frame k is the newest one seen and the judged
  // frame sits w frames behind it.
  let lastCut = 1;
  for (let k = 1 + 2 * w; k < scores.length; k++) {
    const target = k - w;
    let sum = 0;
    for (let i = k - 2 * w; i <= k; i++) if (i !== target) sum += scores[i];
    const avg = sum / (2 * w);
    const score = scores[target];
    let ratio = 0;
    if (Math.abs(avg) >= 1e-5) ratio = Math.min(score / avg, 255);
    else if (score >= o.minContentVal) ratio = 255;
    if (ratio >= o.adaptiveThreshold && score >= o.minContentVal && target - lastCut >= o.minSceneLen) {
      lastCut = target;
      cuts.push(target);
    }
  }
  return cuts;
}

export interface SceneOptions {
  detector: "adaptive" | "content";
  /** ContentDetector threshold. */
  threshold: number;
  adaptiveThreshold: number;
  windowWidth: number;
  minContentVal: number;
  /** Seconds (PySceneDetect's 15 frames at 30 fps). */
  minScene: number;
  filter: FlashMode;
}

export const SCENE_DEFAULTS: SceneOptions = {
  detector: "adaptive",
  threshold: CONTENT_DEFAULTS.threshold,
  adaptiveThreshold: ADAPTIVE_DEFAULTS.adaptiveThreshold,
  windowWidth: ADAPTIVE_DEFAULTS.windowWidth,
  minContentVal: ADAPTIVE_DEFAULTS.minContentVal,
  minScene: 0.5,
  filter: "merge",
};

/** Cut times (seconds, the first frame of each new scene) from per-frame
 * scores. `times[i]` is frame i's timestamp; `scores[0]` is ignored. */
export function sceneCuts(times: ArrayLike<number>, scores: ArrayLike<number>, options: Partial<SceneOptions> = {}): number[] {
  const o = { ...SCENE_DEFAULTS, ...options };
  const n = Math.min(times.length, scores.length);
  if (n < 2) return [];
  const fps = (n - 1) / (times[n - 1] - times[0] || 1);
  const minSceneLen = Math.max(1, Math.round(o.minScene * fps));
  const frames =
    o.detector === "content"
      ? contentCuts(scores, { threshold: o.threshold, minSceneLen, filter: o.filter })
      : adaptiveCuts(scores, { adaptiveThreshold: o.adaptiveThreshold, windowWidth: o.windowWidth, minContentVal: o.minContentVal, minSceneLen });
  return frames.map((f) => times[f]);
}
