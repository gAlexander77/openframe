// Project cards on the home screen (CapCut's Rename and Duplicate): a
// project with a clip is renamed in place without opening it (Escape
// keeps the old name), then duplicated; the copy opens with the same
// clip, and the original is untouched.
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
  return { ok: Object.values(details).every((d) => d.ok), details };
};
