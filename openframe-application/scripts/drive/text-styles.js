// Saved text styles (CapCut's Save as preset for text): a yellow, bold
// title's look is saved under a name from the Text tab and given to a plain
// title in one click, words kept, one undo step. A second save under the
// same name is refused; the style survives a reload (it is the viewer's,
// not the project's) and can be deleted.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(() => {
    const v = window.videoEditor;
    v.exec("add_text", { text: "Styled", start: 0, duration: 2, style: { color: "#ffd400", bold: true, size: 120 } });
    v.exec("add_text", { text: "Plain", start: 2, duration: 2 });
    const t = v.project().tracks.flatMap((x) => x.clips).filter((c) => c.type === "text");
    v.select([t[0].id]);
    return { styled: t.find((c) => c.text === "Styled").id, plain: t.find((c) => c.text === "Plain").id };
  });
  const insp = page.getByRole("region", { name: "Inspector" });
  const section = insp.locator(".insp-section", { hasText: "Saved styles" });
  const details = {};
  await section.getByRole("button", { name: "Save this style" }).click();
  await section.getByLabel("Style name").fill("Yellow punch");
  await section.getByLabel("Style name").press("Enter");
  details.saved = { ok: (await section.getByRole("button", { name: "Yellow punch", exact: true }).count()) === 1 };

  await section.getByRole("button", { name: "Save this style" }).click();
  await section.getByLabel("Style name").fill("yellow PUNCH");
  await section.getByLabel("Style name").press("Enter");
  details.duplicateRefused = { ok: (await section.getByRole("alert").textContent())?.includes("already exists") };
  await section.getByLabel("Style name").press("Escape");

  await page.evaluate((id) => window.videoEditor.select([id]), ids.plain);
  await section.getByRole("button", { name: "Yellow punch", exact: true }).first().click();
  await page.screenshot({ path: "__REPO__/scratch/text-styles.png" });
  const plain = await page.evaluate((id) => {
    const c = window.videoEditor.project().tracks.flatMap((t) => t.clips).find((x) => x.id === id);
    return { text: c.text, color: c.style.color, bold: c.style.bold, size: c.style.size, undo: window.videoEditor.state().undoLabel };
  }, ids.plain);
  details.applied = { ok: plain.text === "Plain" && plain.color === "#ffd400" && plain.bold === true && plain.size === 120 && plain.undo === "Text style Yellow punch", plain };

  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".project-card").first().click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate((id) => window.videoEditor.select([id]), ids.plain);
  details.kept = { ok: (await section.getByRole("button", { name: "Yellow punch", exact: true }).count()) === 1 };
  await section.getByRole("button", { name: "Delete style Yellow punch" }).click();
  details.deleted = { ok: (await section.getByRole("button", { name: "Yellow punch", exact: true }).count()) === 0 };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
