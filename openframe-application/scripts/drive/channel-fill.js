// Channel fill (Premiere's Fill Left / Fill Right): a stereo file with a
// tone on the left channel only. As recorded, the export's right channel
// is silent; Left to both (Audio > Channels) makes both sides equal;
// set_channel_fill right fills both from the silent side. A mono file
// filled from the right still sounds on both sides (it is upmixed first).
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [a] = await api.import([{ name: "left-only.wav", src: location.origin + "/fixtures/media/left-only.wav" }]);
    api.exec("add_media_clip", { asset_id: a.id, start: 0, duration: 2 });
    const c = api.project().tracks.flatMap((t) => t.clips).find((x) => x.type === "audio");
    api.select([c.id]);
    return c.id;
  });
  const sides = () =>
    page.evaluate(async () => {
      const r = await window.videoEditor.render({ video: false, audioFormat: "wav", start: 0.2, end: 1.8 });
      const buf = await (await fetch(r.url)).arrayBuffer();
      URL.revokeObjectURL(r.url);
      const v = new DataView(buf);
      let l = 0, rr = 0, n = 0;
      for (let i = 44; i + 3 < buf.byteLength; i += 4, n++) {
        l += (v.getInt16(i, true) / 32768) ** 2;
        rr += (v.getInt16(i + 2, true) / 32768) ** 2;
      }
      return { l: Math.sqrt(l / n), r: Math.sqrt(rr / n) };
    });
  const details = {};
  const asIs = await sides();
  details.oneSided = { ok: asIs.l > 0.1 && asIs.r < 0.001, ...asIs };
  await page.getByRole("tab", { name: "Audio", exact: true }).last().click();
  await page.getByRole("radio", { name: "Left to both", exact: true }).click();
  const filled = await sides();
  details.leftToBoth = { ok: Math.abs(filled.l - filled.r) < 0.002 && filled.r > 0.1, ...filled };
  details.undo = { ok: (await page.getByRole("button", { name: "Undo Fill from left", exact: true }).count()) === 1 };
  await page.evaluate((id) => window.videoEditor.exec("set_channel_fill", { clip_ids: [id], fill: "right" }), id);
  const silent = await sides();
  details.rightToBoth = { ok: silent.l < 0.001 && silent.r < 0.001, ...silent };
  await page.evaluate(async (id) => {
    const api = window.videoEditor;
    api.exec("delete_clips", { clip_ids: [id] });
    const [m] = await api.import([{ name: "voice-8s.wav", src: location.origin + "/fixtures/media/voice-8s.wav" }]);
    api.exec("add_media_clip", { asset_id: m.id, start: 0, duration: 2 });
    const c = api.project().tracks.flatMap((t) => t.clips).find((x) => x.type === "audio");
    api.exec("set_channel_fill", { clip_ids: [c.id], fill: "right" });
  }, id);
  const mono = await sides();
  details.monoSafe = { ok: mono.l > 0.05 && Math.abs(mono.l - mono.r) < 0.002, ...mono };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
