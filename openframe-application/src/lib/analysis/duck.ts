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
 * [a, b)). The clip covers timeline frames [start, end). `depths` gives
 * each span its own depth instead (dB, in `speech`'s order: a line the
 * music covers more dips deeper). Spans close enough to share a dip stay
 * down between them, and where their depths differ the level moves in the
 * pause between them, as a mixer rides a fader between lines.
 */
export function duckKeys(speech: [number, number][], start: number, end: number, base: number, o: DuckOptions, depths?: number[]): { f: number; v: number }[] {
  const spans = speech
    .map(([a, b], i) => ({ a: Math.max(a, start), b: Math.min(b, end), d: depths?.[i] ?? o.depthDb }))
    .filter((s) => s.b > s.a)
    .sort((x, y) => x.a - y.a);
  // Overlapping spans are one, at the deeper depth; nearby ones share a dip.
  const groups: { a: number; b: number; d: number }[][] = [];
  for (const s of spans) {
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    if (last && s.a <= last.b) [last.b, last.d] = [Math.max(last.b, s.b), Math.max(last.d, s.d)];
    else if (last && s.a - last.b <= o.attack + o.release + o.hold) group.push({ ...s });
    else groups.push([{ ...s }]);
  }
  const lastFrame = end - start - 1;
  const low = (d: number) => base * Math.pow(10, -d / 20);
  const keys: { f: number; v: number }[] = [];
  for (const g of groups) {
    const down = g[0].a - start;
    const up = g[g.length - 1].b - start;
    if (down - o.attack > 0) keys.push({ f: down - o.attack, v: base });
    keys.push({ f: Math.max(0, down), v: low(g[0].d) });
    for (let i = 1; i < g.length; i++) {
      if (g[i].d === g[i - 1].d) continue;
      keys.push({ f: Math.max(0, g[i - 1].b - start), v: low(g[i - 1].d) });
      keys.push({ f: Math.max(0, g[i].a - start), v: low(g[i].d) });
    }
    keys.push({ f: Math.min(lastFrame, up), v: low(g[g.length - 1].d) });
    if (up + o.release < lastFrame) keys.push({ f: up + o.release, v: base });
  }
  // Same frame twice (a dip from the clip's first frame): the later one wins.
  return keys.filter((k, i) => keys[i + 1]?.f !== k.f);
}
