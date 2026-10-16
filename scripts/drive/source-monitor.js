async page => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload(); await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click(); await page.locator(".timeline-panel").waitFor();
  await page.locator(".project-name").click(); await page.locator(".project-name-input").fill("__QA_20261016_source"); await page.locator(".project-name-input").press("Enter");
  await page.evaluate(async () => { await window.videoEditor.import([
    { name: "framecode-30.mp4", src: (window.videoEditor.platform() === "desktop" ? "F:/Dev/video-editor" : location.origin) + "/fixtures/media/framecode-30.mp4" },
    { name: "music-30s.mp3", src: (window.videoEditor.platform() === "desktop" ? "F:/Dev/video-editor" : location.origin) + "/fixtures/media/music-30s.mp3" },
  ]); });
  const details = {};
  await page.getByRole("button", { name: "Preview framecode-30.mp4", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.source-monitor canvas')?.dataset.frame === "0");
  const seek = async (f) => { await page.getByRole("slider", { name: "Source position" }).fill(String(f)); await page.waitForFunction((f) => document.querySelector('.source-monitor canvas')?.dataset.frame === String(f), f); };
  await seek(30); await page.getByRole("button", { name: "Mark In", exact: true }).click();
  await seek(89); await page.getByRole("button", { name: "Mark Out", exact: true }).click();
  details.marks = { ok: await page.getByLabel("Source In", { exact: true }).textContent() === "00:00:01:00" && await page.getByLabel("Source Out", { exact: true }).textContent() === "00:00:02:29" };
  await page.getByRole("button", { name: "Play source", exact: true }).click();
  await page.waitForFunction(() => +document.querySelector('.source-scrub').value > 35 && +document.querySelector('.source-scrub').value < 89);
  await page.getByRole("button", { name: "Pause source", exact: true }).click();
  details.rangePlayback = { ok: true };
  await seek(60);
  details.programUnchanged = { ok: await page.evaluate(() => window.videoEditor.project().tracks.every((t) => t.clips.length === 0) && window.videoEditor.state().playhead === 0) };
  await page.screenshot({ path: "scratch/source-monitor-desktop.png", animations: "disabled" });
  await page.getByRole("button", { name: "Add range", exact: true }).click();
  details.correctClip = { ok: await page.evaluate(() => { const c = window.videoEditor.project().tracks[0].clips[0]; return c.in === 1 && c.duration === 60 && c.start === 0; }) };
  await page.evaluate(() => window.videoEditor.action("undo"));
  details.undo = { ok: await page.evaluate(() => window.videoEditor.project().tracks.every((t) => t.clips.length === 0)) };
  await page.getByRole("button", { name: "Preview music-30s.mp3", exact: true }).click();
  await page.getByRole("slider", { name: "Source position" }).fill("90");
  await page.getByRole("button", { name: "Mark In", exact: true }).click();
  await page.getByRole("slider", { name: "Source position" }).fill("119");
  await page.getByRole("button", { name: "Mark Out", exact: true }).click();
  await page.getByRole("button", { name: "Play source", exact: true }).click();
  await page.getByRole("button", { name: "Pause source", exact: true }).waitFor();
  await page.setViewportSize({ width: 1100, height: 680 });
  details.narrowFit = { ok: await page.locator(".source-monitor").evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().bottom <= innerHeight) };
  await page.getByRole("button", { name: "Add range", exact: true }).click();
  details.audioRange = { ok: await page.evaluate(() => { const c = window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "audio"); return c?.in === 3 && c.duration === 30; }) };
  await page.getByRole("button", { name: "Preview framecode-30.mp4", exact: true }).click();
  await page.getByRole("button", { name: "Mark In", exact: true }).click();
  await page.keyboard.press("Escape");
  details.cancelDoesNotAdd = { ok: await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).length === 1) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
