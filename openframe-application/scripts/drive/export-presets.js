// Export presets drive: built-in presets set the dialog's choices (GIF:
// silent 480p 15 fps; YouTube: MP4 H.264 1080p at the project rate); a
// changed setting reads Custom and can be saved under a name, which
// survives closing the dialog and can be deleted.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.evaluate(() => {
    localStorage.removeItem("export.presets");
    localStorage.removeItem("export.settings");
  });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => window.videoEditor.exec("add_color_clip", { color: "#305070", start: 0, duration: 2 }));
  const details = {};
  const open = async () => {
    await page.keyboard.press("Control+E");
    await page.getByRole("dialog", { name: "Export" }).waitFor();
  };
  const val = (id) => page.locator(id).inputValue();
  await open();
  await page.locator("#export-preset").selectOption({ label: "Animated GIF" });
  details.gif = { ok: (await val("#export-format")) === "gif" && (await val("#export-res")) === "480p" && (await val("#export-fps")) === "15" };
  await page.locator("#export-preset").selectOption({ label: "YouTube 1080p" });
  details.youtube = {
    ok: (await val("#export-format")) === "mp4" && (await val("#export-codec")) === "avc" && (await val("#export-res")) === "1080p" && (await val("#export-fps")) === "30",
  };
  await page.locator("#export-res").selectOption("720p");
  details.custom = { ok: (await val("#export-preset")) === "" };
  await page.getByRole("button", { name: "Save preset…" }).click();
  await page.getByRole("textbox", { name: "Preset name" }).fill("My 720");
  await page.keyboard.press("Enter");
  details.saved = { ok: (await page.locator("#export-preset option:checked").innerText()) === "My 720" && (await page.getByRole("dialog", { name: "Export" }).isVisible()) };
  await page.screenshot({ path: "scratch/export-presets.png" });
  await page.keyboard.press("Escape");
  await open();
  details.kept = { ok: (await page.locator("#export-preset option:checked").innerText()) === "My 720" };
  await page.getByRole("button", { name: "Delete preset" }).click();
  details.deleted = { ok: (await page.locator("#export-preset option", { hasText: "My 720" }).count()) === 0 };
  await page.keyboard.press("Escape");
  return { ok: Object.values(details).every((d) => d.ok), details };
};
