// Audio scrubbing (ADR-079): dragging the playhead while paused sounds a
// short snippet of the mix where it lands, through the same scheduler
// playback uses (engine/audio.ts), so a snippet carries every clip's
// volume, fades, EQ, effects and pan. Snippets follow one another, the next
// starting as the last fades (lib/scrub.ts), never piling up; each has its
// own fade gain into the master bus, so the meters show it, and nothing is
// ever scheduled while the timeline plays.

import { ScrubGate, SNIPPET_FADE, SNIPPET_SECONDS } from "../lib/scrub";
import { framesToSeconds } from "../lib/time";
import { prefsStore } from "../state/prefs";
import { store } from "../state/store";
import { audioContext, masterBus, scheduleAudio, type Schedule } from "./audio";

/** Lead for a snippet's first decode: later and its head is cut. */
const LEAD = 0.06;

const gate = new ScrubGate();
interface Snippet {
  schedule: Schedule;
  out: GainNode;
  timers: number[];
}
/** Snippets still sounding (the last one's tail can overlap the next one's
 * lead), and the newest, whose end asks for the next place. */
const live = new Set<Snippet>();
let newest: Snippet | null = null;
/** Snippets started, for the drive that checks scrubbing sounds. */
let started = 0;
export const scrubSnippets = () => started;

function stop(s: Snippet) {
  s.timers.forEach(clearTimeout);
  s.schedule.stop();
  s.out.disconnect();
  live.delete(s);
  if (newest === s) newest = null;
}

function sound(t: number) {
  const ctx = audioContext();
  if (ctx.state !== "running") void ctx.resume();
  const out = ctx.createGain();
  out.connect(masterBus().input);
  const at = ctx.currentTime + LEAD;
  const end = at + SNIPPET_SECONDS;
  out.gain.setValueAtTime(0, at);
  out.gain.linearRampToValueAtTime(1, at + SNIPPET_FADE);
  out.gain.setValueAtTime(1, end - SNIPPET_FADE);
  out.gain.linearRampToValueAtTime(0, end);
  const s: Snippet = { schedule: scheduleAudio(ctx, out, store.get().project, t, t + SNIPPET_SECONDS, at), out, timers: [] };
  started++;
  live.add(s);
  newest = s;
  // The next place starts one lead before this snippet ends, so it begins
  // as this one fades out: no gap while the hand keeps moving.
  s.timers.push(
    window.setTimeout(() => {
      if (newest !== s) return;
      const next = gate.done();
      if (next !== null && canScrub()) sound(next);
    }, SNIPPET_SECONDS * 1000),
    window.setTimeout(() => stop(s), (LEAD + SNIPPET_SECONDS) * 1000 + 30),
  );
}

const canScrub = () => prefsStore.get().audioScrub && !store.get().playing;

/** The playhead was dragged to `frame`: sound it, or keep it for when the
 * snippet playing now ends. */
export function scrubTo(frame: number) {
  if (!canScrub()) return;
  const p = store.get().project;
  if (gate.request(framesToSeconds(frame, p.fps))) sound(framesToSeconds(frame, p.fps));
}

/** The drag ended: the snippet playing finishes, nothing waits after it. */
export function scrubEnd() {
  gate.reset();
}

// Playback takes the sound over at once.
store.subscribe(() => {
  if (!store.get().playing || !live.size) return;
  live.forEach(stop);
  gate.reset();
});
