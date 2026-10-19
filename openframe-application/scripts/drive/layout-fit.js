// apply_layout's fit and track placement through MCP and the inspector.
// Two 16:9 recordings on their own tracks, a magenta label over each half on
// a track above them. A split screen with fit contain and a cell
// background: each recording whole and centered in its cell (no crop), a
// background shape under it, and the labels still on top, drawn in the
// frame (magenta pixels counted in the rendered frame; the Layout tracks
// once went above every title and hid them). Undo restores the project.
// Then the inspector: two clips selected, Fit chosen, the split tile
// clicked: the same contained layout in one undo step; Fill crops again.
// The frame is saved to scratch/layout-fit.png.
async (page) => {
  const fs = await import("node:fs");
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(10000);
  const details = {};
  const mcp = (name, args) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const json = async (name, args = {}) => {
    const r = await mcp(name, args);
    if (r.result?.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
    return JSON.parse(r.result.content[0].text);
  };
  const origin = await page.evaluate(() => location.origin);
  const project = () => page.evaluate(() => window.videoEditor.project());
  const snapshot = () => page.evaluate(() => JSON.stringify(window.videoEditor.project()));
  await json("set_project", { width: 1920, height: 1080 });
  const [rec, cam] = await json("import_media", { files: ["framecode-30.mp4", "person-pan.mp4"].map((n) => ({ src: `${origin}/fixtures/media/${n}` })) });
  await json("add_color_clip", { color: "#101014", start: 0, duration: 4 });
  const trackA = (await json("add_track", { kind: "video", name: "A" })).added_tracks[0].id;
  const trackB = (await json("add_track", { kind: "video", name: "B" })).added_tracks[0].id;
  const a = (await json("add_media_clip", { asset_id: rec.id, start: 0, duration: 4, track_id: trackA })).added_clips[0].id;
  const b = (await json("add_media_clip", { asset_id: cam.id, start: 0, duration: 4, track_id: trackB })).added_clips[0].id;
  const labels = (await json("add_track", { kind: "video", name: "Labels" })).added_tracks[0].id;
  await json("add_text", { text: "Recording", start: 0, duration: 4, x: -0.24, y: -0.3, track_id: labels, style: { size: 64, bold: true, color: "#ff00ff" } });
  const labels2 = (await json("add_track", { kind: "video", name: "Labels 2" })).added_tracks[0].id;
  await json("add_text", { text: "Camera", start: 0, duration: 4, x: 0.26, y: -0.3, track_id: labels2, style: { size: 64, bold: true, color: "#ff00ff" } });
  // Magenta pixels (the labels) in the frame at 1.5 s as export draws it (preview_frame).
  const magenta = () =>
    page.evaluate(async () => {
      const r = await window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "preview_frame", arguments: { at: 1.5, max_width: 960 } } });
      const bytes = Uint8Array.from(atob(r.result.content[0].data), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const g = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d");
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] > 200) n++;
      return n;
    });
  const before = await snapshot();
  const magentaBefore = await magenta();

  // ---- MCP: contain, a background, the labels kept on top ------------------------
  const done = await json("apply_layout", { clip_ids: [a, b], layout: "split-vertical", fit: "contain", background: "#202024", radius: 0.04 });
  let p = await project();
  const row = (id) => p.tracks.findIndex((t) => t.clips.some((c) => c.id === id));
  const clip = (id) => p.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
  const labelRows = p.tracks.filter((t) => t.clips.some((c) => c.type === "text")).map((t) => p.tracks.indexOf(t));
  const bgs = p.tracks.flatMap((t) => t.clips).filter((c) => c.name === "Layout background");
  details.contain = {
    ok: [a, b].every((id) => Object.values(clip(id).crop).every((v) => v === 0)) && Math.abs(clip(a).transform.x + clip(b).transform.x) < 0.01,
    crops: [clip(a).crop, clip(b).crop],
  };
  details.background = { ok: bgs.length === 2 && bgs.every((g) => g.shape.fill && [a, b].some((id) => clip(id).group === g.group && row(g.id) > row(id))), count: bgs.length };
  details.labelsOnTop = { ok: labelRows.every((r) => r < row(a) && r < row(b)), labelRows, rows: [row(a), row(b)], answered: Object.keys(done) };
  const magentaAfter = await magenta();
  details.labelsDrawn = { ok: magentaAfter > 0.8 * magentaBefore && magentaAfter > 500, magentaBefore, magentaAfter };
  const shot = await mcp("preview_frame", { at: 1.5, max_width: 960 });
  fs.mkdirSync("__REPO__/scratch", { recursive: true });
  fs.writeFileSync("__REPO__/scratch/layout-fit.png", Buffer.from(shot.result.content[0].data, "base64"));
  await json("undo");
  details.undo = { ok: before === (await snapshot()) };

  // ---- the inspector: Fit, then a tile -------------------------------------------------
  await page.evaluate((ids) => window.videoEditor.select(ids), [a, b]);
  await page.getByRole("radio", { name: "Show the whole picture in its cell" }).click();
  await page.getByRole("button", { name: "split vertical", exact: true }).click();
  p = await project();
  details.inspectorFit = { ok: [a, b].every((id) => Object.values(clip(id).crop).every((v) => v === 0)) && labelRows.every((r) => r < row(a)) };
  await json("undo");
  await page.evaluate((ids) => window.videoEditor.select(ids), [a, b]);
  await page.getByRole("radio", { name: "Fill each cell, cropping the picture" }).click();
  await page.getByRole("button", { name: "split vertical", exact: true }).click();
  p = await project();
  details.inspectorFill = { ok: clip(a).crop.left > 0 || clip(a).crop.top > 0 };
  await json("undo");
  details.undoAll = { ok: before === (await snapshot()) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
