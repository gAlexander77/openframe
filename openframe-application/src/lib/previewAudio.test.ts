import { expect, it } from "vitest";
import { previewAudioFormat, previewWav } from "./previewAudio";

it("prefers registered MP3, then AAC, then encoder-free WAV", () => {
  expect(previewAudioFormat("mp3", { mp3: true, m4a: true })).toBe("mp3");
  expect(previewAudioFormat("mp3", { mp3: false, m4a: true })).toBe("m4a");
  expect(previewAudioFormat("mp3", { mp3: false, m4a: false })).toBe("wav");
  expect(previewAudioFormat("m4a", { mp3: true, m4a: false })).toBe("wav");
  expect(previewAudioFormat("wav", { mp3: true, m4a: true })).toBe("wav");
});

it("makes a small 16-bit 24 kHz mono WAV and rejects frequencies above its Nyquist limit", () => {
  const low = Float32Array.from({ length: 4800 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 1000 * i / 48000));
  const high = Float32Array.from(low, (_, i) => 0.5 * Math.sin(2 * Math.PI * 18000 * i / 48000));
  const a = previewWav(low, low), b = previewWav(high, high);
  const v = new DataView(a.buffer);
  expect(a.length).toBe(44 + 2400 * 2);
  expect(v.getUint16(22, true)).toBe(1);
  expect(v.getUint32(24, true)).toBe(24000);
  expect(v.getUint16(34, true)).toBe(16);
  const rms = (wav: Uint8Array<ArrayBuffer>) => {
    const v = new DataView(wav.buffer); let s = 0;
    for (let i = 100; i < 2300; i++) s += v.getInt16(44 + 2 * i, true) ** 2;
    return Math.sqrt(s / 2200);
  };
  expect(rms(b) / rms(a)).toBeLessThan(0.01);
});
