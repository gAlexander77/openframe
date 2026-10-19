// 16-bit PCM WAV, the format every decoder reads; used for voiceover takes.

export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array<ArrayBuffer> {
  const n = channels[0]?.length ?? 0, ch = Math.max(1, channels.length);
  const bytes = n * ch * 2;
  const out = new Uint8Array(44 + bytes);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, "RIFF"); v.setUint32(4, 36 + bytes, true); tag(8, "WAVE");
  tag(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  tag(36, "data"); v.setUint32(40, bytes, true);
  let at = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      v.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      at += 2;
    }
  }
  return out;
}
