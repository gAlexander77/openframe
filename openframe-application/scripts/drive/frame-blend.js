// Frame blending drive: a framecode clip at half speed. Timeline frame 21
// sits between source frames 10 and 11; with Frame blending on (Speed >
// Playback) its rendered still equals the average of the stills of
// frames 20 and 22 (source 10 and 11), and without it it repeats one of
// them. Rendered through the export path, which shares the compositor.
// Then 3 s of 1080p at half speed with blending play in real time.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [fc] = await api.import([{ name: "framecode-30.mp4", src: location.origin + "/fixtures/media/framecode-30.mp4" }]);
    api.exec("add_media_clip", { asset_id: fc.id, start: 0, duration: 2 });
    const c = api.project().tracks.find((t) => t.main).clips[0];
    api.exec("set_speed", { clip_id: c.id, speed: 0.5 });
    api.select([c.id]);
    return c.id;
  });
  const stills = (frames) =>
    page.evaluate(async (frames) => {
      const { exportStill } = await import("/src/engine/export.ts");
      const p = window.videoEditor.project();
      const out = [];
      for (const f of frames) {
        const bmp = await createImageBitmap(await exportStill(p, f, 320, 180));
        const cv = new OffscreenCanvas(320, 180);
        const ctx = cv.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        out.push(Array.from(ctx.getImageData(0, 0, 320, 180).data));
      }
      return out;
    }, frames);
  const diff = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    return s / (a.length * 0.75);
  };
  const details = {};
  const [a, b, plain] = await stills([20, 22, 21]);
  details.sourceDiffers = { ok: diff(a, b) > 5, d: diff(a, b) };
  await page.getByRole("tab", { name: "Speed", exact: true }).click();
  await page.getByRole("switch", { name: "Frame blending" }).click();
  details.on = { ok: await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).frameBlend === true, id) };
  const [mixed, a2] = await stills([21, 20]);
  const avg = a.map((v, i) => (v + b[i]) / 2);
  details.blended = { ok: diff(mixed, avg) < 2.5 && diff(mixed, a) > 2 && diff(mixed, b) > 2, toAvg: diff(mixed, avg), toA: diff(mixed, a), toB: diff(mixed, b) };
  details.plainRepeats = { ok: Math.min(diff(plain, a), diff(plain, b)) < 1, toA: diff(plain, a), toB: diff(plain, b) };
  // On a source frame there is nothing to mix.
  details.evenUnchanged = { ok: diff(a2, a) < 1, d: diff(a2, a) };

  // Real playback: two decoders for the slowed clip, frames drawn vs dropped.
  const drawn = await page.evaluate(async () => {
    const api = window.videoEditor;
    const loaded = performance.getEntriesByType("resource").map((e) => e.name);
    const mod = (path) => import(loaded.find((n) => new URL(n).pathname === path) ?? path);
    const { player } = await mod("/src/engine/player.ts");
    for (const t of api.project().tracks) for (const c of t.clips) api.exec("delete_clips", { clip_ids: [c.id] });
    const [hd] = await api.import([{ name: "h264-1080p30.mp4", src: location.origin + "/fixtures/media/h264-1080p30.mp4" }]);
    api.exec("add_media_clip", { asset_id: hd.id, start: 0, duration: 4 });
    const c = api.project().tracks.find((t) => t.main).clips[0];
    api.exec("set_speed", { clip_id: c.id, speed: 0.5 });
    api.exec("set_frame_blending", { clip_ids: [c.id], on: true });
    api.seek(0);
    await api.rendered();
    const before = { ...player.drawn };
    api.action("playPause");
    await new Promise((r) => setTimeout(r, 3000));
    api.action("playPause");
    return { frame: player.drawn.frame - (before.frame ?? 0), dropped: player.drawn.dropped - (before.dropped ?? 0) };
  });
  details.realtime = { ok: drawn.frame > 60 && drawn.dropped <= 3, ...drawn };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
