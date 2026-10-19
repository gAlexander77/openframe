// Auto reframe (CapCut's and Premiere's): a 16:9 shot of person-pan.mp4,
// where the photo slides right one source pixel a frame, reframed to 9:16
// from the AI tools card. The canvas becomes 1080 x 1920 (short side
// kept), the clip fills it, and its position keys slide the picture left
// as fast as the subject moves right, so the subject stays centered:
// after 60 frames, 60 source pixels times the picture's scale. Then the
// inspector's Tracking > Keep subject centered does the same from a box.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [v] = await api.import([{ name: "person-pan.mp4", src: location.origin + "/fixtures/media/person-pan.mp4" }]);
    api.exec("add_media_clip", { asset_id: v.id, start: 0, duration: 3 });
    const c = api.project().tracks.flatMap((t) => t.clips).find((x) => x.type === "video");
    api.select([c.id]);
    return c.id;
  });
  const lib = page.getByRole("region", { name: "Library" });
  await lib.getByRole("tab", { name: "AI tools", exact: true }).click();
  const card = page.getByRole("region", { name: "Auto reframe" });
  await card.getByRole("button", { name: "Reframe", exact: true }).click();
  await page.waitForFunction(() => window.videoEditor.state().undoLabel === "Auto reframe", null, { timeout: 60000 });
  const r = await page.evaluate((id) => {
    const api = window.videoEditor;
    const p = api.project();
    const c = p.tracks.flatMap((t) => t.clips).find((x) => x.id === id);
    return {
      size: [p.width, p.height],
      scale: c.transform.scale,
      x0: api.paramAt(id, "transform.x", 0),
      x60: api.paramAt(id, "transform.x", 60),
      y0: api.paramAt(id, "transform.y", 0),
      y60: api.paramAt(id, "transform.y", 60),
      keys: c.keyframes["transform.x"].length,
    };
  }, id);
  await page.screenshot({ path: "__REPO__/scratch/auto-reframe.png" });
  const details = {};
  // 960 x 540 fits 1080 x 1920 at 1.125; covering the height takes scale
  // 1920 / (540 * 1.125) = 3.16.
  const want = (-60 * 1.125 * (1920 / (540 * 1.125))) / 1080;
  details.canvas = { ok: r.size[0] === 1080 && r.size[1] === 1920 && Math.abs(r.scale - 1920 / 607.5) < 0.01, ...r };
  details.follows = { ok: Math.abs(r.x60 - r.x0 - want) < 0.012 && Math.abs(r.y60 - r.y0) < 0.003, moved: r.x60 - r.x0, want };
  details.fewKeys = { ok: r.keys >= 2 && r.keys < 30, keys: r.keys };

  // The inspector's way, from a box on the viewer.
  await page.keyboard.press("Control+z");
  await page.evaluate((id) => {
    window.videoEditor.select([id]);
    window.videoEditor.seek(0);
  }, id);
  await page.getByRole("region", { name: "Inspector" }).getByRole("tab", { name: "Animation", exact: true }).click();
  await page.getByRole("button", { name: "Keep subject centered" }).click();
  await page.getByLabel("Subject to track").waitFor();
  await page.locator(".insp-section", { hasText: "Tracking" }).getByRole("button", { name: "Reframe", exact: true }).click();
  await page.waitForFunction(() => window.videoEditor.state().undoLabel === "Reframe", null, { timeout: 60000 });
  const keys = await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((x) => x.id === id).keyframes?.["transform.x"]?.length ?? 0, id);
  details.inspector = { ok: keys >= 2, keys };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
