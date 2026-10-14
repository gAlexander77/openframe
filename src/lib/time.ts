// Timeline time is integer frames at the project's frame rate (ADR-004).
// Seconds exist only at the decode/audio boundary; this file is that boundary.

/** A frame rate as a ratio, so NTSC rates (30000/1001) stay exact. */
export interface Rational {
  num: number;
  den: number;
}

export const FPS_PRESETS: { label: string; fps: Rational }[] = [
  { label: "23.976", fps: { num: 24000, den: 1001 } },
  { label: "24", fps: { num: 24, den: 1 } },
  { label: "25", fps: { num: 25, den: 1 } },
  { label: "29.97", fps: { num: 30000, den: 1001 } },
  { label: "30", fps: { num: 30, den: 1 } },
  { label: "50", fps: { num: 50, den: 1 } },
  { label: "59.94", fps: { num: 60000, den: 1001 } },
  { label: "60", fps: { num: 60, den: 1 } },
];

export const fpsValue = (fps: Rational) => fps.num / fps.den;

export const framesToSeconds = (frames: number, fps: Rational) =>
  (frames * fps.den) / fps.num;

/** Nearest frame. Use `floor` when asking "which frame is showing at t". */
export const secondsToFrames = (seconds: number, fps: Rational) =>
  Math.round((seconds * fps.num) / fps.den);

/** The frame on screen at time t. The epsilon absorbs float error so that
 * exactly-on-boundary times (2.0000000001 frames) land on the right frame. */
export const frameAt = (seconds: number, fps: Rational) =>
  Math.floor((seconds * fps.num) / fps.den + 1e-6);

/** Drop-frame applies to the NTSC rates only (29.97 and 59.94). */
export const isDropFrameRate = (fps: Rational) =>
  fps.den === 1001 && (fps.num === 30000 || fps.num === 60000);

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * SMPTE timecode. NTSC rates use drop-frame (`;` before frames): frame
 * *numbers* 0 and 1 (0-3 at 59.94) are skipped every minute except each
 * tenth, which keeps the label in step with the wall clock.
 */
export function formatTimecode(frame: number, fps: Rational): string {
  const sign = frame < 0 ? "-" : "";
  let f = Math.abs(Math.round(frame));
  const nominal = Math.round(fpsValue(fps));
  const drop = isDropFrameRate(fps);
  if (drop) {
    const dropped = nominal === 60 ? 4 : 2;
    const perMin = nominal * 60 - dropped;
    const per10 = nominal * 600 - dropped * 9;
    const tens = Math.floor(f / per10);
    const rem = f % per10;
    f += dropped * 9 * tens;
    if (rem > dropped) f += dropped * Math.floor((rem - dropped) / perMin);
  }
  const ff = f % nominal;
  const totalSeconds = Math.floor(f / nominal);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return `${sign}${pad(hh)}:${pad(mm)}:${pad(ss)}${drop ? ";" : ":"}${pad(ff)}`;
}

/**
 * Parse what an editor types into a timecode field. Accepts full timecode
 * (`01:02:03:04`, `;` for drop-frame), partial right-aligned groups the way
 * Premiere does (`3:04` = 3 s 4 f), and plain seconds with a unit (`12.5s`).
 * Returns null on anything else so the field can refuse it.
 */
export function parseTimecode(text: string, fps: Rational): number | null {
  const t = text.trim();
  if (!t) return null;
  const secs = /^(\d+(?:\.\d+)?)s$/i.exec(t);
  if (secs) return secondsToFrames(Number(secs[1]), fps);
  if (!/^\d+([:;.]\d+){0,3}$/.test(t)) return null;
  const parts = t.split(/[:;.]/).map(Number);
  while (parts.length < 4) parts.unshift(0);
  const [hh, mm, ss, ff] = parts;
  const nominal = Math.round(fpsValue(fps));
  if (ff >= nominal || ss >= 60 || mm >= 60) return null;
  let frame = ((hh * 60 + mm) * 60 + ss) * nominal + ff;
  if (isDropFrameRate(fps)) {
    const dropped = nominal === 60 ? 4 : 2;
    const totalMinutes = hh * 60 + mm;
    frame -= dropped * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return frame;
}

/** Short human duration for clip badges and the media panel: 1:05, 12.4s. */
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds)) return "--";
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
