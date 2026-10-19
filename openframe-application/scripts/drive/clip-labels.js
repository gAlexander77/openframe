// Clip labels (Premiere's Label): right-click > Label > Blue colors every
// selected clip, painting its body and name strip; No label removes it;
// set_clip_label does the same for agents. One undo step each.
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
    api.exec("add_media_clip", { asset_id: fc.id, start: 2, duration: 2 });
    const [a, b] = api.project().tracks.find((t) => t.main).clips.map((c) => c.id);
    api.select([a, b]);
    return { a, b };
  });
  const labels = () => page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).map((c) => c.labelColor ?? null));
  const details = {};
  await page.locator(`[data-clip="${ids.b}"]`).click({ button: "right", position: { x: 30, y: 10 } });
  await page.getByRole("menuitemradio", { name: "Blue" }).click();
  details.both = { ok: JSON.stringify(await labels()) === JSON.stringify(["blue", "blue"]), labels: await labels() };
  const paint = await page.locator(`[data-clip="${ids.a}"] .clip-label`).evaluate((el) => getComputedStyle(el).backgroundColor);
  details.painted = { ok: paint === "rgb(58, 95, 176)", paint };
  details.undo = { ok: (await page.getByRole("button", { name: "Undo Label blue", exact: true }).count()) === 1 };
  await page.locator(`[data-clip="${ids.a}"]`).click({ button: "right", position: { x: 30, y: 10 } });
  details.current = { ok: (await page.getByRole("menuitemradio", { name: "Blue" }).getAttribute("aria-checked")) === "true" };
  await page.getByRole("menuitemradio", { name: "No label" }).click();
  details.removed = { ok: (await labels()).every((l) => l === null) };
  await page.evaluate((id) => window.videoEditor.exec("set_clip_label", { clip_ids: [id], label: "green" }), ids.a);
  details.command = { ok: JSON.stringify(await labels()) === JSON.stringify(["green", null]) };
  await page.locator(".timeline-panel").screenshot({ path: "scratch/clip-labels.png" });
  return { ok: Object.values(details).every((d) => d.ok), details };
};
