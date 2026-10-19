// Typed values (ADR-072): a number typed in the inspector and left by
// clicking another clip on the timeline is kept (the press keeps focus, so
// no blur ever came); Details > Name commits on Enter and on selecting a
// clip; an empty or junk field keeps its value, and a decimal comma reads
// as a point; Preferences keep a typed length when Escape closes them.
async (page) => {
  page.setDefaultTimeout(6000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const [a, b] = await page.evaluate(() => {
    const ve = window.videoEditor;
    ve.exec("add_color_clip", { color: "#884422", start: 0, duration: 3 });
    ve.exec("add_color_clip", { color: "#224488", start: 3, duration: 3 });
    return ve.project().tracks.flatMap((t) => t.clips).map((c) => c.id);
  });
  const clip = (id) => page.evaluate((id) => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.id === id), id);
  const inspector = page.getByRole("region", { name: "Inspector" });
  const details = {};

  // Type 50 in Scale and click the other clip on the timeline.
  await page.locator(`[data-clip="${a}"]`).click();
  const scale = inspector.getByLabel("Scale value", { exact: true });
  await scale.fill("50");
  await page.locator(`[data-clip="${b}"]`).click();
  details.keptOnClipClick = { ok: (await clip(a)).transform.scale === 0.5 && (await page.evaluate(() => window.videoEditor.state().selection[0])) === b, scale: (await clip(a)).transform.scale };

  // Junk keeps the value; a decimal comma is a point.
  await page.locator(`[data-clip="${a}"]`).click();
  for (const junk of ["", "abc"]) {
    await scale.fill(junk);
    await scale.press("Enter");
  }
  details.junkIgnored = { ok: (await clip(a)).transform.scale === 0.5 && (await scale.inputValue()) === "50", shown: await scale.inputValue() };
  const rotate = inspector.getByLabel("Rotate value", { exact: true });
  await rotate.fill("1,5");
  await rotate.press("Enter");
  details.decimalComma = { ok: (await clip(a)).transform.rotation === 1.5, rotation: (await clip(a)).transform.rotation };

  // Details > Name: Enter commits; a typed name survives selecting a clip.
  await page.evaluate(() => window.videoEditor.select([]));
  const name = inspector.getByLabel("Project name", { exact: true });
  await name.fill("Named with Enter");
  await name.press("Enter");
  details.nameEnter = { ok: (await page.evaluate(() => window.videoEditor.project().name)) === "Named with Enter" };
  await name.fill("Named then left");
  await page.locator(`[data-clip="${a}"]`).click();
  details.nameKeptOnClipClick = { ok: (await page.evaluate(() => window.videoEditor.project().name)) === "Named then left" };

  // Preferences: cleared keeps, a comma reads, Escape keeps what was typed.
  const openPrefs = async () => {
    await page.locator(".menubar-item > button", { hasText: "Edit" }).click();
    await page.getByRole("menuitem", { name: /Preferences/ }).click();
    await page.getByLabel("Pictures seconds", { exact: true }).waitFor();
  };
  await openPrefs();
  const pics = page.getByLabel("Pictures seconds", { exact: true });
  await pics.fill("");
  await pics.press("Enter");
  details.prefsClearedKeeps = { ok: (await pics.inputValue()) === "5", shown: await pics.inputValue() };
  await pics.fill("1,5");
  await pics.press("Enter");
  details.prefsComma = { ok: (await pics.inputValue()) === "1.5" };
  await pics.fill("7");
  await page.keyboard.press("Escape");
  await page.getByLabel("Pictures seconds", { exact: true }).waitFor({ state: "detached" });
  await openPrefs();
  details.prefsEscapeKeeps = { ok: (await pics.inputValue()) === "7", shown: await pics.inputValue() };
  await page.keyboard.press("Escape");
  return { ok: Object.values(details).every((d) => d.ok), details };
};
