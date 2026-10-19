// New/Open through menus and shortcuts, with real persistence and failed saves.
async (page) => {
  page.setDefaultTimeout(15000);
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  const details = {};
  const file = async (name) => {
    await page.locator(".menubar-button", { hasText: /^File$/ }).click();
    await page.getByRole("menuitem", { name: new RegExp(`^${name}(?! file)`) }).click();
  };
  const id = () => page.evaluate(() => window.videoEditor.project().id);
  const differentProject = (old) => page.waitForFunction((old) => !!document.querySelector(".timeline-panel") && window.videoEditor.project().id !== old, old);
  const home = async () => {
    await page.locator(".create-card").waitFor();
    await page.waitForFunction(() => document.activeElement === document.querySelector(".home-search input"));
  };
  const stored = (id) => page.evaluate(async (id) => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("projects");
    return JSON.parse(await (await (await dir.getFileHandle(`${id}.json`)).getFile()).text());
  }, id);

  const initial = await id();
  await file("New project");
  await differentProject(initial);
  const first = await id();
  details.homeNew = { ok: first !== initial };
  await page.locator(".project-name").click();
  await page.locator(".project-name-input").fill("Lifecycle source");
  await page.locator(".project-name-input").press("Enter");
  await page.evaluate(() => window.videoEditor.exec("add_text", { text: "Saved before New", start: 0, duration: 2 }));
  await file("New project");
  await differentProject(first);
  const saved = await stored(first);
  details.editorNew = { ok: saved.name === "Lifecycle source" && saved.tracks.some((t) => t.clips.some((c) => c.text === "Saved before New")) };

  await file("Open project");
  await home();
  await page.locator(".home-search input").fill("Lifecycle source");
  await page.waitForFunction(() => document.querySelectorAll(".project-card").length === 1);
  await page.locator(".project-card").click();
  await page.waitForFunction((first) => !!document.querySelector(".timeline-panel") && window.videoEditor.project().id === first, first);
  details.openSaved = { ok: true };
  await file("Open project");
  await home();
  await page.getByRole("heading", { name: "Projects", exact: true }).click();
  await file("Open project");
  await home();
  details.openAlreadyHome = { ok: true };
  await page.keyboard.press("Control+n");
  await differentProject(first);
  const current = await id();
  details.keyboardHomeNew = { ok: true };

  // Fail only project JSON writes, inside this isolated browser profile.
  await page.evaluate(() => {
    window.__failSaves = true;
    window.__failedWrites = 0;
    const original = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = function (...args) {
      if (window.__failSaves && /\.json(?:\.tmp)?$/.test(this.name)) {
        window.__failedWrites++;
        return Promise.reject(new DOMException("Injected storage failure", "QuotaExceededError"));
      }
      return original.apply(this, args);
    };
    window.videoEditor.exec("add_text", { text: "Keep unsaved work", start: 0, duration: 2 });
  });
  for (const action of ["New project", "Open project", "Save project", "Back to home"]) {
    const before = await page.evaluate(() => window.__failedWrites);
    await file(action);
    await page.waitForFunction((before) => window.__failedWrites > before && document.querySelector(".save-state")?.textContent === "Not saved", before);
    const kept = await page.evaluate((id) => window.videoEditor.project().id === id && !!document.querySelector(".timeline-panel") && window.videoEditor.project().tracks.some((t) => t.clips.some((c) => c.text === "Keep unsaved work")), current);
    details[`failedSave-${action}`] = { ok: kept };
  }
  details.noFalseSaveToast = { ok: !(await page.locator(".toast").allTextContents()).includes("Project saved") };
  await page.evaluate(() => { window.__failSaves = false; });
  await file("Open project");
  await home();
  const recovered = await stored(current);
  details.saveRetry = { ok: recovered.tracks.some((t) => t.clips.some((c) => c.text === "Keep unsaved work")) };
  await page.locator(".project-card").first().click();
  await page.waitForFunction((id) => !!document.querySelector(".timeline-panel") && window.videoEditor.project().id === id, current);
  await page.locator(".player-panel .panel-head").click();
  await page.keyboard.press("Control+n");
  await differentProject(current);
  details.keyboardEditorNew = { ok: true };
  await page.keyboard.press("Control+o");
  await home();
  details.keyboardEditorOpen = { ok: true };
  await page.getByRole("heading", { name: "Projects", exact: true }).click();
  await page.keyboard.press("Control+o");
  await home();
  details.keyboardHomeOpen = { ok: true };
  await page.getByRole("heading", { name: "Projects", exact: true }).click();
  const closed = await page.evaluate(() => JSON.stringify(window.videoEditor.project()));
  await page.keyboard.press("Space");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("m");
  details.homeIgnoresEditing = { ok: await page.evaluate((closed) => JSON.stringify(window.videoEditor.project()) === closed && !window.videoEditor.state().playing, closed) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
