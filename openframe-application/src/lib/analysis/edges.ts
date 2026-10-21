// What happens to the sound where an audio clip starts, stops or meets the
// next (ADR-104): preview_audio's edges. The film test spliced its song on
// a bar (14 s) and could only hope it was clean: each second's loudness
// cannot show an 8 ms hole, a click or a reverb tail cut dead. These are
// read off the rendered stretch, sample by sample, around each edge.

export interface AudioEdge {
  /** Timeline seconds. */
  at: number;
  /** join: a clip ends where the next on its track starts; start, end: a
   * clip's own edge with nothing beside it on its track. */
  kind: "join" | "start" | "end";
  clips: string[];
  /** Seconds of fade (or crossfade) at the edge; 0 is a cut. */
  faded: number;
  /** The clip that stops here: how loud its file goes on past the cut,
   * against its last 300 ms, dB (decoded from the file; absent when the
   * file ends there). */
  goesOn?: number;
  /** The clip that starts here (or comes in at a join): how loud its file
   * was before its in-point, against its first 300 ms, dB (absent at the
   * file's start). At a join, the step the music itself makes there. */
  cameIn?: number;
  /** The file that comes in here as it is at its in-point, unedited
   * (ownOnset): a sample step that steep is the music's own attack. */
  onset?: Onset;
  /** At a join: the incoming file is digital silence for `seconds` right
   * before its in-point `in` (file seconds), so a crossfade into it fades
   * into silence. */
  silentBefore?: { seconds: number; in: number };
  /** Where the join could move instead (timeline seconds, roll_edit): a
   * bar later or earlier, where the incoming file sounds before it. */
  rollTo?: number;
}

/** A file's own attack at a point: its steepest sample step within 2 ms
 * and its level (RMS) 10-60 ms after. */
export interface Onset {
  step: number;
  level: number;
}

/** The onset of mono samples `x` (at `rate`) at sample `at`, as the file
 * has it: a cut that lands on a downbeat plays the kick's first steep step
 * there, which is the music, not a click. */
export function ownOnset(x: Float32Array, rate: number, at: number): Onset {
  const ms = (v: number) => Math.round((v * rate) / 1000);
  return { step: steepest(x, at - ms(2), at + ms(2)), level: rms(x, at + ms(10), at + ms(60)) };
}

export interface EdgeReport {
  at: number;
  kind: AudioEdge["kind"];
  clips: string[];
  /** The quietest 2 ms within 6 ms of the edge against the 50 ms either
   * side, dB: a butt cut's click guard leaves a hole there. */
  dip_db?: number;
  /** The level 10-300 ms after against 300-10 ms before, dB. */
  step_db: number;
  /** The steepest sample step at the edge over the steepest around it,
   * dB, when it is steeper: a click. */
  click_db?: number;
  /** How far the sound that stops here would have rung on over what
   * plays after it, dB: a tail cut dead. */
  tail_cut_db?: number;
  /** How loud the sound that starts here already was before it, against
   * what played before the edge, dB: a clip cut in mid-sound. */
  cut_in_db?: number;
  /** At a join that steps 6 dB or more: what the music does there
   * itself, so a step it makes anyway reads as the music's (ADR-114). */
  step_note?: string;
  /** Seconds the incoming file is silent right before its in-point, when
   * that is the hole: a crossfade cannot fill it, a moved join can. */
  silent_before?: number;
  /** clean, or what is wrong. */
  verdict: string;
  fix?: { tool: string; args: Record<string, unknown> };
}

/** A hole this deep at a join is heard as a tick or a dropout. */
export const DIP_DB = -10;
/** A sample step this much steeper than any around it is a click. */
export const CLICK_DB = 6;
/** A sound cut off this far over what follows is heard to stop dead. */
export const TAIL_DB = 6;
/** A join whose level moves this far is told, though it may be meant. */
export const STEP_DB = 12;
/** Under this (dBFS RMS) around an edge, nothing is heard there. */
const QUIET_DBFS = -60;

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const r1 = (x: number) => +x.toFixed(1);

function rms(m: Float32Array, a: number, b: number): number {
  a = Math.max(0, a);
  b = Math.min(m.length, b);
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += m[i] * m[i];
  return Math.sqrt(s / (b - a));
}

function steepest(m: Float32Array, a: number, b: number): number {
  let top = 0;
  for (let i = Math.max(1, a); i < Math.min(m.length, b); i++) top = Math.max(top, Math.abs(m[i] - m[i - 1]));
  return top;
}

/**
 * Each edge of a rendered stretch (stereo `L`, `R` at `rate`, starting at
 * timeline second `t0`) judged: a hole at a join (dip_db), a click, a
 * step in level, a tail cut dead (the file going on louder than what
 * follows), a clip cut in mid-sound. Edges in silence, or too near the
 * stretch's ends to measure, are left out.
 */
