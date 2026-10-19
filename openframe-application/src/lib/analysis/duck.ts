// Auto ducking: where speech plays, dip a music clip's volume, as editable
// volume keyframes rather than a hidden sidechain (Premiere's Auto-Duck
// works this way; CapCut's ducking is a black box you cannot touch up).

export interface DuckOptions {
  /** How far the music dips under speech, dB. */
  depthDb: number;
  /** Frames the dip starts before speech, so the first word is clear. */
  attack: number;
  /** Frames the music takes to come back after speech. */
  release: number;
  /** Pauses up to this many frames stay ducked, so the music does not pump
   * between sentences. */
  hold: number;
}

/**
 * Volume keyframes (frames from the clip's start, linear gain) that hold
 * `base` and dip to `base - depthDb` under `speech` (timeline frame spans
 * [a, b)). The clip covers timeline frames [start, end).
 */
export function duckKeys(speech: [number, number][], start: number, end: number, base: number, o: DuckOptions): { f: number; v: number }[] {
  const low = base * Math.pow(10, -o.depthDb / 20);
  const spans = speech
    .map(([a, b]) => [Math.max(a, start), Math.min(b, end)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] - last[1] <= o.attack + o.release + o.hold) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  const lastFrame = end - start - 1;
  const keys: { f: number; v: number }[] = [];
  for (const [a, b] of merged) {
    const down = a - start;
    const up = b - start;
    if (down - o.attack > 0) keys.push({ f: down - o.attack, v: base });
    keys.push({ f: Math.max(0, down), v: low });
    keys.push({ f: Math.min(lastFrame, up), v: low });
    if (up + o.release < lastFrame) keys.push({ f: up + o.release, v: base });
  }
  // Same frame twice (a dip from the clip's first frame): the later one wins.
  return keys.filter((k, i) => keys[i + 1]?.f !== k.f);
}
