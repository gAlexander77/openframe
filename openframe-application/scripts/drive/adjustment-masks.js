async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(async () => {
    const v = window.videoEditor;
    const [bars] = await v.import([{ name: "color-bars.png", src: location.origin + "/fixtures/media/color-bars.png" }]);
    v.exec("set_project", { width: 1920, height: 1080 });
    v.exec("add_media_clip", { asset_id: bars.id, start: 0, duration: 3 });
    v.seek(15);
  });
  // Same row through the middle: points inside, on the edge, and outside.
  const sample = (resolution) => page.evaluate(async (resolution) => {
    const v = window.videoEditor;
    await new Promise((r) => setTimeout(r, 100)); await v.rendered();
    let px;
    if (resolution) {
      const s = await v.still(15, resolution), bmp = await createImageBitmap(await (await fetch(s.url)).blob());
      URL.revokeObjectURL(s.url);
      const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext("2d");
      g.drawImage(bmp, 0, 0); bmp.close(); px = g.getImageData(0, 0, c.width, c.height);
    } else px = v.pixels();
    const k = px.width / 1920;
    return [960, 1344, 1536].map((x) => {
      const i = (Math.floor(540 * k) * px.width + Math.floor(x * k)) * 4;
      return px.data[i] + px.data[i + 1] + px.data[i + 2];
    });
  }, resolution);
  const resolutions = [null, "1080p", "720p"];
  // Normalize against the same render path and size before adding the adjustment.
  const baselines = new Map();
  for (const resolution of resolutions) baselines.set(resolution, await sample(resolution));
  const id = await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("add_adjustment_clip", { start: 0, duration: 3 });
    const id = v.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "adjustment").id;
    v.exec("set_param", { clip_ids: [id], path: "adjust.exposure", value: -100 });
    v.exec("set_mask", { clip_ids: [id], shape: "circle", width: 0.4, aspect: 1, feather: 0.1 });
    v.select([id]); return id;
  });
  const details = {};
  for (const inverted of [false, true]) {
    await page.evaluate(({ id, inverted }) => window.videoEditor.exec("set_mask", { clip_ids: [id], invert: inverted }), { id, inverted });
    for (const resolution of resolutions) {
      const baseline = baselines.get(resolution);
      const got = await sample(resolution), ratios = got.map((v, i) => v / baseline[i]);
      details[`${inverted ? "inverted" : "inside"}-${resolution ?? "viewer"}`] = { ok: Math.abs(ratios[0] - (inverted ? 1 : 0.25)) < 0.05 && Math.abs(ratios[1] - 0.625) < 0.1 && Math.abs(ratios[2] - (inverted ? 0.25 : 1)) < 0.05, ratios };
    }
  }
  await page.getByRole("tab", { name: "Mask", exact: true }).click();
  details.overlay = { ok: await page.locator(".mask-outline").isVisible() };
  return { ok: Object.values(details).every((d) => d.ok), details };
}
