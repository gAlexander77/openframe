// Home exposes project entry points and Help; editor menus remain available inside a project.
async (page) => {
  await page.goto("http://localhost:1420");
  await page.waitForFunction(() => !!window.videoEditor);
  const details = {};
  const names = await page.locator(".menubar-button").allTextContents();
  details.homeMenus = { ok: names.join(",") === "File,Help", names };
  await page.locator(".menubar-button", { hasText: /^File$/ }).click();
  const file = await page.locator(".menu-label").allTextContents();
  details.file = { ok: file.join(",") === "New project,Open project,Open project file…,Import timeline…", items: file };
  await page.keyboard.press("Escape");
  await page.locator(".menubar-button", { hasText: /^Help$/ }).click();
  const help = await page.locator(".menu-label").allTextContents();
  details.help = { ok: help.length === 2 && /shortcuts/i.test(help[0]) && /^About /.test(help[1]), items: help };
  const about = await page.getByRole("menuitem", { name: /^About / }).textContent();
  await page.getByRole("menuitem", { name: /^About / }).click();
  // About is a dialog with the name and version (about.js checks the rest).
  const shown = await page.locator("dialog.about-dialog .about-head").innerText();
  const [name, version] = about.replace(/^About /, "").split(/(v\d\S*)/);
  details.about = { ok: shown.includes(name.trim()) && shown.includes(`Version ${version.slice(1)}`), shown, about };
  await page.keyboard.press("Escape");
  await page.locator(".menubar-button", { hasText: /^Help$/ }).click();
  await page.getByRole("menuitem", { name: /shortcuts/i }).click();
  details.shortcuts = { ok: await page.getByRole("dialog").isVisible() };
  await page.keyboard.press("Escape");
  await page.locator(".create-card").click();
  const editor = await page.locator(".menubar-button").allTextContents();
  details.editor = { ok: editor.join(",") === "File,Edit,Timeline,View,Help", names: editor };
  await page.locator(".menubar-button", { hasText: /^File$/ }).click();
  const items = await page.locator(".menu-label").allTextContents();
  details.editorFile = { ok: items.includes("Save project") && items.some((s) => /^Import/.test(s)) && items.some((s) => /^Export/.test(s)), items };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
