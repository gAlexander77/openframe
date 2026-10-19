// The Magnify effect (Premiere 26.3's): a lens near the top of the color
// bars (eight bars; Center 50%, 20%; size 60% of the height; zoom 400%).
// Inside the circle, a point 16% right of center (the red bar) shows what
// is a quarter as far out (54%, magenta), so its color changes; near the
// bottom, outside the circle, nothing does. That also pins Center Y to the
// top, not the bottom.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [b] = await api.import([{ name: "color-bars.png", src: location.origin + "/fixtures/media/color-bars.png" }]);
    api.exec("add_media_clip", { asset_id: b.id, start: 0, duration: 2 });
    const c = api.project().tracks.flatMap((t) => t.clips)[0];
    api.exec("set_param", { clip_ids: [c.id], path: "transform.scale", value: 1 });
    api.seek(10);
    return c.id;
  });
  const sample = () =>
    page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 400));
      const px = window.videoEditor.pixels(640);
      const at = (fx, fy) => {
        const i = (Math.floor(fy * px.height) * px.width + Math.floor(fx * px.width)) * 4;
        return [px.data[i], px.data[i + 1], px.data[i + 2]];
      };
      return { inside: at(0.66, 0.2), outside: at(0.66, 0.85) };
    });
  const before = await sample();
  await page.evaluate((id) => window.videoEditor.exec("add_effect", { clip_id: id, type: "magnify", params: { x: 50, y: 20, size: 60, zoom: 400 } }), id);
  const after = await sample();
  const differ = (a, b) => a.some((v, i) => Math.abs(v - b[i]) > 40);
  const details = {
    inside: { ok: differ(before.inside, after.inside), before: before.inside, after: after.inside },
    outside: { ok: !differ(before.outside, after.outside), before: before.outside, after: after.outside },
  };
  await page.screenshot({ path: "__REPO__/scratch/magnify.png" });
  // It is in the library's Effects tab like the others.
  await page.getByRole("region", { name: "Library" }).getByRole("tab", { name: "Effects", exact: true }).click();
  details.listed = { ok: (await page.getByRole("button", { name: "Add Magnify" }).count()) === 1 };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
