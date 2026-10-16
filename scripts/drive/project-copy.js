async page => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.locator(".project-name").click();
  await page.locator(".project-name-input").fill("__QA_20261016_copy_source");
  await page.locator(".project-name-input").press("Enter");
  await page.evaluate(() => {
    window.videoEditor.exec("add_text", { text: "Original version", start: 2, duration: 2 });
  });
  const details = {};
  const original = await page.evaluate(() => window.videoEditor.project());
  const openDialog = async () => {
    await page.locator(".menubar-button", { hasText: /^File$/ }).click();
    await page.getByRole("menuitem", { name: /^Save a copy/ }).click();
    await page.getByRole("dialog", { name: "Save a copy", exact: true }).waitFor();
  };
  await openDialog();
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill("__QA_20261016_copy_snapshot");
  await page.getByRole("checkbox", { name: "Open the copy after saving" }).uncheck();
  await page.screenshot({ path: "scratch/project-copy-desktop.png", animations: "disabled" });
  await page.getByRole("button", { name: "Save copy", exact: true }).click();
  await page.getByRole("dialog", { name: "Save a copy", exact: true }).waitFor({ state: "detached" });
  details.savedWithoutSwitching = await page.evaluate(async (source) => {
    const { platform } = await import("/src/platform/index.ts");
    const entry = (await platform.listProjects()).find((p) => p.name === "__QA_20261016_copy_snapshot");
    const copy = await platform.loadProject(entry.id);
    return { ok: window.videoEditor.project().id === source.id && copy.id !== source.id && JSON.stringify(copy.tracks) === JSON.stringify(source.tracks), platform: platform.kind };
  }, original);

  await openDialog();
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill("__QA_20261016_copy_alternate");
  await page.evaluate(async () => {
    const { platform } = await import("/src/platform/index.ts");
    const save = platform.saveProject;
    window.__copyFail = true;
    platform.saveProject = async (p, summary) => {
      if (window.__copyFail && p.name === "__QA_20261016_copy_alternate") throw new Error("Injected copy write failure");
      return save(p, summary);
    };
  });
  await page.getByRole("button", { name: "Save copy", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Injected copy write failure" }).waitFor();
  details.failedCopyKeepsOriginal = { ok: await page.evaluate((id) => window.videoEditor.project().id === id, original.id) && await page.getByRole("textbox", { name: "Project name", exact: true }).inputValue() === "__QA_20261016_copy_alternate" };
  await page.evaluate(() => { window.__copyFail = false; });
  await page.getByRole("button", { name: "Save copy", exact: true }).click();
  await page.getByRole("dialog", { name: "Save a copy", exact: true }).waitFor({ state: "detached" });
  details.retryOpensCopy = { ok: await page.evaluate((id) => window.videoEditor.project().id !== id && window.videoEditor.project().name === "__QA_20261016_copy_alternate" && !window.videoEditor.state().undoLabel, original.id) };
  await page.evaluate(() => window.videoEditor.exec("add_text", { text: "Only in alternate", start: 6, duration: 1 }));
  details.originalUnchanged = await page.evaluate(async (source) => {
    const { platform } = await import("/src/platform/index.ts");
    const saved = await platform.loadProject(source.id);
    return { ok: JSON.stringify(saved.tracks) === JSON.stringify(source.tracks) };
  }, original);
  await openDialog();
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill(" ");
  details.blankNameDisabled = { ok: await page.getByRole("button", { name: "Save copy", exact: true }).isDisabled() };
  await page.setViewportSize({ width: 1100, height: 680 });
  details.dialogFits = { ok: await page.locator(".editor-dialog").evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().bottom <= innerHeight) };
  await page.keyboard.press("Escape");
  details.cancelLeavesEditor = { ok: await page.locator(".timeline-panel").isVisible() && await page.locator(".editor-dialog").count() === 0 };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
