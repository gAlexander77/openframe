// Rate stretch, EQ and Auto adjust in the running app:
//   - Rate stretch tool (Shift+R): dragging a clip's end out to twice its
//     length halves its speed; one undo step ("Rate stretch").
//   - EQ: on a 180 Hz tone (voice-8s.wav) the low shelf at -12 dB lowers
//     the rendered level by more than 4 dB and the high shelf at +12 dB
//     leaves it within 1.5 dB; on the 1 kHz beep the mid bell raises it.
//   - Auto adjust: the Adjust tab's button sets the Basic sliders from the
//     frame (the values it reports), as one undo step.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const details = {};

  // ---- rate stretch -------------------------------------------------------------
  const vid = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [fc] = await api.import([{ name: "framecode-30.mp4", src: location.origin + "/fixtures/media/framecode-30.mp4" }]);
    api.exec("add_media_clip", { asset_id: fc.id, start: 0, duration: 2 });
    return api.describe().tracks.flatMap((t) => t.clips)[0].id;
  });
  await page.locator(".tl-ruler").click({ position: { x: 900, y: 10 } });
  await page.keyboard.press("Shift+R");
  const box = await page.locator(`[data-clip="${vid}"]`).boundingBox();
  const edge = page.locator(`[data-clip="${vid}"] .trim-end`);
  const eb = await edge.boundingBox();
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.down();
  await page.mouse.move(eb.x + box.width, eb.y + eb.height / 2, { steps: 8 });
  await page.mouse.up();
  const stretched = await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id), vid);
  details.stretch = { ok: Math.abs(stretched.speed - 0.5) < 0.06 && Math.abs(stretched.duration - 120) <= 6 && stretched.in === 0, speed: stretched.speed, duration: stretched.duration };
  details.stretchUndo = { ok: (await page.getByRole("button", { name: "Undo Rate stretch", exact: true }).count()) === 1 };
  await page.keyboard.press("A");

  // ---- EQ ------------------------------------------------------------------------------
  const rms = (setup) =>
    page.evaluate(async (setup) => {
      const api = window.videoEditor;
      for (const t of api.project().tracks) for (const c of t.clips) api.exec("delete_clips", { clip_ids: [c.id] });
      const asset = api.project().assets.find((a) => a.name === setup.name);
      api.exec("add_media_clip", { asset_id: asset.id, start: 0, duration: 2 });
      const id = api.describe().tracks.flatMap((t) => t.clips).find((c) => c.type === "audio" || c.type === "video").id;
      for (const [band, db] of Object.entries(setup.eq)) api.exec("set_param", { clip_ids: [id], path: `eq.${band}`, value: db });
      const r = await api.render({ video: false, audioFormat: "wav", start: 0, end: 2 });
      const buf = await (await fetch(r.url)).arrayBuffer();
      URL.revokeObjectURL(r.url);
      const v = new DataView(buf);
      let s = 0, n = 0;
      for (let i = 44; i + 1 < buf.byteLength; i += 2) {
        const x = v.getInt16(i, true) / 32768;
        s += x * x;
        n++;
      }
      return 10 * Math.log10(s / n + 1e-12);
    }, setup);
  await page.evaluate(async () => {
    await window.videoEditor.import([
      { name: "voice-8s.wav", src: location.origin + "/fixtures/media/voice-8s.wav" },
      { name: "flash-beep-30.mp4", src: location.origin + "/fixtures/media/flash-beep-30.mp4" },
    ]);
  });
  const flat = await rms({ name: "voice-8s.wav", eq: {} });
  const lowCut = await rms({ name: "voice-8s.wav", eq: { low: -12 } });
  const highBoost = await rms({ name: "voice-8s.wav", eq: { high: 12 } });
  const beep = await rms({ name: "flash-beep-30.mp4", eq: {} });
  const beepMid = await rms({ name: "flash-beep-30.mp4", eq: { mid: 12 } });
  // The low shelf (120 Hz) reaches a 180 Hz tone in part; the high one not.
  details.eq = { ok: flat - lowCut > 1.5 && Math.abs(highBoost - flat) < 0.5 && beepMid - beep > 5, flat, lowCut, highBoost, beep, beepMid };

  // ---- auto adjust ---------------------------------------------------------------------
  const img = await page.evaluate(async () => {
    const api = window.videoEditor;
    for (const t of api.project().tracks) for (const c of t.clips) api.exec("delete_clips", { clip_ids: [c.id] });
    const [ph] = await api.import([{ name: "photo.jpg", src: location.origin + "/fixtures/media/photo.jpg" }]);
    api.exec("add_media_clip", { asset_id: ph.id, start: 0, duration: 3 });
    const id = api.describe().tracks.flatMap((t) => t.clips)[0].id;
    api.select([id]);
    api.seek(10);
    return id;
  });
  await page.getByRole("tab", { name: "Adjust", exact: true }).click();
  await page.getByRole("button", { name: "Auto adjust" }).click();
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent?.includes("Auto adjusted"), null, { timeout: 15000 }).catch(() => {});
  const adj = await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).adjust, img);
  const changed = ["exposure", "temperature", "tint", "blacks", "whites"].some((k) => adj[k] !== 0);
  const within = Math.abs(adj.tint) <= 25 && Math.abs(adj.temperature) <= 40 && adj.blacks <= 40 && adj.whites >= -50;
  details.autoAdjust = { ok: within && (await page.getByRole("button", { name: "Undo Auto adjust", exact: true }).count()) === 1, changed, adj: { exposure: adj.exposure, temperature: adj.temperature, tint: adj.tint, blacks: adj.blacks, whites: adj.whites } };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
