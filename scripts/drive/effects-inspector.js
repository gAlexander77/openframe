// Effect removal must be discoverable without scrolling through color controls.
async (page) => {
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("http://localhost:1420");
  await page.locator(".create-card").click();
  const clipId = await page.evaluate(async () => {
    const v = window.videoEditor;
    await v.import([{ name: "h264-1080p30.mp4", src: `${location.origin}/fixtures/media/h264-1080p30.mp4` }]);
    v.exec("add_media_clip", { asset_id: v.project().assets[0].id, start: 0, duration: 3 });
    const c = v.project().tracks.flatMap(t => t.clips)[0];
    v.exec("add_media_clip", { asset_id: v.project().assets[0].id, start: 3, duration: 3 });
    v.exec("add_effect", { clip_id: c.id, type: "blur" });
    v.exec("set_transition", { clip_id: c.id, type: "dissolve", duration: 0.5 });
    v.select([c.id]);
    return c.id;
  });
  const inspector = page.getByRole("region", { name: "Inspector", exact: true });
  const details = {};
  for (const [width, height] of [[1600, 950], [1100, 680]]) {
    await page.setViewportSize({ width, height });
    const tabs = await inspector.locator('[role="tab"]').evaluateAll(els => els.map(el => {
      const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect();
      return { name: el.textContent, fits: r.left >= p.left && r.right <= p.right + 1 && r.top >= p.top && r.bottom <= p.bottom + 1 };
    }));
    details[`tabs fit at ${width}`] = { ok: tabs.length === 7 && tabs.every(t => t.fits), tabs };
  }
  await inspector.getByRole("tab", { name: "Effects (1)", exact: true }).click();
  details.visibleStack = { ok: await inspector.locator(".fx-card").count() === 1 && await inspector.getByRole("button", { name: "Remove effect", exact: true }).isVisible() };
  await inspector.getByRole("button", { name: "Disable effect", exact: true }).click();
  details.disable = { ok: await page.evaluate(id => !window.videoEditor.project().tracks.flatMap(t => t.clips).find(c => c.id === id).effects[0].enabled, clipId) };
  await inspector.getByRole("button", { name: "Remove effect", exact: true }).click();
  details.remove = { ok: await inspector.locator(".fx-card").count() === 0 && await inspector.getByRole("tab", { name: "Effects", exact: true }).isVisible() };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undo = { ok: await inspector.locator(".fx-card.off").count() === 1 };
  await inspector.getByRole("tab", { name: "Adjust", exact: true }).click();
  details.colorPreserved = { ok: await inspector.getByRole("radio", { name: "Basic", exact: true }).isVisible() && await inspector.locator(".fx-card").count() === 0 };
  await inspector.getByRole("tab", { name: "Effects (1)", exact: true }).click();
  await inspector.screenshot({ path: "scratch/effects-inspector.png", animations: "disabled" });
  return { ok: Object.values(details).every(d => d.ok), details };
}
