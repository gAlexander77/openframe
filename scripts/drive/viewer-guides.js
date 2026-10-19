// Guides follow the canvas and never enter engine pixels, exports or history.
async (page) => {
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("http://localhost:1420");
  await page.locator(".create-card").click();
  await page.evaluate(() => {
    window.videoEditor.exec("add_color_clip", { color: "#237f62", start: 0, duration: 2 });
    window.videoEditor.select([]);
  });
  const details = {};
  const select = page.getByRole("combobox", { name: "Viewer guides" });
  const snapshot = () => page.evaluate(async () => {
    const v = window.videoEditor;
    await v.rendered();
    const px = v.pixels(160);
    const png = await v.still(0, "480p");
    const bytes = await (await fetch(png.url)).arrayBuffer();
    URL.revokeObjectURL(png.url);
    return { project: JSON.stringify(v.project()), revision: v.state().revision, undo: v.state().undoLabel,
      pixels: JSON.stringify(Array.from(px.data)), png: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).join(",") };
  });
  const before = await snapshot();
  details.defaultOff = { ok: await select.inputValue() === "off" && await page.locator(".viewer-guides").count() === 0 };
  await select.selectOption("both");
  const after = await snapshot();
  details.previewOnly = { ok: before.pixels === after.pixels && before.png === after.png };
  details.noDocumentEdit = { ok: before.project === after.project && before.revision === after.revision && before.undo === after.undo };
  const geometry = () => page.evaluate(() => {
    const frame = document.querySelector(".player-frame").getBoundingClientRect();
    const check = (selector, inset) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return Math.abs(r.x - frame.x - frame.width * inset) < 1 && Math.abs(r.y - frame.y - frame.height * inset) < 1 &&
        Math.abs(r.width - frame.width * (1 - 2 * inset)) < 1 && Math.abs(r.height - frame.height * (1 - 2 * inset)) < 1;
    };
    return { ok: check(".viewer-safe-action", .035) && check(".viewer-safe-title", .05) && document.querySelectorAll(".viewer-thirds i").length === 4,
      frame: { width: frame.width, height: frame.height } };
  });
  details.landscape = await geometry();
  await page.locator(".player-frame").click();
  details.clickThrough = { ok: await page.evaluate(() => window.videoEditor.state().selection.length === 1) };
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: "Rule of thirds", exact: true }).click();
  details.menuSync = { ok: await select.inputValue() === "thirds" && await page.locator(".viewer-safe").count() === 0 };
  await select.selectOption("safe");
  details.safeOnly = { ok: await page.locator(".viewer-safe").count() === 2 && await page.locator(".viewer-thirds").count() === 0 };
  await select.selectOption("both");
  await page.evaluate(() => window.videoEditor.exec("set_project", { width: 1080, height: 1920 }));
  await page.setViewportSize({ width: 1100, height: 680 });
  await page.waitForFunction(() => document.querySelector(".player-frame").clientHeight > document.querySelector(".player-frame").clientWidth);
  details.portrait = await geometry();
  details.headerFits = { ok: await select.evaluate(el => {
    const r = el.getBoundingClientRect(), head = el.closest("header").getBoundingClientRect();
    return r.x >= head.x && r.right <= head.right;
  }) };
  await page.locator(".player-panel").screenshot({ path: "scratch/viewer-guides.png", animations: "disabled" });
  await page.getByRole("button", { name: "Full screen", exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  details.fullscreen = await geometry();
  await page.evaluate(() => document.exitFullscreen());
  await select.selectOption("off");
  details.hide = { ok: await page.locator(".viewer-guides").count() === 0 };
  return { ok: Object.values(details).every(d => d.ok), details };
}
