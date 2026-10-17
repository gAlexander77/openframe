// Custom shortcuts drive: in the shortcuts panel, give Add marker the B key
// (the Blade tool's): the panel names the conflict, Replace moves it, B
// then adds a marker instead of picking the blade; the change survives a
// reload; Reset all brings the blade back.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.evaluate(() => localStorage.removeItem("ve.keymap"));
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  const open = async () => {
    await page.locator(".create-card").click();
    await page.locator(".timeline-panel").waitFor();
  };
  await open();
  const details = {};
  const markers = () => page.evaluate(() => window.videoEditor.project().markers.length);
  const tool = () => page.evaluate(() => window.videoEditor.state().tool);

  await page.keyboard.press("Control+/");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await dialog.waitFor();
  await dialog.getByRole("searchbox").fill("marker");
  await dialog.getByRole("button", { name: "Change shortcut for Add marker" }).click();
  await page.keyboard.press("B");
  const alert = dialog.getByRole("alert");
  details.conflictNamed = { ok: /Split tool|Blade/i.test(await alert.innerText()), text: await alert.innerText() };
  await page.screenshot({ path: "scratch/shortcuts-conflict.png" });
  await alert.getByRole("button", { name: "Replace" }).click();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });

  const m0 = await markers();
  await page.locator(".tl-ruler").click({ position: { x: 400, y: 10 } });
  await page.keyboard.press("B");
  details.rebound = { ok: (await markers()) === m0 + 1 && (await tool()) === "select", tool: await tool() };

  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await open();
  const m1 = await markers();
  await page.locator(".tl-ruler").click({ position: { x: 500, y: 10 } });
  await page.keyboard.press("B");
  details.persists = { ok: (await markers()) === m1 + 1 };

  await page.keyboard.press("Control+/");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Reset all shortcuts" }).click();
  await page.keyboard.press("Escape");
  await page.locator(".tl-ruler").click({ position: { x: 600, y: 10 } });
  await page.keyboard.press("B");
  details.resetAll = { ok: (await tool()) === "blade", tool: await tool() };
  await page.keyboard.press("A");
  return { ok: Object.values(details).every((d) => d.ok), details };
};
