// Motion tracking (CapCut's Tracking): a title over person-pan.mp4, where
// the photo slides right one source pixel a frame (960 px wide, filling the
// canvas). Animation > Tracking > Pick subject puts a box on the viewer;
// it is dragged onto the jacket and Track pins the title. After 60 frames
// the title has moved 60/960 of the canvas right and not at all down, in
// one undo step, with a few keyframes rather than one a frame.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [v] = await api.import([{ name: "person-pan.mp4", src: location.origin + "/fixtures/media/person-pan.mp4" }]);
    api.exec("add_media_clip", { asset_id: v.id, start: 0, duration: 3 });
    api.exec("add_text", { text: "Tracked", start: 0, duration: 3, x: 0.05, y: 0.1 });
    const clips = api.project().tracks.flatMap((t) => t.clips);
    const text = clips.find((c) => c.type === "text").id;
    api.select([text]);
    api.seek(0);
    return { text, video: clips.find((c) => c.type === "video").id };
  });
  const details = {};
  await page.getByRole("tab", { name: "Animation", exact: true }).click();
  const section = page.locator(".insp-section", { hasText: "Tracking" });
  await section.getByRole("button", { name: "Pick subject" }).click();
  const box = page.getByLabel("Subject to track");
  await box.waitFor();
  const before = await box.boundingBox();
  // Drag it 30 screen pixels left: the box follows the pointer.
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 - 30, before.y + before.height / 2, { steps: 4 });
  await page.mouse.up();
  const after = await box.boundingBox();
  details.boxDrags = { ok: Math.abs(after.x - (before.x - 30)) < 2 && Math.abs(after.y - before.y) < 2, before, after };
  await page.screenshot({ path: "__REPO__/scratch/motion-tracking-box.png" });
  await section.getByRole("button", { name: "Track", exact: true }).click();
  await page.waitForFunction(() => window.videoEditor.state().undoLabel === "Track motion", null, { timeout: 60000 });
  const r = await page.evaluate((ids) => {
    const api = window.videoEditor;
    const t = api.project().tracks.flatMap((x) => x.clips).find((c) => c.id === ids.text);
    return { x0: api.paramAt(ids.text, "transform.x", 0), x60: api.paramAt(ids.text, "transform.x", 60), y60: api.paramAt(ids.text, "transform.y", 60), keys: t.keyframes["transform.x"].length };
  }, ids);
  // 60 frames of one source pixel each; the source is 960 wide and fills
  // the 1920-wide canvas.
  details.follows = { ok: Math.abs(r.x60 - r.x0 - 60 / 960) < 0.004 && Math.abs(r.y60 - 0.1) < 0.003 && Math.abs(r.x0 - 0.05) < 1e-4, ...r, want: 60 / 960 };
  details.fewKeys = { ok: r.keys >= 2 && r.keys < 20, keys: r.keys };
  details.boxGone = { ok: (await box.count()) === 0 };
  // An agent's call: no video under the layer past the video's end.
  details.refuses = {
    ok: await page.evaluate(async (ids) => {
      const api = window.videoEditor;
      api.exec("add_text", { text: "Alone", start: 4, duration: 1 });
      const lone = api.project().tracks.flatMap((x) => x.clips).find((c) => c.type === "text" && c.start > 100);
      return api.ai.trackMotion(lone.id, { at: 4.2 }).then(() => false, (e) => /video under this layer/.test(e.message));
    }, ids),
  };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
