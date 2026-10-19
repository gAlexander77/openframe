// Fonts drive: Import font… in the Text inspector loads a TTF (Windows'
// Consolas, read from the system for the test only), applies it to the
// selected title, draws the title in it (the rendered frame changes), and
// keeps it after a reload. Needs Windows' C:\Windows\Fonts\consola.ttf.
async (page) => {
  const fs = await import("node:fs");
  const file = "C:/Windows/Fonts/consola.ttf";
  if (!fs.existsSync(file)) return { ok: false, details: { fixture: { ok: false, why: `${file} missing` } } };
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const id = await page.evaluate(() => {
    const api = window.videoEditor;
    api.exec("add_text", { text: "Typeface check 0123", start: 0, duration: 3 });
    const c = api.describe().tracks.flatMap((t) => t.clips)[0];
    api.select([c.id]);
    api.seek(45);
    return c.id;
  });
  const details = {};
  const sum = () => page.evaluate(async () => {
    await window.videoEditor.rendered?.();
    const px = window.videoEditor.pixels(320);
    let s = 0;
    for (let i = 0; i < px.data.length; i += 7) s += px.data[i];
    return s;
  });
  await page.waitForTimeout(300);
  const before = await sum();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import font…" }).click();
  await (await chooser).setFiles({ name: "consola.ttf", mimeType: "font/ttf", buffer: fs.readFileSync(file) });
  await page.waitForFunction((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id).style.font === "consola", id, { timeout: 10000 });
  await page.waitForTimeout(400);
  const after = await sum();
  details.applied = { ok: before !== after && (await page.evaluate(() => document.fonts.check('20px "consola"'))), before, after };
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => {
    const api = window.videoEditor;
    api.exec("add_text", { text: "Again", start: 0, duration: 3 });
    api.select([api.describe().tracks.flatMap((t) => t.clips)[0].id]);
  });
  const listed = await page.locator("select[aria-label=Font] optgroup[label=Imported] option").allInnerTexts();
  details.kept = { ok: listed.includes("consola"), listed };
  await page.screenshot({ path: "scratch/fonts.png" });
  return { ok: Object.values(details).every((d) => d.ok), details };
};
