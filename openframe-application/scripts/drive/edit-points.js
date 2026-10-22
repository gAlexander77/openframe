async (page) => {
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(() => {
    const ve = window.videoEditor;
    ve.exec("add_color_clip", { color: "#336699", start: 0, duration: 3 });
    ve.exec("add_color_clip", { color: "#663399", start: 3, duration: 3 });
    return ve.project().tracks.flatMap((t) => t.clips).map((c) => c.id);
  });
  const details = {};
  const end = page.locator(`[data-clip="${ids[0]}"] .trim-end`);
  await end.click();
  details.bracket = { ok: await page.locator(`[data-clip="${ids[0]}"] [data-edit-edge="end"]`).count() === 1 };
  await page.evaluate(() => window.videoEditor.seek(60));
  await page.keyboard.press("e");
  details.extend = { ok: await page.evaluate((ids) => {
    const clips = window.videoEditor.project().tracks.flatMap((t) => t.clips);
    return clips.find((c) => c.id === ids[0]).duration === 60 && clips.find((c) => c.id === ids[1]).start === 90;
  }, ids) };
  await page.keyboard.press("Control+z");
  details.undo = { ok: await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).duration === 90, ids[0]) };
  await end.click({ modifiers: ["Alt"] });
  details.rollBrackets = { ok: await page.locator("[data-edit-edge]").count() === 2 };
  await page.evaluate(() => window.videoEditor.seek(105));
  await page.keyboard.press("e");
  details.roll = { ok: await page.evaluate((ids) => {
    const clips = window.videoEditor.project().tracks.flatMap((t) => t.clips);
    return clips.find((c) => c.id === ids[0]).duration === 105 && clips.find((c) => c.id === ids[1]).start === 105 && clips.find((c) => c.id === ids[1]).duration === 75;
  }, ids) };
  await page.keyboard.press("Alt+ArrowLeft");
  details.nudge = { ok: await page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).start === 104, ids[1]) };
  await page.keyboard.press("Control+z"); await page.keyboard.press("Control+z");
  await page.keyboard.press("Escape");
  details.clear = { ok: await page.locator("[data-edit-edge]").count() === 0 };
  await page.evaluate(() => window.videoEditor.seek(85));
  await page.keyboard.press("Shift+v");
  details.nearest = { ok: await page.locator(`[data-clip="${ids[0]}"] [data-edit-edge="end"]`).count() === 1 };
  await page.keyboard.press("Shift+ArrowDown");
  details.next = { ok: await page.locator(`[data-clip="${ids[1]}"] [data-edit-edge="end"]`).count() === 1 };
  await page.keyboard.press("Shift+ArrowUp");
  details.previous = { ok: await page.locator(`[data-clip="${ids[0]}"] [data-edit-edge="end"]`).count() === 1 };
  return { ok: Object.values(details).every((d) => d.ok), details };
}
