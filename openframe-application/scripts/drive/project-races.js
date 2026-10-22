// Hold real storage operations to exercise edits and navigation during I/O.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  page.setDefaultTimeout(15000);
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  // A new project is saved once touched (ADR-073): the held edit below is
  // its first save.
  const details = {};
  const file = async (name) => {
    await page.locator(".menubar-button", { hasText: /^File$/ }).click();
    await page.getByRole("menuitem", { name: new RegExp(`^${name}(?! file)`) }).click();
  };
  const first = await page.evaluate(() => window.videoEditor.project().id);
  await page.evaluate(() => {
    const write = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      if (window.__holdSave && /\.json(?:\.tmp)?$/.test(this.name)) {
        window.__holdSave = false;
        await new Promise((resolve) => { window.__releaseSave = resolve; });
      }
      return write.apply(this, args);
    };
    const read = FileSystemFileHandle.prototype.getFile;
    FileSystemFileHandle.prototype.getFile = async function (...args) {
      if (window.__failLoad === this.name) throw new Error("Injected read failure");
      if (window.__holdLoad === this.name) {
        window.__holdLoad = null;
        await new Promise((resolve) => { window.__releaseLoad = resolve; });
      }
      return read.apply(this, args);
    };
    window.__holdSave = true;
    window.videoEditor.exec("add_text", { text: "Before save", start: 0, duration: 2 });
  });
  await file("Back to home");
  await page.waitForFunction(() => !!window.__releaseSave);
  await page.evaluate(() => {
    window.videoEditor.exec("add_text", { text: "During save", start: 3, duration: 2 });
    window.__releaseSave();
    window.__releaseSave = null;
  });
  await page.locator(".create-card").waitFor();
  const saved = await page.evaluate(async (id) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("projects");
    return JSON.parse(await (await (await dir.getFileHandle(`${id}.json`)).getFile()).text());
  }, first);
  details.editsDuringSavePersist = { ok: saved.tracks.some((t) => t.clips.some((c) => c.text === "During save")) };

  await page.locator(".project-card").first().waitFor();
  await page.evaluate((id) => { window.__holdLoad = `${id}.json`; }, first);
  await page.locator(".project-card").first().click();
  await page.waitForFunction(() => !!window.__releaseLoad);
  const disabled = await page.locator(".create-card").isDisabled();
  await page.screenshot({ path: "scratch/project-opening.png" });
  // Shortcut actions must also respect the same guard as the buttons.
  await page.evaluate(() => window.videoEditor.action("newProject"));
  details.loadingBlocksOtherNavigation = { ok: disabled && await page.locator(".home").isVisible() };
  await page.evaluate(() => { window.__releaseLoad(); window.__releaseLoad = null; });
  await page.locator(".timeline-panel").waitFor();
  details.requestedProjectOpens = { ok: await page.evaluate((id) => window.videoEditor.project().id === id, first) };

  await page.evaluate(() => {
    window.__holdSave = true;
    window.videoEditor.action("newProject");
  });
  await page.waitForFunction(() => !!window.__releaseSave);
  await page.evaluate(() => {
    window.videoEditor.action("newProject");
    window.videoEditor.action("openProject");
    window.__releaseSave();
    window.__releaseSave = null;
  });
  await page.waitForFunction((id) => window.videoEditor.project().id !== id, first);
  // Touch the new project so it is saved (ADR-073) and listed on Home.
  await page.evaluate(() => window.videoEditor.exec("add_text", { text: "Touched", start: 0, duration: 2 }));
  await page.waitForFunction(() => document.querySelector(".save-state")?.textContent?.startsWith("Saved"));
  details.firstNavigationWins = { ok: await page.locator(".timeline-panel").isVisible() };
  // Read the id before leaving: Home holds no project (ADR-144).
  const current = await page.evaluate(() => window.videoEditor.project().id);
  await file("Open project");
  await page.locator(".project-card").first().waitFor();
  await page.evaluate((id) => { window.__failLoad = `${id}.json`; }, current);
  await page.locator(".project-card").first().click();
  await page.getByText(/Couldn't open the project: Injected read failure/).waitFor();
  details.loadFailureRecovers = { ok: await page.locator(".home").isVisible() && await page.locator(".create-card").isEnabled() };
  await page.evaluate(() => { window.__failLoad = null; });
  const card = page.locator(".project-card").first();
  const cards = await page.locator(".project-card").count();
  // Delete moves the project to Recently deleted at once (ADR-078); from
  // the keyboard it must not open the card, and Undo brings it back.
  await card.locator(".project-delete").focus();
  await page.keyboard.press("Enter");
  const undo = page.locator(".toast-action", { hasText: "Undo" });
  await undo.waitFor();
  details.deleteKeyboardDoesNotOpen = { ok: await page.locator(".home").isVisible() && await page.locator(".home-trash").count() === 1 };
  await undo.click();
  await page.waitForFunction((n) => document.querySelectorAll(".project-card").length === n && !document.querySelector(".home-trash"), cards);
  await card.focus();
  await page.keyboard.press("Space");
  await page.locator(".timeline-panel").waitFor();
  details.spaceOpensCard = { ok: await page.evaluate((id) => window.videoEditor.project().id === id, current) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
