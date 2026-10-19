// Speed tab Duration (CapCut's): typing 4 s on a 2 s clip halves its
// speed, the same source filling the length, and moves the clip after it;
// a length past the 100x limit stops there. One undo step each.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(async () => {
    const api = window.videoEditor;
    const [fc] = await api.import([{ name: "framecode-30.mp4", src: location.origin + "/fixtures/media/framecode-30.mp4" }]);
    api.exec("add_media_clip", { asset_id: fc.id, start: 0, duration: 2 });
    api.exec("add_media_clip", { asset_id: fc.id, start: 2, duration: 1 });
    const [a, b] = api.project().tracks.find((t) => t.main).clips;
    api.select([a.id]);
    return { a: a.id, b: b.id };
  });
  await page.getByRole("tab", { name: "Speed", exact: true }).click();
  const field = page.getByLabel("Duration value", { exact: true });
  await field.fill("4");
  await field.press("Enter");
  const clips = () => page.evaluate(() => window.videoEditor.project().tracks.find((t) => t.main).clips.map((c) => ({ start: c.start, duration: c.duration, speed: c.speed, in: c.in })));
  const [a, b] = await clips();
  const details = {};
  details.fit = { ok: a.duration === 120 && Math.abs(a.speed - 0.5) < 0.01 && a.in === 0 && b.start === 120, a, b };
  details.undo = { ok: (await page.getByRole("button", { name: "Undo Duration 4s", exact: true }).count()) === 1 };
  details.shown = { ok: (await field.inputValue()) === "4.00" };
  await field.fill("0.001");
  await field.press("Enter");
  const [c] = await clips();
  details.limit = { ok: c.speed <= 100 && c.duration >= 1, speed: c.speed, duration: c.duration };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
