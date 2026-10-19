// Save the frame under the playhead from the player (Premiere's Export
// Frame, CapCut's still frame): the camera button and Mod+Shift+E write a
// PNG at the project's own size without the export dialog. The browser's
// save picker is replaced by one that keeps the bytes, so the drive reads
// the PNG's header.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(() => {
    window.__saved = [];
    window.showSaveFilePicker = async (o) => ({
      name: o.suggestedName,
      createWritable: async () => {
        const parts = [];
        return {
          write: async (c) => parts.push(c.data ?? c),
          close: async () => {
            const bytes = parts[0];
            const v = new DataView(bytes.buffer, bytes.byteOffset);
            window.__saved.push({ name: o.suggestedName, png: bytes[1] === 0x50 && bytes[2] === 0x4e, width: v.getUint32(16), height: v.getUint32(20) });
          },
        };
      },
    });
    const api = window.videoEditor;
    api.exec("set_project", { width: 1080, height: 1920 });
    api.exec("add_color_clip", { color: "#cc3366", start: 0, duration: 2 });
  });
  const saved = () => page.evaluate(() => window.__saved);
  const details = {};
  await page.getByRole("button", { name: "Save frame as PNG" }).click();
  await page.waitForFunction(() => window.__saved.length === 1);
  const [first] = await saved();
  details.button = { ok: first.png && first.width === 1080 && first.height === 1920 && / frame\.png$/.test(first.name), first };
  details.toast = { ok: (await page.locator(".toast", { hasText: "Saved" }).count()) >= 1 };
  await page.keyboard.press("Control+Shift+E");
  await page.waitForFunction(() => window.__saved.length === 2, null, { timeout: 10000 }).catch(() => {});
  details.key = { ok: (await saved()).length === 2 };
  details.tip = { ok: /\(Ctrl\+Shift\+E\)$/.test(await page.getByRole("button", { name: "Save frame as PNG" }).getAttribute("data-tip")) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
