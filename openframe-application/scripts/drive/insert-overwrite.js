// Insert and Overwrite from the source monitor (Premiere's , and .): with
// two 2 s color shots on the main track and the playhead at 1 s, a 1 s
// source range inserted splits the first shot and pushes the rest 1 s
// later; overwritten instead (the . key), it covers 1-2 s and the timeline
// keeps its length. Each is one undo step named for the edit.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(async () => {
    const api = window.videoEditor;
    await api.import([{ name: "framecode-30.mp4", src: location.origin + "/fixtures/media/framecode-30.mp4" }]);
    const m = api.project().tracks.find((t) => t.main).id;
    api.exec("add_color_clip", { color: "#203040", start: 0, duration: 2, track_id: m });
    api.exec("add_color_clip", { color: "#402030", start: 2, duration: 2, track_id: m });
    api.seek(30);
  });
  const layout = () => page.evaluate(() => JSON.stringify(window.videoEditor.project().tracks.find((t) => t.main).clips.map((c) => [c.type, c.start, c.duration])));
  const open = async () => {
    await page.getByRole("button", { name: "Preview framecode-30.mp4", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".source-monitor canvas")?.dataset.frame === "0");
    const seek = async (f) => {
      await page.getByRole("slider", { name: "Source position" }).fill(String(f));
      await page.waitForFunction((f) => document.querySelector(".source-monitor canvas")?.dataset.frame === String(f), f);
    };
    await seek(60);
    await page.getByRole("button", { name: "Mark In", exact: true }).click();
    await seek(89);
    await page.getByRole("button", { name: "Mark Out", exact: true }).click();
  };
  const details = {};
  const before = await page.evaluate(() => JSON.stringify(window.videoEditor.project()));
  await open();
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  const ins = await layout();
  details.insert = { ok: ins === JSON.stringify([["color", 0, 30], ["video", 30, 30], ["color", 60, 30], ["color", 90, 60]]), ins };
  const insertLabel = await page.getByRole("button", { name: "Undo Insert source", exact: true }).count() === 1;
  details.insertSource = { ok: await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "video").in === 2) };
  await page.evaluate(() => {
    window.videoEditor.action("undo");
    window.videoEditor.seek(30);
  });
  const insertRestored = await page.evaluate((before) => JSON.stringify(window.videoEditor.project()) === before, before);
  details.insertUndo = { ok: insertLabel && insertRestored, label: insertLabel, restored: insertRestored };
  await open();
  await page.keyboard.press(".");
  const over = await layout();
  details.overwrite = { ok: over === JSON.stringify([["color", 0, 30], ["video", 30, 30], ["color", 60, 60]]), over };
  const overwriteLabel = await page.getByRole("button", { name: "Undo Overwrite source", exact: true }).count() === 1;
  await page.evaluate(() => window.videoEditor.action("undo"));
  const overwriteRestored = await page.evaluate((before) => JSON.stringify(window.videoEditor.project()) === before, before);
  details.overwriteUndo = { ok: overwriteLabel && overwriteRestored, label: overwriteLabel, restored: overwriteRestored };
  // With no source monitor open the keys explain themselves.
  await page.keyboard.press(",");
  details.closedHint = { ok: await page.waitForFunction(() => /source monitor first/.test(document.querySelector(".toast")?.textContent ?? ""), null, { timeout: 3000 }).then(() => true, () => false) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
