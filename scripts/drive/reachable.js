// Things only an agent could do, now in the UI: a solid color layer from
// the library's Adjustment tab, the canvas size typed in pixels (even, as
// encoders need), deleting the markers the list shows, aligning a title
// inside the title-safe line, and set_project's frame rate.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const api = (fn, arg) => page.evaluate(fn, arg);
  const details = {};

  await page.locator(".lib-tabs [role=tab]", { hasText: "Adjustment" }).click();
  await page.getByRole("button", { name: "Add Solid color" }).click();
  const color = await api(() => {
    const c = window.videoEditor.project().tracks.flatMap((t) => t.clips).find((x) => x.type === "color");
    return c && { color: c.color, selected: window.videoEditor.state().selection[0] === c.id, undo: window.videoEditor.state().undoLabel };
  });
  details.solidColor = { ok: !!color && color.color === "#ffffff" && color.selected && color.undo === "Add solid color", color };

  await api(() => window.videoEditor.select([]));
  const width = page.getByLabel("Canvas width");
  await width.fill("1081");
  await width.press("Enter");
  const height = page.getByLabel("Canvas height");
  await height.fill("1350");
  await height.press("Enter");
  const size = await api(() => [window.videoEditor.project().width, window.videoEditor.project().height]);
  details.canvasSize = { ok: size[0] === 1082 && size[1] === 1350, size };
  await page.screenshot({ path: "__REPO__/scratch/reachable-size.png" });

  await api(() => {
    const v = window.videoEditor;
    v.exec("add_markers", { times: [1, 2], label: "beat" });
    v.exec("add_markers", { times: [3], label: "keep" });
  });
  await page.locator(".lib-tabs [role=tab]", { hasText: "Markers" }).click();
  await page.getByLabel("Search markers").fill("beat");
  await page.getByRole("button", { name: "Delete shown markers" }).click();
  const left = await api(() => window.videoEditor.project().markers.map((m) => m.label));
  details.deleteShown = { ok: JSON.stringify(left) === '["keep"]' && (await api(() => window.videoEditor.state().undoLabel)) === "Delete 2 markers", left };

  const title = await api(() => {
    const v = window.videoEditor;
    v.exec("add_text", { text: "Safe", start: 0, duration: 2 });
    const t = v.project().tracks.flatMap((x) => x.clips).find((c) => c.type === "text");
    v.select([t.id]);
    v.seek(0);
    return t.id;
  });
  await page.getByRole("region", { name: "Inspector" }).getByRole("tab", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: "Inside title safe" }).click();
  await page.getByRole("button", { name: "Align left", exact: true }).click();
  const safeX = await api((id) => window.videoEditor.paramAt(id, "transform.x", 0), title);
  await page.getByRole("button", { name: "Inside title safe" }).click();
  await page.getByRole("button", { name: "Align left", exact: true }).click();
  const edgeX = await api((id) => window.videoEditor.paramAt(id, "transform.x", 0), title);
  // The title-safe line (90%) is 5% of the canvas in from the edge.
  details.titleSafe = { ok: Math.abs(safeX - edgeX - 0.05) < 1e-3, safeX, edgeX };

  const fps = await api(() => {
    const v = window.videoEditor;
    v.exec("set_project", { fps: "25" });
    return v.project().fps;
  });
  details.fps = { ok: fps.num === 25 && fps.den === 1, fps };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