export function edgeReport(L: Float32Array, R: Float32Array, rate: number, t0: number, edges: AudioEdge[]): EdgeReport[] {
  const m = new Float32Array(L.length);
  for (let i = 0; i < m.length; i++) m[i] = (L[i] + R[i]) / 2;
  // The sound's slope (a first difference): a 2 ms window of a bass note
  // near its zero crossing reads as a dip; its slope does not.
  const d = new Float32Array(m.length);
  for (let i = 1; i < m.length; i++) d[i] = m[i] - m[i - 1];
  const ms = (x: number) => Math.round((x * rate) / 1000);
  // The quietest 2 ms of slope within 5 ms of sample c.
  const lowAt = (c: number) => {
    let low = Infinity;
    for (let k = c - ms(5); k <= c + ms(3); k += Math.max(1, ms(0.5))) low = Math.min(low, rms(d, k, k + ms(2)));
    return low;
  };
  const out: EdgeReport[] = [];
  for (const e of edges) {
    const n = Math.round((e.at - t0) * rate);
    if (n - ms(160) < 0 || n + ms(160) > m.length) continue;
    const before = rms(m, n - ms(300), n - ms(10)), after = rms(m, n + ms(10), n + ms(300));
    const near = Math.sqrt((rms(m, n - ms(60), n - ms(10)) ** 2 + rms(m, n + ms(10), n + ms(60)) ** 2) / 2);
    if (db(Math.max(before, after, near)) < QUIET_DBFS) continue;
    const r: EdgeReport = { at: e.at, kind: e.kind, clips: e.clips, step_db: r1(Math.max(-60, Math.min(60, db(after) - db(before)))), verdict: "clean" };
    const problems: string[] = [];
    if (e.kind === "join" && db(near) >= QUIET_DBFS) {
      // Against the sound just either side of it (6-12 ms off), the
      // quieter side: music's own quiet moments (a hit dying away before
      // the next) last tens of milliseconds and pass from one side to the
      // other; a hole of a few milliseconds sits under both.
      // Never more than 20 dB under the slope's usual level within 60 ms:
      // a silent stretch at the cut itself (a decoder's lost packet) runs
      // past 6 ms and would hide under its own side.
      const around: number[] = [];
      for (let c = n - ms(60); c + ms(2) <= n + ms(60); c += ms(2)) if (c + ms(2) <= n - ms(10) || c >= n + ms(10)) around.push(rms(d, c, c + ms(2)));
      around.sort((x, y) => x - y);
      const side = Math.max(Math.min(rms(d, n - ms(12), n - ms(6)), rms(d, n + ms(6), n + ms(12))), around[Math.floor(around.length / 2)] / 10);
      if (side > 0) {
        r.dip_db = r1(Math.max(-60, Math.min(0, db(lowAt(n)) - db(side))));
        // The incoming file silent before its in-point (a breath before a
        // drop): the crossfade fades into that silence, and a longer one
        // deepens the hole. The fourth film test was sent to set_crossfade
        // 0.03, already set, twice (ADR-125).
        const quiet = e.silentBefore && r.dip_db <= DIP_DB ? e.silentBefore : undefined;
        if (quiet) {
          r.silent_before = quiet.seconds;
          const where = e.rollTo !== undefined ? `, e.g. a bar ${e.rollTo > e.at ? "later" : "earlier"} (roll_edit to ${e.rollTo} s)` : " (roll_edit it to a bar line where the incoming file sounds)";
          problems.push(`a ${-r.dip_db} dB hole at the cut: ${e.clips[1]}'s file is silent for ${quiet.seconds} s just before its in-point (${+(quiet.in - quiet.seconds).toFixed(3)}-${+quiet.in.toFixed(3)} s of the file), so ${e.faded ? "the crossfade fades" : "a crossfade would fade"} into that silence and a longer one deepens the hole: move the join where both files sound${where}`);
        } else if (r.dip_db <= -40) problems.push("silence for a few milliseconds at the cut, heard as a dropout");
        else if (r.dip_db <= DIP_DB) problems.push(`a ${-r.dip_db} dB hole for a few milliseconds at the cut (${e.faded ? `under the ${e.faded} s crossfade` : "a butt cut's click guard"}), heard as a tick`);
      }
    }
    // Against the steepest step around, and the incoming file's own attack
    // at the cut (scaled to the level it plays at): a cut on a downbeat
    // after a quiet bar played the kick's first step, steeper than anything
    // near it, and read as a click on a clean join.
    const own = e.onset && e.onset.level > 0 ? e.onset.step * (rms(m, n + ms(10), n + ms(60)) / e.onset.level) : 0;
    const click = db(steepest(m, n - ms(2), n + ms(2))) - db(Math.max(steepest(m, n - ms(60), n - ms(10)), steepest(m, n + ms(10), n + ms(60)), own));
    if (Number.isFinite(click) && click > 0) {
      r.click_db = r1(click);
      if (click >= CLICK_DB) problems.push(`a click: a sample step ${r.click_db} dB steeper than any around it`);
    }
    if (e.goesOn !== undefined && e.faded < 0.05) {
      // What the file would have played on, where it is heard at all.
      const ringing = db(before) + e.goesOn;
      const tail = ringing - Math.max(db(after), QUIET_DBFS);
      if (Number.isFinite(tail) && ringing > QUIET_DBFS) {
        r.tail_cut_db = r1(Math.min(60, tail));
        if (tail >= TAIL_DB) problems.push(`${e.clips[0]}'s sound is cut off while it still rings ${r.tail_cut_db} dB over what follows`);
      }
    }
    if (e.cameIn !== undefined && e.faded < 0.05 && e.kind === "start") {
      // Its file was already sounding: the clip comes in mid-note.
      r.cut_in_db = r1(e.cameIn);
      if (e.cameIn > -12 && r.step_db >= TAIL_DB) problems.push(`${e.clips[0]} comes in mid-sound (its file ${r.cut_in_db} dB before its in-point against after), with no fade`);
    }
    // Against the step the incoming file makes there itself: a cut just
    // before a downbeat has the hit after it and the bar's end before it.
    const moved = e.kind === "join" && e.cameIn !== undefined ? r.step_db + e.cameIn : r.step_db;
    // And against what the outgoing file would have done uncut (goesOn).
    const uncut = e.kind === "join" && e.goesOn !== undefined ? r.step_db - e.goesOn : r.step_db;
    // How far the step is off what the music does there itself, either file.
    const offMusic = Math.min(Math.abs(moved), Math.abs(uncut));
    // Inside a ring-out (the sound fell 6 dB or more over the second before
    // the cut) a step stands out at half the size: the second film test cut
    // a bar out of its outro and read a 6.9 dB step, called clean without a
    // word; the file steps 6.0 dB on that bar itself, so it was the music's.
    const fell = n - ms(1300) >= 0 ? db(rms(m, n - ms(1300), n - ms(1000))) - db(before) : 0;
    const ringing = e.kind === "join" && fell >= TAIL_DB;
    const told = problems.some((x) => /still rings/.test(x));
    const ringStep = ringing && !told && Math.abs(r.step_db) >= TAIL_DB && offMusic >= TAIL_DB;
    if (ringStep) problems.push(`the level ${r.step_db > 0 ? "jumps up" : "drops"} ${Math.abs(r.step_db)} dB inside a ring-out (the sound fell ${r1(fell)} dB over the second before), ${r1(offMusic)} dB more than the music does there: heard as a jump in its tail; cut before the tail, or crossfade longer`);
    else if (e.kind === "join" && Math.abs(r.step_db) >= TAIL_DB && offMusic < TAIL_DB) r.step_note = `the music steps ${r1(Math.abs(moved) <= Math.abs(uncut) ? -(e.cameIn ?? 0) : (e.goesOn ?? 0))} dB there itself (a new bar or hit), so the join keeps its shape`;
    if (e.kind === "join" && !ringing && Math.abs(moved) >= STEP_DB) problems.push(`the level ${r.step_db > 0 ? "jumps up" : "drops"} ${Math.abs(r.step_db)} dB at the cut${moved !== r.step_db ? `, ${r1(Math.abs(moved))} dB more than the music does there` : ""} (fine if the music changes there)`);
    if (problems.length) {
      r.verdict = problems.join("; ");
      const real = problems.some((x) => !/fine if/.test(x));
      const seconds = ringStep || (r.tail_cut_db !== undefined && r.tail_cut_db >= TAIL_DB) ? 0.25 : 0.03;
      // Never the crossfade the join has already: move the join instead.
      const elsewhere = r.silent_before !== undefined || e.faded >= seconds - 1e-3;
      if (real && e.kind === "join" && elsewhere && e.rollTo !== undefined) r.fix = { tool: "roll_edit", args: { clip_id: e.clips[0], to: e.rollTo } };
      else if (real && e.kind === "join" && elsewhere) {
        if (r.silent_before === undefined) r.verdict += `; the ${e.faded} s crossfade is already set: move the join (roll_edit) where both files sound`;
      } else if (real && e.kind === "join") r.fix = { tool: "set_crossfade", args: { clip_id: e.clips[0], seconds } };
      else if (real && e.kind === "end") r.fix = { tool: "set_fades", args: { clip_ids: [e.clips[0]], fade_out: 0.3 } };
      else if (real && e.kind === "start") r.fix = { tool: "set_fades", args: { clip_ids: [e.clips[0]], fade_in: 0.05 } };
    }
    out.push(r);
  }
  return out;
}
