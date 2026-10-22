async (page) => {
  await page.goto("http://localhost:1420");
  await page.locator(".create-card").click();
  await page.waitForFunction(() => !!window.videoEditor);
  const details = {};
  const setup = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [a] = await ve.import([{ name: "color-bars.png", src: location.origin + "/fixtures/media/color-bars.png" }]);
    ve.exec("add_media_clip", { asset_id: a.id, start: 0, duration: 3 });
    ve.exec("add_media_clip", { asset_id: a.id, start: 3, duration: 3 });
    const ids = ve.project().tracks.flatMap(t => t.clips).map(c => c.id);
    ve.select([ids[0]]);
    ve.seek(15);
    await ve.rendered();
    const plain = ve.pixels();
    ve.exec("set_param", { clip_ids: [ids[0]], path: "adjust.temperature", value: 70 });
    ve.exec("set_param", { clip_ids: [ids[1]], path: "adjust.temperature", value: -70 });
    await ve.rendered();
    window.__comparePlain = plain;
    window.__compareGraded = ve.pixels();
    return { ids, width: plain.width, height: plain.height };
  });
  await page.getByRole("button", { name: "Comparison options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Before/after", exact: true }).click();
  details.beforeAfter = await page.evaluate(async () => {
    const ve = window.videoEditor;
    await ve.rendered();
    const px = ve.pixels(), plain = window.__comparePlain, graded = window.__compareGraded;
    let left = 0, right = 0, difference = 0;
    for (let y = 0; y < px.height; y++) for (let x = 0; x < px.width; x++) for (let k = 0; k < 3; k++) {
      const i = (y * px.width + x) * 4 + k;
      if (x < px.width / 2 - 2) left = Math.max(left, Math.abs(px.data[i] - plain.data[i]));
      if (x > px.width / 2 + 2) right = Math.max(right, Math.abs(px.data[i] - graded.data[i]));
      difference += Math.abs(plain.data[i] - graded.data[i]);
    }
    return { ok: left <= 1 && right <= 1 && difference > 10000, left, right, difference };
  });
  const handle = page.getByRole("slider", { name: "Comparison split", exact: true });
  const rect = await page.locator(".player-frame").boundingBox(), h = await handle.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.7, rect.y + rect.height / 2, { steps: 5 });
  await page.mouse.up();
  const split = await page.evaluate(() => window.videoEditor.state().compare.split);
  details.drag = { ok: Math.abs(split - 0.7) < 0.02, split };
  await handle.dblclick();
  details.reset = { ok: await page.evaluate(() => window.videoEditor.state().compare.split === 0.5) };
  await page.getByRole("button", { name: "Comparison options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Capture reference", exact: true }).click();
  await page.waitForFunction(() => window.videoEditor.state().compare.mode === "reference");
  await page.evaluate(() => window.videoEditor.seek(105));
  details.reference = await page.evaluate(async () => {
    const ve = window.videoEditor;
    await ve.rendered();
    const p = ve.pixels(), ref = window.__compareGraded;
    let left = 0, rightDifference = 0;
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) for (let k = 0; k < 3; k++) {
      const i = (y * p.width + x) * 4 + k;
      if (x < p.width / 2 - 2) left = Math.max(left, Math.abs(p.data[i] - ref.data[i]));
      else if (x > p.width / 2 + 2) rightDifference += Math.abs(p.data[i] - ref.data[i]);
    }
    return { ok: left <= 1 && rightDifference > 10000, left, rightDifference };
  });
  await page.getByRole("button", { name: "Comparison options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Horizontal split", exact: true }).click();
  details.horizontal = { ok: await page.locator(".compare-divider.horizontal").isVisible() };
  details.exportUnchanged = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const frame = async () => (await ve.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "preview_frame", arguments: { at: 3.5, max_width: 320 } } })).result.content[0].data;
    const on = await frame();
    ve.action("toggleCompare");
    const off = await frame();
    ve.action("toggleCompare");
    return { ok: on === off };
  });
  const start = await page.evaluate(() => { window.videoEditor.seek(10); window.videoEditor.action("playPause"); return window.videoEditor.state().playhead; });
  // Two seconds: playback start-up alone can take half a second on a cold page.
  await page.waitForTimeout(2000);
  const end = await page.evaluate(() => { const f = window.videoEditor.state().playhead; window.videoEditor.action("shuttleStop"); return f; });
  details.playback = { ok: end - start >= 40, start, end };
  await page.evaluate(() => window.videoEditor.action("toggleCompare"));
  details.off = { ok: await page.getByRole("slider", { name: "Comparison split" }).count() === 0 };
  return { ok: Object.values(details).every(d => d.ok), details, setup };
}
