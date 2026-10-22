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
    v.seek(15); v.select([id]); return id;
  });
  await page.getByRole("radio", { name: "Mask", exact: true }).click();
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  const canvas = await page.locator(".player-canvas").boundingBox();
  const screen = (x, y) => [canvas.x + x * canvas.width / 1920, canvas.y + y * canvas.height / 1080];
  const vertices = [[576, 270], [1440, 756], [480, 756]];
  for (const [x, y] of vertices) await page.mouse.click(...screen(x, y));
  await page.locator('.mask-point[aria-label="Mask point 1"]').click();
  const mask = () => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).mask, id);
  const made = await mask();
  const details = { realPenClicks: { ok: made.shape === "path" && made.closed === true && made.points.length === 3, mask: made } };
  for (const resolution of [null, "1080p", "720p"]) {
    const got = await page.evaluate(async (resolution) => {
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
      return [[960, 600], [100, 500], [960, 150]].map(([x, y]) => px.data[(Math.floor(y * k) * px.width + Math.floor(x * k)) * 4]);
    }, resolution);
    details[resolution ?? "viewer"] = { ok: got[0] > 250 && got[1] < 4 && got[2] < 4, pixels: got };
  }
  const point = page.locator('.mask-point[aria-label="Mask point 2"]');
  const before = await point.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 - 30, before.y + before.height / 2 - 15, { steps: 8 });
  await page.mouse.up();
  const moved = await mask();
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.pointDragUndo = { ok: moved.points[1].x !== made.points[1].x && JSON.stringify((await mask()).points) === JSON.stringify(made.points) };
  await point.click({ modifiers: ["Alt"] });
  const smooth = await mask();
  details.smoothCorner = { ok: smooth.points[1].in?.length === 2 && smooth.points[1].out?.length === 2 };
  const handle = page.locator('.mask-tangent[aria-label="Outgoing handle 2"]');
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 20, hb.y + hb.height / 2 + 10, { steps: 5 });
  await page.mouse.up();
  const pulled = await mask();
  details.handleDrag = { ok: JSON.stringify(pulled.points[1].out) !== JSON.stringify(smooth.points[1].out) };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.handleUndo = { ok: JSON.stringify((await mask()).points) === JSON.stringify(smooth.points) };
  await page.locator('[aria-label="Mask editor"]').press("Delete");
  details.deletePoint = { ok: (await mask()).points.length === 2 && (await mask()).closed === false };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.deleteUndo = { ok: (await mask()).points.length === 3 && (await mask()).closed === true };
  return { ok: Object.values(details).every((d) => d.ok), details };
}
