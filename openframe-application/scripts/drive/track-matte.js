// Track mattes (ADR-056), in real pixels, in the viewer and through the
// export path (window.videoEditor.still renders with export's compositor):
// - alpha: the color bars show only inside a big white "O" (a text clip),
//   which is not drawn itself; black elsewhere.
// - alphaInverted: the reverse.
// - luma: a white-to-black gradient shape as the matte keeps the bars at
//   its bright left, drops them at its dark right; lumaInverted reverses.
// - above: with no matte named, the shape on the track directly above
//   (an ellipse) cuts the bars, and the ellipse's red never shows.
// - an animated matte (a box sliding right) reveals more over time.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(5000);
  const ids = await page.evaluate(async () => {
    const v = window.videoEditor;
    v.exec("set_project", { width: 1920, height: 1080 });
    const [b] = await v.import([{ name: "color-bars.png", src: location.origin + "/fixtures/media/color-bars.png" }]);
    v.exec("add_media_clip", { asset_id: b.id, start: 0, duration: 6 });
    const bars = v.project().tracks.flatMap((t) => t.clips)[0].id;
    v.exec("set_param", { clip_ids: [bars], path: "transform.scale", value: 1 });
    // The matte for the first two seconds: a huge white O at the center.
    v.exec("add_text", { text: "O", start: 0, duration: 2, style: { size: 900, color: "#ffffff" } });
    const text = v.describe().tracks.flatMap((t) => t.clips).find((c) => c.type === "text").id;
    return { bars, text };
  });
  /** Colors at canvas fractions, from the viewer and from export's still. */
  const sample = (frame, pts) =>
    page.evaluate(
      async ({ frame, pts }) => {
        const v = window.videoEditor;
        v.seek(frame);
        await new Promise((r) => setTimeout(r, 60));
        await v.rendered();
        const px = v.pixels(640);
        const at = (d, w, h, [fx, fy]) => {
          const i = (Math.floor(fy * h) * w + Math.floor(fx * w)) * 4;
          return [d[i], d[i + 1], d[i + 2]];
        };
        const viewer = pts.map((p) => at(px.data, px.width, px.height, p));
        const still = await v.still(frame, "480p");
        const bmp = await createImageBitmap(await (await fetch(still.url)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d");
        c.drawImage(bmp, 0, 0);
        const img = c.getImageData(0, 0, bmp.width, bmp.height);
        URL.revokeObjectURL(still.url);
        return { viewer, exported: pts.map((p) => at(img.data, img.width, img.height, p)) };
      },
      { frame, pts },
    );
  // The bars change rows at y 0.5 (75% above, 100% below): samples stay
  // off that line, or the two paths' sizes land on different rows.
  const dark = (c) => c.every((v) => v < 30);
  const dim = (c) => c.every((v) => v < 60);
  const lit = (c) => Math.max(...c) > 120;
  const same = (a, b) => a.every((c, i) => c.every((v, k) => Math.abs(v - b[i][k]) <= 24));
  const details = {};
  // Inside the O's stroke (left side of the ring), its hole, and a corner.
  const ring = [0.5 - 0.09, 0.45], hole = [0.5, 0.45], corner = [0.08, 0.1];
  const exec = (name, args) => page.evaluate(({ name, args }) => window.videoEditor.exec(name, args), { name, args });

  await exec("set_track_matte", { clip_id: ids.bars, matte_clip_id: ids.text, mode: "alpha" });
  let s = await sample(15, [ring, hole, corner]);
  details.alpha = { ok: lit(s.viewer[0]) && dark(s.viewer[1]) && dark(s.viewer[2]) && same(s.viewer, s.exported), ...s };
  // The O itself is white; the bars at the ring's spot are not.
  details.matteHidden = { ok: !s.viewer[0].every((v) => v > 230), ring: s.viewer[0] };

  await exec("set_track_matte", { clip_id: ids.bars, mode: "alphaInverted" });
  s = await sample(15, [ring, hole, corner]);
  details.alphaInverted = { ok: dark(s.viewer[0]) && lit(s.viewer[1]) && lit(s.viewer[2]) && same(s.viewer, s.exported), ...s };

  // Luma: a full-canvas gradient shape from white (left) to black (right), 2..4 s.
  await exec("add_shape", { kind: "rectangle", start: 2, duration: 2, width: 1, height: 1, gradient: { from: "#ffffff", to: "#000000", angle: 0 } });
  const grad = await page.evaluate(() => window.videoEditor.describe().tracks.flatMap((t) => t.clips).find((c) => c.shape && c.shape.gradient).id);
  await exec("set_track_matte", { clip_id: ids.bars, matte_clip_id: grad, mode: "luma" });
  // The gray bar at the bright left, the blue bar near the dark right.
  const left = [0.06, 0.35], right = [0.84, 0.35];
  s = await sample(75, [left, right]);
  details.luma = { ok: lit(s.viewer[0]) && dim(s.viewer[1]) && same(s.viewer, s.exported), ...s };
  await exec("set_track_matte", { clip_id: ids.bars, mode: "lumaInverted" });
  s = await sample(75, [left, right]);
  details.lumaInverted = { ok: dim(s.viewer[0]) && lit(s.viewer[1]) && same(s.viewer, s.exported), ...s };

  // Above: a red ellipse on the track directly above the bars, 4..5 s.
  const above = await page.evaluate(() => {
    const v = window.videoEditor;
    const p = v.project();
    const barsTrack = p.tracks.findIndex((t) => t.clips.some((c) => c.type === "image"));
    // The track right above the bars' track.
    v.exec("add_shape", { kind: "ellipse", start: 4, duration: 1, width: 0.3, color: "#ff0000", track_id: p.tracks[barsTrack - 1].id });
    return v.describe().tracks.flatMap((t) => t.clips).find((c) => c.shape?.kind === "ellipse").id;
  });
  await exec("set_track_matte", { clip_id: ids.bars, matte_clip_id: "above", mode: "alpha" });
  s = await sample(135, [hole, corner, [0.5 + 0.1, 0.45]]);
  details.above = { ok: lit(s.viewer[0]) && dark(s.viewer[1]) && same(s.viewer, s.exported) && !(s.viewer[0][0] > 200 && s.viewer[0][1] < 40 && s.viewer[0][2] < 40), ellipse: above, ...s };

  // An animated matte: a box sliding from the left edge to the center over
  // 5..6 s reveals the bars' middle only at the end.
  await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("add_shape", { kind: "rectangle", start: 5, duration: 1, width: 0.5, height: 1, color: "#ffffff", x: -0.5 });
    const box = v.describe().tracks.flatMap((t) => t.clips).find((c) => c.shape && c.start === 5).id;
    v.exec("add_keyframe", { clip_id: box, path: "transform.x", at: 5, value: -0.5 });
    v.exec("add_keyframe", { clip_id: box, path: "transform.x", at: 5.9, value: 0, ease: "easeOut" });
  });
  const box = await page.evaluate(() => window.videoEditor.describe().tracks.flatMap((t) => t.clips).find((c) => c.shape && c.start === 5).id);
  await exec("set_track_matte", { clip_id: ids.bars, matte_clip_id: box, mode: "alpha" });
  const early = await sample(150, [[0.4, 0.4]]);
  const late = await sample(177, [[0.4, 0.4]]);
  details.animated = { ok: dark(early.viewer[0]) && lit(late.viewer[0]), early: early.viewer[0], late: late.viewer[0] };

  // describe_project says what cuts what; "none" takes it off.
  const desc = await page.evaluate((id) => window.videoEditor.describe().tracks.flatMap((t) => t.clips).find((c) => c.id === id).track_matte, ids.bars);
  details.described = { ok: desc?.mode === "alpha" && desc?.matte === box, desc };
  await exec("set_track_matte", { clip_id: ids.bars, matte_clip_id: "none" });
  s = await sample(15, [corner]);
  details.none = { ok: lit(s.viewer[0]), corner: s.viewer[0] };
  await exec("set_track_matte", { clip_id: ids.bars, matte_clip_id: ids.text });
  await page.evaluate(async () => {
    window.videoEditor.seek(15);
    await window.videoEditor.rendered();
  });
  await page.screenshot({ path: "__REPO__/scratch/track-matte.png" });
  return { ok: Object.values(details).every((d) => d.ok), details };
};
