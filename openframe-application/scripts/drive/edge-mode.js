// Mirror and repeat edges (ADR-059), in real pixels, in the viewer and
// through export. The color bars at half size sit in the middle of the
// canvas (x 0.25..0.75, y 0.25..0.75). At canvas x 0.05, y 0.4:
// - none: black (nothing there);
// - mirror: the picture reflected at its left edge, 40% into it: the
//   fourth bar (green);
// - repeat: the picture tiled, 60% into it: the fifth bar (magenta).
// A turned, shrunk picture with mirror edges leaves no corner empty.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(5000);
  const id = await page.evaluate(async () => {
    const v = window.videoEditor;
    v.exec("set_project", { width: 1920, height: 1080 });
    const [b] = await v.import([{ name: "color-bars.png", src: location.origin + "/fixtures/media/color-bars.png" }]);
    v.exec("add_media_clip", { asset_id: b.id, start: 0, duration: 2 });
    const id = v.project().tracks.flatMap((t) => t.clips)[0].id;
    v.exec("set_param", { clip_ids: [id], path: "transform.scale", value: 0.5 });
    return id;
  });
  const sample = (pts) =>
    page.evaluate(async (pts) => {
      const v = window.videoEditor;
      v.seek(15);
      await new Promise((r) => setTimeout(r, 60));
      await v.rendered();
      const px = v.pixels(640);
      const at = (d, w, h, [fx, fy]) => {
        const i = (Math.floor(fy * h) * w + Math.floor(fx * w)) * 4;
        return [d[i], d[i + 1], d[i + 2]];
      };
      const still = await v.still(15, "480p");
      const bmp = await createImageBitmap(await (await fetch(still.url)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d");
      c.drawImage(bmp, 0, 0);
      const img = c.getImageData(0, 0, bmp.width, bmp.height);
      URL.revokeObjectURL(still.url);
      return { viewer: pts.map((p) => at(px.data, px.width, px.height, p)), exported: pts.map((p) => at(img.data, img.width, img.height, p)) };
    }, pts);
  const edge = (e) => page.evaluate(({ id, e }) => window.videoEditor.exec("set_edge_mode", { clip_ids: [id], edge: e }), { id, e });
  const near = (c, want) => c.every((v, i) => Math.abs(v - want[i]) <= 30);
  const same = (a, b) => a.every((c, i) => c.every((v, k) => Math.abs(v - b[i][k]) <= 24));
  const pt = [0.05, 0.4], mid = [0.5, 0.4];
  const details = {};
  let s = await sample([pt, mid]);
  details.none = { ok: near(s.viewer[0], [0, 0, 0]) && near(s.viewer[1], [191, 0, 191]) && same(s.viewer, s.exported), ...s };
  await edge("mirror");
  s = await sample([pt, mid]);
  details.mirror = { ok: near(s.viewer[0], [0, 191, 0]) && near(s.viewer[1], [191, 0, 191]) && same(s.viewer, s.exported), ...s };
  await edge("repeat");
  s = await sample([pt, mid]);
  details.repeat = { ok: near(s.viewer[0], [191, 0, 191]) && same(s.viewer, s.exported), ...s };

  // Turned 20 degrees at 0.8: every corner shows picture with mirror edges.
  await page.evaluate((id) => {
    const v = window.videoEditor;
    v.exec("set_param", { clip_ids: [id], path: "transform.rotation", value: 20 });
    v.exec("set_param", { clip_ids: [id], path: "transform.scale", value: 0.8 });
    v.exec("set_edge_mode", { clip_ids: [id], edge: "mirror" });
  }, id);
  const corners = [[0.01, 0.01], [0.99, 0.01], [0.01, 0.99], [0.99, 0.99]];
  s = await sample(corners);
  const empty = (c) => c.every((v) => v < 8);
  // The bars' own black bar and dark ramp can land in a corner: count how
  // many are black, which without edges is all four.
  await edge("none");
  const bare = await sample(corners);
  details.turned = { ok: s.viewer.filter(empty).length <= 1 && bare.viewer.filter(empty).length === 4, mirrored: s.viewer, bare: bare.viewer };

  await edge("mirror");
  const desc = await page.evaluate((id) => window.videoEditor.describe().tracks.flatMap((t) => t.clips).find((c) => c.id === id).edge, id);
  details.described = { ok: desc === "mirror", desc };
  await page.evaluate(async () => {
    window.videoEditor.seek(15);
    await window.videoEditor.rendered();
  });
  await page.screenshot({ path: "__REPO__/scratch/edge-mode.png" });
  return { ok: Object.values(details).every((d) => d.ok), details };
};
