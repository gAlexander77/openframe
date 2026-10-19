// The inspector's chrome: turning Low-pass on brings its new rows into
// view, nothing runs past the inspector's right edge (Reverb's four
// presets at 1280 px wrapped instead of cutting off Cathedral), the
// Reverb row can be scrolled to, and sections keep their open or closed
// state across a reload.
async (page) => {
  page.setDefaultTimeout(6000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const ids = await page.evaluate(async () => {
    const ve = window.videoEditor;
    ve.exec("set_project", { name: "Inspector chrome" });
    const [m] = await ve.import([{ name: "music-30s.mp3", src: `${location.origin}/fixtures/media/music-30s.mp3` }]);
    ve.exec("add_color_clip", { color: "#446688", start: 0, duration: 3 });
    ve.exec("add_media_clip", { asset_id: m.id, start: 0, duration: 6 });
    const clips = ve.project().tracks.flatMap((t) => t.clips);
    return { color: clips.find((c) => c.type === "color").id, music: clips.find((c) => c.type === "audio").id };
  });
  const inspector = page.getByRole("region", { name: "Inspector" });
  const body = inspector.locator(".insp-body");
  const details = {};

  await page.evaluate((id) => window.videoEditor.select([id]), ids.music);
  const fx = inspector.getByRole("button", { name: "Effects", exact: true });
  if ((await fx.getAttribute("aria-expanded")) === "false") await fx.click();
  await inspector.getByRole("switch", { name: "Low-pass" }).click();
  await page.waitForTimeout(200);
  details.revealed = await page.evaluate(() => {
    const b = document.querySelector(".inspector-panel .insp-body");
    const box = b.getBoundingClientRect();
    const res = [...b.querySelectorAll(".insp-label")].find((l) => l.textContent === "Resonance").getBoundingClientRect();
    return { ok: res.top >= box.top && res.bottom <= box.bottom, noSideways: b.scrollWidth <= b.clientWidth };
  });
  details.revealed.ok &&= details.revealed.noSideways;
  const bb = await body.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(200);
  details.reverbReachable = await page.evaluate(() => {
    const b = document.querySelector(".inspector-panel .insp-body").getBoundingClientRect();
    const seg = [...document.querySelectorAll(".inspector-panel .insp-label")].find((l) => l.textContent === "Reverb").closest(".insp-row").getBoundingClientRect();
    return { ok: seg.top >= b.top && seg.bottom <= b.bottom && seg.right <= b.right };
  });
  await page.locator(".inspector-panel").screenshot({ path: "scratch/inspector-lowpass.png" });

  // Close the picture's Transform section; it stays closed after a reload.
  await page.evaluate((id) => window.videoEditor.select([id]), ids.color);
  const transform = inspector.getByRole("button", { name: "Transform", exact: true });
  if ((await transform.getAttribute("aria-expanded")) === "true") await transform.click();
  await page.waitForFunction(() => /Saved/.test(document.querySelector(".save-state")?.textContent ?? ""), null, { timeout: 8000 }).catch(() => undefined);
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".project-card", { hasText: "Inspector chrome" }).click();
  await page.locator(".timeline-panel").waitFor();
  await page.evaluate((id) => window.videoEditor.select([id]), ids.color);
  details.sectionRemembered = { ok: (await transform.getAttribute("aria-expanded")) === "false" };
  await page.evaluate((id) => window.videoEditor.select([id]), ids.music);
  details.openRemembered = { ok: (await inspector.getByRole("button", { name: "Effects", exact: true }).getAttribute("aria-expanded")) === "true" };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
