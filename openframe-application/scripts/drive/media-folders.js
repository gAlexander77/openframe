async page => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload(); await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click(); await page.locator(".timeline-panel").waitFor();
  await page.locator(".project-name").click(); await page.locator(".project-name-input").fill("__QA_20261016_folders"); await page.locator(".project-name-input").press("Enter");
  await page.evaluate(async () => { await window.videoEditor.import([
    { name: "framecode-30.mp4", src: (window.videoEditor.platform() === "desktop" ? "__REPO__" : location.origin) + "/fixtures/media/framecode-30.mp4" },
    { name: "color-bars.png", src: (window.videoEditor.platform() === "desktop" ? "__REPO__" : location.origin) + "/fixtures/media/color-bars.png" },
  ]); });
  const details = {};
  await page.getByRole("button", { name: "Manage media", exact: true }).click();
  await page.getByText("Organize folders", { exact: true }).click();
  await page.getByRole("textbox", { name: "Folder name", exact: true }).fill("B-roll");
  await page.getByRole("button", { name: "Create folder", exact: true }).click();
  await page.getByRole("combobox", { name: "Folder for framecode-30.mp4" }).selectOption("B-roll");
  await page.getByRole("checkbox", { name: "Favorite framecode-30.mp4", exact: true }).check();
  details.assignment = { ok: await page.evaluate(() => window.videoEditor.project().assets[0].folder === "B-roll" && window.videoEditor.project().assets[0].favorite) };
  await page.getByRole("combobox", { name: "Folder to manage" }).selectOption("B-roll");
  await page.getByRole("textbox", { name: "Folder name", exact: true }).fill("Scenes");
  await page.getByRole("button", { name: "Rename folder", exact: true }).click();
  details.renameMovesMembers = { ok: await page.evaluate(() => window.videoEditor.project().assets[0].folder === "Scenes") };
  await page.screenshot({ path: "scratch/media-folders-desktop.png", animations: "disabled" });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("combobox", { name: "Filter by folder" }).selectOption({ label: "Scenes" });
  await page.getByRole("checkbox", { name: "Favorites only", exact: true }).check();
  details.combinedFilters = { ok: await page.locator(".media-card").count() === 1 && await page.locator(".media-card").innerText().then((t) => t.includes("framecode")) };
  await page.getByRole("combobox", { name: "Filter by folder" }).selectOption({ label: "Unfiled" });
  details.emptyIntersection = { ok: await page.locator(".media-card").count() === 0 };
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  details.clearFilters = { ok: await page.locator(".media-card").count() === 2 };
  await page.evaluate(() => window.videoEditor.action("saveProject"));
  await page.waitForFunction(() => document.querySelector(".save-indicator")?.textContent?.includes("Saved") || document.body.textContent.includes("Saved "));
  details.persisted = await page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").find((e) => /\/src\/state\/project\.ts(?:\?|$)/.test(e.name)).name;
    await (await import(url)).saveNow();
    const platformUrl = performance.getEntriesByType("resource").find((e) => /\/src\/platform\/index\.ts(?:\?|$)/.test(e.name)).name;
    const p = await (await import(platformUrl)).platform.loadProject(window.videoEditor.project().id);
    return { ok: p.mediaFolders.includes("Scenes") && p.assets[0].favorite && p.assets[0].folder === "Scenes" };
  });
  await page.getByRole("button", { name: "Manage media", exact: true }).click();
  await page.getByText("Organize folders", { exact: true }).click();
  await page.getByRole("combobox", { name: "Folder to manage" }).selectOption("Scenes");
  await page.getByRole("button", { name: "Delete folder", exact: true }).click();
  details.deleteKeepsMedia = { ok: await page.evaluate(() => window.videoEditor.project().assets.length === 2 && !window.videoEditor.project().assets[0].folder) };
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undoMembership = { ok: await page.evaluate(() => window.videoEditor.project().assets[0].folder === "Scenes") };
  await page.setViewportSize({ width: 1100, height: 680 });
  await page.screenshot({ path: "scratch/media-folders-narrow.png", animations: "disabled" });
  details.narrowFit = { ok: await page.locator(".media-browser").evaluate((el) => el.scrollWidth <= el.clientWidth + 1) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
