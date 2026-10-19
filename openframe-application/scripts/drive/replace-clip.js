// Replace clip drive: right-click a video clip, Replace clip…, choose a
// picture in the file picker; the clip becomes that picture in the same
// place with the same length, scale and effects; Undo brings the video back.
// The agent path (replace_clip) refuses a sound for a picture.
async (page) => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [fc] = await api.import([{ name: "framecode-30.mp4", src: location.origin + "/fixtures/media/framecode-30.mp4" }]);
    api.exec("add_media_clip", { asset_id: fc.id, start: 0, duration: 3 });
    const c = api.describe().tracks.flatMap((t) => t.clips)[0];
    api.exec("set_param", { clip_ids: [c.id], path: "transform.scale", value: 0.6 });
    api.exec("add_effect", { clip_id: c.id, type: "glow" });
    return c.id;
  });
  const clip = () => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id), id);
  const details = {};
  const box = await page.locator(`[data-clip="${id}"]`).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Replace clip…" }).click();
  const fileChooser = await chooser;
  await fileChooser.setFiles({ name: "photo.png", mimeType: "image/png", buffer: fs.readFileSync(path.join(process.cwd(), "fixtures/media/photo.png")) });
  await page.waitForFunction((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id)?.type === "image", id, { timeout: 15000 });
  const c = await clip();
  details.replaced = { ok: c.type === "image" && c.start === 0 && c.duration === 90 && c.transform.scale === 0.6 && c.effects.length === 1, type: c.type, duration: c.duration };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undo = { ok: (await clip()).type === "video" };
  const err = await page.evaluate(async (id) => {
    const api = window.videoEditor;
    const [snd] = await api.import([{ name: "voice-8s.wav", src: location.origin + "/fixtures/media/voice-8s.wav" }]);
    try {
      api.exec("replace_clip", { clip_id: id, asset_id: snd.id });
      return "";
    } catch (e) {
      return String(e.message ?? e);
    }
  }, id);
  details.kindChecked = { ok: /video or a picture/.test(err), err };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
