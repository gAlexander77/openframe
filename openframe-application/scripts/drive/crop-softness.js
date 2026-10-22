// Real compositor pixels and exported PNGs, at both delivery sizes.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("set_project", { width: 1920, height: 1080, background: "#000000" });
    v.exec("add_color_clip", { color: "#ffffff", start: 0, duration: 3 });
    const id = v.project().tracks.flatMap((t) => t.clips)[0].id;
    v.exec("set_crop", { clip_ids: [id], left: 0.25 });
    v.seek(15); v.select([id]);
    return id;
  });
  const samples = (resolution) => page.evaluate(async (resolution) => {
    const v = window.videoEditor;
    await new Promise((r) => setTimeout(r, 100));
    await v.rendered();
    let px;
    if (resolution) {
      const s = await v.still(15, resolution);
      const bmp = await createImageBitmap(await (await fetch(s.url)).blob());
      URL.revokeObjectURL(s.url);
      const canvas = new OffscreenCanvas(bmp.width, bmp.height), g = canvas.getContext("2d");
      g.drawImage(bmp, 0, 0); bmp.close();
      px = g.getImageData(0, 0, canvas.width, canvas.height);
    } else px = v.pixels();
    const k = px.width / 1920;
    return { width: px.width, height: px.height, ramp: [474, 486, 510, 540, 570, 600, 624].map((x) => px.data[(Math.floor(540 * k) * px.width + Math.floor(x * k)) * 4]) };
  }, resolution);
  const details = {};
  const hard = await samples();
  details.hard = { ok: hard.ramp[0] < 4 && hard.ramp.slice(1).every((x) => x > 250), ...hard };
  await page.evaluate((id) => window.videoEditor.exec("set_crop", { clip_ids: [id], feather: 120 }), id);
  const want = [0, 2, 40, 128, 215, 255, 255];
  for (const res of [null, "1080p", "720p"]) {
    const got = await samples(res);
    details[res ?? "viewer"] = { ok: got.ramp.every((v, i) => Math.abs(v - want[i]) < 10) && (res !== "720p" || got.height === 720), ...got };
  }
  // Both entry points expose softness; crop mode keeps its draft until Done.
  const crop = page.getByRole("button", { name: "Crop on the viewer", exact: true });
  await crop.click();
  const softness = page.getByRole("slider", { name: "Crop softness", exact: true });
  details.toolbar = { ok: await softness.isVisible() && +(await softness.inputValue()) === 120 };
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  return { ok: Object.values(details).every((d) => d.ok), details };
}
