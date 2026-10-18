// Removing media from the project (Premiere's Clear and Remove Unused,
// CapCut's Delete on a media card): right-click a card for its menu;
// unused media goes at once, media the timeline uses offers to take its
// clips too; Manage media removes every unused file. Each is one undo
// step, and the files themselves are never touched.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(async () => {
    const api = window.videoEditor;
    const o = location.origin + "/fixtures/media/";
    const [, , v] = await api.import([
      { name: "photo.jpg", src: o + "photo.jpg" },
      { name: "voice-8s.wav", src: o + "voice-8s.wav" },
      { name: "talk-gaps.mp4", src: o + "talk-gaps.mp4" },
    ]);
    api.exec("add_media_clip", { asset_id: v.id, start: 0, duration: 3 });
  });
  const names = () => page.evaluate(() => window.videoEditor.project().assets.map((a) => a.name));
  const clips = () => page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).length);
  const undoLabel = () => page.evaluate(() => window.videoEditor.state().undoLabel);
  const card = (name) => page.locator(".media-card", { hasText: name });
  const details = {};

  await card("photo.jpg").click({ button: "right" });
  const items = await page.locator(".ctx-anchor [role=menuitem]").allTextContents();
  details.menu = { ok: items.some((t) => t.startsWith("Add to timeline")) && items.some((t) => t.startsWith("Remove from project")), items };
  await page.waitForTimeout(300); // the menu pops in over 180 ms
  await page.screenshot({ path: "__REPO__/scratch/media-remove-menu.png" });
  await page.getByRole("menuitem", { name: /^Remove from project/ }).click();
  details.unused = { ok: JSON.stringify(await names()) === '["voice-8s.wav","talk-gaps.mp4"]' && (await undoLabel()) === "Remove photo.jpg", names: await names() };

  await card("talk-gaps.mp4").click({ button: "right" });
  const used = page.getByRole("menuitem", { name: /Remove from project and its clip/ });
  details.usedLabel = { ok: (await used.count()) === 1 };
  await used.click();
  details.used = { ok: JSON.stringify(await names()) === '["voice-8s.wav"]' && (await clips()) === 0, names: await names(), clips: await clips() };

  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  details.undo = { ok: (await names()).length === 3 && (await clips()) === 1, names: await names() };

  await page.locator(".media-clear", { hasText: "Manage media" }).click();
  const sweep = page.getByRole("button", { name: "Remove 2 unused" });
  await sweep.waitFor();
  await page.screenshot({ path: "__REPO__/scratch/media-remove-dialog.png" });
  await sweep.click();
  details.sweep = { ok: JSON.stringify(await names()) === '["talk-gaps.mp4"]' && (await clips()) === 1 && (await page.getByRole("button", { name: "Nothing unused" }).count()) === 1, names: await names() };

  // An agent cannot remove media in use by accident.
  details.command = {
    ok: await page.evaluate(() => {
      const api = window.videoEditor;
      const id = api.project().assets[0].id;
      try {
        api.exec("remove_media", { asset_ids: [id] });
        return false;
      } catch (e) {
        return /used on the timeline/.test(e.message);
      }
    }),
  };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
