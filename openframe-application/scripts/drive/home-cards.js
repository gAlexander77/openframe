// Project cards on the home screen (CapCut's Rename and Duplicate): a
// project with a clip is renamed in place without opening it (Escape
// keeps the old name), then duplicated; the copy opens with the same
// clip, and the original is untouched. Then the list view and the
// right-click menu (Rename…, Duplicate) in both views.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("set_project", { name: "Cards drive" });
    v.exec("add_color_clip", { color: "#884422", start: 0, duration: 3 });
  });
  await page.locator(".menubar-item > button", { hasText: "File" }).click();
  await page.getByRole("menuitem", { name: "Back to home" }).click();
  const card = (name) => page.locator(".project-card", { has: page.locator(".project-card-name", { hasText: new RegExp(`^${name}$`) }) });
  await card("Cards drive").waitFor();
  const details = {};

  await card("Cards drive").hover();
  await page.getByRole("button", { name: "Rename Cards drive", exact: true }).click();
  const field = page.getByLabel("New name for Cards drive");
  await field.fill("Throwaway");
  await field.press("Escape");
  details.escape = { ok: (await card("Cards drive").count()) === 1 && (await page.locator(".project-rename").count()) === 0 };

  await card("Cards drive").hover();
  await page.getByRole("button", { name: "Rename Cards drive", exact: true }).click();
  await field.fill("Renamed drive");
  await page.screenshot({ path: "__REPO__/scratch/home-cards-rename.png" });
  await field.press("Enter");
  await card("Renamed drive").waitFor();
  details.renamed = { ok: (await card("Cards drive").count()) === 0 && (await page.locator(".editor, .timeline-panel").count()) === 0 };

  await card("Renamed drive").hover();
  await page.getByRole("button", { name: "Duplicate Renamed drive", exact: true }).click();
  await card("Renamed drive copy").waitFor();
  details.duplicated = { ok: (await card("Renamed drive").count()) === 1 && (await card("Renamed drive copy").count()) === 1 };

  await card("Renamed drive copy").click();
  await page.locator(".timeline-panel").waitFor();
  const opened = await page.evaluate(() => ({ name: window.videoEditor.project().name, clips: window.videoEditor.project().tracks.flatMap((t) => t.clips).map((c) => c.color) }));
  details.copyOpens = { ok: opened.name === "Renamed drive copy" && JSON.stringify(opened.clips) === '["#884422"]', opened };

  // The list view (CapCut's grid/list toggle) and the right-click menu,
  // in both views: Rename… and Duplicate from the menu; the view is
  // remembered across a reload.
  await page.locator(".menubar-item > button", { hasText: "File" }).click();
  await page.getByRole("menuitem", { name: "Back to home" }).click();
  await page.getByRole("button", { name: "List view", exact: true }).click();
  const row = (name) => page.locator(".project-row", { has: page.locator(".project-card-name", { hasText: new RegExp(`^${name}$`) }) });
  await row("Renamed drive").waitFor();
  details.list = { ok: (await page.locator(".project-card").count()) === 0 && (await page.locator(".project-row:not(.project-list-head)").count()) >= 2 };
  await row("Renamed drive").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page.getByLabel("New name for Renamed drive").fill("Listed drive");
  await page.getByLabel("New name for Renamed drive").press("Enter");
  await row("Listed drive").waitFor();
  await row("Listed drive").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await row("Listed drive copy").waitFor();
  details.listMenu = { ok: (await row("Renamed drive").count()) === 0 && (await row("Listed drive").count()) === 1 && (await page.locator(".timeline-panel").count()) === 0 };
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await row("Listed drive").waitFor();
  details.listRemembered = { ok: (await page.getByRole("button", { name: "List view", exact: true }).getAttribute("aria-pressed")) === "true" };
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await card("Listed drive").click({ button: "right" });
  const items = await page.locator(".ctx-anchor .menu-label").allTextContents();
  await page.keyboard.press("Escape");
  details.cardMenu = { ok: items.join(",") === "Open,Rename…,Duplicate,Delete" && (await page.locator(".ctx-anchor").count()) === 0, items };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
