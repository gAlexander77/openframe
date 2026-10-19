// Keyframed pan: the Audio tab's Pan row takes keyframes like Volume. A
// mono tone (on 1 s, off 1 s) panned from full left (0 s) to full right
// (2 s) renders left in its first burst and right in its second.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(async () => {
    const api = window.videoEditor;
    const [m] = await api.import([{ name: "voice-8s.wav", src: location.origin + "/fixtures/media/voice-8s.wav" }]);
    api.exec("add_media_clip", { asset_id: m.id, start: 0, duration: 4 });
    const c = api.project().tracks.flatMap((t) => t.clips).find((x) => x.type === "audio");
    api.select([c.id]);
    api.seek(0);
  });
  const details = {};
  await page.getByRole("tab", { name: "Audio", exact: true }).last().click();
  // The row's diamond keys pan at the playhead (0 s); set_param then sets
  // that key to full left and adds one at 2 s, full right.
  const row = page.locator(".insp-row", { has: page.locator(".insp-label", { hasText: /^Pan$/ }) });
  await row.getByRole("button", { name: "Add keyframe" }).click();
  await page.evaluate(() => {
    const api = window.videoEditor;
    const c = api.project().tracks.flatMap((t) => t.clips).find((x) => x.type === "audio");
    api.exec("set_param", { clip_ids: [c.id], path: "pan", value: -1, at: 0 });
    api.exec("set_param", { clip_ids: [c.id], path: "pan", value: 1, at: 2 });
  });
  const keys = await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((x) => x.type === "audio").keyframes?.pan ?? []);
  details.keys = { ok: keys.length === 2, keys };
  const ends = await page.evaluate(async () => {
    const r = await window.videoEditor.render({ video: false, audioFormat: "wav", start: 0, end: 3 });
    const buf = await (await fetch(r.url)).arrayBuffer();
    URL.revokeObjectURL(r.url);
    const v = new DataView(buf);
    const rate = v.getUint32(24, true);
    const rms = (from, to) => {
      let l = 0, rr = 0, n = 0;
      for (let s = Math.floor(from * rate); s < Math.floor(to * rate); s++, n++) {
        const i = 44 + s * 4;
        if (i + 3 >= buf.byteLength) break;
        l += (v.getInt16(i, true) / 32768) ** 2;
        rr += (v.getInt16(i + 2, true) / 32768) ** 2;
      }
      return { l: Math.sqrt(l / n), r: Math.sqrt(rr / n) };
    };
    return { start: rms(0.05, 0.3), end: rms(2.1, 2.5) };
  });
  details.sweeps = { ok: ends.start.l > ends.start.r * 3 && ends.end.r > ends.end.l * 3, ...ends };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
