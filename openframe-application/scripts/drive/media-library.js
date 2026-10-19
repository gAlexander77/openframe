async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  page.setDefaultTimeout(15000);
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const details = {};
  const names = () => page.locator(".media-card .card-label").allTextContents();
  const choose = (label, value) => page.getByRole("combobox", { name: label, exact: true }).selectOption(value);
  await page.evaluate(async () => {
    const base = "http://localhost:1420/fixtures/media/";
    await window.videoEditor.import([
      { name: "Shot10.mp4", src: base + "framecode-30.mp4" },
      { name: "shot2.mp4", src: base + "h264-1080p30.mp4" },
      { name: "Music.mp3", src: base + "music-30s.mp3" },
      { name: "Cover.png", src: base + "color-bars.png" },
    ]);
  });
  await page.waitForFunction(() => document.querySelectorAll(".media-card").length === 4);
  const original = await page.evaluate(() => ({ project: JSON.stringify(window.videoEditor.project()), revision: window.videoEditor.state().revision }));
  details.importOrder = { ok: JSON.stringify(await names()) === JSON.stringify(["Shot10.mp4", "shot2.mp4", "Music.mp3", "Cover.png"]) };
  await choose("Sort media", "name");
  details.naturalNameSort = { ok: JSON.stringify(await names()) === JSON.stringify(["Cover.png", "Music.mp3", "shot2.mp4", "Shot10.mp4"]) };
  await choose("Sort media", "name-desc");
  details.reverseNameSort = { ok: (await names())[0] === "Shot10.mp4" && (await names())[3] === "Cover.png" };
  await choose("Sort media", "duration-desc");
  const expected = await page.evaluate(() => window.videoEditor.project().assets.filter((a) => a.kind !== "image").sort((a, b) => b.duration - a.duration).map((a) => a.name).concat("Cover.png"));
  details.durationSort = { ok: JSON.stringify(await names()) === JSON.stringify(expected) };
  await choose("Media type", "video");
  details.typeFilter = { ok: (await names()).length === 2 };
  await page.getByRole("textbox", { name: "Search media", exact: true }).fill(" SHOT2 ");
  details.intersectSearch = { ok: JSON.stringify(await names()) === JSON.stringify(["shot2.mp4"]) };
  await choose("Timeline usage", "used");
  details.emptyFilterState = { ok: await page.getByText("No media matches", { exact: true }).isVisible() };
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByRole("button", { name: "List view", exact: true }).click();
  details.listMetadata = { ok: (await page.locator(".media-list .media-details").allTextContents()).some((s) => /Video.*fps/.test(s)) && (await page.locator(".media-list .media-details").allTextContents()).some((s) => /Still image.*1920/.test(s)) };
  details.browsingDoesNotEdit = { ok: await page.evaluate((old) => JSON.stringify(window.videoEditor.project()) === old.project && window.videoEditor.state().revision === old.revision, original) };

  await page.evaluate(() => {
    const v = window.videoEditor;
    const asset = v.project().assets[0];
    v.exec("add_media_clip", { asset_id: asset.id, start: 2, duration: 1 });
    v.exec("add_media_clip", { asset_id: asset.id, start: 4, duration: 1 });
  });
  await choose("Timeline usage", "used");
  details.usedFilter = { ok: JSON.stringify(await names()) === JSON.stringify(["Shot10.mp4"]) };
  const beforeUses = await page.evaluate(() => ({ project: JSON.stringify(window.videoEditor.project()), revision: window.videoEditor.state().revision }));
  await page.getByRole("button", { name: "Select 2 timeline uses of Shot10.mp4", exact: true }).click();
  details.selectUses = { ok: await page.evaluate((old) => window.videoEditor.state().selection.length === 2 && window.videoEditor.state().playhead === 60 && window.videoEditor.state().revision === old.revision && JSON.stringify(window.videoEditor.project()) === old.project, beforeUses) };
  await choose("Timeline usage", "unused");
  details.unusedFilter = { ok: (await names()).length === 3 && !(await names()).includes("Shot10.mp4") };
  await page.getByRole("button", { name: "Add shot2.mp4 to the timeline", exact: true }).click();
  details.liveUsageAfterAdd = { ok: !(await names()).includes("shot2.mp4") };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.liveUsageAfterUndo = { ok: (await names()).includes("shot2.mp4") };
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.locator(".lib-tab", { hasText: /^Audio$/ }).click();
  details.audioView = { ok: JSON.stringify(await names()) === JSON.stringify(["Music.mp3"]) && await page.locator(".media-list").isVisible() };
  await page.locator(".lib-tab", { hasText: /^Media$/ }).click();
  details.viewSurvivesTabChange = { ok: (await names()).length === 4 && await page.locator(".media-list").isVisible() };
  await page.evaluate(async () => { window.videoEditor.seek(60); await window.videoEditor.rendered(); });
  await page.screenshot({ path: "scratch/media-library-wide.png", animations: "disabled" });

  await page.setViewportSize({ width: 1100, height: 680 });
  details.narrowFit = { ok: await page.locator(".media-browser").evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && [...el.querySelectorAll("select, .media-card")].every((child) => child.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1)) };
  await page.screenshot({ path: "scratch/media-library-narrow.png", animations: "disabled" });
  await page.setViewportSize({ width: 1600, height: 950 });
  await choose("Media type", "video");
  await choose("Timeline usage", "used");
  await page.getByRole("textbox", { name: "Search media", exact: true }).fill("Shot10");
  await page.evaluate(() => window.videoEditor.action("openProject"));
  await page.locator(".project-card").first().click();
  await page.locator(".timeline-panel").waitFor();
  details.openResetsFilters = { ok: (await names()).length === 4 && await page.locator(".media-list").isVisible() && await page.getByRole("textbox", { name: "Search media", exact: true }).inputValue() === "" };
  const count = () => page.evaluate(() => window.videoEditor.project().tracks.reduce((n, t) => n + t.clips.length, 0));
  const initialCount = await count();
  await page.getByRole("button", { name: "Add Cover.png to the timeline", exact: true }).focus();
  await page.keyboard.press("Enter");
  details.keyboardAdd = { ok: await count() === initialCount + 1 };
  await page.evaluate(() => window.videoEditor.action("undo"));
  await page.locator(".media-card .card-label", { hasText: /^Cover.png$/ }).dblclick();
  details.listDoubleClickAdd = { ok: await count() === initialCount + 1 };
  await page.evaluate(() => window.videoEditor.action("undo"));
  const source = await page.locator(".media-card .card-label", { hasText: /^Cover.png$/ }).boundingBox();
  const lane = await page.locator(".tl-row.main .tl-lane").boundingBox();
  await page.mouse.move(source.x + 15, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(lane.x + 650, lane.y + lane.height / 2, { steps: 10 });
  await page.mouse.up();
  details.listDragAdd = { ok: await count() === initialCount + 1 };
  await page.evaluate(() => window.videoEditor.action("undo"));
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  const addImage = page.getByRole("button", { name: "Add Cover.png to the timeline", exact: true });
  await addImage.focus();
  await addImage.dblclick();
  details.gridButtonDoesNotBubbleExtraAdd = { ok: await count() === initialCount + 2 };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
