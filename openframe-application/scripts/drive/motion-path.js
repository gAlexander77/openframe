// Motion path (Premiere's): a picture whose position is keyframed shows
// the dashed line its center travels, with a dot at each position key, in
// the viewer while it is selected; a still picture shows none. A box moving
// from left (-0.3) to right (+0.3) of the canvas over two seconds draws a
// level line spanning 60% of the canvas's width on screen.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("add_color_clip", { color: "#225588", start: 0, duration: 3 });
    v.exec("add_color_clip", { color: "#aa3344", start: 0, duration: 3 });
    const [a, b] = v.project().tracks.flatMap((t) => t.clips).map((c) => c.id);
    v.exec("set_param", { clip_ids: [a, b], path: "transform.scale", value: 0.2 });
    v.exec("add_keyframe", { clip_id: a, path: "transform.x", at: 0, value: -0.3 });
    v.exec("add_keyframe", { clip_id: a, path: "transform.x", at: 2, value: 0.3 });
    v.select([a]);
    v.seek(10);
    return { a, b };
  });
  const details = {};
  const path = page.locator(".motion-path polyline");
  await path.waitFor({ state: "attached" }); // a level line has no height, so never "visible"
  const canvas = await page.locator(".viewer-guides, .player-stage canvas").first().boundingBox();
  const geom = await page.evaluate(() => {
    const pts = document.querySelector(".motion-path polyline").getAttribute("points").split(" ").map((s) => s.split(",").map(Number));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { span: Math.max(...xs) - Math.min(...xs), rise: Math.max(...ys) - Math.min(...ys), dots: document.querySelectorAll(".motion-path circle").length };
  });
  const width = await page.evaluate(() => document.querySelector(".tf-layer").getBoundingClientRect().width);
  details.path = { ok: Math.abs(geom.span / width - 0.6) < 0.02 && geom.rise < 1 && geom.dots === 2, ...geom, width, canvas };
  await page.screenshot({ path: "__REPO__/scratch/motion-path.png" });
  await page.evaluate((b) => window.videoEditor.select([b]), ids.b);
  details.stillNone = { ok: (await page.locator(".motion-path").count()) === 0 };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
