// The export-complete card shows a loudness normalization that reached its
// target as success (green, a check), not as a warning (amber, an alert):
// a real export through the dialog, the save picker answered with a file
// in the browser's own storage (headless has no save dialog).
async (page) => {
  page.setDefaultTimeout(60000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.evaluate(() => {
    window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle("done-card.mp4", { create: true });
  });
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [m] = await ve.import([{ name: "music-30s.mp3", src: `${location.origin}/fixtures/media/music-30s.mp3` }]);
    ve.exec("add_color_clip", { color: "#2a4d6e", start: 0, duration: 2 });
    ve.exec("add_media_clip", { asset_id: m.id, start: 0, duration: 2 });
  });
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  await page.locator("#export-loudness").selectOption("-14");
  await page.locator(".export-dialog").getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("heading", { name: "Export complete" }).waitFor();
  const card = await page.evaluate(() => {
    const ok = document.querySelector(".export-note.ok");
    const warn = document.querySelector(".export-note:not(.ok)");
    return { info: ok?.textContent ?? "", color: ok ? getComputedStyle(ok).color : "", warning: warn?.textContent ?? "" };
  });
  await page.waitForTimeout(300);
  await page.locator(".export-dialog").screenshot({ path: "scratch/export-done-card.png" });
  await page.keyboard.press("Escape");
  const details = {
    successShownAsSuccess: { ok: /normalized to -1[34]\.\d LUFS/.test(card.info) && card.color === "rgb(60, 207, 142)" && !/Loudness/.test(card.warning), ...card },
  };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
