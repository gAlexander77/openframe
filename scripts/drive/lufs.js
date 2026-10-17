// LUFS meter drive: play about 4 s of a steady tone (voice-8s.wav); the
// readout under the meter shows momentary, short-term and integrated, and
// its integrated agrees within 1 LU with the same span rendered to WAV and
// measured offline by LoudnessMeter (BS.1770). The line sits in the
// stage's bottom gutter, below the picture.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(async () => {
    const api = window.videoEditor;
    const [v] = await api.import([{ name: "voice-8s.wav", src: location.origin + "/fixtures/media/voice-8s.wav" }]);
    api.exec("add_media_clip", { asset_id: v.id, start: 0, duration: 8 });
    api.seek(0);
  });
  const details = {};
  await page.locator(".tl-ruler").click({ position: { x: 900, y: 10 } });
  await page.evaluate(() => window.videoEditor.seek(0));
  await page.keyboard.press("Space");
  await page.waitForTimeout(4200);
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  const text = await page.locator(".lufs").textContent().catch(() => null);
  const num = (k) => Number(new RegExp(`${k} (-?\\d+\\.\\d)`).exec(text ?? "")?.[1]);
  const live = { m: num("M"), s: num("S"), i: num("I") };
  const offline = await page.evaluate(async () => {
    const { LoudnessMeter } = await import("/src/lib/analysis/loudness.ts");
    const r = await window.videoEditor.render({ video: false, audioFormat: "wav", start: 0.5, end: 3.5 });
    const buf = await (await fetch(r.url)).arrayBuffer();
    URL.revokeObjectURL(r.url);
    const v = new DataView(buf);
    const ch = v.getUint16(22, true), rate = v.getUint32(24, true);
    const n = (buf.byteLength - 44) / 2 / ch;
    const planes = Array.from({ length: ch }, () => new Float32Array(n));
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) planes[c][i] = v.getInt16(44 + (i * ch + c) * 2, true) / 32768;
    const m = new LoudnessMeter(rate, ch);
    m.push(planes, n);
    return m.integrated();
  });
  // After the stop, momentary has fallen to silence and shows a dash.
  details.reading = { ok: Number.isFinite(live.s) && Number.isFinite(live.i) && /M —/.test(text), text };
  details.agrees = { ok: Math.abs(live.i - offline) < 1, live: live.i, offline };
  const geo = await page.evaluate(() => {
    const l = document.querySelector(".lufs").getBoundingClientRect();
    const f = document.querySelector(".player-frame").getBoundingClientRect();
    const s = document.querySelector(".player-stage").getBoundingClientRect();
    return { below: l.top >= f.bottom - 0.5, inside: l.right <= s.right + 0.5 && l.bottom <= s.bottom + 0.5 };
  });
  details.placement = { ok: geo.below && geo.inside, ...geo };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
