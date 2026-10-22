async (page) => {
  await page.goto("http://localhost:1420"); await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click(); await page.locator(".timeline-panel").waitFor();
  const asset = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [a] = await ve.import([{ name: "framecode-30.mp4", src: `${location.origin}/fixtures/media/framecode-30.mp4` }]);
    ve.exec("add_color_clip", { color: "#123456", start: 0, duration: 30 });
    return a;
  });
  const details = {};
  details.commands = await page.evaluate((asset) => {
    const ve = window.videoEditor, results = [];
    for (const mode of ["insert", "overwrite"]) for (let mask = 0; mask < 16; mask++) {
      const si = !!(mask & 1), so = !!(mask & 2), ti = !!(mask & 4), to = !!(mask & 8);
      const r = ve.exec("edit_from_source", { asset_id: asset.id, mode, ...(si ? { source_in: 1 } : {}), ...(so ? { source_out: 5 } : {}), ...(ti ? { timeline_in: 12 } : {}), ...(to ? { timeline_out: 16 } : {}) });
      const c = ve.project().tracks.flatMap((t) => t.clips).find((c) => c.id === r.sourceEdit.clip_id);
      const length = ti && to ? 4 : (so ? 5 : asset.duration) - (si ? 1 : 0);
      const start = ti ? 12 : to ? 16 - length : 0;
      results.push({ mode, mask, ok: c.start === Math.round(start * 30) && c.duration === Math.floor(length * 30 + 1e-6) && c.in === (ti && to && !si && so ? 1 : si ? 1 : 0) && c.speed === 1 });
      ve.action("undo");
    }
    return { ok: results.every((r) => r.ok), results };
  }, asset);
  details.playheadFallback = { ok: await page.evaluate((asset) => {
    const ve = window.videoEditor; ve.seek(60);
    const r = ve.exec("edit_from_source", { asset_id: asset.id, source_in: 1, source_out: 2, mode: "overwrite" });
    const c = ve.project().tracks.flatMap((t) => t.clips).find((c) => c.id === r.sourceEdit.clip_id);
    const ok = c.start === 60 && c.duration === 30;
    ve.action("undo"); ve.seek(0); return ok;
  }, asset) };
  const range = async (from, to) => page.evaluate(({ from, to }) => {
    const ve = window.videoEditor; ve.action("clearInOut");
    if (from !== null) { ve.seek(from); ve.action("markIn"); }
    if (to !== null) { ve.seek(to); ve.action("markOut"); }
  }, { from, to });
  const open = async () => page.getByRole("button", { name: "Preview framecode-30.mp4", exact: true }).click();
  const mark = async (name, frame) => {
    await page.getByRole("slider", { name: "Source position" }).fill(String(frame));
    await page.getByRole("button", { name, exact: true }).click();
  };
  const placed = async (name, expected) => {
    const got = await page.evaluate(() => {
      const ve = window.videoEditor, c = ve.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "video");
      return { start: c.start, duration: c.duration, in: c.in, speed: c.speed, cleared: ve.state().inPoint === null && ve.state().outPoint === null };
    });
    details[name] = { ok: Object.entries(expected).every(([k, v]) => Math.abs(got[k] - v) < 1e-6) && got.cleared, got };
    await page.evaluate(() => window.videoEditor.action("undo"));
  };
  await range(120, null); await open(); await mark("Mark In", 30); await mark("Mark Out", 89);
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await placed("sourceInOutTimelineIn", { start: 120, duration: 60, in: 1, speed: 1 });
  await range(120, 180); await open(); await mark("Mark In", 30);
  await page.getByRole("button", { name: "Overwrite", exact: true }).click();
  await placed("sourceInTimelineRange", { start: 120, duration: 60, in: 1, speed: 1 });
  await range(120, 180); await open(); await mark("Mark Out", 149);
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await placed("backtimedSourceOut", { start: 120, duration: 60, in: 3, speed: 1 });
  await range(120, 180); await open(); await mark("Mark In", 30); await mark("Mark Out", 149);
  await page.getByRole("button", { name: "Overwrite", exact: true }).click();
  details.fourPointPrompt = { ok: await page.getByRole("group", { name: "Resolve four-point edit" }).isVisible() };
  await page.getByRole("group", { name: "Resolve four-point edit" }).getByRole("button", { name: "Fit to fill", exact: true }).click();
  await placed("fitFill", { start: 120, duration: 60, in: 1, speed: 2 });
  await range(120, 180); await open(); await mark("Mark In", 30); await mark("Mark Out", 149);
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("button", { name: "Trim source to fit", exact: true }).click();
  await placed("trimFit", { start: 120, duration: 60, in: 1, speed: 1 });
  await range(120, 180); await open(); await mark("Mark In", 30); await mark("Mark Out", 149);
  await page.keyboard.press("Shift+f");
  await placed("fitKey", { start: 120, duration: 60, in: 1, speed: 2 });
  await range(120, 720); await open(); await mark("Mark In", 30);
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  details.insufficient = { ok: (await page.getByRole("alert").textContent()).includes("Not enough") && await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).every((c) => c.type !== "video") && window.videoEditor.state().inPoint === 120) };
  await page.keyboard.press("Escape");
  return { ok: Object.values(details).every((d) => d.ok), details };
}
