// Text case (CapCut's Aa / AA / aa): the Text tab's Case set to UPPERCASE draws
// a title exactly as the same title typed in capitals would, while the
// clip keeps the words as typed; As typed restores it. set_text takes
// case for agents.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(() => {
    const api = window.videoEditor;
    api.exec("add_text", { text: "hello world", start: 0, duration: 3 });
    const c = api.describe().tracks.flatMap((t) => t.clips).find((x) => x.type === "text");
    api.select([c.id]);
    return c.id;
  });
  const still = () =>
    page.evaluate(async () => {
      const { exportStill } = await import("/src/engine/export.ts");
      const bmp = await createImageBitmap(await exportStill(window.videoEditor.project(), 10, 480, 270));
      const cv = new OffscreenCanvas(480, 270);
      const ctx = cv.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      return Array.from(ctx.getImageData(0, 0, 480, 270).data);
    });
  const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1);
  const details = {};
  const typed = await still();
  const inspector = page.getByRole("region", { name: "Inspector" });
  await inspector.getByRole("tab", { name: "Text", exact: true }).click();
  await inspector.getByRole("radio", { name: "UPPERCASE", exact: true }).click();
  const shown = await still();
  const clip = () => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id), id);
  details.kept = { ok: (await clip()).text === "hello world" && (await clip()).style.case === "upper" };
  await page.evaluate((id) => window.videoEditor.exec("set_text", { clip_id: id, text: "HELLO WORLD", style: { case: "none" } }), id);
  const capitals = await still();
  details.matches = { ok: same(shown, capitals) && !same(shown, typed) };
  details.noneClears = { ok: (await clip()).style.case === undefined };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
