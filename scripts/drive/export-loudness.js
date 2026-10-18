// Loudness-normalized export (Premiere's): a tone rendered with targets of
// -20 and -14 LUFS measures within 0.5 LU of each when read back by
// LoudnessMeter; a -1 LUFS target cannot be met under the -1 dBFS peak
// ceiling, so a limiter holds the peaks there (the steady tone loses as
// much loudness as it is limited) and the note says so. The export dialog
// offers the targets under Audio.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(async () => {
    const api = window.videoEditor;
    const [v] = await api.import([{ name: "voice-8s.wav", src: location.origin + "/fixtures/media/voice-8s.wav" }]);
    api.exec("add_media_clip", { asset_id: v.id, start: 0, duration: 4 });
  });
  const measure = (loudness) =>
    page.evaluate(async (loudness) => {
      const { LoudnessMeter } = await import("/src/lib/analysis/loudness.ts");
      const r = await window.videoEditor.render({ video: false, audioFormat: "wav", loudness });
      const buf = await (await fetch(r.url)).arrayBuffer();
      URL.revokeObjectURL(r.url);
      const v = new DataView(buf);
      const ch = v.getUint16(22, true), rate = v.getUint32(24, true);
      const n = Math.floor((buf.byteLength - 44) / 2 / ch);
      const planes = Array.from({ length: ch }, () => new Float32Array(n));
      for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) planes[c][i] = v.getInt16(44 + (i * ch + c) * 2, true) / 32768;
      const m = new LoudnessMeter(rate, ch);
      m.push(planes, n);
      return { lufs: +m.integrated().toFixed(2), peakDb: +(20 * Math.log10(m.peak)).toFixed(2), note: r.note ?? "" };
    }, loudness);
  const details = {};
  const asMixed = await measure(null);
  const at20 = await measure(-20);
  const at14 = await measure(-14);
  const at1 = await measure(-1);
  details.minus20 = { ok: Math.abs(at20.lufs + 20) < 0.5 && /normalized to -20\.0 LUFS\.$/.test(at20.note), ...at20 };
  details.minus14 = { ok: Math.abs(at14.lufs + 14) < 0.5, ...at14 };
  details.peakHeld = { ok: at1.peakDb <= -0.9 && at1.peakDb > -1.5 && at1.lufs < -1 && /limiter held the peaks under -1 dB/.test(at1.note), ...at1, asMixed };
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  const select = page.locator("#export-loudness");
  await select.waitFor();
  details.dialog = { ok: (await select.locator("option").count()) === 4 && (await select.inputValue()) === "off" };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
