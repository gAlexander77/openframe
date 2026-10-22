import { expect, it } from "vitest";
import { createProject } from "./project/defaults";
import { runCommand } from "./commands";
import { placedLineTimes } from "./voiceScript";
import { placeTake } from "./voiceover";
import { encodeWav } from "./wav";

const fps = { num: 30, den: 1 };

it("places a take on the frame after its first heard sample", () => {
  // Playback put timeline 2 s at clock 10 s; the mic began at 10.5 s and the
  // speaker lags 0.05 s, so the take starts at timeline 2.45 s.
  const { start, skip } = placeTake({ first: 10.5, t0: 2, ctxAt: 10, outputLatency: 0.05, from: 2 }, fps, 48000);
  expect(start).toBe(74); // 2.4667 s, the first whole frame at or after 2.45 s
  expect(skip).toBe(Math.round((74 / 30 - 2.45) * 48000));
  // On a frame exactly: nothing dropped. Before zero: clamp, dropping the lead.
  expect(placeTake({ first: 1, t0: 1, ctxAt: 1, outputLatency: 0, from: 1 }, fps, 48000)).toEqual({ start: 30, skip: 0 });
  expect(placeTake({ first: 0, t0: 0, ctxAt: 0.5, outputLatency: 0, from: 0 }, fps, 48000)).toEqual({ start: 0, skip: 24000 });
  // The mic opened 0.12 s before playback from 1 s: that pre-roll is dropped.
  expect(placeTake({ first: 9.88, t0: 1, ctxAt: 10, outputLatency: 0, from: 1 }, fps, 48000)).toEqual({ start: 30, skip: 5760 });
});

it("writes a 16-bit PCM WAV header and clamped samples", () => {
  const wav = encodeWav([new Float32Array([0, 1, -1, 2])], 48000);
  const v = new DataView(wav.buffer);
  expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
  expect(v.getUint32(24, true)).toBe(48000);
  expect(v.getUint16(22, true)).toBe(1);
  expect(v.getUint32(40, true)).toBe(8);
  expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
});


it("reports the placed frame times, keeping speech seconds separate from clip length", () => {
  const p = { ...createProject({ fps }), assets: [{ id: "voice", kind: "audio" as const, name: "Voice.wav", src: "voice.wav", hasAudio: true, hasVideo: false, duration: 4.519 }] };
  const q = runCommand(p, "add_media_clip", { asset_id: "voice", start: 0 });
  const c = q.tracks.flatMap((t) => t.clips).find((c) => c.type === "audio")!;
  expect(placedLineTimes(c, fps)).toEqual({ start: 0, end: 4.533 });
  const next = runCommand(q, "add_media_clip", { asset_id: "voice", start: 4.719 });
  const d = next.tracks.flatMap((t) => t.clips).find((x) => x.id !== c.id && x.type === "audio")!;
  expect(placedLineTimes(d, fps).start).toBe(4.733);
  expect(p.assets[0].duration).toBe(4.519);
});
