// The player's Go to start and Go to end buttons (the keymap's actions, so
// their tooltips name the current keys), and the title bar's Preferences
// button on Home and in the editor (Home's keys open it too).
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  const details = {};

  // Home: the gear opens Preferences.
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  details.homeGear = { ok: (await page.locator("dialog.prefs-dialog").count()) === 1 };
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Comma");
  details.homeKey = { ok: (await page.locator("dialog.prefs-dialog").count()) === 1 };
  await page.keyboard.press("Escape");

  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(async () => {
    const api = window.videoEditor;
    const [fc] = await api.import([{ name: "framecode-30.mp4", src: location.origin + "/fixtures/media/framecode-30.mp4" }]);
    api.exec("add_media_clip", { asset_id: fc.id, start: 0, duration: 3 });
    api.seek(40);
  });
  const playhead = () => page.evaluate(() => window.videoEditor.state().playhead);
  const end = await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).reduce((e, c) => Math.max(e, c.start + c.duration), 0));
  const toEnd = page.getByRole("button", { name: "Go to end", exact: true });
  const toStart = page.getByRole("button", { name: "Go to start", exact: true });
  details.tips = { ok: (await toStart.getAttribute("data-tip")) === "Go to start (Home)" && (await toEnd.getAttribute("data-tip")) === "Go to end (End)", start: await toStart.getAttribute("data-tip"), end: await toEnd.getAttribute("data-tip") };
  await toEnd.click();
  details.goEnd = { ok: (await playhead()) === end, playhead: await playhead(), end };
  await toStart.click();
  details.goStart = { ok: (await playhead()) === 0 };
  await page.locator(".transport").screenshot({ path: "scratch/transport.png" });

  // The editor's gear, beside the shortcuts button.
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  details.editorGear = { ok: (await page.locator("dialog.prefs-dialog").count()) === 1, tip: await page.getByRole("button", { name: "Preferences", exact: true }).getAttribute("data-tip") };
  await page.locator(".titlebar-right").screenshot({ path: "scratch/titlebar-right.png" });
  await page.keyboard.press("Escape");
  return { ok: Object.values(details).every((d) => d.ok), details };
};
