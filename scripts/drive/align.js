// Align drive: CapCut's Transform align row and the viewer's edge snapping.
// The on-canvas box (.tf-box) is drawn from the same geometry the buttons
// use, so each check compares the box against the canvas (.tf-layer):
//   - Align left/right/top/bottom/center put an image's edges on the
//     canvas's, rotated or not; a text clip's raster too; Undo restores.
//   - Three selected clips align to their combined bounds and distribute.
//   - Dragging the box near the canvas center or another picture's edge
//     snaps and shows a guide at that line; Ctrl drags freely.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [img] = await api.import([{ name: "photo.png", src: location.origin + "/fixtures/media/photo.png" }]);
    api.exec("add_media_clip", { asset_id: img.id, start: 0, duration: 4 });
    api.exec("add_color_clip", { color: "#d04040", start: 0, duration: 4 });
    api.exec("add_text", { text: "Aligned title", start: 0, duration: 4 });
    const clips = api.describe().tracks.flatMap((t) => t.clips);
    const pic = clips.find((c) => c.type === "image").id, red = clips.find((c) => c.type === "color").id, text = clips.find((c) => c.type === "text").id;
    api.exec("set_param", { clip_ids: [pic], path: "transform.scale", value: 0.5 });
    api.exec("set_param", { clip_ids: [red], path: "transform.scale", value: 0.2 });
    api.exec("set_param", { clip_ids: [red], path: "transform.x", value: -0.3 });
    api.seek(30);
    return { pic, red, text };
  });

  const details = {};
  const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
  const select = (id) => page.evaluate((id) => window.videoEditor.select([id]), id);
  const rects = () => page.evaluate(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const box = document.querySelector(".tf-box");
    // The box is rotated with CSS; its bounding rect is the axis-aligned extent.
    return { canvas: r(".tf-layer"), box: box && box.getBoundingClientRect() };
  });
  const click = (label) => page.getByRole("button", { name: label, exact: true }).click();
  const tx = (id) => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).transform, id);

  await select(ids.pic);
  await page.getByRole("toolbar", { name: "Align" }).waitFor();
  await page.screenshot({ path: "scratch/align-inspector.png" });
  for (const [label, edge] of [["Align left", "left"], ["Align right", "right"], ["Align top", "top"], ["Align bottom", "bottom"]]) {
    await click(label);
    const { canvas, box } = await rects();
    details[edge] = { ok: near(box[edge], canvas[edge]), box: box[edge], canvas: canvas[edge] };
  }
  await click("Align center horizontally");
  await click("Align center vertically");
  details.centered = { ok: (await tx(ids.pic)).x === 0 && (await tx(ids.pic)).y === 0 };
  await page.evaluate((id) => window.videoEditor.exec("set_param", { clip_ids: [id], path: "transform.rotation", value: 90 }), ids.pic);
  await click("Align left");
  {
    const { canvas, box } = await rects();
    details.rotatedLeft = { ok: near(box.left, canvas.left), box: box.left, canvas: canvas.left };
  }
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undo = { ok: (await tx(ids.pic)).x === 0 };
  await page.evaluate((id) => window.videoEditor.exec("set_param", { clip_ids: [id], path: "transform.rotation", value: 0 }), ids.pic);

  await select(ids.text);
  await click("Align right");
  {
    const { canvas, box } = await rects();
    details.textRight = { ok: near(box.right, canvas.right), box: box.right, canvas: canvas.right };
  }
  await click("Align center horizontally");

  // Three clips: the inspector's multi-selection panel.
  await page.evaluate((ids) => window.videoEditor.select([ids.pic, ids.red, ids.text]), ids);
  await page.getByRole("toolbar", { name: "Align" }).waitFor();
  await click("Align top");
  const tops = [];
  for (const id of [ids.pic, ids.red, ids.text]) {
    await select(id);
    tops.push((await rects()).box.top);
  }
  await page.evaluate((ids) => window.videoEditor.select([ids.pic, ids.red, ids.text]), ids);
  details.selectionTop = { ok: tops.every((t) => near(t, tops[0])), tops };
  await page.screenshot({ path: "scratch/align-multi.png" });
  const before = await page.evaluate(() => JSON.stringify(window.videoEditor.project().tracks));
  await click("Distribute horizontally");
  details.distribute = { ok: before !== (await page.evaluate(() => JSON.stringify(window.videoEditor.project().tracks))) };
  await page.evaluate(() => window.videoEditor.action("undo"));
  await page.evaluate(() => window.videoEditor.action("undo"));

  // Drag snapping: move the picture so its center lands 3 screen px off
  // the canvas center: it snaps there and draws the guide.
  await select(ids.pic);
  await page.evaluate((id) => window.videoEditor.exec("set_param", { clip_ids: [id], path: "transform.x", value: 0.2 }), ids.pic);
  {
    const { canvas, box } = await rects();
    const sx = box.left + box.width / 2, sy = box.top + box.height / 2;
    const tx0 = canvas.left + canvas.width / 2 + 3;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move((sx + tx0) / 2, sy, { steps: 4 });
    await page.mouse.move(tx0, sy, { steps: 4 });
    const guide = await page.locator(".tf-guide-v").count();
    await page.mouse.up();
    const t = await tx(ids.pic);
    details.snapCenter = { ok: guide === 1 && t.x === 0, guide, x: t.x };
  }
  // The red square's right edge: drag the picture's left edge 2 px past it.
  {
    await select(ids.red);
    await page.waitForTimeout(50);
    const red = (await rects()).box;
    await select(ids.pic);
    await page.waitForTimeout(50);
    const { box } = await rects();
    const sx = box.left + box.width / 2, sy = box.top + box.height / 2;
    const dx = red.right + 2 - box.left;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + dx / 2, sy, { steps: 4 });
    await page.mouse.move(sx + dx, sy, { steps: 4 });
    const guideX = await page.locator(".tf-guide-v").evaluate((g) => g.getBoundingClientRect().left).catch(() => null);
    await page.mouse.up();
    const after = (await rects()).box;
    details.snapEdge = { ok: guideX !== null && near(after.left, red.right), left: after.left, redRight: red.right, guideX };
  }
  // Ctrl ignores every snap line.
  {
    const { canvas, box } = await rects();
    const sx = box.left + box.width / 2, sy = box.top + box.height / 2;
    const target = canvas.left + canvas.width / 2 + 3;
    await page.keyboard.down("Control");
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(target, sy, { steps: 6 });
    const guide = await page.locator(".tf-guide-v").count();
    await page.mouse.up();
    await page.keyboard.up("Control");
    details.ctrlFree = { ok: guide === 0 && (await tx(ids.pic)).x !== 0, guide };
  }
  // Uniform scale off: Scale Y halves the picture's height only, in the
  // handles and in the rendered frame.
  {
    await select(ids.red);
    await page.evaluate((id) => window.videoEditor.exec("align_clips", { clip_ids: [id], align: "center" }), ids.red);
    await page.evaluate((id) => window.videoEditor.exec("align_clips", { clip_ids: [id], align: "middle" }), ids.red);
    const before = (await rects()).box;
    await page.getByRole("switch", { name: "Uniform scale" }).click();
    await page.getByRole("textbox", { name: "Scale Y value" }).fill("10");
    await page.getByRole("textbox", { name: "Scale Y value" }).press("Enter");
    await page.waitForTimeout(100);
    const after = (await rects()).box;
    const t = await tx(ids.red);
    details.stretch = { ok: near(after.width, before.width) && near(after.height, before.height / 2) && t.scaleY === 0.1 && t.scale === 0.2, before: [before.width, before.height], after: [after.width, after.height], t };
    await page.screenshot({ path: "scratch/align-stretch.png" });
    await page.getByRole("switch", { name: "Uniform scale" }).click();
    details.unstretch = { ok: (await tx(ids.red)).scaleY === undefined && near((await rects()).box.height, before.height) };
  }
  // Arrow keys on the viewer nudge by a pixel (Shift: ten); a held key is
  // one undo step; elsewhere they still step frames.
  {
    await select(ids.pic);
    await page.evaluate((id) => window.videoEditor.exec("set_param", { clip_ids: [id], path: "transform.x", value: 0 }), ids.pic);
    const t0 = await tx(ids.pic);
    const { box } = await rects();
    await page.mouse.click(box.left + box.width / 2, box.top + box.height / 2);
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    const t1 = await tx(ids.pic);
    const frame = await page.evaluate(() => window.videoEditor.state().playhead);
    details.nudge = { ok: near(t1.x * 1920, t0.x * 1920 + 3, 0.01) && near(t1.y * 1080, t0.y * 1080 + 10, 0.01), dx: (t1.x - t0.x) * 1920, dy: (t1.y - t0.y) * 1080, frame };
    await page.keyboard.down("ArrowLeft");
    await page.keyboard.down("ArrowLeft");
    await page.keyboard.up("ArrowLeft");
    await page.evaluate(() => window.videoEditor.action("undo"));
    details.nudgeUndo = { ok: near(((await tx(ids.pic)).x - t1.x) * 1920, 0, 0.01) };
    await page.locator(".tl-ruler").click({ position: { x: 300, y: 10 } });
    const before = await page.evaluate(() => window.videoEditor.state().playhead);
    await page.keyboard.press("ArrowRight");
    const after = await page.evaluate(() => window.videoEditor.state().playhead);
    details.arrowsStepElsewhere = { ok: after !== before, before, after };
  }
  // Fit, Fill and Stretch frame the picture on the canvas, centered.
  {
    await select(ids.pic);
    await page.waitForTimeout(50);
    const rows = {};
    for (const label of ["Fill", "Stretch", "Fit"]) {
      await page.getByRole("button", { name: `${label} to canvas`, exact: true }).click();
      const { canvas, box } = await rects();
      rows[label] = { box: [box.left, box.top, box.right, box.bottom].map(Math.round), canvas: [canvas.left, canvas.top, canvas.right, canvas.bottom].map(Math.round) };
    }
    const covers = (r) => r.box[0] <= r.canvas[0] + 1 && r.box[1] <= r.canvas[1] + 1 && r.box[2] >= r.canvas[2] - 1 && r.box[3] >= r.canvas[3] - 1;
    const exact = (r) => r.box.every((v, i) => Math.abs(v - r.canvas[i]) <= 1);
    const inside = (r) => r.box[0] >= r.canvas[0] - 1 && r.box[1] >= r.canvas[1] - 1 && r.box[2] <= r.canvas[2] + 1 && r.box[3] <= r.canvas[3] + 1;
    details.frame = { ok: covers(rows.Fill) && exact(rows.Stretch) && inside(rows.Fit) && (exact(rows.Fit) || rows.Fit.box[1] === rows.Fit.canvas[1] || rows.Fit.box[0] === rows.Fit.canvas[0]), rows };
  }
  // Agents get the same moves.
  const viaCommand = await page.evaluate((ids) => {
    const api = window.videoEditor;
    api.exec("align_clips", { clip_ids: [ids.red], align: "right" });
    let err = "";
    try { api.exec("distribute_clips", { clip_ids: [ids.red, ids.pic], axis: "vertical" }); } catch (e) { err = String(e.message ?? e); }
    return { x: api.project().tracks.flatMap((t) => t.clips).find((c) => c.id === ids.red).transform.x, err };
  }, ids);
  details.command = { ok: Math.abs(viaCommand.x - 0.4) < 1e-9 && /three or more/.test(viaCommand.err), ...viaCommand };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
